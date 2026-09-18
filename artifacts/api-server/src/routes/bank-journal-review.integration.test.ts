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
  let suggestedBankId: number;
  let unknownBankId: number;
  const userIds: number[] = [];
  const accountIds: number[] = [];
  const bankIds: number[] = [];
  const journalEntryIds: number[] = [];

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

    const [expenseAccount] = await db.insert(chartOfAccountsTable).values({
      code: `review-expense-${suffix}`,
      name: "Review expense account",
      type: "expense",
      normalBalance: "debit",
    }).returning();
    expenseAccountId = expenseAccount.id;
    accountIds.push(expenseAccount.id);

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
    ]).returning();
    [suggestedBankId, unknownBankId] = transactions.map(({ id }) => id);
    bankIds.push(...transactions.map(({ id }) => id));

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (journalEntryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalEntryIds));
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
    }>;
    const suggested = rows.find(({ id }) => id === suggestedBankId);
    const unknown = rows.find(({ id }) => id === unknownBankId);
    assert.equal(suggested?.suggestedAccountId, expenseAccountId);
    assert.equal(suggested?.suggestedAccountName, "Review expense account");
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
  });

  it("rejects a suggestion into the unclear queue and removes it from review", async () => {
    const rejected = await fetch(`${baseUrl}/api/bank-transactions/${unknownBankId}/reject-suggestion`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(rejected.status, 204);

    const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, unknownBankId));
    assert.ok(bank.unclearAt);
    assert.equal(bank.accountId, null);

    const review = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, { headers: { cookie } });
    const rows = await review.json() as Array<{ id: number }>;
    assert.equal(rows.some(({ id }) => id === unknownBankId), false);
  });
});