import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  cashTransactionsTable,
  bankTransactionsTable,
  db,
  inventoryPurchasesTable,
  usersTable,
} from "@workspace/db";
import app from "../app.ts";
import { createStaffSession, hrCookie } from "../lib/hr-session.ts";

describe("inventory purchase payment", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let purchaseId: number;
  let bankTransactionId: number;

  before(async () => {
    process.env.SESSION_SECRET = "inventory-purchase-payment-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      documentName: `Payment test ${process.pid}`,
      hasReceipt: true,
      date: "2099-01-10",
      totalAmount: 125_000,
    }).returning({ id: inventoryPurchasesTable.id });
    purchaseId = purchase.id;
    const [bankTransaction] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-01-15T09:30:00.000Z"),
      type: "expense",
      amount: 120_000,
      account: "1234567890",
      counterparty: `Payment test ${process.pid}`,
      description: `Payment test ${process.pid} бараа материал`,
      fingerprint: `inventory-payment-bank-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    bankTransactionId = bankTransaction.id;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await db.delete(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchaseId));
    server.close();
  });

  it("suggests, links, and releases a bank transaction with the cash expense", async () => {
    const suggestionsResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment-bank-suggestions`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await suggestionsResponse.json() as Array<{ id: number; score: number }>;
    assert.equal(suggestions[0]?.id, bankTransactionId);
    assert.ok((suggestions[0]?.score ?? 0) > 0);

    const confirmResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-15", amount: 120_000, bankTransactionId }),
    });
    assert.equal(confirmResponse.status, 200);
    const confirmed = await confirmResponse.json() as { paid: boolean; paymentDate: string; paymentAmount: number };
    assert.equal(confirmed.paid, true);
    assert.equal(confirmed.paymentDate, "2099-01-15");
    assert.equal(confirmed.paymentAmount, 120_000);

    const [cashExpense] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    assert.ok(cashExpense);
    assert.equal(cashExpense.date, "2099-01-15");
    assert.equal(cashExpense.category, "Хүнсний бараа материал");
    assert.equal(Number(cashExpense.amount), 120_000);
    assert.equal(cashExpense.bankTransactionId, bankTransactionId);
    assert.ok(cashExpense.bankVerifiedAt);
    const [linkedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(linkedBank?.cashTransactionId, cashExpense.id);
    assert.ok(linkedBank?.transferredAt);

    const reconfirmResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-16", amount: 110_000 }),
    });
    assert.equal(reconfirmResponse.status, 409);

    const cancelResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    assert.equal(cancelResponse.status, 200);
    const cancelled = await cancelResponse.json() as { paid: boolean; paymentDate: null; paymentAmount: null };
    assert.equal(cancelled.paid, false);
    assert.equal(cancelled.paymentDate, null);
    assert.equal(cancelled.paymentAmount, null);

    const [removedCashExpense] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    assert.equal(removedCashExpense, undefined);
    const [releasedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(releasedBank?.cashTransactionId, null);
    assert.equal(releasedBank?.transferredAt, null);

    const relinkResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-15", amount: 120_000, bankTransactionId }),
    });
    assert.equal(relinkResponse.status, 200);
    const deleteResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    assert.equal(deleteResponse.status, 204);
    const [releasedAfterDelete] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(releasedAfterDelete?.cashTransactionId, null);
    assert.equal(releasedAfterDelete?.transferredAt, null);
  });

  it("allows only one purchase to claim the same bank transaction concurrently", async () => {
    const purchases = await db.insert(inventoryPurchasesTable).values([
      { documentName: `Concurrent payment A ${process.pid}`, hasReceipt: true, date: "2099-02-10", totalAmount: 50_000 },
      { documentName: `Concurrent payment B ${process.pid}`, hasReceipt: true, date: "2099-02-10", totalAmount: 50_000 },
    ]).returning({ id: inventoryPurchasesTable.id });
    const purchaseIds = purchases.map((purchase) => purchase.id);
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-02-11T10:00:00.000Z"),
      type: "expense",
      amount: 50_000,
      description: `Concurrent payment ${process.pid}`,
      fingerprint: `inventory-payment-concurrent-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    try {
      const responses = await Promise.all(purchaseIds.map((id) => fetch(`${baseUrl}/api/inventory/purchases/${id}/payment`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ date: "2099-02-11", amount: 50_000, bankTransactionId: bank.id }),
      })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const linkedCash = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      assert.equal(linkedCash.length, 1);
    } finally {
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, bank.id));
      await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchaseIds));
      await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    }
  });
});