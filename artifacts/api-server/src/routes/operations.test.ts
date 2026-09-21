import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { UpsertShiftPlanBody } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("PUT /api/attendance/shift-plans", () => {
  let server: Server | undefined;
  let baseUrl: string;
  let adminCookie: string;
  let testUserId: number | undefined;

  before(async () => {
    process.env.SESSION_SECRET = "shift-plan-date-regression-test";
    const uniqueName = `operations-shift-plan-${process.pid}-${randomUUID()}`;
    const [testUser] = await db.insert(usersTable).values({
      username: uniqueName,
      normalizedUsername: uniqueName,
      role: "admin",
      passwordHash: "not-used-by-session-tests",
    }).returning();
    assert.ok(testUser);
    testUserId = testUser.id;
    adminCookie = `${hrCookie.name}=${createStaffSession(testUser)}`;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server?.close();
    if (testUserId !== undefined) {
      await db.delete(usersTable).where(eq(usersTable.id, testUserId));
    }
  });

  it("rejects a nonexistent calendar date with 400", async () => {
    const response = await fetch(`${baseUrl}/api/attendance/shift-plans`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: 1,
        date: "2026-02-31",
        shiftId: 1,
      }),
    });

    assert.equal(response.status, 400);
  });

  it("accepts February 29 in a leap year during request validation", () => {
    assert.equal(UpsertShiftPlanBody.safeParse({
      employeeId: 1,
      date: "2028-02-29",
      shiftId: 1,
    }).success, true);
  });
});

describe("calendar month request validation", () => {
  let server: Server | undefined;
  let baseUrl: string;
  let adminCookie: string;
  let testUserId: number | undefined;

  before(async () => {
    process.env.SESSION_SECRET = "calendar-month-regression-test";
    const uniqueName = `operations-calendar-month-${process.pid}-${randomUUID()}`;
    const [testUser] = await db.insert(usersTable).values({
      username: uniqueName,
      normalizedUsername: uniqueName,
      role: "admin",
      passwordHash: "not-used-by-session-tests",
    }).returning();
    assert.ok(testUser);
    testUserId = testUser.id;
    adminCookie = `${hrCookie.name}=${createStaffSession(testUser)}`;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server?.close();
    if (testUserId !== undefined) {
      await db.delete(usersTable).where(eq(usersTable.id, testUserId));
    }
  });

  for (const month of ["2026-00", "2026-13"]) {
    it(`rejects ${month} when copying the previous month's shift plans`, async () => {
      const response = await fetch(`${baseUrl}/api/attendance/shift-plans/copy-previous`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ month, overwrite: false }),
      });

      assert.equal(response.status, 400);
    });

    it(`rejects ${month} for the monthly payroll report`, async () => {
      const response = await fetch(`${baseUrl}/api/payroll?month=${month}`, {
        headers: { cookie: adminCookie },
      });

      assert.equal(response.status, 400);
    });
  }

  it("keeps malformed JSON classified as a 400 client error", async () => {
    const response = await fetch(`${baseUrl}/api/attendance/shift-plans/copy-previous`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: "{",
    });

    assert.equal(response.status, 400);
  });
});

describe("accountant employee page dependencies", () => {
  let server: Server | undefined;
  let baseUrl: string;
  let accountantCookie: string;
  let testUserId: number | undefined;

  before(async () => {
    process.env.SESSION_SECRET = "accountant-employee-page-access-test";
    const uniqueName = `operations-accountant-${process.pid}-${randomUUID()}`;
    const [testUser] = await db.insert(usersTable).values({
      username: uniqueName,
      normalizedUsername: uniqueName,
      role: "accountant",
      passwordHash: "not-used-by-session-tests",
    }).returning();
    assert.ok(testUser);
    testUserId = testUser.id;
    accountantCookie = `${hrCookie.name}=${createStaffSession(testUser)}`;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server?.close();
    if (testUserId !== undefined) {
      await db.delete(usersTable).where(eq(usersTable.id, testUserId));
    }
  });

  it("allows the read requests used by the employee page", async () => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/employees`, { headers: { cookie: accountantCookie } }),
      fetch(`${baseUrl}/api/attendance/shifts`, { headers: { cookie: accountantCookie } }),
      fetch(`${baseUrl}/api/attendance/shift-plans?month=2026-09`, { headers: { cookie: accountantCookie } }),
    ]);

    assert.deepEqual(responses.map(({ status }) => status), [200, 200, 200]);
  });

  it("does not grant accountant access to attendance mutations", async () => {
    const response = await fetch(`${baseUrl}/api/attendance/shift-plans`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: accountantCookie,
      },
      body: JSON.stringify({
        employeeId: 1,
        date: "2026-09-21",
        shiftId: 1,
      }),
    });

    assert.equal(response.status, 403);
  });
});
