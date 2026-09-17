import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  chartOfAccountsTable,
  cashTransactionsTable,
  journalEntriesTable,
  journalLinesTable,
  operatingExpensesTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import cashRouter from "./cash.js";

describe("cash journal posting", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let userId: number;
  let cashAccountId: number;
  let revenueAccountId: number;
  let expenseAccountId: number;
  let testAccountIds: number[] = [];
  const cashIds: number[] = [];
  const journalIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "cash-journal-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `cash-journal-${suffix}`,
      normalizedUsername: `cash-journal-${suffix}`,
      role: "accountant",
      passwordHash: "not-used-by-session-tests",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;

    const accounts = await db.insert(chartOfAccountsTable).values([
      { code: `cash-journal-cash-${suffix}`, name: "Cash journal cash", type: "asset", normalBalance: "debit" },
      { code: `cash-journal-revenue-${suffix}`, name: "Cash journal revenue", type: "revenue", normalBalance: "credit" },
      { code: `cash-journal-expense-${suffix}`, name: "Cash journal expense", type: "expense", normalBalance: "debit" },
    ]).returning({ id: chartOfAccountsTable.id });
    testAccountIds = accounts.map((account) => account.id);
    // The route uses canonical account codes; these test rows exercise the
    // actual production mapping without changing that mapping globally.
    const canonical = await db.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code })
      .from(chartOfAccountsTable)
      .where(inArray(chartOfAccountsTable.code, ["1000", "4900", "6900"]));
    cashAccountId = canonical.find((row) => row.code === "1000")?.id ?? accounts[0].id;
    revenueAccountId = canonical.find((row) => row.code === "4900")?.id ?? accounts[1].id;
    expenseAccountId = canonical.find((row) => row.code === "6900")?.id ?? accounts[2].id;
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", requireStaffAuth, cashRouter);
    server = testApp.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (cashIds.length) {
      await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.cashTransactionId, cashIds));
      await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    }
    if (journalIds.length) {
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    }
    await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, testAccountIds));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/cash/transactions`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("posts a balanced income and links it to the cash transaction", async () => {
    const response = await request({
      type: "income",
      category: `Unmapped income ${randomUUID()}`,
      description: "Cash journal income",
      amount: 125.5,
      date: "2025-01-20",
      incomeMonth: "2025-01",
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number; journalEntryId: number | null; accountId: number | null; accountCode: string | null; accountName: string | null };
    assert.ok(value.journalEntryId);
    assert.equal(value.accountId, null);
    assert.equal(value.accountCode, null);
    assert.equal(value.accountName, null);
    cashIds.push(value.id);
    journalIds.push(value.journalEntryId!);

    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, value.id));
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, value.journalEntryId!));
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, value.journalEntryId!));
    assert.equal(cash.journalEntryId, value.journalEntryId);
    assert.equal(entry.sourceType, "cash");
    assert.equal(entry.sourceId, value.id);
    assert.equal(entry.status, "posted");
    assert.deepEqual(lines.map((line) => [line.accountId, line.debit, line.credit]).sort((a, b) => Number(a[0]) - Number(b[0])), [
      [cashAccountId, 125.5, 0],
      [revenueAccountId, 0, 125.5],
    ]);
  });

  it("posts an expense using the resolved fallback account and keeps trial balance balanced", async () => {
    const response = await request({
      type: "expense",
      category: `Unmapped expense ${randomUUID()}`,
      description: "Cash journal expense",
      amount: 42.25,
      date: "2025-01-21",
      incomeMonth: null,
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number; category: string; subcategory: string | null; journalEntryId: number; accountId: number | null; accountCode: string | null; accountName: string | null };
    assert.ok(value.journalEntryId);
    assert.equal(value.accountId, null);
    assert.equal(value.accountCode, null);
    assert.equal(value.accountName, null);
    assert.match(value.category, /^Unmapped expense /);
    assert.equal(value.subcategory, "Бусад үйл ажиллагааны зардал");
    cashIds.push(value.id);
    journalIds.push(value.journalEntryId);
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, value.journalEntryId));
    assert.deepEqual(lines.map((line) => [line.accountId, line.debit, line.credit]).sort((a, b) => Number(a[0]) - Number(b[0])), [
      [cashAccountId, 0, 42.25],
      [expenseAccountId, 42.25, 0],
    ]);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, value.id));
    assert.equal(cash.journalEntryId, value.journalEntryId);
  });

  it("rolls back the cash row when the cash posting account is unavailable", async () => {
    await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, cashAccountId));
    try {
      const response = await request({
        type: "income",
        category: "Таван толгой ХХК",
        description: "Should roll back",
        amount: 10,
        date: "2025-01-22",
        incomeMonth: "2025-01",
      });
      assert.equal(response.status, 500);
      const rows = await db.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable)
        .where(and(eq(cashTransactionsTable.description, "Should roll back"), eq(cashTransactionsTable.date, "2025-01-22")));
      assert.equal(rows.length, 0);
    } finally {
      await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, cashAccountId));
    }
  });
});