import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { db, chartOfAccountsTable, journalEntriesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import journalRouter from "./journal.js";

describe("journal routes", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let debitAccount: number;
  let creditAccount: number;
  let reportDebitAccount: number;
  let reportCreditAccount: number;
  const entryIds: number[] = [];
  let userId: number;

  before(async () => {
    process.env.SESSION_SECRET = "journal-route-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `journal-route-${suffix}`, normalizedUsername: `journal-route-${suffix}`,
      role: "accountant", passwordHash: "not-used-by-session-tests",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const accounts = await db.insert(chartOfAccountsTable).values([
      { code: `journal-test-debit-${suffix}`, name: "Journal test debit", type: "asset", normalBalance: "debit" },
      { code: `journal-test-credit-${suffix}`, name: "Journal test credit", type: "liability", normalBalance: "credit" },
      { code: `journal-report-debit-${suffix}`, name: "Journal report debit", type: "asset", normalBalance: "debit" },
      { code: `journal-report-credit-${suffix}`, name: "Journal report credit", type: "liability", normalBalance: "credit" },
    ]).returning({ id: chartOfAccountsTable.id });
    debitAccount = accounts[0].id;
    creditAccount = accounts[1].id;
    reportDebitAccount = accounts[2].id;
    reportCreditAccount = accounts[3].id;
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", journalRouter);
    server = testApp.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (entryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
    await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, [debitAccount, creditAccount, reportDebitAccount, reportCreditAccount]));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init, headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
  }
  function lines(debit: number, credit: number) {
    return [
      { accountId: debitAccount, debit, credit: 0, memo: null },
      { accountId: creditAccount, debit: 0, credit, memo: null },
    ];
  }
  async function create(debit: number, credit: number) {
    const response = await request("/journal/entries", {
      method: "POST", body: JSON.stringify({ date: "2025-01-15", description: "Route test", lines: lines(debit, credit) }),
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number };
    entryIds.push(value.id);
    return value.id;
  }
  async function createForAccounts(date: string, debitAccountId: number, creditAccountId: number, debit: number, credit: number) {
    const response = await request("/journal/entries", {
      method: "POST", body: JSON.stringify({
        date, description: "Report test", lines: [
          { accountId: debitAccountId, debit, credit: 0, memo: null },
          { accountId: creditAccountId, debit: 0, credit, memo: null },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number };
    entryIds.push(value.id);
    return value.id;
  }

  it("creates a manual entry and returns its lines in detail", async () => {
    const id = await create(10, 10);
    const response = await request(`/journal/entries/${id}`);
    assert.equal(response.status, 200);
    const value = await response.json() as { sourceType: string; status: string; lines: unknown[]; createdBy: number };
    assert.equal(value.sourceType, "manual");
    assert.equal(value.status, "posted");
    assert.equal(value.createdBy, userId);
    assert.equal(value.lines.length, 2);
  });

  it("keeps an unbalanced create as draft and transitions it when updated", async () => {
    const id = await create(10, 5);
    let detail = await (await request(`/journal/entries/${id}`)).json() as { status: string };
    assert.equal(detail.status, "draft");
    const response = await request(`/journal/entries/${id}`, {
      method: "PUT", body: JSON.stringify({ lines: lines(10, 10) }),
    });
    assert.equal(response.status, 200);
    detail = await response.json() as { status: string };
    assert.equal(detail.status, "posted");
  });

  it("rejects posted updates without changing their lines", async () => {
    const id = await create(10, 10);
    const before = await (await request(`/journal/entries/${id}`)).json() as { lines: unknown[] };
    const response = await request(`/journal/entries/${id}`, {
      method: "PUT", body: JSON.stringify({ lines: lines(20, 20) }),
    });
    assert.equal(response.status, 409);
    const afterUpdate = await (await request(`/journal/entries/${id}`)).json() as { lines: unknown[] };
    assert.deepEqual(afterUpdate.lines, before.lines);
  });

  it("supports list filters and voids a posted entry", async () => {
    const id = await create(10, 10);
    const list = await request(`/journal/entries?sourceType=manual&status=posted&accountId=${debitAccount}&dateFrom=2025-01-01&dateTo=2025-12-31`);
    assert.equal(list.status, 200);
    assert.ok((await list.json() as unknown[]).length >= 1);
    const response = await request(`/journal/entries/${id}/void`, { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const reversal = await response.json() as { reversalEntryId: number };
    entryIds.push(reversal.reversalEntryId);
    const detail = await (await request(`/journal/entries/${id}`)).json() as { status: string };
    assert.equal(detail.status, "void");
  });

  it("does not expose DELETE", async () => {
    const response = await request("/journal/entries/1", { method: "DELETE" });
    assert.equal(response.status, 404);
  });

  it("returns debit- and credit-normal ledger balances in deterministic order", async () => {
    const first = await createForAccounts("2025-02-02", reportDebitAccount, reportCreditAccount, 10.01, 10.01);
    const second = await createForAccounts("2025-01-02", reportDebitAccount, reportCreditAccount, 3.02, 3.02);
    const debitResponse = await request(`/journal/accounts/${reportDebitAccount}/ledger`);
    assert.equal(debitResponse.status, 200);
    const debit = await debitResponse.json() as { entries: { journalEntryId: number; debit: number; balance: number }[] };
    assert.deepEqual(debit.entries.map((row) => row.journalEntryId), [second, first]);
    assert.deepEqual(debit.entries.map((row) => row.balance), [3.02, 13.03]);
    const creditResponse = await request(`/journal/accounts/${reportCreditAccount}/ledger`);
    const credit = await creditResponse.json() as { entries: { balance: number }[] };
    assert.deepEqual(credit.entries.map((row) => row.balance), [3.02, 13.03]);
  });

  it("excludes drafts and includes void originals plus reversals", async () => {
    const draft = await createForAccounts("2025-03-01", reportDebitAccount, reportCreditAccount, 7, 6);
    const baseline = await (await request(`/journal/accounts/${reportDebitAccount}/ledger`)).json() as { entries: { journalEntryId: number; balance: number }[] };
    const posted = await createForAccounts("2025-03-02", reportDebitAccount, reportCreditAccount, 5, 5);
    const voidResponse = await request(`/journal/entries/${posted}/void`, { method: "POST", body: "{}" });
    assert.equal(voidResponse.status, 200);
    const reversal = (await voidResponse.json() as { reversalEntryId: number }).reversalEntryId;
    entryIds.push(reversal);
    const ledger = await (await request(`/journal/accounts/${reportDebitAccount}/ledger`)).json() as { entries: { journalEntryId: number; balance: number }[] };
    assert.equal(ledger.entries.some((row) => row.journalEntryId === draft), false);
    assert.equal(ledger.entries.some((row) => row.journalEntryId === posted), true);
    assert.equal(ledger.entries.some((row) => row.journalEntryId === reversal), true);
    assert.equal(ledger.entries.at(-1)?.balance, baseline.entries.at(-1)?.balance);
  });

  it("returns exact trial totals and balanced status", async () => {
    const response = await request("/journal/trial-balance");
    assert.equal(response.status, 200);
    const trial = await response.json() as { totalDebit: number; totalCredit: number; balanced: boolean; accounts: { accountId: number; debit: number; credit: number }[] };
    assert.equal(trial.balanced, true);
    assert.equal(trial.totalDebit, trial.totalCredit);
    assert.equal(trial.accounts.find((account) => account.accountId === reportDebitAccount)?.debit, 18.03);
    assert.equal(trial.accounts.find((account) => account.accountId === reportCreditAccount)?.credit, 18.03);
  });

  it("returns 404 for a missing ledger account", async () => {
    const response = await request("/journal/accounts/2147483647/ledger");
    assert.equal(response.status, 404);
  });
});