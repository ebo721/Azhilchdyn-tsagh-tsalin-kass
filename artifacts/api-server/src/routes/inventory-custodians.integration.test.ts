import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, employeesTable, inventoryItemsTable, inventoryIssuesTable, inventoryOpeningBalancesTable,
  inventoryOpeningConsumptionsTable, inventoryIssueConsumptionsTable, inventoryPurchasesTable,
  inventoryPurchaseItemsTable, inventorySuppliersTable } from "@workspace/db";
import authRouter from "./auth.js";
import inventoryRouter from "./inventory.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("configured inventory custodian names", () => {
  const suffix = randomUUID();
  const userIds: Record<string, number> = {};
  const employeeIds: number[] = [];
  let itemId: number;
  let purchaseId: number;
  let issueId: number;
  let server: Server;
  let url: string;
  const supplierName = `Custodian supplier ${suffix}`;

  before(async () => {
    for (const role of ["admin", "warehouse", "accountant", "viewer", "warehouse2"]) {
      const username = `custodian-${role}-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role: role === "warehouse2" ? "warehouse" : role, passwordHash: "not-used" }).returning();
      userIds[role] = user.id;
    }
    for (const name of ["Нярав Тест", "Нярав Хоёр", "Сонгоогүй ажилтан"]) {
      const [employee] = await db.insert(employeesTable).values({ name, role: "Тест", baseSalary: 0 }).returning();
      employeeIds.push(employee.id);
    }
    const app = express();
    app.use(express.json());
    app.use("/api", authRouter);
    app.use("/api", requireStaffAuth, inventoryRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(error instanceof Error && error.name === "ZodError" ? 400 : 500).json({ error: error instanceof Error ? error.message : "Error" }));
    server = app.listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  async function request(path: string, method = "GET", body?: unknown, role = "admin") {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userIds[role]));
    const cookie = user ? `${hrCookie.name}=${createStaffSession({ ...user, role: user.role as "admin" })}` : "";
    return fetch(`${url}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function rename(role: string, fullName: string | null, newRole = role) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userIds[role]));
    return request(`/users/${user.id}`, "PUT", { username: user.username, role: newRole, fullName });
  }
  const issueBody = () => ({ inventoryItemId: itemId, date: "2099-01-03", quantity: 1, purpose: "Тест" });
  const purchaseBody = () => ({ materialType: "supply", supplierName, hasReceipt: false, date: "2099-01-02",
    items: [{ inventoryItemId: itemId, name: `Custodian item ${suffix}`, category: "Тест", unit: "кг", quantity: 2, unitPrice: 200 }] });

  after(async () => {
    server?.close();
    if (itemId) {
      const issueIds = db.select({ id: inventoryIssuesTable.id }).from(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      await db.delete(inventoryOpeningConsumptionsTable).where(inArray(inventoryOpeningConsumptionsTable.issueId, issueIds));
      await db.delete(inventoryIssueConsumptionsTable).where(inArray(inventoryIssueConsumptionsTable.issueId, issueIds));
      await db.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      await db.delete(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.inventoryItemId, itemId));
      if (purchaseId) await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchaseId));
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, itemId));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    }
    await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.name, supplierName));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(userIds)));
    await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
  });

  const configure = async (key: string, ids: number[], actor = "admin") => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userIds[key]));
    return request(`/users/${user.id}`, "PUT", { username: user.username, role: user.role, custodianEmployeeIds: ids }, actor);
  };
  it("admin selects several real employees; directory deduplicates choices without exposing employee financial fields", async () => {
    assert.equal((await configure("warehouse", employeeIds.slice(0, 2))).status, 200);
    assert.equal((await configure("warehouse2", [employeeIds[1]])).status, 200);
    const users = await (await request("/users")).json();
    assert.deepEqual(users.find((user: { id: number }) => user.id === userIds.warehouse).custodianEmployeeIds.sort(), employeeIds.slice(0, 2).sort());
    assert.equal((await configure("warehouse", [], "warehouse")).status, 403);
    assert.equal((await configure("warehouse", [2147483647])).status, 400);
    assert.equal((await configure("warehouse", [employeeIds[0], employeeIds[0]])).status, 400);
    assert.equal((await configure("accountant", [employeeIds[0]])).status, 400);
    const list = await (await request("/inventory/custodians", "GET", undefined, "warehouse")).json();
    const custodian = list.find((employee: { id: number }) => employee.id === employeeIds[0]);
    assert.deepEqual(custodian, { id: employeeIds[0], name: "Нярав Тест" });
    assert.equal(list.filter((employee: { id: number }) => employee.id === employeeIds[1]).length, 1);
    assert.equal(list.some((employee: { id: number }) => employee.id === employeeIds[2]), false);
    assert.equal((await request("/inventory/custodians", "GET", undefined, "none")).status, 401);
  });

  it("validates assignments and saves purchase/issue names in create/list/edit responses", async () => {
    const opening = await request("/inventory/opening-balances", "POST", { materialType: "supply", name: `Custodian item ${suffix}`, category: "Тест", unit: "кг", date: "2099-01-01", quantity: 5, unitPrice: 100 });
    assert.equal(opening.status, 201);
    itemId = (await opening.json()).inventoryItemId;
    for (const id of [employeeIds[2], 2147483647]) {
      assert.equal((await request("/inventory/issues", "POST", { ...issueBody(), responsibleEmployeeId: id })).status, 400);
      assert.equal((await request("/inventory/purchases", "POST", { ...purchaseBody(), responsibleEmployeeId: id })).status, 400);
    }
    assert.equal((await request("/inventory/issues", "POST", { ...issueBody(), responsibleUserId: userIds.warehouse })).status, 400);
    const purchase = await request("/inventory/purchases", "POST", { ...purchaseBody(), responsibleEmployeeId: employeeIds[0] }, "warehouse");
    assert.equal(purchase.status, 201);
    const savedPurchase = await purchase.json();
    purchaseId = savedPurchase.id;
    assert.equal(savedPurchase.responsibleName, "Нярав Тест");
    assert.equal(savedPurchase.responsibleEmployeeId, employeeIds[0]);
    assert.equal(savedPurchase.responsibleUserId, null);
    const issued = await request("/inventory/issues", "POST", { ...issueBody(), responsibleEmployeeId: employeeIds[1] }, "warehouse");
    assert.equal(issued.status, 201);
    const issue = await issued.json();
    issueId = issue.id;
    assert.equal(issue.responsibleName, "Нярав Хоёр");
    assert.equal(issue.totalCost, 100);
    assert.equal((await request("/inventory/issues", "POST", { ...issueBody(), responsibleEmployeeId: employeeIds[0] }, "viewer")).status, 403);
    const purchases = await (await request("/inventory/purchases")).json();
    assert.equal(purchases.find((row: { id: number }) => row.id === purchaseId).responsibleEmployeeId, employeeIds[0]);
    const issues = await (await request("/inventory/issues")).json();
    assert.equal(issues.find((row: { id: number }) => row.id === issueId).responsibleEmployeeId, employeeIds[1]);
  });

  it("removal, employee rename/deletion and role changes preserve historical names; new choices use current names", async () => {
    await db.update(employeesTable).set({ name: "Шинэ нэр" }).where(eq(employeesTable.id, employeeIds[1]));
    const reassigned = await request(`/inventory/purchases/${purchaseId}`, "PUT", { ...purchaseBody(), responsibleEmployeeId: employeeIds[1] });
    assert.equal(reassigned.status, 200);
    assert.equal((await reassigned.json()).responsibleName, "Шинэ нэр");
    assert.equal((await configure("warehouse", [])).status, 200);
    assert.equal((await rename("warehouse", "Өөр нэр", "viewer")).status, 200);
    const options = await (await request("/inventory/custodians")).json();
    assert.equal(options.some((row: { id: number }) => row.id === employeeIds[0]), false);
    const edited = await request(`/inventory/purchases/${purchaseId}`, "PUT", { ...purchaseBody(), responsibleEmployeeId: employeeIds[1] });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).responsibleName, "Шинэ нэр");
    const issueEdit = await request(`/inventory/issues/${issueId}`, "PUT", { ...issueBody(), responsibleEmployeeId: employeeIds[1] });
    assert.equal(issueEdit.status, 200);
    assert.equal((await issueEdit.json()).responsibleName, "Нярав Хоёр");
    assert.equal((await request("/inventory/issues", "POST", { ...issueBody(), responsibleEmployeeId: employeeIds[0] })).status, 400);
    assert.equal((await request(`/users/${userIds.warehouse}`, "DELETE")).status, 204);
    await db.delete(employeesTable).where(eq(employeesTable.id, employeeIds[1]));
    const afterDelete = await request(`/inventory/issues/${issueId}`, "PUT", issueBody());
    assert.equal(afterDelete.status, 200);
    const saved = await afterDelete.json();
    assert.equal(saved.responsibleUserId, null);
    assert.equal(saved.responsibleEmployeeId, null);
    assert.equal(saved.responsibleName, "Нярав Хоёр");
    const purchases = await (await request("/inventory/purchases")).json();
    assert.equal(purchases.find((row: { id: number }) => row.id === purchaseId).responsibleName, "Шинэ нэр");
    await db.update(inventoryPurchasesTable).set({ responsibleUserId: userIds.warehouse2, responsibleEmployeeId: null, responsibleName: "Хуучин нярав" }).where(eq(inventoryPurchasesTable.id, purchaseId));
    const legacyEdit = await request(`/inventory/purchases/${purchaseId}`, "PUT", purchaseBody());
    assert.equal(legacyEdit.status, 200);
    assert.equal((await legacyEdit.json()).responsibleName, "Хуучин нярав");
  });
});
