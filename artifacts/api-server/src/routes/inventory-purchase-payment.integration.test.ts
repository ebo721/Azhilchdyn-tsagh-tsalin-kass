import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import {
  cashTransactionsTable,
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

  before(async () => {
    process.env.SESSION_SECRET = "inventory-purchase-payment-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      documentName: `Payment test ${process.pid}`,
      hasReceipt: true,
      date: "2099-01-10",
      totalAmount: 125_000,
    }).returning({ id: inventoryPurchasesTable.id });
    purchaseId = purchase.id;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await db.delete(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchaseId));
    server.close();
  });

  it("creates and removes the linked cash expense when payment is confirmed and cancelled", async () => {
    const confirmResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-15", amount: 120_000 }),
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
    assert.equal(Number(cashExpense.amount), 120_000);

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
  });
});