import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, db, usersTable } from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("read-only cash detail and directly linked bank facts", () => {
  const prefix = `cash-detail-${randomUUID()}`;
  const actors: number[] = [], cashIds: number[] = [], bankIds: number[] = [];
  let server: Server, root: string, cashCookie: string, noCashCookie: string, linkedId: number, plainId: number, hiddenId: number;
  const call = (id: number | string, cookie = cashCookie, method = "GET") =>
    fetch(`${root}/cash/transactions/${id}`, { method, headers: { cookie } });

  before(async () => {
    process.env.SESSION_SECRET = "cash-detail-test-session";
    for (const menus of [["/cash"], ["/bank-transactions"]]) {
      const [actor] = await db.insert(usersTable).values({
        username: `${prefix}-${actors.length}`, normalizedUsername: `${prefix}-${actors.length}`,
        passwordHash: "not-used", role: "viewer", menuPaths: menus,
      }).returning();
      actors.push(actor.id);
      const cookie = `${hrCookie.name}=${createStaffSession(actor)}`;
      if (menus[0] === "/cash") cashCookie = cookie;
      else noCashCookie = cookie;
    }
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-01-14T17:18:19Z"), type: "expense", amount: 1234.56,
      account: `${prefix}-recipient`, counterparty: `${prefix}-party`, description: `${prefix} bank`,
      fingerprint: randomUUID(), bankName: "Fixture Bank", bankAccountNumber: "fixture-own-account",
      balance: 0, executedAt: new Date("2099-01-14T17:18:20Z"),
    }).returning();
    bankIds.push(bank.id);
    const cash = await db.insert(cashTransactionsTable).values([
      { type: "expense", category: "Цалин", description: `${prefix} salary`, amount: 1234.56, date: "2099-01-14", sourceType: "payroll", sourceKey: prefix, bankTransactionId: bank.id, bankVerifiedAt: new Date() },
      { type: "income", category: "Fixture", description: `${prefix} income`, amount: 10.25, date: "2099-01-14", incomeMonth: "2099-01" },
      { type: "expense", category: "Цалин", description: `${prefix} hidden`, amount: 20, date: "2099-01-14", sourceType: "payroll", sourceKey: `${prefix}-hidden`, unclearAt: new Date() },
    ]).returning();
    cashIds.push(...cash.map(row => row.id));
    [linkedId, plainId, hiddenId] = cashIds;
    await db.update(bankTransactionsTable).set({ cashTransactionId: linkedId }).where(eq(bankTransactionsTable.id, bank.id));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  after(async () => {
    // Clear both directions before removing the owned pair.
    if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null }).where(inArray(bankTransactionsTable.id, bankIds));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (actors.length) await db.delete(usersTable).where(inArray(usersTable.id, actors));
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("cash-only viewer reads the linked pair with exact cents, zero balance and unchanged bank clock", async () => {
    const response = await call(linkedId);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.cashTransaction.id, linkedId);
    assert.equal(detail.cashTransaction.transactionKind, "payroll");
    assert.equal(detail.cashTransaction.editable, false);
    assert.equal(detail.cashTransaction.category, "Цалин");
    assert.equal(detail.cashTransaction.amount, 1234.56);
    assert.equal(detail.bankTransaction.id, bankIds[0]);
    assert.equal(detail.bankTransaction.cashTransactionId, linkedId);
    assert.equal(detail.bankTransaction.amount, 1234.56);
    assert.equal(detail.bankTransaction.balance, 0);
    assert.equal(detail.bankTransaction.transactionAt, "2099-01-14T17:18:19.000Z");
    assert.equal(detail.bankTransaction.bankAccountNumber, "fixture-own-account");
  });

  it("unlinked income has explicit null bank and its correct income month", async () => {
    const response = await call(plainId);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.bankTransaction, null);
    assert.equal(detail.cashTransaction.incomeMonth, "2099-01");
    assert.equal(detail.cashTransaction.amount, 10.25);
  });

  it("list and detail use the same cash representation", async () => {
    const response = await fetch(`${root}/cash/transactions`, { headers: { cookie: cashCookie } });
    assert.equal(response.status, 200);
    const row = (await response.json() as Array<{ id: number }>).find(row => row.id === linkedId);
    const detail = await (await call(linkedId)).json();
    assert.deepEqual(detail.cashTransaction, row);
  });

  it("does not grant bank-list, mutation or cash-menu access", async () => {
    assert.equal((await fetch(`${root}/bank-transactions`, { headers: { cookie: cashCookie } })).status, 403);
    assert.equal((await call(linkedId, noCashCookie)).status, 403);
    assert.equal((await call(linkedId, cashCookie, "PUT")).status, 403);
    assert.equal((await call(linkedId, "")).status, 401);
  });

  it("returns 400 for invalid IDs and 404 for hidden or missing cash", async () => {
    assert.equal((await call("invalid")).status, 400);
    assert.equal((await call(2147483647)).status, 404);
    assert.equal((await call(hiddenId)).status, 404);
  });

  it("returns 404 rather than expose hidden bank facts, and performs no write", async () => {
    const [beforeCash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, linkedId));
    const [beforeBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankIds[0]));
    await call(linkedId);
    const [afterCash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, linkedId));
    const [afterBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankIds[0]));
    assert.deepEqual(afterCash, beforeCash);
    assert.deepEqual(afterBank, beforeBank);
    await db.update(bankTransactionsTable).set({ unclearAt: new Date() }).where(eq(bankTransactionsTable.id, bankIds[0]));
    assert.equal((await call(linkedId)).status, 404);
    await db.update(bankTransactionsTable).set({ unclearAt: null }).where(eq(bankTransactionsTable.id, bankIds[0]));
  });
});
