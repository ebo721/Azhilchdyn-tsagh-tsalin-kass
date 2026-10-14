import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, employeesTable, chartOfAccountsTable, journalEntriesTable,
  journalLinesTable, receivablesTable, payablesTable, receivableAllocationsTable, payableAllocationsTable,
} from "@workspace/db";
import journalRouter from "./journal.js";
import employeesRouter from "./employees.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

describe("employee-linked receivable and payable registration", () => {
  const prefix = `employee-ar-ap-${randomUUID()}`;
  let server: Server, base: string;
  let actor: string, viewer: string, hidden: string, admin: string;
  let userIds: number[] = [], employeeIds: number[] = [];
  let counterId: number, inactiveAccountId: number;
  let accountIds: number[] = [];
  const payload = (employeeId = employeeIds[0]) => ({
    employeeId, date: "2026-10-05", amount: 41.25, description: prefix, counterAccountId: counterId,
  });
  const call = (path: string, method = "GET", body?: unknown, cookie = actor) => fetch(base + path, {
    method, headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ownedEntries = () => db.select().from(journalEntriesTable).where(inArray(journalEntriesTable.createdBy, userIds));

  before(async () => {
    const users = await db.insert(usersTable).values([
      { username: `${prefix}-accountant`, normalizedUsername: `${prefix}-accountant`, role: "accountant", menuPaths: ["/ar-ap"], passwordHash: "unused-test-hash" },
      { username: `${prefix}-viewer`, normalizedUsername: `${prefix}-viewer`, role: "viewer", menuPaths: ["/ar-ap"], passwordHash: "unused-test-hash" },
      { username: `${prefix}-hidden`, normalizedUsername: `${prefix}-hidden`, role: "accountant", menuPaths: ["/payroll"], passwordHash: "unused-test-hash" },
      { username: `${prefix}-admin`, normalizedUsername: `${prefix}-admin`, role: "admin", menuPaths: ["/ar-ap", "/employees", "/users"], passwordHash: "unused-test-hash" },
    ]).returning();
    userIds = users.map(row => row.id);
    [actor, viewer, hidden, admin] = users.map(row => `${hrCookie.name}=${createStaffSession(row)}`);
    const employees = await db.insert(employeesTable).values([
      { name: `${prefix}-receivable`, role: "test", baseSalary: 0 },
      { name: `${prefix}-payable`, role: "test", baseSalary: 0 },
      { name: `${prefix}-inactive`, role: "test", baseSalary: 0, status: "inactive" },
      { name: `${prefix}-race`, role: "test", baseSalary: 0 },
    ]).returning();
    employeeIds = employees.map(row => row.id);
    const accounts = await db.insert(chartOfAccountsTable).values([
      { code: `${prefix}-counter`, name: "Employee balance test counter", type: "asset", normalBalance: "debit" },
      { code: `${prefix}-inactive`, name: "Inactive test counter", type: "asset", normalBalance: "debit", isActive: false },
    ]).returning();
    accountIds = accounts.map(row => row.id);
    counterId = accounts[0].id;
    inactiveAccountId = accounts[1].id;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, journalRouter, employeesRouter);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    const entries = userIds.length ? await ownedEntries() : [];
    if (entries.length) {
      const ids = entries.map(row => row.id);
      const receivables = await db.select().from(receivablesTable).where(inArray(receivablesTable.originJournalEntryId, ids));
      const payables = await db.select().from(payablesTable).where(inArray(payablesTable.journalEntryId, ids));
      if (receivables.length) {
        const rids = receivables.map(row => row.id);
        await db.delete(receivableAllocationsTable).where(inArray(receivableAllocationsTable.receivableId, rids));
        await db.delete(receivablesTable).where(inArray(receivablesTable.id, rids));
      }
      if (payables.length) {
        const pids = payables.map(row => row.id);
        await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.payableId, pids));
        await db.delete(payablesTable).where(inArray(payablesTable.id, pids));
      }
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
    }
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    if (accountIds.length) await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, accountIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  });

  it("registers each kind against the selected employee with a balanced posted journal and saved date", async () => {
    for (const [kind, employeeId, code] of [
      ["receivables", employeeIds[0], "1200"], ["payables", employeeIds[1], "2000"],
    ] as const) {
      const response = await call(`/journal/${kind}`, "POST", payload(employeeId));
      assert.equal(response.status, 201, await response.clone().text());
      const record = await response.json();
      assert.equal(record.partyType, "employee");
      assert.equal(record.partyId, employeeId);
      assert.equal(record.originalAmount, 41.25);
      assert.equal(record.date, "2026-10-05");
      assert.equal(record.description, prefix);
      assert.equal(record.status, "open");
      assert.equal(kind === "receivables" ? record.openAmount : record.remainingBalance, 41.25);
      const entryId = record.originJournalEntryId ?? record.journalEntryId;
      const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entryId));
      assert.equal(entry.status, "posted");
      assert.equal(entry.createdBy, userIds[0]);
      const lines = await db.select({ debit: journalLinesTable.debit, credit: journalLinesTable.credit, allocation: journalLinesTable.allocation, code: chartOfAccountsTable.code })
        .from(journalLinesTable).innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
        .where(eq(journalLinesTable.journalEntryId, entryId));
      assert.equal(lines.length, 2);
      assert.equal(lines.reduce((sum, row) => sum + row.debit, 0), 41.25);
      assert.equal(lines.reduce((sum, row) => sum + row.credit, 0), 41.25);
      const allocated = lines.find(row => row.code === code)!;
      assert.equal(kind === "receivables" ? allocated.debit : allocated.credit, 41.25);
      assert.equal((allocated.allocation as { employeeId: number }).employeeId, employeeId);
      const listed = await (await call(`/journal/${kind}?status=all`)).json();
      const saved = listed.find((row: { id: number }) => row.id === record.id);
      assert.equal(saved.partyId, employeeId);
      assert.equal(saved.date, "2026-10-05");
      assert.equal(saved.description, prefix);
    }
  });
  it("rejects malformed money, dates, employee and account references atomically", async () => {
    const count = (await ownedEntries()).length;
    const [control] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1200"));
    for (const override of [
      { employeeId: 2147483647 }, { employeeId: employeeIds[2] }, { amount: 0 },
      { employeeId: 2147483648 }, { counterAccountId: 2147483648 },
      { amount: -1 }, { amount: 1.001 }, { amount: 1000000000000 },
      { date: "2026-02-30" }, { description: "  " }, { counterAccountId: inactiveAccountId },
      { counterAccountId: 2147483647 }, { counterAccountId: control.id },
    ]) {
      const response = await call("/journal/payables", "POST", { ...payload(), ...override });
      assert.equal(response.status, 400, await response.clone().text());
    }
    assert.equal((await ownedEntries()).length, count);
  });
  it("keeps role and menu ceilings, allowing only the read-only employee dependency", async () => {
    assert.equal((await call("/employees")).status, 200);
    assert.equal((await call("/employees", "POST", {})).status, 403);
    assert.equal((await call("/journal/entries")).status, 403);
    for (const cookie of [viewer, hidden]) {
      for (const kind of ["receivables", "payables"]) assert.equal((await call(`/journal/${kind}`, "POST", payload(), cookie)).status, 403);
    }
    assert.equal((await call("/journal/receivables?status=all", "GET", undefined, viewer)).status, 200);
  });
  it("preserves employee identities for receivable and payable history", async () => {
    for (const id of employeeIds.slice(0, 2)) {
      const response = await call(`/employees/${id}`, "DELETE", undefined, admin);
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Авлага, өглөг/);
      const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
      assert.ok(employee);
    }
  });
  it("serializes employee deletion against new payable registration without orphaning a party", async () => {
    const id = employeeIds[3];
    const [created, deleted] = await Promise.all([
      call("/journal/payables", "POST", payload(id)),
      call(`/employees/${id}`, "DELETE", undefined, admin),
    ]);
    assert.ok([201, 400].includes(created.status), await created.clone().text());
    assert.ok([204, 409].includes(deleted.status), await deleted.clone().text());
    assert.deepEqual([created.status, deleted.status], created.status === 201 ? [201, 409] : [400, 204]);
    const parties = await db.select().from(payablesTable).where(eq(payablesTable.partyId, id));
    const people = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    assert.equal(parties.length, created.status === 201 ? 1 : 0);
    assert.equal(people.length, created.status === 201 ? 1 : 0);
  });
});
