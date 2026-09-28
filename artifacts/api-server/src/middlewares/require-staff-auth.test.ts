import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "./require-staff-auth.js";

describe("technologist staff auth", () => {
  let server: Server;
  let baseUrl: string;
  let userId: number;
  let cookie: string;

  before(async () => {
    process.env.SESSION_SECRET = "technologist-auth-test-secret";
    const username = `technologist-${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username,
      normalizedUsername: username,
      role: "technologist",
      passwordHash: "not-used",
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;

    const app = express();
    app.use("/api", requireStaffAuth);
    app.get("/api/meals", (_req, res) => res.sendStatus(200));
    app.get("/api/meal-schedule/week", (_req, res) => res.sendStatus(200));
    app.get("/api/employees", (_req, res) => res.sendStatus(200));
    app.post("/api/meals", (_req, res) => res.sendStatus(200));
    app.use("/api", (_req, res) => res.sendStatus(200));
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(path: string, method = "GET") {
    return fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { cookie },
    });
  }

  it("allows GET meals and schedule prefixes", async () => {
    assert.equal((await request("/meals")).status, 200);
    assert.equal((await request("/meal-schedule/week")).status, 200);
  });

  it("allows technologist meal creation, ingredient writes, edit requests, and deletion requests", async () => {
    assert.equal((await request("/meals", "POST")).status, 200);
    assert.equal((await request("/meal-schedule", "POST")).status, 200);
    assert.equal((await request("/meals/1/ingredients", "POST")).status, 200);
    assert.equal((await request("/meals/1/ingredients/2", "PUT")).status, 200);
    assert.equal((await request("/meals/1/ingredients/2", "DELETE")).status, 200);
    assert.equal((await request("/meals/1/edit-request", "POST")).status, 200);
    assert.equal((await request("/deletion-requests", "POST")).status, 200);
    assert.equal((await request("/inventory/material-requests/catalog")).status, 200);
    assert.equal((await request("/inventory/material-requests", "POST")).status, 200);
  });

  it("denies protected writes and unrelated GET APIs", async () => {
    assert.equal((await request("/meals/1", "PUT")).status, 403);
    assert.equal((await request("/meals/1", "DELETE")).status, 403);
    assert.equal((await request("/meal-schedule/week", "PUT")).status, 403);
    assert.equal((await request("/meal-schedule/week", "DELETE")).status, 403);
    assert.equal((await request("/meal-schedule/1/move", "POST")).status, 403);
    assert.equal((await request("/meal-schedule/slots", "POST")).status, 403);
    assert.equal((await request("/meal-schedule/slots/1", "PUT")).status, 403);
    assert.equal((await request("/meal-schedule/slots/1", "DELETE")).status, 403);
    assert.equal((await request("/employees")).status, 403);
    assert.equal((await request("/inventory/items")).status, 403);
    assert.equal((await request("/inventory/material-requests")).status, 403);
    assert.equal((await request("/inventory/material-requests/1/status", "PATCH")).status, 403);
  });
});