import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, bankAccountsTable, bankTransactionsTable, bankInternalTransfersTable,
  cashTransactionsTable, chartOfAccountsTable, inventoryPurchasesTable, operatingExpensesTable,
  journalEntriesTable,
} from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { countTransferSuggestions } from "../lib/bank-internal-transfer.js";

describe("bank internal transfer HTTP lifecycle", () => {
  const prefix = `internal-${randomUUID()}`;
  const banks: number[] = [], accounts: number[] = [], users: number[] = [], purchases: number[] = [], expenses: number[] = [], cash: number[] = [];
  const cookies: Record<string, string> = {};
  const gl: Record<string, number> = {};
  let server: Server, base: string;
  const date = "2097-08-20";
  const call = (path: string, method = "GET", data?: unknown, role = "admin") => fetch(`${base}/api${path}`, {
    method, headers: { cookie: cookies[role], "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  async function bank(type: "income" | "expense", account = accounts[type === "expense" ? 0 : 1], amount = 100) {
    const [row] = await db.insert(bankTransactionsTable).values({
      type, amount, bankAccountId: account, transactionAt: new Date(`${date}T09:00:00Z`),
      description: prefix, account: prefix, counterparty: "", fingerprint: randomUUID(),
    }).returning();
    banks.push(row.id);
    return row;
  }
  async function purchase(amount = 100) {
    const [row] = await db.insert(inventoryPurchasesTable).values({
      documentName: prefix, materialType: "food", accountId: gl["1500"], date, totalAmount: amount,
    }).returning();
    purchases.push(row.id); return row.id;
  }
  before(async () => {
    for (const role of ["admin", "accountant", "viewer", "warehouse"] as const) {
      const [user] = await db.insert(usersTable).values({
        username: `${prefix}-${role}`, normalizedUsername: `${prefix}-${role}`, passwordHash: "unused", role,
      }).returning();
      users.push(user.id); cookies[role] = `${hrCookie.name}=${createStaffSession(user)}`;
    }
    for (const number of ["out", "in", "other"]) {
      const [account] = await db.insert(bankAccountsTable).values({ bankName: prefix, accountNumber: `${prefix}-${number}` }).returning();
      accounts.push(account.id);
    }
    for (const row of await db.select().from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, ["1500", "1510", "1800", "6900", "4000"]))) gl[row.code] = row.id;
    server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    if (banks.length) {
      await db.delete(bankInternalTransfersTable).where(inArray(bankInternalTransfersTable.outBankTransactionId, banks));
      await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
    }
    if (cash.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cash));
    if (purchases.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchases));
    if (expenses.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, expenses));
    await db.delete(bankAccountsTable).where(inArray(bankAccountsTable.id, accounts));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
    await new Promise<void>(resolve => server.close(() => resolve())); await pool.end();
  });
  it("suggests, explicitly pairs idempotently, excludes accounting, then restores on unpair", async () => {
    const out = await bank("expense"), incoming = await bank("income");
    const suggestions = await (await call(`/bank-transactions/${out.id}/transfer-suggestions`)).json();
    assert.ok(suggestions.some((row: { id: number; score: number }) => row.id === incoming.id && row.score === 100));
    assert.equal(await countTransferSuggestions([out.id, incoming.id]), 2);
    const totals = async () => {
      const rows = await (await call("/bank-transactions")).json();
      const own = rows.filter((row: { id: number; internalTransfer: boolean }) => [out.id, incoming.id].includes(row.id) && !row.internalTransfer);
      return {
        income: own.filter((r: { type: string }) => r.type === "income").reduce((n: number, r: { amount: number }) => n + r.amount, 0),
        expense: own.filter((r: { type: string }) => r.type === "expense").reduce((n: number, r: { amount: number }) => n + r.amount, 0),
      };
    };
    assert.deepEqual(await totals(), { income: 100, expense: 100 });
    const beforeCash = await db.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable).where(inArray(cashTransactionsTable.bankTransactionId, [out.id, incoming.id]));
    const paired = await Promise.all([
      call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: incoming.id }, "accountant"),
      call(`/bank-transactions/${incoming.id}/pair-transfer`, "POST", { peerId: out.id }),
    ]);
    assert.deepEqual(paired.map(r => r.status), [200, 200]);
    const result = await paired[0].json(); assert.equal((await paired[1].json()).id, result.id);
    assert.equal((await db.select().from(bankInternalTransfersTable).where(eq(bankInternalTransfersTable.outBankTransactionId, out.id))).length, 1);
    assert.deepEqual(await totals(), { income: 0, expense: 0 });
    assert.equal(await countTransferSuggestions([out.id, incoming.id]), 0);
    const review = await (await call("/bank-transactions/journal-review")).json();
    assert.ok(!review.some((r: { id: number }) => [out.id, incoming.id].includes(r.id)));
    const rows = await (await call("/bank-transactions")).json();
    assert.equal(rows.find((r: { id: number }) => r.id === out.id).transferPeerId, incoming.id);
    assert.deepEqual(await (await call(`/bank-transactions/${out.id}/transfer-suggestions`)).json(), []);
    assert.deepEqual(await db.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable).where(inArray(cashTransactionsTable.bankTransactionId, [out.id, incoming.id])), beforeCash);
    assert.equal((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.description, prefix))).length, 0);
    assert.equal((await call(`/bank-transactions/${incoming.id}/pair-transfer`, "DELETE", undefined, "accountant")).status, 204);
    assert.equal((await call(`/bank-transactions/${incoming.id}/pair-transfer`, "DELETE")).status, 204);
    assert.deepEqual(await totals(), { income: 100, expense: 100 });
    assert.ok((await (await call("/bank-transactions/journal-review")).json()).some((r: { id: number }) => r.id === out.id));
  });
  it("rejects every accounting mutation with 409, including alternative payment routes", async () => {
    const out = await bank("expense"), incoming = await bank("income", accounts[1], 99);
    assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: incoming.id })).status, 200);
    const [pair] = await db.select().from(bankInternalTransfersTable).where(eq(bankInternalTransfersTable.outBankTransactionId, out.id));
    assert.equal(Number(pair.feeAmount), 1);
    const p1 = await purchase(), p2 = await purchase();
    const [expense] = await db.insert(operatingExpensesTable).values({ description: prefix, accountId: gl["6900"], date, amount: 100 }).returning();
    expenses.push(expense.id);
    const [cashRow] = await db.insert(cashTransactionsTable).values({ type: "expense", category: "test", description: prefix, amount: 100, date }).returning();
    cash.push(cashRow.id);
    const cases: Array<[number, string, string, unknown?]> = [
      [out.id, "link-purchase", "POST", { inventoryPurchaseId: p1 }],
      [out.id, "link-purchases", "POST", { inventoryPurchaseIds: [p1, p2] }],
      [out.id, "link-expense", "POST", { operatingExpenseId: expense.id }],
      [out.id, "link-fixed-asset", "POST", { name: prefix, unitPrice: 100, quantity: 1, date }],
      [out.id, "post-journal", "POST", { accountId: gl["6900"] }],
      [incoming.id, "transfer-to-cash", "POST", { incomeMonth: "2097-08" }],
      [out.id, "link-cash", "POST", { cashTransactionId: cashRow.id }],
      [out.id, "account", "PATCH", { accountId: gl["1500"] }],
      [out.id, "reject-suggestion", "POST", {}],
      [out.id, "", "DELETE"],
    ];
    for (const [id, suffix, method, data] of cases) {
      const response = await call(`/bank-transactions/${id}${suffix ? `/${suffix}` : ""}`, method, data);
      assert.equal(response.status, 409, `${suffix || "delete"}: ${await response.text()}`);
    }
    assert.equal((await call(`/bank-transactions/${out.id}`, "DELETE", undefined, "accountant")).status, 409);
    assert.deepEqual(await (await call(`/bank-transactions/${incoming.id}/cash-suggestions`)).json(), []);
    for (const [path, data] of [
      [`/inventory/purchases/${p1}/payment`, { date, amount: 100, bankTransactionId: out.id }],
      [`/operating-expenses/${expense.id}/payment`, { date, amount: 100, bankTransactionId: out.id }],
    ] as const) {
      const response = await call(path, "PUT", data);
      assert.equal(response.status, 409, `${path}: ${await response.text()}`);
    }
    const unclear = await call(`/unclear-transactions/bank/${out.id}`, "POST", {});
    assert.equal(unclear.status, 409, await unclear.text());
    for (const code of ["1500", "1510", "1800"]) {
      assert.equal((await call(`/bank-transactions/${out.id}/account`, "PATCH", { accountId: gl[code] })).status, 409);
    }
    const suggestions = await (await call(`/inventory/purchases/${p1}/payment-bank-suggestions`)).json();
    assert.ok(Array.isArray(suggestions));
    assert.ok(!suggestions.some((r: { id: number }) => r.id === out.id));
  });
  it("concurrent competing peers cannot claim the same bank row", async () => {
    const out = await bank("expense"), b = await bank("income"), c = await bank("income", accounts[2]);
    const results = await Promise.all([b, c].map(peer => call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: peer.id })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await db.select().from(bankInternalTransfersTable).where(eq(bankInternalTransfersTable.outBankTransactionId, out.id))).length, 1);
  });
  it("enforces roles, input validation and keeps failed pairs non-mutating", async () => {
    const out = await bank("expense"), incoming = await bank("income", accounts[0]);
    for (const role of ["viewer", "warehouse"]) {
      assert.equal((await call(`/bank-transactions/${out.id}/transfer-suggestions`, "GET", undefined, role)).status, 403);
      assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: incoming.id }, role)).status, 403);
      assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "DELETE", undefined, role)).status, 403);
      assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer/`, "POST", { peerId: incoming.id }, role)).status, 403);
    }
    assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: incoming.id })).status, 409);
    assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: 0 })).status, 400);
    assert.equal((await call(`/bank-transactions/${out.id}/pair-transfer`, "POST", { peerId: 2147483647 })).status, 404);
    assert.equal((await db.select().from(bankInternalTransfersTable).where(eq(bankInternalTransfersTable.outBankTransactionId, out.id))).length, 0);
  });
});
