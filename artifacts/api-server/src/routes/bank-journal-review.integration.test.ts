import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  bankTransactionsTable,
  chartOfAccountsTable,
  db,
  journalEntriesTable,
  journalLinesTable,
  operatingExpensesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("bank journal review routes", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let expenseAccountId: number;
  let liabilityAccountId: number;
  let suggestedBankId: number;
  let unknownBankId: number;
  let vatBankId: number;
  let rejectedBankId: number;
  let matchedExpenseId: number;
  const userIds: number[] = [];
  const accountIds: number[] = [];
  const bankIds: number[] = [];
  const journalEntryIds: number[] = [];
  const operatingExpenseIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "bank-journal-review-test";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `bank-review-${suffix}`,
      normalizedUsername: `bank-review-${suffix}`,
      role: "accountant",
      passwordHash: "not-used-by-session-tests",
    }).returning();
    userIds.push(user.id);
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;

    const [expenseAccount, liabilityAccount] = await db.insert(chartOfAccountsTable).values([
      {
        code: `review-expense-${suffix}`,
        name: "Review expense account",
        type: "expense",
        normalBalance: "debit",
      },
      {
        code: `review-liability-${suffix}`,
        name: "Review VAT liability account",
        type: "liability",
        normalBalance: "credit",
      },
    ]).returning();
    expenseAccountId = expenseAccount.id;
    liabilityAccountId = liabilityAccount.id;
    accountIds.push(expenseAccount.id, liabilityAccount.id);

    const [matchedExpense] = await db.insert(operatingExpensesTable).values({
      description: "Тест нийлүүлэгчийн худалдан авалт",
      accountId: expenseAccountId,
      date: "2099-03-01",
      amount: 125_000,
    }).returning();
    matchedExpenseId = matchedExpense.id;
    operatingExpenseIds.push(matchedExpense.id);

    const transactions = await db.insert(bankTransactionsTable).values([
      {
        transactionAt: new Date("2099-03-01T10:00:00.000Z"),
        type: "expense",
        amount: 125_000,
        accountId: expenseAccountId,
        account: "1234567890",
        counterparty: "Тест нийлүүлэгч",
        description: "Туршилтын худалдан авалт",
        fingerprint: `review-suggested-${suffix}`,
      },
      {
        transactionAt: new Date("2099-03-02T11:00:00.000Z"),
        type: "expense",
        amount: 75_000,
        account: "0987654321",
        counterparty: "Тодорхойгүй харилцагч",
        description: "Тодорхойгүй гүйлгээ",
        fingerprint: `review-unknown-${suffix}`,
      },
      {
        transactionAt: new Date("2099-03-03T11:00:00.000Z"),
        type: "expense",
        amount: 50_000,
        accountId: liabilityAccountId,
        account: "1122334455",
        counterparty: "Татварын газар",
        description: "НӨАТ төлбөр",
        fingerprint: `review-vat-${suffix}`,
      },
      {
        transactionAt: new Date("2099-03-04T11:00:00.000Z"),
        type: "expense",
        amount: 88_000,
        accountId: expenseAccountId,
        account: "5566778899",
        counterparty: "Татгалзах харилцагч",
        description: "Татгалзах санал",
        fingerprint: `review-rejected-${suffix}`,
      },
    ]).returning();
    [suggestedBankId, unknownBankId, vatBankId, rejectedBankId] = transactions.map(({ id }) => id);
    bankIds.push(...transactions.map(({ id }) => id));

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (journalEntryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalEntryIds));
    if (operatingExpenseIds.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, operatingExpenseIds));
    if (accountIds.length) await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, accountIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  it("lists suggested and unknown pending transactions", async () => {
    const response = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const rows = await response.json() as Array<{
      id: number;
      suggestedAccountId: number | null;
      suggestedAccountName: string | null;
      date: string;
      existingPurchaseMatch?: { type: string; id: number };
    }>;
    const suggested = rows.find(({ id }) => id === suggestedBankId);
    const unknown = rows.find(({ id }) => id === unknownBankId);
    assert.equal(suggested?.suggestedAccountId, expenseAccountId);
    assert.equal(suggested?.suggestedAccountName, "Review expense account");
    assert.equal(suggested?.date, "2099-03-01");
    assert.deepEqual(suggested?.existingPurchaseMatch, {
      type: "operating_expense",
      id: matchedExpenseId,
    });
    assert.equal(unknown?.suggestedAccountId, null);
    assert.equal(unknown?.suggestedAccountName, null);
  });

  it("posts a balanced journal once and removes the row from review", async () => {
    const post = () => fetch(`${baseUrl}/api/bank-transactions/${suggestedBankId}/post-journal`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: expenseAccountId }),
    });
    const first = await post();
    assert.equal(first.status, 200);
    const result = await first.json() as { id: number; journalEntryId: number };
    journalEntryIds.push(result.journalEntryId);
    assert.equal(result.id, suggestedBankId);

    const retry = await post();
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), result);

    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    assert.equal(lines.length, 2);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 125_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 125_000);

    const review = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, { headers: { cookie } });
    const rows = await review.json() as Array<{ id: number }>;
    assert.equal(rows.some(({ id }) => id === suggestedBankId), false);
    const [sourceExpense] = await db.select().from(operatingExpensesTable)
      .where(eq(operatingExpensesTable.id, matchedExpenseId));
    assert.equal(sourceExpense.paymentDate, null);
    assert.equal(sourceExpense.bankTransactionId, null);
  });

  it("rejects only the suggested account and keeps the transaction pending", async () => {
    const rejected = await fetch(`${baseUrl}/api/bank-transactions/${rejectedBankId}/reject-suggestion`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(rejected.status, 204);

    const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, rejectedBankId));
    assert.equal(bank.unclearAt, null);
    assert.equal(bank.accountId, null);
    assert.deepEqual(bank.rejectedAccountIds, [expenseAccountId]);

    const review = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, { headers: { cookie } });
    const rows = await review.json() as Array<{ id: number; suggestedAccountId: number | null }>;
    const pending = rows.find(({ id }) => id === rejectedBankId);
    assert.ok(pending);
    assert.equal(pending.suggestedAccountId, null);

    const manualAssignment = await fetch(`${baseUrl}/api/bank-transactions/${rejectedBankId}/account`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: expenseAccountId }),
    });
    assert.equal(manualAssignment.status, 200);
    const [manuallyAssigned] = await db.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, rejectedBankId));
    assert.equal(manuallyAssigned.accountId, expenseAccountId);
    assert.deepEqual(manuallyAssigned.rejectedAccountIds, []);
  });

  it("posts a VAT payment by debiting the liability account and crediting bank", async () => {
    const response = await fetch(`${baseUrl}/api/bank-transactions/${vatBankId}/post-journal`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: liabilityAccountId }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { journalEntryId: number };
    journalEntryIds.push(result.journalEntryId);
    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    const liabilityLine = lines.find((line) => line.accountId === liabilityAccountId);
    assert.equal(Number(liabilityLine?.debit), 50_000);
    assert.equal(Number(liabilityLine?.credit), 0);
    const bankLine = lines.find((line) => line.accountId !== liabilityAccountId);
    assert.equal(Number(bankLine?.debit), 0);
    assert.equal(Number(bankLine?.credit), 50_000);
  });
});