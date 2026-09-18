import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";
import { findKapitronHeaderRow, isExcludedBankFee } from "./bank-transactions";

describe("bank statement fee filtering", () => {
  it("excludes 50₮ message notification fees", () => {
    assert.equal(isExcludedBankFee(50, "Мессэж мэдэгдэл шимтгэл"), true);
    assert.equal(isExcludedBankFee(50, "МЭССЭЖ МЭДЭГДЛИЙН ШИМТГЭЛ"), true);
  });

  it("keeps unrelated 50₮ transactions", () => {
    assert.equal(isExcludedBankFee(50, "Данс хооронд шилжүүлэг"), false);
    assert.equal(isExcludedBankFee(50, "Мессэж мэдэгдэл"), false);
  });
});

describe("Kapitron statement header detection", () => {
  it("finds the transaction header after account metadata rows", () => {
    const rows = [
      new Map([[0, "Дансны дугаар"], [1, "MN650030005000015555"]]),
      new Map([[0, "Дансны нэр"], [1, "Test account"]]),
      new Map([[0, "Огноо"], [1, "Зарлага"], [2, "Орлого"], [3, "Exchange"], [4, "Харьцсан данс / Нэр"], [5, "Үлдэгдэл"], [6, "Гүйлгээний утга"], [7, "Гүйлгээ хийсэн огноо"]]),
    ];
    assert.equal(findKapitronHeaderRow(rows), 2);
  });

  it("rejects rows that do not contain the complete transaction header", () => {
    assert.equal(findKapitronHeaderRow([
      new Map([[0, "Огноо"], [1, "Зарлага"], [2, "Орлого"]]),
    ]), -1);
  });
});

describe("bank transaction route", () => {
  let server: Server;
  let baseUrl: string;
  let hrSessionCookie: string;
  let accountantSessionCookie: string;
  let viewerSessionCookie: string;
  const testUserIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "bank-route-scope-regression-test";
    const username = `bank-route-hr-${process.pid}-${randomUUID()}`;
    const testUsers = await db.insert(usersTable).values([
      { username, normalizedUsername: username, role: "hr", passwordHash: "not-used-by-session-tests" },
      { username: `${username}-accountant`, normalizedUsername: `${username}-accountant`, role: "accountant", passwordHash: "not-used-by-session-tests" },
      { username: `${username}-viewer`, normalizedUsername: `${username}-viewer`, role: "viewer", passwordHash: "not-used-by-session-tests" },
    ]).returning();
    assert.equal(testUsers.length, 3);
    testUserIds.push(...testUsers.map(({ id }) => id));
    hrSessionCookie = `${hrCookie.name}=${createStaffSession(testUsers[0])}`;
    accountantSessionCookie = `${hrCookie.name}=${createStaffSession(testUsers[1])}`;
    viewerSessionCookie = `${hrCookie.name}=${createStaffSession(testUsers[2])}`;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    for (const id of testUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
  });

  it("requires a staff session for statements, cash matching, transfers, and XLSX imports", async () => {
    const [list, suggestions, transfer, link, importFile] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions`),
      fetch(`${baseUrl}/api/bank-transactions/1/cash-suggestions`),
      fetch(`${baseUrl}/api/bank-transactions/1/transfer-to-cash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "Бусад" }),
      }),
      fetch(`${baseUrl}/api/bank-transactions/1/link-cash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashTransactionId: 1 }),
      }),
      fetch(`${baseUrl}/api/bank-transactions/import`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([0x50, 0x4b]),
      }),
    ]);
    assert.equal(list.status, 401);
    assert.equal(suggestions.status, 401);
    assert.equal(transfer.status, 401);
    assert.equal(link.status, 401);
    assert.equal(importFile.status, 401);
  });

  it("does not block HR access to employee routes while keeping bank routes restricted", async () => {
    const [employees, bankTransactions] = await Promise.all([
      fetch(`${baseUrl}/api/employees`, { headers: { cookie: hrSessionCookie } }),
      fetch(`${baseUrl}/api/bank-transactions`, { headers: { cookie: hrSessionCookie } }),
    ]);
    assert.equal(employees.status, 200);
    assert.equal(bankTransactions.status, 403);
  });

  it("preserves accountant and viewer access to bank data while unclear transactions remain admin-only", async () => {
    for (const cookie of [accountantSessionCookie, viewerSessionCookie]) {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/bank-transactions`, { headers: { cookie } }),
        fetch(`${baseUrl}/api/bank-accounts`, { headers: { cookie } }),
        fetch(`${baseUrl}/api/unclear-transactions`, { headers: { cookie } }),
      ]);
      assert.deepEqual(responses.map(({ status }) => status), [200, 200, 403]);
    }
  });
});