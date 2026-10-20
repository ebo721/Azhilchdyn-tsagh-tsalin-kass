import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { db, pool, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("payroll payable route permissions", () => {
  const ids: number[] = [];
  const cookies: Record<string, string> = {};
  let server: Server, base: string;
  before(async () => {
    for (const role of ["admin", "accountant", "viewer", "hr", "warehouse"]) {
      const name = `payroll-payable-${role}-${randomUUID()}`;
      const [user] = await db.insert(usersTable).values({
        username: name, normalizedUsername: name, role, passwordHash: "unused",
        menuPaths: role === "hr" ? ["/payroll"] : role === "warehouse" ? ["/inventory"] : ["/ar-ap"],
      }).returning();
      ids.push(user.id); cookies[role] = `${hrCookie.name}=${createStaffSession(user)}`;
    }
    server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(usersTable).where(inArray(usersTable.id, ids)); await pool.end();
  });
  it("allows ar-ap-only readers without requiring the payroll menu, and preserves existing payable lists", async () => {
    for (const role of ["admin", "accountant", "viewer"]) {
      const response = await fetch(`${base}/api/journal/payables/payroll-balances`, { headers: { cookie: cookies[role] } });
      // Public development data may explicitly need historical balance repair.
      assert.ok([200, 409].includes(response.status), `${role}: ${response.status}`);
      const data = await response.json();
      if (response.status === 200) {
        assert.ok(Array.isArray(data.lines));
        assert.equal(new Set(data.lines.map((line: { employeeId: number }) => line.employeeId)).size, data.lines.length);
        assert.ok(data.lines.every((line: { remainingBalance: number }) => line.remainingBalance > 1));
      } else assert.equal(typeof data.error, "string");
      const manual = await fetch(`${base}/api/journal/payables?status=all`, { headers: { cookie: cookies[role] } });
      assert.equal(manual.status, 200);
    }
  });
  it("denies unauthenticated, HR and warehouse access, including trailing slashes", async () => {
    for (const role of ["", "hr", "warehouse"]) {
      const response = await fetch(`${base}/api/journal/payables/payroll-balances/`, { headers: role ? { cookie: cookies[role] } : {} });
      assert.equal(response.status, role ? 403 : 401);
    }
  });
});
