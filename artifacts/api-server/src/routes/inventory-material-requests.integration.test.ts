import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryMaterialRequestsTable, mealScheduleEntriesTable, mealScheduleSlotsTable, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import materialRequestsRouter from "./inventory-material-requests.js";

describe("inventory material requests", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let viewerCookie: string;
  let warehouseCookie: string;
  let accountantCookie: string;
  let adminId: number;
  let viewerId: number;
  let warehouseId: number;
  let accountantId: number;
  let itemId: number;
  let slotId: number;
  let scheduleEntryId: number;
  const requestIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "material-request-test-secret";
    const suffix = randomUUID();
    const [admin] = await db.insert(usersTable).values({ username: `material-admin-${suffix}`, normalizedUsername: `material-admin-${suffix}`, role: "admin", passwordHash: "not-used" }).returning();
    const [viewer] = await db.insert(usersTable).values({ username: `material-viewer-${suffix}`, normalizedUsername: `material-viewer-${suffix}`, role: "viewer", passwordHash: "not-used" }).returning();
    const [warehouse] = await db.insert(usersTable).values({ username: `material-warehouse-${suffix}`, normalizedUsername: `material-warehouse-${suffix}`, role: "warehouse", passwordHash: "not-used" }).returning();
    const [accountant] = await db.insert(usersTable).values({ username: `material-accountant-${suffix}`, normalizedUsername: `material-accountant-${suffix}`, role: "accountant", passwordHash: "not-used" }).returning();
    adminId = admin.id;
    viewerId = viewer.id;
    warehouseId = warehouse.id;
    accountantId = accountant.id;
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    viewerCookie = `${hrCookie.name}=${createStaffSession(viewer)}`;
    warehouseCookie = `${hrCookie.name}=${createStaffSession(warehouse)}`;
    accountantCookie = `${hrCookie.name}=${createStaffSession(accountant)}`;
    const [item] = await db.insert(inventoryItemsTable).values({ name: `Тест материал ${suffix}`, normalizedName: `тест материал ${suffix}`, category: "Тест", unit: "кг", quantity: 0 }).returning();
    itemId = item.id;
    const [slot] = await db.insert(mealScheduleSlotsTable).values({ name: `Тест цаг ${suffix}`, startTime: "08:00", endTime: "08:30", sortOrder: 900000 + Math.floor(Math.random() * 1000), isActive: true }).returning();
    slotId = slot.id;
    const [entry] = await db.insert(mealScheduleEntriesTable).values({ date: "2099-04-03", slotId, kind: "break", mealId: null }).returning();
    scheduleEntryId = entry.id;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, materialRequestsRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    for (const requestId of requestIds) await db.delete(inventoryMaterialRequestsTable).where(eq(inventoryMaterialRequestsTable.id, requestId));
    await db.delete(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.id, scheduleEntryId));
    await db.delete(mealScheduleSlotsTable).where(eq(mealScheduleSlotsTable.id, slotId));
    await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    await db.delete(usersTable).where(eq(usersTable.id, adminId));
    await db.delete(usersTable).where(eq(usersTable.id, viewerId));
    await db.delete(usersTable).where(eq(usersTable.id, warehouseId));
    await db.delete(usersTable).where(eq(usersTable.id, accountantId));
  });

  async function request(cookie: string, path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}/api${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...init.headers } });
  }

  it("creates expanded requests, enforces duplicate lines and transitions", async () => {
    const createdResponse = await request(adminCookie, "/inventory/material-requests", {
      method: "POST",
      body: JSON.stringify({ requestedDate: "2099-02-03", note: "Тест", lines: [{ inventoryItemId: itemId, quantity: 2.5 }] }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: number; requesterId: number; requesterName: string; lines: Array<{ itemName: string; unit: string; quantity: number }> };
    requestIds.push(created.id);
    assert.equal(created.requesterId, adminId);
    assert.equal(created.requesterName.startsWith("material-admin-"), true);
    assert.deepEqual(created.lines[0].quantity, 2.5);
    assert.equal(created.lines[0].unit, "кг");

    const duplicate = await request(adminCookie, "/inventory/material-requests", {
      method: "POST",
      body: JSON.stringify({ requestedDate: "2099-02-03", lines: [{ inventoryItemId: itemId, quantity: 1 }, { inventoryItemId: itemId, quantity: 2 }] }),
    });
    assert.equal(duplicate.status, 400);

    const viewerList = await request(viewerCookie, "/inventory/material-requests");
    assert.equal(viewerList.status, 200);
    assert.ok((await viewerList.json() as unknown[]).length >= 1);

    const approved = await request(adminCookie, `/inventory/material-requests/${created.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
    assert.equal(approved.status, 200);
    const fulfilled = await request(adminCookie, `/inventory/material-requests/${created.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "fulfilled" }) });
    assert.equal(fulfilled.status, 200);
    const invalid = await request(adminCookie, `/inventory/material-requests/${created.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
    assert.equal(invalid.status, 409);
  });

  it("keeps viewers read-only", async () => {
    const response = await request(viewerCookie, "/inventory/material-requests", { method: "POST", body: JSON.stringify({ requestedDate: "2099-02-03", lines: [{ inventoryItemId: itemId, quantity: 1 }] }) });
    assert.equal(response.status, 403);
    const accountantResponse = await request(accountantCookie, "/inventory/material-requests", { method: "POST", body: JSON.stringify({ requestedDate: "2099-02-03", lines: [{ inventoryItemId: itemId, quantity: 1 }] }) });
    assert.equal(accountantResponse.status, 403);
    const warehouseResponse = await request(warehouseCookie, "/inventory/material-requests", { method: "POST", body: JSON.stringify({ requestedDate: "2099-02-03", lines: [{ inventoryItemId: itemId, quantity: 1 }] }) });
    assert.equal(warehouseResponse.status, 201);
    const warehouseRequest = await warehouseResponse.json() as { id: number };
    requestIds.push(warehouseRequest.id);
  });

  it("rejects impossible dates and numeric overflow or precision", async () => {
    for (const quantity of [0, -1, 1.2345, 100_000_000_000]) {
      const response = await request(adminCookie, "/inventory/material-requests", { method: "POST", body: JSON.stringify({ requestedDate: "2099-02-03", lines: [{ inventoryItemId: itemId, quantity }] }) });
      assert.equal(response.status, 400);
    }
    const invalidDate = await request(adminCookie, "/inventory/material-requests", { method: "POST", body: JSON.stringify({ requestedDate: "2099-02-31", lines: [{ inventoryItemId: itemId, quantity: 1 }] }) });
    assert.equal(invalidDate.status, 400);
  });

  it("allows only one concurrent transition", async () => {
    const createdResponse = await request(adminCookie, "/inventory/material-requests", {
      method: "POST",
      body: JSON.stringify({ requestedDate: "2099-03-03", lines: [{ inventoryItemId: itemId, quantity: 1 }] }),
    });
    const created = await createdResponse.json() as { id: number };
    requestIds.push(created.id);
    const responses = await Promise.all([
      request(adminCookie, `/inventory/material-requests/${created.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) }),
      request(adminCookie, `/inventory/material-requests/${created.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  });

  it("requires a linked schedule entry to use the requested date", async () => {
    const mismatch = await request(adminCookie, "/inventory/material-requests", {
      method: "POST",
      body: JSON.stringify({ requestedDate: "2099-04-04", mealScheduleEntryId: scheduleEntryId, lines: [{ inventoryItemId: itemId, quantity: 1 }] }),
    });
    assert.equal(mismatch.status, 400);
    const matching = await request(adminCookie, "/inventory/material-requests", {
      method: "POST",
      body: JSON.stringify({ requestedDate: "2099-04-03", mealScheduleEntryId: scheduleEntryId, lines: [{ inventoryItemId: itemId, quantity: 1 }] }),
    });
    assert.equal(matching.status, 201);
    const created = await matching.json() as { id: number };
    requestIds.push(created.id);
  });
});