import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { db, chartOfAccountsTable, journalEntriesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import journalRouter from "./journal.js";

describe("journal routes", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let debitAccount: number;
  let creditAccount: number;
  const entryIds: number[] = [];
  let userId: number;

  before(async () => {
    process.env.SESSION_SECRET = "journal-route-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `journal-route-${suffix}`, normalizedUsername: `journal-route-${suffix}`,
      role: "accountant", passwordHash: "not-used-by-session-tests",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const accounts = await db.insert(chartOfAccountsTable).values([
      { code: `journal-test-debit-${suffix}`, name: "Journal test debit", type: "asset", normalBalance: "debit" },
      { code: `journal-test-credit-${suffix}`, name: "Journal test credit", type: "liability", normalBalance: "credit" },
    ]).returning({ id: chartOfAccountsTable.id });
    debitAccount = accounts[0].id;
    creditAccount = accounts[1].id;
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api", journalRouter);
    server = testApp.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (entryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
    await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, [debitAccount, creditAccount]));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init, headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
  }
  function lines(debit: number, credit: number) {
    return [
      { accountId: debitAccount, debit, credit: 0, memo: null },
      { accountId: creditAccount, debit: 0, credit, memo: null },
    ];
  }
  async function create(debit: number, credit: number) {
    const response = await request("/journal/entries", {
      method: "POST", body: JSON.stringify({ date: "2025-01-15", description: "Route test", lines: lines(debit, credit) }),
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number };
    entryIds.push(value.id);
    return value.id;
  }

  it("creates a manual entry and returns its lines in detail", async () => {
    const id = await create(10, 10);
    const response = await request(`/journal/entries/${id}`);
    assert.equal(response.status, 200);
    const value = await response.json() as { sourceType: string; status: string; lines: unknown[]; createdBy: number };
    assert.equal(value.sourceType, "manual");
    assert.equal(value.status, "posted");
    assert.equal(value.createdBy, userId);
    assert.equal(value.lines.length, 2);
  });

  it("keeps an unbalanced create as draft and transitions it when updated", async () => {
    const id = await create(10, 5);
    let detail = await (await request(`/journal/entries/${id}`)).json() as { status: string };
    assert.equal(detail.status, "draft");
    const response = await request(`/journal/entries/${id}`, {
      method: "PUT", body: JSON.stringify({ lines: lines(10, 10) }),
    });
    assert.equal(response.status, 200);
    detail = await response.json() as { status: string };
    assert.equal(detail.status, "posted");
  });

  it("rejects posted updates without changing their lines", async () => {
    const id = await create(10, 10);
    const before = await (await request(`/journal/entries/${id}`)).json() as { lines: unknown[] };
    const response = await request(`/journal/entries/${id}`, {
      method: "PUT", body: JSON.stringify({ lines: lines(20, 20) }),
    });
    assert.equal(response.status, 409);
    const afterUpdate = await (await request(`/journal/entries/${id}`)).json() as { lines: unknown[] };
    assert.deepEqual(afterUpdate.lines, before.lines);
  });

  it("supports list filters and voids a posted entry", async () => {
    const id = await create(10, 10);
    const list = await request(`/journal/entries?sourceType=manual&status=posted&accountId=${debitAccount}&dateFrom=2025-01-01&dateTo=2025-12-31`);
    assert.equal(list.status, 200);
    assert.ok((await list.json() as unknown[]).length >= 1);
    const response = await request(`/journal/entries/${id}/void`, { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const reversal = await response.json() as { reversalEntryId: number };
    entryIds.push(reversal.reversalEntryId);
    const detail = await (await request(`/journal/entries/${id}`)).json() as { status: string };
    assert.equal(detail.status, "void");
  });

  it("does not expose DELETE", async () => {
    const response = await request("/journal/entries/1", { method: "DELETE" });
    assert.equal(response.status, 404);
  });
});