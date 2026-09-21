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
import { postJournalEntry } from "../lib/journal-posting";

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
  let reversibleBankId: number;
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
      {
        transactionAt: new Date("2099-03-07T11:00:00.000Z"),
        type: "expense",
        amount: 27_000,
        account: "9900112233",
        counterparty: "Буцаах журнал",
        description: "Батлагдсан журнал устгах туршилт",
        fingerprint: `review-reversible-${suffix}`,
      },
    ]).returning();
    [suggestedBankId, unknownBankId, vatBankId, rejectedBankId, transferBankId, linkBankId, reversibleBankId] = transactions.map(({ id }) => id);
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

  it("reverses and unlinks a directly posted bank journal so it can be posted again", async () => {
    const post = () => fetch(`${baseUrl}/api/bank-transactions/${reversibleBankId}/post-journal`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: expenseAccountId }),
    });
    const firstPost = await post();
    assert.equal(firstPost.status, 200);
    const first = await firstPost.json() as { journalEntryId: number };
    journalEntryIds.push(first.journalEntryId);

    const remove = await fetch(`${baseUrl}/api/bank-transactions/${reversibleBankId}/journal`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(remove.status, 200);
    const removed = await remove.json() as {
      bankTransactionId: number;
      voidedJournalEntryId: number;
      reversalJournalEntryId: number;
    };
    journalEntryIds.push(removed.reversalJournalEntryId);
    assert.equal(removed.bankTransactionId, reversibleBankId);
    assert.equal(removed.voidedJournalEntryId, first.journalEntryId);

    const [bank] = await db.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, reversibleBankId));
    assert.equal(bank.journalEntryId, null);
    assert.equal(bank.accountId, null);
    assert.equal(bank.rejectedAccountIds.includes(expenseAccountId), true);

    const [original, reversal] = await Promise.all([
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, first.journalEntryId)),
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, removed.reversalJournalEntryId)),
    ]);
    assert.equal(original[0].status, "void");
    assert.equal(reversal[0].status, "posted");
    assert.equal(reversal[0].sourceType, "reversal");
    assert.equal(reversal[0].sourceId, first.journalEntryId);

    const reversalLines = await db.select().from(journalLinesTable)
      .where(inArray(journalLinesTable.journalEntryId, [first.journalEntryId, removed.reversalJournalEntryId]));
    assert.equal(reversalLines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0);

    const duplicateRemove = await fetch(`${baseUrl}/api/bank-transactions/${reversibleBankId}/journal`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(duplicateRemove.status, 409);

    const secondPost = await post();
    assert.equal(secondPost.status, 200);
    const second = await secondPost.json() as { journalEntryId: number };
    journalEntryIds.push(second.journalEntryId);
    assert.notEqual(second.journalEntryId, first.journalEntryId);
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
      body: JSON.stringify({ category: "Бараа материал", incomeMonth: null }),
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

    const remove = await fetch(`${baseUrl}/api/bank-transactions/${transferBankId}/journal`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(remove.status, 200);
    const removed = await remove.json() as { reversalJournalEntryId: number };
    journalEntryIds.push(removed.reversalJournalEntryId);
    const [[afterDeleteBank], [afterDeleteCash], [voided], [reversal]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, transferBankId)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, firstResult.cashTransactionId)),
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId)),
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, removed.reversalJournalEntryId)),
    ]);
    assert.equal(afterDeleteBank.journalEntryId, null);
    assert.equal(afterDeleteCash.journalEntryId, null);
    assert.equal(afterDeleteBank.cashTransactionId, null);
    assert.equal(afterDeleteBank.transferredAt, null);
    assert.equal(afterDeleteCash.bankTransactionId, null);
    assert.equal(afterDeleteCash.bankVerifiedAt, null);
    assert.equal(afterDeleteCash.sourceType, null);
    assert.equal(afterDeleteCash.sourceKey, null);
    assert.equal(voided.status, "void");
    assert.equal(reversal.status, "posted");
  });

  it("suggests and links payroll cash with sub-tugrik bank rounding while preserving its employee source key", async () => {
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-08T11:00:00.000Z"),
      type: "expense",
      amount: 44_000,
      account: "9911223344",
      counterparty: "Цалингийн ажилтан",
      description: "2099-03 сарын сүүл цалин",
      fingerprint: `review-payroll-${randomUUID()}`,
    }).returning();
    bankIds.push(bank.id);
    const sourceKey = "2099-03:123:2";
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Бараа материал",
      accountId: expenseAccountId,
      description: "Тест Ажилтан · 2099-03 сарын цалин · 2-р олголт",
      amount: 44_000,
      date: "2099-03-08",
      sourceType: "payroll",
      sourceKey,
    }).returning();
    cashIds.push(cash.id);

    const duplicateTransferResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/transfer-to-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ category: "Цалин", incomeMonth: null }),
    });
    assert.equal(duplicateTransferResponse.status, 409);
    const [bankAfterBlockedTransfer] = await db.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, bank.id));
    assert.equal(bankAfterBlockedTransfer.cashTransactionId, null);
    await db.update(bankTransactionsTable)
      .set({ amount: 43_999.43 })
      .where(eq(bankTransactionsTable.id, bank.id));

    const [unrelatedBank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-08T12:00:00.000Z"),
      type: "expense",
      amount: 44_000,
      account: "9988776655",
      counterparty: "Цалинтай ижил дүнтэй нийлүүлэгч",
      description: "Цалинтай давхцсан дүнтэй бараа материал",
      fingerprint: `review-non-payroll-collision-${randomUUID()}`,
    }).returning();
    bankIds.push(unrelatedBank.id);
    const unrelatedTransferResponse = await fetch(`${baseUrl}/api/bank-transactions/${unrelatedBank.id}/transfer-to-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ category: "Бараа материал", incomeMonth: null }),
    });
    assert.equal(unrelatedTransferResponse.status, 200);
    const unrelatedTransfer = await unrelatedTransferResponse.json() as {
      cashTransactionId: number;
      journalEntryId: number;
    };
    cashIds.push(unrelatedTransfer.cashTransactionId);
    journalEntryIds.push(unrelatedTransfer.journalEntryId);

    const suggestionsResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/cash-suggestions`, {
      headers: { cookie },
    });
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await suggestionsResponse.json() as Array<{
      id: number;
      transactionKind: string;
      journalEntryId: number | null;
    }>;
    const suggestion = suggestions.find((candidate) => candidate.id === cash.id);
    assert.equal(suggestion?.transactionKind, "payroll");
    assert.equal(suggestion?.journalEntryId, null);

    const linkResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(linkResponse.status, 200);
    const [[linkedBank], [linkedCash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id)),
    ]);
    assert.ok(linkedBank.journalEntryId);
    journalEntryIds.push(linkedBank.journalEntryId);
    const postedLines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, linkedBank.journalEntryId));
    assert.equal(postedLines.length, 2);
    assert.ok(postedLines.every((line) => Number(line.debit) === 43_999.43 || Number(line.credit) === 43_999.43));
    assert.equal(linkedCash.journalEntryId, linkedBank.journalEntryId);
    assert.equal(linkedCash.sourceType, "payroll");
    assert.equal(linkedCash.sourceKey, sourceKey);
    assert.equal(linkedCash.bankTransactionId, bank.id);

    const unlinkResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/journal`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(unlinkResponse.status, 200);
    const unlinkedResult = await unlinkResponse.json() as { reversalJournalEntryId: number };
    journalEntryIds.push(unlinkedResult.reversalJournalEntryId);
    const [[unlinkedBank], [unlinkedCash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id)),
    ]);
    assert.equal(unlinkedBank.cashTransactionId, null);
    assert.equal(unlinkedBank.transferredAt, null);
    assert.equal(unlinkedBank.journalEntryId, null);
    assert.equal(unlinkedCash.bankTransactionId, null);
    assert.equal(unlinkedCash.bankVerifiedAt, null);
    assert.equal(unlinkedCash.journalEntryId, null);
    assert.equal(unlinkedCash.sourceType, "payroll");
    assert.equal(unlinkedCash.sourceKey, sourceKey);

    const relinkResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(relinkResponse.status, 200);
    const [[relinkedBank], [relinkedCash]] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id)),
    ]);
    assert.ok(relinkedBank.journalEntryId);
    journalEntryIds.push(relinkedBank.journalEntryId);
    assert.equal(relinkedCash.journalEntryId, relinkedBank.journalEntryId);
    assert.equal(relinkedCash.sourceType, "payroll");
    assert.equal(relinkedCash.sourceKey, sourceKey);
  });

  it("reverses an advance journal before linking the payroll advance to its bank payment", async () => {
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-09T11:00:00.000Z"),
      type: "expense",
      amount: 35_000,
      account: "9944556677",
      counterparty: "Урьдчилгаа ажилтан",
      description: "2099-03 сарын урьдчилгаа",
      fingerprint: `review-payroll-advance-${randomUUID()}`,
    }).returning();
    bankIds.push(bank.id);
    const existingPosting = await db.transaction((tx) => postJournalEntry(tx, {
      date: "2099-03-09",
      description: "Тест Ажилтан · 2099-03 сарын урьдчилгаа",
      sourceType: "payroll",
      sourceId: null,
      createdBy: null,
      lines: [
        { accountId: expenseAccountId, debit: 35_000, credit: 0 },
        { accountId: liabilityAccountId, debit: 0, credit: 35_000 },
      ],
    }));
    assert.equal(existingPosting.status, "posted");
    journalEntryIds.push(existingPosting.journalEntryId);
    const sourceKey = "2099-03:456";
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Урьдчилгаа цалин",
      accountId: expenseAccountId,
      description: "Тест Ажилтан · 2099-03 сарын урьдчилгаа",
      amount: 35_000,
      date: "2099-03-09",
      sourceType: "payroll_advance",
      sourceKey,
      journalEntryId: existingPosting.journalEntryId,
    }).returning();
    cashIds.push(cash.id);

    const suggestionsResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/cash-suggestions`, {
      headers: { cookie },
    });
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await suggestionsResponse.json() as Array<{
      id: number;
      transactionKind: string;
      journalEntryId: number | null;
    }>;
    const suggestion = suggestions.find((candidate) => candidate.id === cash.id);
    assert.equal(suggestion?.transactionKind, "payroll_advance");
    assert.equal(suggestion?.journalEntryId, existingPosting.journalEntryId);

    const linkResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(linkResponse.status, 200);
    const [[linkedBank], [linkedCash], [voidedEntry], reversalEntries] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id)),
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, existingPosting.journalEntryId)),
      db.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "reversal"),
        eq(journalEntriesTable.sourceId, existingPosting.journalEntryId),
      )),
    ]);
    assert.ok(linkedBank.journalEntryId);
    journalEntryIds.push(linkedBank.journalEntryId, ...reversalEntries.map((entry) => entry.id));
    assert.equal(linkedCash.journalEntryId, linkedBank.journalEntryId);
    assert.equal(linkedCash.sourceType, "payroll_advance");
    assert.equal(linkedCash.sourceKey, sourceKey);
    assert.equal(voidedEntry.status, "void");
    assert.equal(reversalEntries.length, 1);

    const unlinkResponse = await fetch(`${baseUrl}/api/bank-transactions/${bank.id}/journal`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(unlinkResponse.status, 200);
    const unlinkedResult = await unlinkResponse.json() as { reversalJournalEntryId: number };
    journalEntryIds.push(unlinkedResult.reversalJournalEntryId);
    const [[unlinkedBank], [unlinkedCash], canonicalAccounts] = await Promise.all([
      db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id)),
      db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id)),
      db.select().from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, ["6000", "1000"])),
    ]);
    assert.equal(unlinkedBank.cashTransactionId, null);
    assert.equal(unlinkedBank.journalEntryId, null);
    assert.equal(unlinkedCash.bankTransactionId, null);
    assert.equal(unlinkedCash.sourceType, "payroll_advance");
    assert.equal(unlinkedCash.sourceKey, sourceKey);
    assert.ok(unlinkedCash.journalEntryId);
    assert.notEqual(unlinkedCash.journalEntryId, linkedCash.journalEntryId);
    journalEntryIds.push(unlinkedCash.journalEntryId);
    const restoredLines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, unlinkedCash.journalEntryId));
    const accountByCode = new Map(canonicalAccounts.map((account) => [account.code, account.id]));
    assert.equal(restoredLines.length, 2);
    assert.ok(restoredLines.some((line) =>
      line.accountId === accountByCode.get("6000")
      && Number(line.debit) === 35_000
      && Number(line.credit) === 0));
    assert.ok(restoredLines.some((line) =>
      line.accountId === accountByCode.get("1000")
      && Number(line.debit) === 0
      && Number(line.credit) === 35_000));
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
      description: "Inventory-owned cash",
      amount: 9_000,
      date: "2099-03-08",
      sourceType: "inventory_purchase",
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
    assert.equal(unchanged.sourceType, "inventory_purchase");
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