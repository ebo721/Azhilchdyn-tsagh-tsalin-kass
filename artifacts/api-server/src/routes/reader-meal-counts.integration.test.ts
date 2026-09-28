import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, mealCountsTable, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { readerMealCountsStaffRouter } from "./reader-meal-counts.js";

describe("manual Reader meal-count import", () => {
  let apiServer: Server;
  let readerServer: Server;
  let apiUrl: string;
  let readerUrl: string;
  let adminCookie: string;
  let warehouseCookie: string;
  let viewerCookie: string;
  let technologistCookie: string;
  let hrCookieValue: string;
  let accountantCookie: string;
  let readerToken: string;
  let payload: unknown;
  let upstreamStatus = 200;
  let forwardedAuthorization = "";
  let forwardedAccept = "";
  let forwardedQuery = "";
  const userIds: number[] = [];
  const suffix = randomUUID();
  const mealTypes = [`Morning ${suffix}`, `Midday ${suffix}`, `Evening ${suffix}`, `Partial ${suffix}`];
  const dateFrom = "2098-06-10";
  const dateTo = "2098-06-11";
  const envBefore: Record<string, string | undefined> = {};
  const envKeys = ["NODE_ENV", "SESSION_SECRET", "READER_MEAL_EXPORT_URL", "READER_MEAL_READ_TOKEN"];

  before(async () => {
    for (const key of envKeys) envBefore[key] = process.env[key];
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "reader-meal-counts-test-session-secret";
    readerToken = `reader-meal-test-${suffix}`;

    const roles = ["admin", "warehouse", "viewer", "technologist", "hr", "accountant"] as const;
    const users = await db.insert(usersTable).values(roles.map((role) => ({
      username: `meal-import-${role}-${suffix}`,
      normalizedUsername: `meal-import-${role}-${suffix}`,
      role,
      passwordHash: "not-used",
    }))).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    userIds.push(...users.map((user) => user.id));
    const cookieForRole = (role: string) => {
      const user = users.find((entry) => entry.role === role);
      assert.ok(user);
      return `${hrCookie.name}=${createStaffSession(user)}`;
    };
    adminCookie = cookieForRole("admin");
    warehouseCookie = cookieForRole("warehouse");
    viewerCookie = cookieForRole("viewer");
    technologistCookie = cookieForRole("technologist");
    hrCookieValue = cookieForRole("hr");
    accountantCookie = cookieForRole("accountant");

    readerServer = await new Promise<Server>((resolve) => {
      const server = createServer((req, res) => {
        forwardedAuthorization = req.headers.authorization ?? "";
        forwardedAccept = req.headers.accept ?? "";
        forwardedQuery = req.url ?? "";
        res.statusCode = upstreamStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    readerUrl = `http://127.0.0.1:${(readerServer.address() as AddressInfo).port}/export`;
    process.env.READER_MEAL_EXPORT_URL = readerUrl;
    process.env.READER_MEAL_READ_TOKEN = readerToken;

    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, readerMealCountsStaffRouter);
    apiServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => apiServer.once("listening", resolve));
    apiUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/api`;
  });

  after(async () => {
    await Promise.all([apiServer, readerServer].map((server) => new Promise<void>((resolve) => server?.close(() => resolve()))));
    await db.delete(mealCountsTable).where(inArray(
      mealCountsTable.normalizedMealType,
      mealTypes.map((type) => type.toLocaleLowerCase("mn-MN")),
    ));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    for (const key of envKeys) {
      const value = envBefore[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function importCounts(
    dateRange: { dateFrom: string; dateTo: string } = { dateFrom, dateTo },
    cookie = adminCookie,
  ) {
    return fetch(`${apiUrl}/meal-counts/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(dateRange),
    });
  }

  async function readCounts() {
    const result = await db.select({
      date: mealCountsTable.date,
      mealType: mealCountsTable.mealType,
      count: mealCountsTable.count,
    }).from(mealCountsTable).where(inArray(
      mealCountsTable.normalizedMealType,
      mealTypes.map((type) => type.toLocaleLowerCase("mn-MN")),
    ));
    return result;
  }

  it("validates ranges and roles, then fetches and atomically upserts absolute Reader totals", async () => {
    const request = { dateFrom, dateTo };
    delete process.env.READER_MEAL_EXPORT_URL;
    assert.equal((await importCounts(request)).status, 503);
    process.env.READER_MEAL_EXPORT_URL = readerUrl;
    delete process.env.READER_MEAL_READ_TOKEN;
    assert.equal((await importCounts(request)).status, 503);
    process.env.READER_MEAL_READ_TOKEN = readerToken;

    for (const cookie of [viewerCookie, technologistCookie, hrCookieValue, accountantCookie]) {
      assert.equal((await importCounts(request, cookie)).status, 403);
    }
    for (const cookie of [hrCookieValue, accountantCookie]) {
      assert.equal((await fetch(`${apiUrl}/meal-counts/import/`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(request),
      })).status, 403);
    }
    assert.equal((await fetch(`${apiUrl}/meal-counts/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })).status, 401);

    assert.equal((await importCounts({ dateFrom: "2098-02-30", dateTo })).status, 400);
    assert.equal((await importCounts({ dateFrom: "2098-06-12", dateTo })).status, 400);
    assert.equal((await importCounts({ dateFrom: "2098-01-01", dateTo: "2099-01-02" })).status, 400);
    payload = { records: [] };
    assert.equal((await importCounts({ dateFrom: "2098-01-01", dateTo: "2099-01-01" })).status, 200);

    const records = [
      { date: dateFrom, mealType: mealTypes[0], count: 4 },
      { date: dateFrom, mealType: mealTypes[1], count: 9 },
      { date: dateTo, mealType: mealTypes[2], count: 2 },
    ];
    payload = { records };
    upstreamStatus = 200;
    const first = await importCounts(request, warehouseCookie);
    assert.equal(first.status, 200);
    const firstResult = await first.json() as { received: number; updatedAt: string };
    assert.equal(firstResult.received, records.length);
    assert.ok(Number.isFinite(Date.parse(firstResult.updatedAt)));
    assert.equal(forwardedAuthorization, `Bearer ${readerToken}`);
    assert.equal(forwardedAccept, "application/json");
    assert.equal(forwardedQuery, `/export?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    assert.deepEqual((await readCounts()).map(({ date, mealType, count }) => [date, mealType, count]), [
      [dateFrom, mealTypes[0], 4],
      [dateFrom, mealTypes[1], 9],
      [dateTo, mealTypes[2], 2],
    ]);

    const replay = await importCounts(request);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { received: number }).received, records.length);
    assert.equal((await readCounts()).length, records.length);

    payload = { records: [{ ...records[0], count: 6 }] };
    assert.equal((await importCounts(request)).status, 200);
    assert.deepEqual((await readCounts()).find((row) => row.mealType === mealTypes[0])?.count, 6);

    payload = { records: [] };
    const empty = await importCounts(request);
    assert.equal(empty.status, 200);
    assert.equal((await empty.json() as { received: number }).received, 0);

    payload = { records: [
      { date: dateFrom, mealType: mealTypes[3], count: 1 },
      { date: "2098-06-12", mealType: mealTypes[1], count: 2 },
    ] };
    const invalid = await importCounts(request);
    assert.equal(invalid.status, 502);
    assert.equal((await readCounts()).some((row) => row.mealType === mealTypes[3]), false);

    payload = { records: [
      { date: dateFrom, mealType: ` ${mealTypes[0]} `, count: 1 },
      { date: dateFrom, mealType: mealTypes[0].toLocaleLowerCase("mn-MN"), count: 2 },
    ] };
    assert.equal((await importCounts(request)).status, 502);
    assert.equal((await readCounts()).find((row) => row.mealType === mealTypes[0])?.count, 6);

    payload = { records: [{ date: dateFrom, mealType: mealTypes[3], count: -1 }] };
    assert.equal((await importCounts(request)).status, 502);
    upstreamStatus = 502;
    payload = "upstream secret content";
    const upstreamFailure = await importCounts(request);
    assert.equal(upstreamFailure.status, 502);
    assert.doesNotMatch(await upstreamFailure.text(), /secret|reader-meal-test/);
    assert.equal((await readCounts()).some((row) => row.mealType === mealTypes[3]), false);
    upstreamStatus = 200;
  });
});