import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, inventoryPurchasesTable, inventoryPurchaseItemsTable,
  inventoryPurchaseDocumentCountersTable, inventoryItemsTable, inventoryOpeningBalancesTable,
  inventorySuppliersTable,
} from "@workspace/db";
import inventoryRouter from "./inventory.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("daily purchase document numbers", () => {
  const prefix = `number-test-${randomUUID()}`;
  const year = 5000 + randomInt(4000);
  const dates = Array.from({ length: 6 }, (_, i) => `${year}-04-${String(i + 1).padStart(2, "0")}`);
  const itemIds: number[] = [];
  let reserved = false;
  let userId: number;
  let server: Server;
  let base: string;
  let cookie: string;

  const insert = async (date: string, extra: Partial<typeof inventoryPurchasesTable.$inferInsert> = {}) =>
    (await db.insert(inventoryPurchasesTable).values({
      date, totalAmount: 20, materialType: "supply", documentName: prefix, ...extra,
    }).returning())[0];
  const number = (date: string, sequence: number) => `${date.replaceAll("-", "/")}/${String(sequence).padStart(3, "0")}`;
  const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  before(async () => {
    const counters = await db.select().from(inventoryPurchaseDocumentCountersTable)
      .where(inArray(inventoryPurchaseDocumentCountersTable.date, dates));
    assert.equal(counters.length, 0, "Do not reuse another test's dates");
    reserved = true;
    const [user] = await db.insert(usersTable).values({
      username: prefix, normalizedUsername: prefix, passwordHash: "not-used", role: "admin",
    }).returning();
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession({ ...user, role: "admin" })}`;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, inventoryRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    server?.close();
    const owned = await db.select({ id: inventoryPurchasesTable.id }).from(inventoryPurchasesTable)
      .where(eq(inventoryPurchasesTable.documentName, prefix));
    if (owned.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, owned.map(p => p.id)));
    if (itemIds.length) {
      await db.delete(inventoryOpeningBalancesTable).where(inArray(inventoryOpeningBalancesTable.inventoryItemId, itemIds));
      await db.delete(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds));
    }
    await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.normalizedName, prefix));
    if (reserved) await db.delete(inventoryPurchaseDocumentCountersTable).where(inArray(inventoryPurchaseDocumentCountersTable.date, dates));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  });

  it("starts each selected date at 001 and serializes concurrent writers", async () => {
    const purchases = await Promise.all(Array.from({ length: 12 }, () => insert(dates[0])));
    assert.deepEqual(purchases.map(p => p.documentNumber).sort(), Array.from({ length: 12 }, (_, i) => number(dates[0], i + 1)));
    assert.equal((await insert(dates[1])).documentNumber, number(dates[1], 1));
  });
  it("preserves ordinary edits, does not reuse deleted numbers, and renumbers changed dates", async () => {
    const first = await insert(dates[2], { documentNumber: "client-supplied-number" });
    assert.equal(first.documentNumber, number(dates[2], 1));
    const [edited] = await db.update(inventoryPurchasesTable).set({ documentNumber: "overwrite", totalAmount: 33 })
      .where(eq(inventoryPurchasesTable.id, first.id)).returning();
    assert.equal(edited.documentNumber, first.documentNumber);
    await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, first.id));
    const next = await insert(dates[2]);
    assert.equal(next.documentNumber, number(dates[2], 2));
    const [moved] = await db.update(inventoryPurchasesTable).set({ date: dates[1] })
      .where(eq(inventoryPurchasesTable.id, next.id)).returning();
    assert.equal(moved.documentNumber, number(dates[1], 2));
    assert.equal((await insert(dates[2])).documentNumber, number(dates[2], 3));
  });
  it("rolls back a failed allocation and does not truncate numbers after 999", async () => {
    await assert.rejects(db.transaction(async tx => {
      await tx.insert(inventoryPurchasesTable).values({ date: dates[3], totalAmount: 20, documentName: prefix });
      throw new Error("forced rollback");
    }), /forced rollback/);
    assert.equal((await insert(dates[3])).documentNumber, number(dates[3], 1));
    await db.insert(inventoryPurchaseDocumentCountersTable).values({ date: dates[5], lastSequence: 998 });
    assert.equal((await insert(dates[5])).documentNumber, number(dates[5], 999));
    assert.equal((await insert(dates[5])).documentNumber, number(dates[5], 1000));
  });
  it("stock API deduplicates live purchase numbers, excludes exhausted lots, and preserves edit response", async () => {
    const [item] = await db.insert(inventoryItemsTable).values({
      name: prefix, normalizedName: prefix, materialType: "supply", category: "Тест", unit: "кг", quantity: 3.5,
    }).returning();
    itemIds.push(item.id);
    const active = await insert(dates[0]);
    const exhausted = await insert(dates[0]);
    await db.insert(inventoryPurchaseItemsTable).values([
      ...[1, 0.5].map(quantity => ({
        purchaseId: active.id, inventoryItemId: item.id, name: item.name, category: item.category,
        unit: item.unit, quantity, remainingQuantity: quantity, unitPrice: 10, totalAmount: quantity * 10,
      })),
      { purchaseId: exhausted.id, inventoryItemId: item.id, name: item.name, category: item.category,
        unit: item.unit, quantity: 2, remainingQuantity: 0, unitPrice: 10, totalAmount: 20 },
    ]);
    await db.insert(inventoryOpeningBalancesTable).values({
      inventoryItemId: item.id, date: dates[0], quantity: 2, remainingQuantity: 2, unitPrice: 10,
    });
    const response = await call("/inventory/items");
    assert.equal(response.status, 200);
    const stock = (await response.json() as Array<{ id: number; quantity: number; totalValue: number; purchaseDocumentNumbers: string[] }>)
      .find(row => row.id === item.id)!;
    assert.deepEqual(stock.purchaseDocumentNumbers, [active.documentNumber]);
    assert.equal(stock.totalValue, 35);
    const edited = await call(`/inventory/items/${item.id}`, "PUT", { name: prefix, category: "Шинэ" });
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.deepEqual((await edited.json()).purchaseDocumentNumbers, [active.documentNumber]);
    const purchaseList = await call("/inventory/purchases");
    assert.equal(purchaseList.status, 200);
    assert.equal((await purchaseList.json() as Array<{ id: number; documentNumber: string }>).find(p => p.id === active.id)!.documentNumber, active.documentNumber);
  });
  it("create/update APIs return the assigned number and keep it stable on ordinary edits", async () => {
    const [item] = await db.insert(inventoryItemsTable).values({
      name: `${prefix}-api`, normalizedName: `${prefix}-api`, materialType: "supply", category: "Тест", unit: "ширхэг", quantity: 0,
    }).returning();
    itemIds.push(item.id);
    const input = { supplierName: prefix, materialType: "supply", hasReceipt: false, date: dates[4],
      items: [{ inventoryItemId: item.id, name: item.name, category: item.category, unit: item.unit, quantity: 2, unitPrice: 10 }] };
    const created = await call("/inventory/purchases", "POST", input);
    assert.equal(created.status, 201, await created.clone().text());
    const purchase = await created.json();
    assert.equal(purchase.documentNumber, number(dates[4], 1));
    const edited = await call(`/inventory/purchases/${purchase.id}`, "PUT", input);
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).documentNumber, purchase.documentNumber);
    const changedDate = await call(`/inventory/purchases/${purchase.id}`, "PUT", { ...input, date: dates[1] });
    assert.equal(changedDate.status, 200, await changedDate.clone().text());
    assert.equal((await changedDate.json()).documentNumber, number(dates[1], 3));
  });
  it("concurrent date edit and creation on the same item use one consistent lock order", async () => {
    const [item] = await db.insert(inventoryItemsTable).values({
      name: `${prefix}-concurrent`, normalizedName: `${prefix}-concurrent`, materialType: "supply",
      category: "Тест", unit: "ширхэг", quantity: 0,
    }).returning();
    itemIds.push(item.id);
    const input = { supplierName: prefix, materialType: "supply", hasReceipt: false, date: dates[3],
      items: [{ inventoryItemId: item.id, name: item.name, category: item.category, unit: item.unit, quantity: 2, unitPrice: 10 }] };
    const first = await call("/inventory/purchases", "POST", input);
    assert.equal(first.status, 201, await first.clone().text());
    const purchase = await first.json();
    const [created, edited] = await Promise.all([
      call("/inventory/purchases", "POST", { ...input, date: dates[4] }),
      call(`/inventory/purchases/${purchase.id}`, "PUT", { ...input, date: dates[4] }),
    ]);
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal(edited.status, 200, await edited.clone().text());
    const numbers = [(await created.json()).documentNumber, (await edited.json()).documentNumber].sort();
    assert.deepEqual(numbers, [number(dates[4], 2), number(dates[4], 3)]);
    const stock = (await (await call("/inventory/items")).json() as Array<{ id: number; quantity: number; purchaseDocumentNumbers: string[] }>)
      .find(row => row.id === item.id)!;
    assert.equal(stock.quantity, 4);
    assert.deepEqual(stock.purchaseDocumentNumbers, numbers);
  });
});
