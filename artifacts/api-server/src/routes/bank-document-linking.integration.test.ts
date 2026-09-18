import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, db,
  inventoryPurchasesTable, journalEntriesTable, journalLinesTable,
  operatingExpensesTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("bank document linking", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  const bankIds: number[] = [];
  const cashIds: number[] = [];
  const purchaseIds: number[] = [];
  const expenseIds: number[] = [];
  const journalIds: number[] = [];
  const userIds: number[] = [];
  let accountId: number;

  before(async () => {
    process.env.SESSION_SECRET = "bank-document-linking-test";
    const suffix = `link-${process.pid}-${Date.now()}`;
    const [user] = await db.insert(usersTable).values({
      username: suffix, normalizedUsername: suffix,
      role: "admin", passwordHash: "test",
    }).returning();
    userIds.push(user.id);
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const [account] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(and(eq(chartOfAccountsTable.type, "expense"), eq(chartOfAccountsTable.isActive, true))).limit(1);
    assert.ok(account);
    accountId = account.id;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(inArray(bankTransactionsTable.id, bankIds));
    if (expenseIds.length) await db.update(operatingExpensesTable).set({ bankTransactionId: null, cashTransactionId: null }).where(inArray(operatingExpensesTable.id, expenseIds));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (journalIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    if (expenseIds.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, expenseIds));
    if (purchaseIds.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchaseIds));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  async function bank(date: string, amount: number, label: string) {
    const [row] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date(`${date}T10:00:00Z`), type: "expense", amount,
      description: label, counterparty: label, fingerprint: `link-${label}-${Date.now()}-${Math.random()}`,
    }).returning();
    bankIds.push(row.id);
    return row.id;
  }

  it("posts a journal when linking a legacy cash row that has no journal", async () => {
    const bankId = await bank("2099-08-05", 63_000, "legacy-cash-without-journal");
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Legacy expense",
      description: "Legacy cash without journal",
      amount: 63_000,
      date: "2099-08-05",
      accountId,
      sourceType: "manual",
    }).returning();
    cashIds.push(cash.id);
    assert.equal(cash.journalEntryId, null);

    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(response.status, 200);

    const [operatingExpense] = await db.select().from(operatingExpensesTable)
      .where(eq(operatingExpensesTable.cashTransactionId, cash.id));
    assert.ok(operatingExpense);
    expenseIds.push(operatingExpense.id);
    const [linkedCash] = await db.select().from(cashTransactionsTable)
      .where(eq(cashTransactionsTable.id, cash.id));
    assert.ok(linkedCash.journalEntryId);
    journalIds.push(linkedCash.journalEntryId);
    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, linkedCash.journalEntryId));
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 63_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 63_000);
  });

  it("links an existing unpaid purchase, posts a balanced journal, and removes review row", async () => {
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: (await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500")))[0].id,
      documentName: "Existing linked purchase", date: "2099-08-01", totalAmount: 42_000,
    }).returning();
    purchaseIds.push(purchase.id);
    const bankId = await bank("2099-08-01", 42_000, "existing-purchase");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inventoryPurchaseId: purchase.id }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { cashTransactionId: number; journalEntryId: number };
    cashIds.push(result.cashTransactionId); journalIds.push(result.journalEntryId);
    const [saved] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchase.id));
    assert.equal(saved.paymentDate, "2099-08-01"); assert.equal(Number(saved.paymentAmount), 42_000);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, result.cashTransactionId); assert.ok(linked.transferredAt);
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 42_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 42_000);
    const review = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, { headers: { cookie } });
    assert.equal((await review.json() as Array<{ id: number }>).some((row) => row.id === bankId), false);
    assert.equal((await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ inventoryPurchaseId: purchase.id }) })).status, 409);
  });

  it("serializes reverse and forward linking without a deadlock or duplicate journal", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      accountId: inventoryAccount.id,
      documentName: "Concurrent linked purchase",
      date: "2099-08-04",
      totalAmount: 27_000,
    }).returning();
    purchaseIds.push(purchase.id);
    const bankId = await bank("2099-08-04", 27_000, "concurrent-purchase");
    const headers = { cookie, "content-type": "application/json" };
    const [forward, reverse] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, {
        method: "POST",
        headers,
        body: JSON.stringify({ inventoryPurchaseId: purchase.id }),
      }),
      fetch(`${baseUrl}/api/inventory/purchases/${purchase.id}/payment`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ date: "2099-08-04", amount: 27_000, bankTransactionId: bankId }),
      }),
    ]);
    assert.deepEqual([forward.status, reverse.status].sort(), [200, 409]);
    const cashRows = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchase.id}`),
    ));
    assert.equal(cashRows.length, 1);
    cashIds.push(cashRows[0].id);
    assert.ok(cashRows[0].journalEntryId);
    journalIds.push(cashRows[0].journalEntryId!);
  });

  it("creates and links a new operating expense atomically", async () => {
    const bankId = await bank("2099-08-02", 31_000, "new-operating-expense");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-expense`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "New linked operating expense", accountId, date: "2099-08-02", amount: 31_000 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { operatingExpenseId: number; cashTransactionId: number; journalEntryId: number };
    expenseIds.push(result.operatingExpenseId); cashIds.push(result.cashTransactionId); journalIds.push(result.journalEntryId);
    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, result.operatingExpenseId));
    assert.equal(expense.paymentDate, "2099-08-02"); assert.equal(expense.bankTransactionId, bankId); assert.equal(expense.cashTransactionId, result.cashTransactionId);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, result.cashTransactionId));
    assert.equal(cash.bankTransactionId, bankId); assert.ok(cash.journalEntryId);
  });

  it("rolls back a mismatched new expense without claiming the bank", async () => {
    const bankId = await bank("2099-08-03", 19_000, "mismatch");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-expense`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "Should roll back", accountId, date: "2099-08-03", amount: 18_999 }),
    });
    assert.equal(response.status, 400);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, null); assert.equal(linked.transferredAt, null);
    assert.equal((await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.description, "Should roll back"))).length, 0);
    assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bankId))).length, 0);
    assert.equal((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.description, "Should roll back"))).length, 0);
  });
});