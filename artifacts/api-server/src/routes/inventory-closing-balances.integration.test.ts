import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, usersTable, employeesTable, inventoryCustodianEmployeesTable,
  inventoryItemsTable, inventoryOpeningBalancesTable, inventoryClosingBalancesTable,
  inventoryPurchasesTable, inventoryPurchaseItemsTable, inventoryIssuesTable,
  inventoryIssueConsumptionsTable, inventoryOpeningConsumptionsTable,
} from "@workspace/db";
import inventoryRouter from "./inventory.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("end-of-day inventory counts", () => {
  let server: Server;
  let baseUrl: string;
  const users: number[] = [];
  const sessions: Record<string, string> = {};
  let employeeId: number;
  let itemId: number;
  let purchaseId: number;
  const suffix = randomUUID();

  before(async () => {
    for (const role of ["admin", "warehouse", "viewer"]) {
      const username = `closing-${role}-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "not-used" }).returning();
      users.push(user.id);
      sessions[role] = `${hrCookie.name}=${createStaffSession({ ...user, role: user.role as "admin" })}`;
    }
    const [employee] = await db.insert(employeesTable).values({ name: `Нярав ${suffix}`, role: "Тест", baseSalary: 0 }).returning();
    employeeId = employee.id;
    await db.insert(inventoryCustodianEmployeesTable).values({ employeeId, userId: users[1] });
    const [item] = await db.insert(inventoryItemsTable).values({
      name: `Count stock ${suffix}`, normalizedName: `count stock ${suffix}`, category: "Тест", unit: "кг",
      materialType: "supply", quantity: 6,
    }).returning();
    itemId = item.id;
    await db.insert(inventoryOpeningBalancesTable).values({
      inventoryItemId: itemId, date: "2098-12-31", quantity: 1, remainingQuantity: 1, unitPrice: 90,
    });
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      date: "2099-01-02", materialType: "supply", totalAmount: 600,
    }).returning();
    purchaseId = purchase.id;
    await db.insert(inventoryPurchaseItemsTable).values({
      purchaseId, inventoryItemId: itemId, name: item.name, category: item.category, unit: item.unit,
      quantity: 5, remainingQuantity: 5, unitPrice: 120, totalAmount: 600,
    });
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, inventoryRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(error instanceof Error && error.name === "ZodError" ? 400 : 500)
        .json({ error: error instanceof Error ? error.message : "Unexpected error" }));
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    server?.close();
    if (itemId) {
      await db.delete(inventoryClosingBalancesTable).where(eq(inventoryClosingBalancesTable.inventoryItemId, itemId));
      const issueIds = await db.select({ id: inventoryIssuesTable.id }).from(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      if (issueIds.length) {
        const ids = issueIds.map(row => row.id);
        await db.delete(inventoryIssueConsumptionsTable).where(inArray(inventoryIssueConsumptionsTable.issueId, ids));
        await db.delete(inventoryOpeningConsumptionsTable).where(inArray(inventoryOpeningConsumptionsTable.issueId, ids));
        await db.delete(inventoryIssuesTable).where(inArray(inventoryIssuesTable.id, ids));
      }
      await db.delete(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, purchaseId));
      await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchaseId));
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, itemId));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    }
    if (employeeId) await db.delete(inventoryCustodianEmployeesTable).where(eq(inventoryCustodianEmployeesTable.employeeId, employeeId));
    if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
  });
  const call = (path: string, method = "GET", body?: unknown, role = "admin") =>
    fetch(`${baseUrl}${path}`, {
      method, headers: { cookie: sessions[role] ?? "", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const countInput = (quantity: number, date = "2099-01-03") =>
    ({ inventoryItemId: itemId, date, quantity, responsibleEmployeeId: employeeId });
  const stock = async () => (await (await call("/inventory/items")).json() as Array<{ id: number; quantity: number }>).find(x => x.id === itemId)!.quantity;

  it("quotes the last price on or before the day, with opening-price fallback, and guards roles/dates", async () => {
    const early = await call(`/inventory/closing-balances/quote?inventoryItemId=${itemId}&date=2099-01-01`);
    assert.equal(early.status, 200);
    assert.deepEqual(await early.json(), { inventoryItemId: itemId, date: "2099-01-01", bookQuantity: 1, unitPrice: 90, priceSource: "opening" });
    const quote = await call(`/inventory/closing-balances/quote?inventoryItemId=${itemId}&date=2099-01-03`);
    assert.equal(quote.status, 200);
    assert.deepEqual(await quote.json(), { inventoryItemId: itemId, date: "2099-01-03", bookQuantity: 6, unitPrice: 120, priceSource: "purchase" });
    assert.equal((await call(`/inventory/closing-balances/quote?inventoryItemId=${itemId}&date=2099-02-30`)).status, 400);
    assert.equal((await call("/inventory/closing-balances", "POST", countInput(4), "viewer")).status, 403);
    assert.equal((await call("/inventory/closing-balances", "POST", countInput(4), "none")).status, 401);
    assert.equal((await call("/inventory/closing-balances", "POST", { ...countInput(4), responsibleEmployeeId: null })).status, 400);
    assert.equal((await call("/inventory/closing-balances", "POST", countInput(-1))).status, 400);
  });

  it("saves shortage drafts without consuming stock; edits, surplus and deletion stay atomic", async () => {
    const created = await call("/inventory/closing-balances", "POST", countInput(3), "warehouse");
    assert.equal(created.status, 201, await created.clone().text());
    const count = await created.json() as { id: number; issueId: number; totalAmount: number; difference: number; status: string; responsibleName: string };
    assert.equal(count.totalAmount, 360);
    assert.equal(count.difference, 3);
    assert.equal(count.status, "pending");
    assert.equal(count.responsibleName, `Нярав ${suffix}`);
    assert.equal(await stock(), 6);
    const issues = await call("/inventory/issues");
    const draft = (await issues.json() as Array<{ id: number; status: string; totalCost: number; closingBalanceId: number }>)
      .find(row => row.id === count.issueId)!;
    assert.equal(draft.status, "pending");
    assert.equal(draft.totalCost, 360);
    assert.equal(draft.closingBalanceId, count.id);
    assert.equal((await call(`/inventory/issues/${count.issueId}`, "DELETE")).status, 409);
    assert.equal((await call(`/inventory/issues/${count.issueId}`, "PUT", {
      inventoryItemId: itemId, date: "2099-01-03", quantity: 1, purpose: "Өөрчилсөн",
    })).status, 409);
    assert.equal((await call("/inventory/closing-balances", "POST", countInput(3))).status, 409);
    const surplus = await call(`/inventory/closing-balances/${count.id}`, "PUT", countInput(7));
    assert.equal(surplus.status, 200, await surplus.clone().text());
    assert.equal((await surplus.json()).status, "recorded");
    assert.equal(await stock(), 6);
    assert.ok(!(await (await call("/inventory/issues")).json() as Array<{ id: number }>).some(row => row.id === count.issueId));
    const updated = await call(`/inventory/closing-balances/${count.id}`, "PUT", countInput(3));
    assert.equal(updated.status, 200, await updated.clone().text());
    assert.equal((await updated.json()).status, "pending");
    assert.equal((await call(`/inventory/closing-balances/${count.id}`, "DELETE", undefined, "warehouse")).status, 403);
    assert.equal((await call(`/inventory/closing-balances/${count.id}`, "DELETE")).status, 204);
    assert.equal(await stock(), 6);
  });

  it("confirms exactly once, consumes FIFO only after approval and protects confirmed history", async () => {
    const created = await call("/inventory/closing-balances", "POST", countInput(3));
    assert.equal(created.status, 201);
    const count = await created.json() as { id: number; issueId: number };
    const confirmed = await call(`/inventory/issues/${count.issueId}/confirm`, "POST", undefined, "warehouse");
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    assert.equal((await confirmed.json()).status, "confirmed");
    assert.equal(await stock(), 3);
    const [issue] = (await (await call("/inventory/issues")).json() as Array<{ id: number; totalCost: number; status: string }>).filter(x => x.id === count.issueId);
    assert.equal(issue.totalCost, 330); // opening 1 × 90 + purchase 2 × 120; not 3 × 120.
    assert.equal(issue.status, "confirmed");
    assert.equal((await call(`/inventory/issues/${count.issueId}/confirm`, "POST")).status, 200);
    assert.equal(await stock(), 3);
    assert.equal((await call(`/inventory/closing-balances/${count.id}`, "PUT", countInput(2))).status, 409);
    assert.equal((await call(`/inventory/closing-balances/${count.id}`, "DELETE")).status, 409);
    assert.equal((await call(`/inventory/issues/${count.issueId}`, "DELETE")).status, 409);

    const next = await call("/inventory/closing-balances", "POST", countInput(2, "2099-01-04"));
    assert.equal(next.status, 201, await next.clone().text());
    const stale = await next.json() as { id: number; issueId: number };
    const normal = await call("/inventory/issues", "POST", { inventoryItemId: itemId, date: "2099-01-04", quantity: 1, purpose: "Тест" });
    assert.equal(normal.status, 201, await normal.text());
    const conflict = await call(`/inventory/issues/${stale.issueId}/confirm`, "POST");
    assert.equal(conflict.status, 409);
    assert.equal(await stock(), 2);
    const refreshed = await call(`/inventory/closing-balances/${stale.id}`, "PUT", countInput(1, "2099-01-04"));
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    assert.equal((await call(`/inventory/issues/${stale.issueId}/confirm`, "POST")).status, 200);
    assert.equal(await stock(), 1);
  });
});
