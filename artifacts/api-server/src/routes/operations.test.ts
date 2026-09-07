import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { UpsertShiftPlanBody } from "@workspace/api-zod";
import app from "../app.ts";
import { createStaffSession, hrCookie } from "../lib/hr-session.ts";

describe("PUT /api/attendance/shift-plans", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;

  before(() => {
    process.env.SESSION_SECRET = "shift-plan-date-regression-test";
    adminCookie = `${hrCookie.name}=${createStaffSession("admin")}`;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
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