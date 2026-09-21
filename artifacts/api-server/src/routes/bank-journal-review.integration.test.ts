import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  bankTransactionsTable,
  cashTransactionsTable,
  chartOfAccountsTable,
  db,
  journalEntriesTable,
  journalLinesTable,
  operatingExpensesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
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
  let transferBankId: number;
  let linkBankId: number;
  let matchedExpenseId: number;
  const userIds: number[] = [];
  const accountIds: number[] = [];
  const bankIds: number[] = [];
  const cashIds: number[] = [];
  const journalEntryIds: number[] = [];
  const operatingExpenseIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "bank-journal-review-test";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `bank-review-${suffix}`,
      normalizedUsername: `bank-review-${suffix}`,
      role: "admin",
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
      {
        transactionAt: new Date("2099-03-05T11:00:00.000Z"),
        type: "expense",
        amount: 42_000,
        accountId: expenseAccountId,
        account: "6677889900",
        counterparty: "Касс",
        description: "Касс руу шилжүүлэх туршилт",
        fingerprint: `review-transfer-${suffix}`,
      },
      {
        transactionAt: new Date("2099-03-06T11:00:00.000Z"),
        type: "expense",
        amount: 31_000,
        accountId: expenseAccountId,
        account: "7788990011",
        counterparty: "Кассын тулгалт",
        description: "Existing cash холбоосын туршилт",
        fingerprint: `review-link-${suffix}`,
      },
    ]).returning();
    [suggestedBankId, unknownBankId, vatBankId, rejectedBankId, transferBankId, linkBankId] = transactions.map(({ id }) => id);
    bankIds.push(...transactions.map(({ id }) => id));

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (cashIds.length) {
      await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.cashTransactionId, cashIds));
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, journalEntryId: null, transferredAt: null })
        .where(inArray(bankTransactionsTable.id, bankIds));
      await db.update(cashTransactionsTable).set({ bankTransactionId: null, journalEntryId: null })
        .where(inArray(cashTransactionsTable.id, cashIds));
      await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    }
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

  it("does not delete a bank transaction with a posted journal", async () => {
    const remove = await fetch(`${baseUrl}/api/bank-transactions/${suggestedBankId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(remove.status, 409);
    const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, suggestedBankId));
    assert.ok(bank);
    assert.ok(bank.journalEntryId);
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId));
    assert.equal(entry.status, "posted");
  });

  it("serializes concurrent journal posting and bank deletion without orphaning a journal", async () => {
    const suffix = randomUUID();
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-07T11:00:00.000Z"),
      type: "expense",
      amount: 19_000,
      accountId: expenseAccountId,
      account: "8899001122",
      counterparty: "Concurrency test",
      description: "Post болон delete зэрэг эхлэх туршилт",
      fingerprint: `review-concurrent-${suffix}`,
    }).returning();
    bankIds.push(bank.id);

    const [post, remove] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions/${bank.id}/post-journal`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ accountId: expenseAccountId }),
      }),
      fetch(`${baseUrl}/api/bank-transactions/${bank.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
    ]);

    if (post.status === 200) {
      assert.equal(remove.status, 409);
      const posted = await post.json() as { journalEntryId: number };
      journalEntryIds.push(posted.journalEntryId);
      const [source] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(source.journalEntryId, posted.journalEntryId);
    } else {
      assert.equal(post.status, 404);
      assert.equal(remove.status, 204);
      const orphaned = await db.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "bank"),
        eq(journalEntriesTable.sourceId, bank.id),
      ));
      assert.equal(orphaned.length, 0);
    }
  });

  it("links a cash transfer to one bank-sourced journal entry", async () => {
    const transfer = () => fetch(`${baseUrl}/api/bank-transactions/${transferBankId}/transfer-to-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ category: "Бусад", incomeMonth: null }),
    });
    const first = await transfer();
    assert.equal(first.status, 200);
    const firstResult = await first.json() as { cashTransactionId: number };
    assert.ok(firstResult.cashTransactionId);
    cashIds.push(firstResult.cashTransactionId);

    const [[bank], [cash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, transferBankId)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, firstResult.cashTransactionId)),
    ]);
    assert.ok(bank.journalEntryId);
    assert.equal(cash.journalEntryId, bank.journalEntryId);
    journalEntryIds.push(bank.journalEntryId);

    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId));
    assert.equal(entry.sourceType, "bank_transaction");
    assert.equal(entry.sourceId, transferBankId);
    assert.equal(entry.status, "posted");

    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, bank.journalEntryId));
    assert.equal(lines.length, 2);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 42_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 42_000);

    const retry = await transfer();
    assert.equal(retry.status, 200);
    const [afterRetry] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, transferBankId));
    assert.equal(afterRetry.journalEntryId, bank.journalEntryId);
    const sourceEntries = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "bank_transaction"),
      eq(journalEntriesTable.sourceId, transferBankId),
    ));
    assert.equal(sourceEntries.length, 1);
  });

  it("posts a journal for a journal-less cash link and blocks source-side edits", async () => {
    const [manualCash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Бусад",
      accountId: expenseAccountId,
      description: "Journal-гүй existing cash",
      amount: 31_000,
      date: "2099-03-06",
      incomeMonth: null,
    }).returning();
    cashIds.push(manualCash.id);

    const link = () => fetch(`${baseUrl}/api/bank-transactions/${linkBankId}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: manualCash.id }),
    });
    const first = await link();
    assert.equal(first.status, 200);

    const [[bank], [cash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, linkBankId)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, manualCash.id)),
    ]);
    assert.ok(bank.journalEntryId);
    assert.equal(cash.journalEntryId, bank.journalEntryId);
    journalEntryIds.push(bank.journalEntryId);

    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId));
    assert.equal(entry.sourceType, "bank_transaction");
    assert.equal(entry.sourceId, linkBankId);
    assert.equal(entry.status, "posted");

    const retry = await link();
    assert.equal(retry.status, 200);
    const sourceEntries = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "bank_transaction"),
      eq(journalEntriesTable.sourceId, linkBankId),
    ));
    assert.equal(sourceEntries.length, 1);

    const update = await fetch(`${baseUrl}/api/cash/transactions/${manualCash.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        type: "expense",
        category: "Бусад",
        description: "Засах оролдлого",
        amount: 31_000,
        date: "2099-03-06",
        incomeMonth: null,
      }),
    });
    assert.equal(update.status, 409);

    const remove = await fetch(`${baseUrl}/api/cash/transactions/${manualCash.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(remove.status, 409);

    const voidJournal = await fetch(`${baseUrl}/api/journal/entries/${bank.journalEntryId}/void`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(voidJournal.status, 409);
  });

  it("does not offer or relabel cash owned by another source", async () => {
    const suffix = randomUUID();
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-08T11:00:00.000Z"),
      type: "expense",
      amount: 9_000,
      accountId: expenseAccountId,
      description: "Source managed cash хамгаалалт",
      fingerprint: `review-source-managed-bank-${suffix}`,
    }).returning();
    bankIds.push(bank.id);
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Цалин",
      accountId: expenseAccountId,
      description: "Payroll-owned cash",
      amount: 9_000,
      date: "2099-03-08",
      sourceType: "payroll",
      sourceKey: `source-managed-${suffix}`,
    }).returning();
    cashIds.push(cash.id);

    const suggestionsResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/cash-suggestions`, {
      headers: { cookie },
    });
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await suggestionsResponse.json() as Array<{ id: number }>;
    assert.equal(suggestions.some(({ id }) => id === cash.id), false);

    const link = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(link.status, 409);
    const [unchanged] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id));
    assert.equal(unchanged.sourceType, "payroll");
    assert.equal(unchanged.sourceKey, `source-managed-${suffix}`);
    assert.equal(unchanged.bankTransactionId, null);
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