import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, bankTransactionsTable, cashTransactionsTable, cashClosuresTable, chartOfAccountsTable, journalEntriesTable, journalLinesTable, operatingExpensesTable, usersTable } from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("bank cash unlink and journal restoration", () => {
  let server: Server;
  let base: string;
  let accountId: number;
  const cookies = new Map<string, string>();
  const bankIds: number[] = [], cashIds: number[] = [], journalIds: number[] = [], userIds: number[] = [], closureIds: number[] = [];
  before(async () => {
    process.env.SESSION_SECRET = "bank-cash-lifecycle-test";
    for (const role of ["admin", "accountant", "hr"]) {
      const username = `lifecycle-${role}-${process.pid}-${Date.now()}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "test" }).returning();
      userIds.push(user.id);
      cookies.set(role, `${hrCookie.name}=${createStaffSession(user)}`);
    }
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6900"));
    assert.ok(account?.isActive);
    accountId = account.id;
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (closureIds.length) await db.delete(cashClosuresTable).where(inArray(cashClosuresTable.id, closureIds));
    if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null, journalEntryId: null }).where(inArray(bankTransactionsTable.id, bankIds));
    if (cashIds.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.cashTransactionId, cashIds));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (journalIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });
  const request = (path: string, body?: object, method = "POST", role = "admin") => fetch(base + path, {
    method, headers: { Cookie: cookies.get(role)!, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function pair(sourceType: string | null = "payroll", date = "2099-12-15", category = "salary") {
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date(`${date}T00:00:00Z`), type: "expense", amount: 1000,
      accountId, description: "Lifecycle fixture", fingerprint: `lifecycle-${process.pid}-${Date.now()}-${bankIds.length}`,
    }).returning();
    bankIds.push(bank.id);
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense", category, amount: 1000, date, description: "Lifecycle fixture",
      accountId, sourceType, sourceKey: sourceType ? `2099-12:${bank.id}` : null,
    }).returning();
    cashIds.push(cash.id);
    const linked = await request(`/bank-transactions/${bank.id}/link-cash`, { cashTransactionId: cash.id });
    assert.equal(linked.status, 200, await linked.clone().text());
    const [row] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    assert.ok(row.journalEntryId);
    journalIds.push(row.journalEntryId);
    return { bank, cash, journalId: row.journalEntryId };
  }
  async function rows(id: number, cashId: number) {
    const [[bank], [cash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashId)),
    ]);
    return { bank, cash };
  }
  it("restores an accidentally deleted journal without unlinking or duplicating payment, including concurrent retries", async () => {
    const { bank, cash, journalId } = await pair();
    assert.equal((await request(`/journal/entries/${journalId}`, undefined, "DELETE")).status, 204);
    const beforeRestore = await rows(bank.id, cash.id);
    assert.equal(beforeRestore.bank.cashTransactionId, cash.id);
    assert.equal(beforeRestore.cash.journalEntryId, null);
    const responses = await Promise.all([request(`/bank-transactions/${bank.id}/restore-cash-journal`, { accountId }), request(`/bank-transactions/${bank.id}/restore-cash-journal`, { accountId }, "POST", "accountant")]);
    const results = [];
    for (const response of responses) {
      assert.equal(response.status, 200, await response.clone().text());
      results.push(await response.json() as { journalEntryId: number });
    }
    assert.equal(results[0].journalEntryId, results[1].journalEntryId);
    journalIds.push(results[0].journalEntryId);
    const restored = await rows(bank.id, cash.id);
    assert.equal(restored.bank.cashTransactionId, cash.id);
    assert.equal(restored.cash.bankTransactionId, bank.id);
    assert.ok(restored.cash.bankVerifiedAt);
    assert.equal(restored.bank.journalEntryId, restored.cash.journalEntryId);
    assert.equal(restored.cash.amount, 1000);
    assert.equal(restored.cash.sourceKey, cash.sourceKey);
    const lines = await db.select({ code: chartOfAccountsTable.code }).from(journalLinesTable)
      .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
      .where(eq(journalLinesTable.journalEntryId, results[0].journalEntryId));
    assert.ok(lines.some((line) => line.code === "1010"));
    assert.ok(!lines.some((line) => line.code === "1000"));
  });
  for (const sourceType of [null, "payroll", "payroll_advance"]) {
    it(`unlinks incorrect ${sourceType ?? "manual"} payments without removing their source identity`, async () => {
      const { bank, cash, journalId } = await pair(sourceType);
      const response = await request(`/bank-transactions/${bank.id}/unlink-cash`);
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { reversalJournalEntryId: number };
      journalIds.push(result.reversalJournalEntryId);
      const unlinked = await rows(bank.id, cash.id);
      assert.equal(unlinked.bank.cashTransactionId, null);
      assert.equal(unlinked.bank.transferredAt, null);
      assert.equal(unlinked.cash.bankTransactionId, null);
      assert.equal(unlinked.cash.bankVerifiedAt, null);
      assert.equal(unlinked.cash.journalEntryId, null);
      assert.equal(unlinked.cash.sourceType, sourceType);
      assert.equal(unlinked.cash.sourceKey, cash.sourceKey);
      assert.equal(unlinked.cash.amount, cash.amount);
      const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, journalId));
      assert.equal(entry.status, "void");
      // The same bank can be linked again to the existing cash; no extra payment is created.
      const relink = await request(`/bank-transactions/${bank.id}/link-cash`, { cashTransactionId: cash.id });
      assert.equal(relink.status, 200);
      const relinked = await rows(bank.id, cash.id);
      assert.ok(relinked.bank.journalEntryId);
      journalIds.push(relinked.bank.journalEntryId);
    });
  }
  it("can unlink after hard deletion of its journal; role and source protections remain", async () => {
    const { bank, cash, journalId } = await pair();
    assert.equal((await request(`/bank-transactions/${bank.id}/unlink-cash`, undefined, "POST", "hr")).status, 403);
    assert.equal((await request(`/journal/entries/${journalId}`, undefined, "DELETE")).status, 204);
    const response = await request(`/bank-transactions/${bank.id}/unlink-cash`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { reversalJournalEntryId: null }).reversalJournalEntryId, null);
    assert.equal((await rows(bank.id, cash.id)).cash.sourceType, "payroll");
  });
  it("explicit unlink preserves its cash-paid expense mirror", async () => {
    const { bank, cash } = await pair(null, "2099-12-15", "Үйл ажиллагааны зардал");
    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, cash.id));
    assert.ok(expense);
    const response = await request(`/bank-transactions/${bank.id}/unlink-cash`);
    assert.equal(response.status, 200, await response.clone().text());
    journalIds.push((await response.json() as { reversalJournalEntryId: number }).reversalJournalEntryId);
    const [preserved] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, expense.id));
    assert.equal(preserved.bankTransactionId, null);
    assert.equal(preserved.cashTransactionId, cash.id);
    assert.equal(preserved.paymentAmount, expense.paymentAmount);
    assert.equal(preserved.paymentDate, expense.paymentDate);
    assert.equal((await rows(bank.id, cash.id)).cash.amount, cash.amount);
  });
  it("blocks document-managed payments without changing their journal or link", async () => {
    const { bank, cash, journalId } = await pair();
    await db.update(cashTransactionsTable).set({ sourceType: "operating_expense" }).where(eq(cashTransactionsTable.id, cash.id));
    for (const action of ["unlink-cash", "restore-cash-journal"]) {
      assert.equal((await request(`/bank-transactions/${bank.id}/${action}`, { accountId })).status, 409);
    }
    const unchanged = await rows(bank.id, cash.id);
    assert.equal(unchanged.bank.journalEntryId, journalId);
    assert.equal(unchanged.cash.bankTransactionId, bank.id);
  });
  it("blocks closed days and inconsistent links atomically", async () => {
    const { bank, cash, journalId } = await pair(null, "2099-12-20");
    const [closure] = await db.insert(cashClosuresTable).values({ date: "2099-12-20" }).returning();
    closureIds.push(closure.id);
    assert.equal((await request(`/bank-transactions/${bank.id}/unlink-cash`)).status, 409);
    assert.equal((await request(`/bank-transactions/${bank.id}/restore-cash-journal`, { accountId })).status, 409);
    assert.equal((await rows(bank.id, cash.id)).bank.journalEntryId, journalId);
    const open = await pair(null);
    await db.update(cashTransactionsTable).set({ bankTransactionId: null }).where(eq(cashTransactionsTable.id, open.cash.id));
    assert.equal((await request(`/bank-transactions/${open.bank.id}/unlink-cash`)).status, 409);
    assert.equal((await rows(open.bank.id, open.cash.id)).bank.cashTransactionId, open.cash.id);
  });
});
