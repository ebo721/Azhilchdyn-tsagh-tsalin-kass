import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, usersTable, inventoryCustodianEmployeesTable } from "@workspace/db";
import { ROLE_MENU_PATHS, validMenuSelection } from "@workspace/api-zod";
import authRouter from "./auth.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { canUseMenuApi } from "../lib/staff-menu-access.js";
import { createStaffSession, hashPassword, hrCookie, type StaffRole } from "../lib/hr-session.js";

describe("staff account creation and role-bounded menus", () => {
  const prefix = `menu-test-${randomUUID()}`;
  const password = "Fixture-password-123";
  let server: Server;
  let base: string;
  let actorId: number;
  let actorCookie: string;
  let readonlyCookie: string;
  const cookie = (user: Pick<typeof usersTable.$inferSelect, "id" | "role" | "tokenVersion">) => `${hrCookie.name}=${createStaffSession(user)}`;
  const call = (path: string, method = "GET", body?: unknown, actor = actorCookie) => fetch(base + path, {
    method, headers: { cookie: actor, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  before(async () => {
    const hash = await hashPassword(password);
    const users = await db.insert(usersTable).values([
      { username: `${prefix}-admin`, normalizedUsername: `${prefix}-admin`, role: "admin", passwordHash: hash },
      { username: `${prefix}-reader`, normalizedUsername: `${prefix}-reader`, role: "viewer", passwordHash: hash },
    ]).returning();
    actorId = users[0].id;
    actorCookie = cookie(users[0]);
    readonlyCookie = cookie(users[1]);
    const app = express();
    app.use(express.json());
    app.use("/api", authRouter);
    app.use("/api", requireStaffAuth);
    // These fixture handlers prove the real authorization boundary independently of module data.
    app.use("/api", (_req, res) => res.json({ authorized: true }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    const owned = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.normalizedUsername, `${prefix}%`));
    if (owned.length) {
      const ids = owned.map(user => user.id);
      await db.delete(inventoryCustodianEmployeesTable).where(inArray(inventoryCustodianEmployeesTable.userId, ids));
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
    await pool.end();
  });
  const input = (suffix: string, role: StaffRole = "viewer", menuPaths: string[] | null = ["/meal-counts"]) =>
    ({ username: `${prefix}-${suffix}`, password, role, menuPaths });

  it("only admins create accounts, validates credentials/menus/custodians, and never exposes password data", async () => {
    assert.equal((await call("/users", "POST", input("forbidden"), readonlyCookie)).status, 403);
    assert.equal((await call("/users/", "POST", input("forbidden"), readonlyCookie)).status, 403);
    assert.equal((await call("/users", "POST", input("anonymous"), "")).status, 401);
    for (const body of [
      { ...input("short"), password: "short" },
      { ...input("blank"), username: "  " },
      { ...input("bad-type"), role: "superuser" },
      input("outside", "hr", ["/cash"]),
      input("duplicate-menu", "viewer", ["/meal-counts", "/meal-counts"]),
      input("admin-lockout", "admin", []),
      { ...input("missing-employee", "warehouse", ["/inventory"]), custodianEmployeeIds: [2147483647] },
      { ...input("wrong-custodian-role"), custodianEmployeeIds: [] },
    ]) assert.equal((await call("/users", "POST", body)).status, 400);
    const created = await call("/users", "POST", input("new"));
    assert.equal(created.status, 201, await created.clone().text());
    const user = await created.json();
    assert.deepEqual(user.menuPaths, ["/meal-counts"]);
    assert.equal("passwordHash" in user, false);
    assert.equal("password" in user, false);
    const login = await call("/auth/login", "POST", { username: user.username.toUpperCase(), password });
    assert.equal(login.status, 200);
    assert.deepEqual((await login.json()).menuPaths, ["/meal-counts"]);
    const sessionCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await call("/meal-counts", "GET", undefined, sessionCookie)).status, 200);
    assert.equal((await call("/inventory/items", "GET", undefined, sessionCookie)).status, 403);
    assert.equal((await call("/meal-counts/import/", "POST", {}, sessionCookie)).status, 403);
    assert.equal((await call("/auth/login", "POST", { username: user.username, password: "incorrect" })).status, 401);
  });

  it("normalizes usernames and resolves concurrent duplicate creation to one 201 and one 409", async () => {
    const request = input("race");
    const responses = await Promise.all([
      call("/users", "POST", request),
      call("/users", "POST", { ...request, username: ` ${request.username.toUpperCase()} ` }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    const saved = await db.select().from(usersTable).where(eq(usersTable.normalizedUsername, request.username));
    assert.equal(saved.length, 1);
    assert.notEqual(saved[0].passwordHash, password);
  });

  it("persists selected menus, protects role ceilings, revokes old sessions and supports no-menu accounts", async () => {
    const created = await call("/users", "POST", input("editable", "hr", ["/employees", "/attendance"]));
    const user = await created.json();
    let [saved] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    const oldCookie = cookie(saved);
    assert.equal((await call("/attendance", "GET", undefined, oldCookie)).status, 200);
    assert.equal((await call(`/users/${user.id}`, "PUT", { username: user.username, role: "hr", menuPaths: ["/cash"] })).status, 400);
    const edit = await call(`/users/${user.id}`, "PUT", { username: user.username, role: "hr", menuPaths: ["/meal-counts"] });
    assert.equal(edit.status, 200, await edit.clone().text());
    assert.equal((await call("/attendance", "GET", undefined, oldCookie)).status, 401);
    [saved] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    assert.deepEqual(saved.menuPaths, ["/meal-counts"]);
    assert.equal((await call("/attendance", "GET", undefined, cookie(saved))).status, 403);
    assert.equal((await call("/meal-counts", "GET", undefined, cookie(saved))).status, 200);
    assert.deepEqual((await (await call("/auth/me", "GET", undefined, cookie(saved))).json()).menuPaths, ["/meal-counts"]);
    assert.equal((await call(`/users/${user.id}`, "PUT", { username: user.username, role: "hr", menuPaths: [] })).status, 200);
    [saved] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    assert.equal((await call("/meal-counts", "GET", undefined, cookie(saved))).status, 403);
    assert.equal((await call("/auth/me", "GET", undefined, cookie(saved))).status, 200);
    assert.equal((await call(`/users/${user.id}`, "DELETE")).status, 204);
    assert.equal((await call("/meal-counts", "GET", undefined, cookie(saved))).status, 401);
    assert.equal((await call(`/users/${actorId}`, "DELETE")).status, 400);
  });

  it("menu selection does not grant writes, and hidden admin modules cannot be reached through path variants", async () => {
    const viewerResponse = await call("/users", "POST", input("cash-viewer", "viewer", ["/cash"]));
    const adminResponse = await call("/users", "POST", input("narrow-admin", "admin", ["/users", "/meal-counts"]));
    const viewer = await viewerResponse.json();
    const admin = await adminResponse.json();
    const [v] = await db.select().from(usersTable).where(eq(usersTable.id, viewer.id));
    const [a] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
    assert.equal((await call("/cash", "GET", undefined, cookie(v))).status, 200);
    assert.equal((await call("/cash", "POST", {}, cookie(v))).status, 403);
    for (const path of ["/cash", "/cash/", "/CASH/", "/bank-transactions/journal-review", "/attendance/devices"]) {
      assert.equal((await call(path, "GET", undefined, cookie(a))).status, 403, path);
    }
    assert.equal((await call("/users", "GET", undefined, cookie(a))).status, 200);
    assert.equal((await call(`/users/${a.id}`, "PUT", { username: a.username, role: "admin", menuPaths: ["/meal-counts"] })).status, 400);
    assert.equal((await call("/deletion-requests", "POST", { targetPath: "/cash/1" }, cookie(a))).status, 403);
  });

  it("NULL retains legacy roles and explicit selections keep only necessary read-only page dependencies", () => {
    assert.equal(canUseMenuApi({ role: "warehouse", menuPaths: null }, "/operating-expenses", "POST"), true);
    assert.equal(canUseMenuApi({ role: "accountant", menuPaths: ["/payroll"] }, "/employees", "GET"), true);
    assert.equal(canUseMenuApi({ role: "accountant", menuPaths: ["/payroll"] }, "/employees/1", "PATCH"), false);
    assert.equal(canUseMenuApi({ role: "accountant", menuPaths: ["/payroll"] }, "/cash/closures", "GET"), true);
    assert.equal(canUseMenuApi({ role: "accountant", menuPaths: ["/payroll"] }, "/cash", "GET"), false);
    assert.equal(canUseMenuApi({ role: "admin", menuPaths: ["/users"] }, "/unmapped-new-module", "GET"), false);
    for (const role of Object.keys(ROLE_MENU_PATHS) as StaffRole[]) {
      assert.equal(validMenuSelection(role, ROLE_MENU_PATHS[role]), true);
      if (role !== "admin") assert.equal(validMenuSelection(role, ["/users"]), false);
    }
  });
});
