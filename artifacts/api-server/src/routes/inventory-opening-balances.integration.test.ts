import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryOpeningBalancesTable, inventoryOpeningConsumptionsTable, inventoryIssuesTable, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import inventoryRouter from "./inventory.js";

describe("inventory opening stock lifecycle", () => {
  let server: Server;
  let baseUrl: string;
  const cookies: Record<string, string> = {};
  const userIds: number[] = [];
  const itemIds: number[] = [];
  const suffix = randomUUID();
  const input = { materialType: "supply", name: `Opening stock ${suffix}`, category: "Тест", unit: "кг", date: "2099-01-01", quantity: 5, unitPrice: 1000 };

  before(async () => {
    for (const role of ["admin", "warehouse", "viewer", "accountant"]) {
      const username = `opening-${role}-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "not-used" }).returning();
      userIds.push(user.id);
      cookies[role] = `${hrCookie.name}=${createStaffSession({ ...user, role: role as "admin" })}`;
    }
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, inventoryRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof Error && error.name === "ZodError" ? 400 : 500).json({ error: error instanceof Error ? error.message : "Error" });
    });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  after(async () => {
    server?.close();
    for (const id of itemIds) {
      await db.delete(inventoryOpeningConsumptionsTable).where(inArray(inventoryOpeningConsumptionsTable.openingBalanceId,
        db.select({ id: inventoryOpeningBalancesTable.id }).from(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, id))));
      await db.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, id));
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, id));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  const request = (path: string, method = "GET", body?: unknown, role = "admin") =>
    fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", cookie: cookies[role] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("requires authentication and blocks viewer/accountant writes", async () => {
    assert.equal((await request("/inventory/opening-balances", "GET", undefined, "none")).status, 401);
    for (const role of ["viewer", "accountant"]) {
      assert.equal((await request("/inventory/opening-balances", "POST", input, role)).status, 403);
    }
  });

  it("rejects invalid dates, quantities, prices and missing existing items", async () => {
    for (const change of [{ date: "2099-02-30" }, { quantity: 0 }, { unitPrice: -1 }, { name: "  " }, { quantity: 0.0001 }]) {
      assert.equal((await request("/inventory/opening-balances", "POST", { ...input, ...change })).status, 400);
    }
    assert.equal((await request("/inventory/opening-balances", "POST", { ...input, inventoryItemId: 2147483647 })).status, 404);
  });

  it("creates new/existing stock, updates costs, issues, reverses, and protects consumed lots", async () => {
    const created = await request("/inventory/opening-balances", "POST", input, "warehouse");
    assert.equal(created.status, 201);
    const first = await created.json();
    itemIds.push(first.inventoryItemId);
    assert.equal(first.totalAmount, 5000);
    const existing = { ...input, inventoryItemId: first.inventoryItemId, date: "2099-01-02", quantity: 3 };
    assert.equal((await request("/inventory/opening-balances", "POST", { ...existing, unit: "литр" })).status, 409);
    const added = await request("/inventory/opening-balances", "POST", existing);
    assert.equal(added.status, 201);
    const second = await added.json();
    assert.equal((await request(`/inventory/opening-balances/${second.id}`, "PUT", { ...existing, quantity: 4, unitPrice: 2000 })).status, 200);
    const stock = async () => (await (await request("/inventory/items")).json()).find((row: { id: number }) => row.id === first.inventoryItemId);
    assert.equal((await stock()).quantity, 9);
    assert.equal((await stock()).totalValue, 13000);
    const issueInput = { inventoryItemId: first.inventoryItemId, date: "2099-01-03", quantity: 2, purpose: "Тест" };
    const issued = await request("/inventory/issues", "POST", issueInput);
    assert.equal(issued.status, 201);
    const issue = await issued.json();
    assert.equal(issue.totalCost, 2000);
    assert.equal((await stock()).quantity, 7);
    assert.equal((await stock()).totalValue, 11000);
    const listed = await (await request("/inventory/issues")).json();
    assert.equal(listed.find((row: { id: number }) => row.id === issue.id).totalCost, 2000);
    assert.equal((await request(`/inventory/opening-balances/${first.id}`, "PUT", { ...input, inventoryItemId: first.inventoryItemId })).status, 409);
    assert.equal((await request(`/inventory/opening-balances/${first.id}`, "DELETE")).status, 409);
    assert.equal((await request("/inventory/issues", "POST", { ...issueInput, quantity: 8 })).status, 409);
    assert.equal((await request(`/inventory/issues/${issue.id}`, "PUT", { ...issueInput, quantity: 10 })).status, 409);
    assert.equal((await stock()).quantity, 7);
    assert.equal((await request(`/inventory/issues/${issue.id}`, "PUT", { ...issueInput, quantity: 9 })).status, 200);
    assert.equal((await stock()).quantity, 0);
    assert.equal((await stock()).totalValue, 0);
    assert.equal((await request("/inventory/issues", "POST", { ...issueInput, quantity: 1 })).status, 409);
    assert.equal((await request(`/inventory/issues/${issue.id}`, "DELETE")).status, 204);
    assert.equal((await stock()).quantity, 9);
    assert.equal((await stock()).totalValue, 13000);
    assert.equal((await request(`/inventory/opening-balances/${first.id}`, "DELETE", undefined, "warehouse")).status, 403);
    assert.equal((await request(`/inventory/opening-balances/${first.id}`, "DELETE")).status, 204);
    assert.equal((await stock()).quantity, 4);
    assert.equal((await stock()).totalValue, 8000);
  });

  it("preserves fractional food stock and serializes parallel consumption", async () => {
    const body = { ...input, name: `Food stock ${suffix}`, materialType: "food", quantity: 0.005, unitPrice: 10000 };
    const response = await request("/inventory/opening-balances", "POST", body);
    assert.equal(response.status, 201);
    const row = await response.json();
    itemIds.push(row.inventoryItemId);
    const issue = { inventoryItemId: row.inventoryItemId, date: body.date, quantity: 0.003, purpose: "Тест" };
    const results = await Promise.all([request("/inventory/issues", "POST", issue), request("/inventory/issues", "POST", issue)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, row.inventoryItemId));
    assert.equal(item.quantity, 0.002);
  });
});
