import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, db, operatingExpensesTable, usersTable } from "@workspace/db";
import app from "../app.ts";
import { createStaffSession, hrCookie } from "../lib/hr-session.ts";

describe("operating expenses", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let expenseId: number;
  let bankId: number;
  before(async () => {
    process.env.SESSION_SECRET = "operating-expense-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin);
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [expense] = await db.insert(operatingExpensesTable).values({ description: `test expense ${process.pid}`, category: "supplies", date: "2099-03-10", amount: 1200 }).returning({ id: operatingExpensesTable.id });
    expenseId = expense.id;
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-12T09:00:00Z"), type: "expense", amount: 1300,
      counterparty: `matched counterparty ${process.pid}`, description: "unrelated bank text",
      fingerprint: `operating-expense-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    bankId = bank.id;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.sourceKey, `expense:${expenseId}`));
    await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, expenseId));
    server.close();
  });

  it("supports CRUD, ranked suggestions, linking, cancellation and deletion", async () => {
    const create = await fetch(`${baseUrl}/api/operating-expenses`, { method: "POST", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ description: "new expense", category: "supplies", date: "2099-03-11", amount: 1250 }) });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number };
    const list = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: adminCookie } });
    assert.equal(list.status, 200);
    const update = await fetch(`${baseUrl}/api/operating-expenses/${created.id}`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ description: "updated", category: "supplies", date: "2099-03-11", amount: 1300 }) });
    assert.equal(update.status, 200);
    const suggestions = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment-bank-suggestions`, { headers: { cookie: adminCookie } });
    assert.equal(suggestions.status, 200);
    assert.equal((await suggestions.json() as Array<{ id: number }>)[0].id, bankId);
    const pay = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ date: "2099-03-12", amount: 1300, bankTransactionId: bankId }) });
    assert.equal(pay.status, 200);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.sourceKey, `expense:${expenseId}`));
    assert.equal(cash.category, "Үйл ажиллагааны зардал");
    assert.equal(cash.sourceType, "operating_expense");
    assert.ok(cash.bankVerifiedAt);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, cash.id);
    const cancel = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment`, { method: "DELETE", headers: { cookie: adminCookie } });
    assert.equal(cancel.status, 200);
    const [released] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(released.cashTransactionId, null);
    const del = await fetch(`${baseUrl}/api/operating-expenses/${created.id}`, { method: "DELETE", headers: { cookie: adminCookie } });
    assert.equal(del.status, 204);
    const cleanup = await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, created.id));
    void cleanup;
  });

  it("allows one concurrent bank claim and denies viewers", async () => {
    const rows = await db.insert(operatingExpensesTable).values([
      { description: "concurrent a", category: "x", date: "2099-04-10", amount: 500 },
      { description: "concurrent b", category: "x", date: "2099-04-10", amount: 500 },
    ]).returning({ id: operatingExpensesTable.id });
    const [bank] = await db.insert(bankTransactionsTable).values({ transactionAt: new Date("2099-04-11T10:00:00Z"), type: "expense", amount: 500, description: "concurrent", fingerprint: `operating-concurrent-${process.pid}` }).returning({ id: bankTransactionsTable.id });
    try {
      const responses = await Promise.all(rows.map((row) => fetch(`${baseUrl}/api/operating-expenses/${row.id}/payment`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ date: "2099-04-11", amount: 500, bankTransactionId: bank.id }) })));
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const viewer = await db.select().from(usersTable).where(eq(usersTable.role, "viewer")).limit(1);
      if (viewer[0]) {
        const response = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: `${hrCookie.name}=${createStaffSession(viewer[0])}` } });
        assert.equal(response.status, 403);
      }
    } finally {
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, bank.id));
      await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, rows.map((r) => r.id)));
      await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    }
  });
});