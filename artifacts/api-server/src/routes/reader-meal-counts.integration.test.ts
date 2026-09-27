import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, mealCountsTable, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { readerMealCountsPushRouter, readerMealCountsStaffRouter } from "./reader-meal-counts.js";

describe("reader meal-count push and staff read", () => {
  let server: Server;
  let baseUrl: string;
  let staffCookie: string;
  let userId: number;
  let readerToken: string;
  let tokenBefore: string | undefined;
  const suffix = randomUUID();
  const normalizedTypes = [`Morning ${suffix}`, `Midday ${suffix}`, `Evening ${suffix}`];
  const date = "2098-06-10";

  before(async () => {
    process.env.SESSION_SECRET = "reader-meal-counts-test-session-secret";
    tokenBefore = process.env.READER_MEAL_PUSH_TOKEN;
    readerToken = `reader-meal-test-${suffix}`;
    process.env.READER_MEAL_PUSH_TOKEN = readerToken;
    const [user] = await db.insert(usersTable).values({
      username: `reader-meal-${suffix}`,
      normalizedUsername: `reader-meal-${suffix}`,
      role: "admin",
      passwordHash: "not-used",
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    userId = user.id;
    staffCookie = `${hrCookie.name}=${createStaffSession(user)}`;

    const app = express();
    app.use(express.json());
    app.use("/api", readerMealCountsPushRouter);
    app.use("/api", requireStaffAuth, readerMealCountsStaffRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await db.delete(mealCountsTable).where(inArray(
      mealCountsTable.normalizedMealType,
      normalizedTypes.map((type) => type.toLocaleLowerCase("mn-MN")),
    ));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (tokenBefore === undefined) delete process.env.READER_MEAL_PUSH_TOKEN;
    else process.env.READER_MEAL_PUSH_TOKEN = tokenBefore;
  });

  async function push(body: unknown, token = readerToken) {
    return fetch(`${baseUrl}/api/reader/meal-counts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("authenticates, validates and idempotently upserts absolute counts without deleting other types", async () => {
    delete process.env.READER_MEAL_PUSH_TOKEN;
    assert.equal((await push({ records: [] })).status, 503);
    process.env.READER_MEAL_PUSH_TOKEN = readerToken;
    assert.equal((await push({ records: [] }, "wrong-token")).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/reader/meal-counts`, {
      method: "POST",
      headers: { cookie: staffCookie, "content-type": "application/json" },
      body: JSON.stringify({ records: [{ date, mealType: normalizedTypes[0], count: 1 }] }),
    })).status, 401);
    assert.equal((await push({ records: [{ date: "2098-02-30", mealType: normalizedTypes[0], count: 1 }] })).status, 400);
    assert.equal((await push({ records: [
      { date, mealType: `  Morning   ${suffix} `, count: 1 },
      { date, mealType: normalizedTypes[0].toLocaleLowerCase("mn-MN"), count: 2 },
    ] })).status, 400);

    const records = [
      { date, mealType: normalizedTypes[0], count: 4 },
      { date, mealType: normalizedTypes[1], count: 9 },
      { date: "2098-06-11", mealType: normalizedTypes[2], count: 2 },
    ];
    const first = await push({ records });
    assert.equal(first.status, 200);
    const firstResult = await first.json() as { received: number; updatedAt: string };
    assert.equal(firstResult.received, records.length);
    assert.ok(Number.isFinite(Date.parse(firstResult.updatedAt)));

    const replay = await push({ records });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { received: number }).received, records.length);

    const correction = await push({ records: [{ ...records[0], count: 6 }] });
    assert.equal(correction.status, 200);

    assert.equal((await fetch(`${baseUrl}/api/meal-counts?dateFrom=2098-02-30&dateTo=2098-06-11`, {
      headers: { cookie: staffCookie },
    })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/meal-counts?dateFrom=2098-01-01&dateTo=2099-01-02`, {
      headers: { cookie: staffCookie },
    })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/meal-counts?dateFrom=${date}&dateTo=2098-06-11`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/meal-counts?dateFrom=${date}&dateTo=2098-06-11`, {
      headers: { authorization: `Bearer ${readerToken}` },
    })).status, 401);

    const response = await fetch(`${baseUrl}/api/meal-counts?dateFrom=${date}&dateTo=2098-06-11`, {
      headers: { cookie: staffCookie },
    });
    assert.equal(response.status, 200);
    const rows = await response.json() as Array<{ date: string; mealType: string; count: number; syncedAt: string }>;
    assert.deepEqual(rows.map(({ date: rowDate, mealType, count }) => [rowDate, mealType, count]), [
      ["2098-06-11", normalizedTypes[2], 2],
      [date, normalizedTypes[1], 9],
      [date, normalizedTypes[0], 6],
    ]);
    assert.ok(rows.every((row) => Number.isFinite(Date.parse(row.syncedAt))));
  });
});