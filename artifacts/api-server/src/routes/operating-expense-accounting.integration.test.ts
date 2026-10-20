import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, operatingExpensesTable, cashTransactionsTable, journalEntriesTable, chartOfAccountsTable } from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";

describe("operating expense accounting visibility", () => {
  const prefix = `expense-status-${randomUUID()}`;
  const expenseIds: number[] = [], cashIds: number[] = [], journalIds: number[] = [];
  let server: Server, base: string, cookie: string;
  before(async () => {
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    cookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [expenseAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6900"));
    const [cashAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1000"));
    for (let i = 0; i < 4; i++) {
      const [expense] = await db.insert(operatingExpensesTable).values({
        description: `${prefix}-${i}`, accountId: expenseAccount.id, date: "2096-11-03", amount: 123,
        // A payment flag alone must not imply a cash or journal entry.
        paymentDate: i === 0 ? "2096-11-03" : null,
      }).returning();
      expenseIds.push(expense.id);
      let cashId: number | null = null;
      if (i === 1 || i === 3) {
        const [cash] = await db.insert(cashTransactionsTable).values({
          description: expense.description, type: "expense", category: "Бусад", accountId: expenseAccount.id,
          amount: 123, date: expense.date, sourceType: "operating_expense", sourceKey: `expense:${expense.id}`,
        }).returning();
        cashId = cash.id; cashIds.push(cash.id);
        // i=3 deliberately keeps the legacy source link only.
        if (i === 1) await db.update(operatingExpensesTable).set({ cashTransactionId: cash.id }).where(eq(operatingExpensesTable.id, expense.id));
      }
      if (i === 2 || i === 3) {
        const entry = await db.transaction(tx => postJournalEntry(tx, {
          date: expense.date, description: expense.description, sourceType: i === 3 ? "cash" : "operating_expense",
          sourceId: cashId ?? expense.id, createdBy: null,
          lines: [{ accountId: expenseAccount.id, debit: 123, credit: 0 }, { accountId: cashAccount.id, debit: 0, credit: 123 }],
        }));
        journalIds.push(entry.journalEntryId);
      }
    }
    server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, expenseIds));
    await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  });
  async function list() {
    const response = await fetch(`${base}/api/operating-expenses`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return await response.json() as Array<{ id: number; accountingStatus: string }>;
  }
  it("exposes all four real-entry states, including legacy links, without creating entries", async () => {
    const before = await db.select().from(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    const rows = await list();
    assert.deepEqual(expenseIds.map(id => rows.find(row => row.id === id)?.accountingStatus),
      ["missing_both", "missing_journal", "missing_cash", "complete"]);
    assert.deepEqual(await db.select().from(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds)), before);
    assert.equal((await db.select().from(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds))).length, 2);
  });
  it("does not count a voided journal as complete after reloading", async () => {
    const result = await db.transaction(tx => voidJournalEntry(tx, { journalEntryId: journalIds[1], voidedBy: null }));
    journalIds.push(result.reversalEntryId);
    const rows = await list();
    assert.equal(rows.find(row => row.id === expenseIds[3])?.accountingStatus, "missing_journal");
  });
});
