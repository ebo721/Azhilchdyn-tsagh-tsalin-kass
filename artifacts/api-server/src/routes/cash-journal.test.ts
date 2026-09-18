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
  let accountantCookie: string;
  let userId: number;
  let accountantUserId: number;
  let cashAccountId: number;
  let bankAccountId: number;
  let inventoryAccountId: number;
  let revenueAccountId: number;
  let mappedRevenueAccountId: number;
  let expenseAccountId: number;
  let testAccountIds: number[] = [];
  const cashIds: number[] = [];
  const journalIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "cash-journal-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user, accountant] = await db.insert(usersTable).values([
      {
        username: `cash-journal-${suffix}`,
        normalizedUsername: `cash-journal-${suffix}`,
        role: "admin",
        passwordHash: "not-used-by-session-tests",
      },
      {
        username: `cash-journal-accountant-${suffix}`,
        normalizedUsername: `cash-journal-accountant-${suffix}`,
        role: "accountant",
        passwordHash: "not-used-by-session-tests",
      },
    ]).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    accountantUserId = accountant.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    accountantCookie = `${hrCookie.name}=${createStaffSession(accountant)}`;

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
       .where(inArray(chartOfAccountsTable.code, ["1000", "1010", "1500", "4900", "6900"]));
    cashAccountId = canonical.find((row) => row.code === "1000")?.id ?? accounts[0].id;
    bankAccountId = canonical.find((row) => row.code === "1010")?.id ?? accounts[0].id;
    inventoryAccountId = canonical.find((row) => row.code === "1500")?.id ?? accounts[0].id;
    revenueAccountId = canonical.find((row) => row.code === "4900")?.id ?? accounts[1].id;
    const [mappedRevenue] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "4000"));
    mappedRevenueAccountId = mappedRevenue?.id ?? accounts[1].id;
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
    await db.delete(usersTable).where(inArray(usersTable.id, [userId, accountantUserId]));
  });

  async function requestPath(path: string, init: RequestInit) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    });
  }

  async function request(body: Record<string, unknown>) {
    return requestPath("/api/cash/transactions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("allows only admins to edit cash transactions", async () => {
    const body = JSON.stringify({
      type: "expense",
      category: "Бусад",
      description: "Unauthorized cash edit",
      amount: 1,
      date: "2025-01-20",
      incomeMonth: null,
    });
    const [transactionEdit, incomeMonthEdit] = await Promise.all([
      fetch(`${baseUrl}/api/cash/transactions/999999`, {
        method: "PUT",
        headers: { cookie: accountantCookie, "content-type": "application/json" },
        body,
      }),
      fetch(`${baseUrl}/api/cash/transactions/999999/income-month`, {
        method: "PATCH",
        headers: { cookie: accountantCookie, "content-type": "application/json" },
        body: JSON.stringify({ incomeMonth: "2025-01" }),
      }),
    ]);
    assert.equal(transactionEdit.status, 403);
    assert.equal(incomeMonthEdit.status, 403);
  });

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

  it("uses safe journal fallbacks for incompatible mapped categories without changing cash metadata", async () => {
    const income = await request({
      type: "income",
      category: "Бараа материал",
      description: "Incompatible income",
      amount: 11,
      date: "2025-01-23",
      incomeMonth: "2025-01",
    });
    assert.equal(income.status, 201);
    const incomeValue = await income.json() as { id: number; journalEntryId: number; accountId: number | null; accountCode: string | null; accountName: string | null };
    assert.equal(incomeValue.accountId, inventoryAccountId);
    assert.equal(incomeValue.accountCode, "1500");
    assert.ok(incomeValue.journalEntryId);
    cashIds.push(incomeValue.id);
    journalIds.push(incomeValue.journalEntryId);
    const incomeLines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, incomeValue.journalEntryId));
    assert.equal(incomeLines.some((line) => line.accountId === revenueAccountId && line.credit === 11), true);

    const expense = await request({
      type: "expense",
      category: "Таван толгой ХХК",
      description: "Incompatible expense",
      amount: 12,
      date: "2025-01-24",
      incomeMonth: null,
    });
    assert.equal(expense.status, 201);
    const expenseValue = await expense.json() as { id: number; journalEntryId: number; accountId: number | null; accountCode: string | null; accountName: string | null };
    assert.equal(expenseValue.accountId, mappedRevenueAccountId);
    assert.equal(expenseValue.accountCode, "4000");
    assert.ok(expenseValue.journalEntryId);
    cashIds.push(expenseValue.id);
    journalIds.push(expenseValue.journalEntryId);
    const expenseLines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, expenseValue.journalEntryId));
    assert.equal(expenseLines.some((line) => line.accountId === expenseAccountId && line.debit === 12), true);
  });

  it("replaces a changed journal exactly once and reverses the old entry", async () => {
    const lifecycleCategory = `Lifecycle ${randomUUID()}`;
    const create = await request({
      type: "expense",
      category: lifecycleCategory,
      description: "Lifecycle original",
      amount: 20,
      date: "2025-01-25",
      incomeMonth: null,
    });
    assert.equal(create.status, 201);
    const original = await create.json() as { id: number; journalEntryId: number };
    cashIds.push(original.id);
    journalIds.push(original.journalEntryId);
    const unchanged = await requestPath(`/api/cash/transactions/${original.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "expense", category: lifecycleCategory, description: "Lifecycle original", amount: 20, date: "2025-01-25", incomeMonth: null }),
    });
    assert.equal(unchanged.status, 200);
    const unchangedValue = await unchanged.json() as { journalEntryId: number };
    assert.equal(unchangedValue.journalEntryId, original.journalEntryId);
    const changed = await requestPath(`/api/cash/transactions/${original.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "expense", category: "Lifecycle changed", description: "Lifecycle replacement", amount: 35, date: "2025-01-26", incomeMonth: null }),
    });
    assert.equal(changed.status, 200);
    const replacement = await changed.json() as { journalEntryId: number };
    assert.notEqual(replacement.journalEntryId, original.journalEntryId);
    journalIds.push(replacement.journalEntryId);
    const [oldEntry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, original.journalEntryId));
    assert.equal(oldEntry.status, "void");
    const [reversal] = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "reversal"),
      eq(journalEntriesTable.sourceId, original.journalEntryId),
    ));
    assert.ok(reversal);
    journalIds.push(reversal.id);
    const sourceEntries = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "cash"),
      eq(journalEntriesTable.sourceId, original.id),
    ));
    assert.equal(sourceEntries.length, 2);
  });

  it("voids the linked journal before deleting a cash transaction", async () => {
    const create = await request({
      type: "income",
      category: `Delete ${randomUUID()}`,
      description: "Delete lifecycle",
      amount: 17,
      date: "2025-01-27",
      incomeMonth: "2025-01",
    });
    const original = await create.json() as { id: number; journalEntryId: number };
    assert.equal(create.status, 201);
    journalIds.push(original.journalEntryId);
    const removed = await requestPath(`/api/cash/transactions/${original.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, original.id));
    assert.equal(cash, undefined);
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, original.journalEntryId));
    assert.equal(entry.status, "void");
    const [reversal] = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "reversal"),
      eq(journalEntriesTable.sourceId, original.journalEntryId),
    ));
    assert.ok(reversal);
    journalIds.push(reversal.id);
  });

  it("keeps a bank-linked cash PUT idempotent and settled through bank", async () => {
    const category = `Bank linked ${randomUUID()}`;
    const create = await request({
      type: "expense",
      category,
      description: "Bank linked original",
      amount: 21,
      date: "2025-01-28",
      incomeMonth: null,
    });
    assert.equal(create.status, 201);
    const original = await create.json() as { id: number; journalEntryId: number };
    cashIds.push(original.id);
    journalIds.push(original.journalEntryId);
    await db.update(cashTransactionsTable).set({ bankTransactionId: 987654321 }).where(eq(cashTransactionsTable.id, original.id));
    await db.update(journalLinesTable)
      .set({ accountId: bankAccountId })
      .where(and(eq(journalLinesTable.journalEntryId, original.journalEntryId), eq(journalLinesTable.accountId, cashAccountId)));

    const unchanged = await requestPath(`/api/cash/transactions/${original.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "expense", category, description: "Bank linked original", amount: 21, date: "2025-01-28", incomeMonth: null }),
    });
    assert.equal(unchanged.status, 200);
    const unchangedValue = await unchanged.json() as { journalEntryId: number };
    assert.equal(unchangedValue.journalEntryId, original.journalEntryId);

    const changed = await requestPath(`/api/cash/transactions/${original.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "expense", category: `Bank linked changed ${randomUUID()}`, description: "Bank linked changed", amount: 22, date: "2025-01-29", incomeMonth: null }),
    });
    assert.equal(changed.status, 200);
    const replacement = await changed.json() as { journalEntryId: number };
    assert.notEqual(replacement.journalEntryId, original.journalEntryId);
    journalIds.push(replacement.journalEntryId);
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, replacement.journalEntryId));
    assert.equal(lines.some((line) => line.accountId === bankAccountId && line.credit === 22), true);
  });

  it("does not backfill a historical cash row with a null journal link", async () => {
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Historical",
      accountId: null,
      description: "Historical null journal",
      amount: 9,
      date: "2025-01-28",
      incomeMonth: null,
      journalEntryId: null,
    }).returning();
    cashIds.push(cash.id);
    const response = await requestPath(`/api/cash/transactions/${cash.id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "expense", category: "Historical changed", description: "Historical changed", amount: 10, date: "2025-01-29", incomeMonth: null }),
    });
    assert.equal(response.status, 200);
    const value = await response.json() as { journalEntryId: number | null };
    assert.equal(value.journalEntryId, null);
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