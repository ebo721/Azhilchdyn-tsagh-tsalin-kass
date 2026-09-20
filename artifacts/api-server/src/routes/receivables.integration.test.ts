import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { after, afterEach, before, describe, it } from "node:test";
import {
  db, chartOfAccountsTable, employeesTable, inventorySuppliersTable,
  journalEntriesTable, receivablesTable, receivableAllocationsTable, usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import journalRouter from "./journal.js";
import { setReceivableSettlementTestHook } from "../lib/journal-posting.js";

describe("receivable allocation integration", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let receivableAccountId: number;
  let offsetAccountId: number;
  let employeeId: number;
  let inactiveEmployeeId: number;
  let supplierId: number;
  let userId: number;
  const entryIds: number[] = [];
  const createdReceivableIds: number[] = [];
  let createdAccount = false;

  before(async () => {
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `receivable-test-${suffix}`, normalizedUsername: `receivable-test-${suffix}`,
      role: "accountant", passwordHash: "not-used",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const existing = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1200"));
    if (existing[0]) receivableAccountId = existing[0].id;
    else {
      const [account] = await db.insert(chartOfAccountsTable).values({
        code: "1200", name: "Тест авлага", type: "asset", normalBalance: "debit",
      }).returning({ id: chartOfAccountsTable.id });
      receivableAccountId = account.id;
      createdAccount = true;
    }
    const [offset] = await db.insert(chartOfAccountsTable).values({
      code: `receivable-offset-${suffix}`, name: "Receivable offset", type: "asset", normalBalance: "debit",
    }).returning({ id: chartOfAccountsTable.id });
    offsetAccountId = offset.id;
    const employees = await db.insert(employeesTable).values([
      { name: `Receivable Employee ${suffix}`, role: "test", baseSalary: 1, status: "active" },
      { name: `Inactive Employee ${suffix}`, role: "test", baseSalary: 1, status: "inactive" },
    ]).returning({ id: employeesTable.id });
    employeeId = employees[0].id;
    inactiveEmployeeId = employees[1].id;
    const [supplier] = await db.insert(inventorySuppliersTable).values({
      name: `Receivable Supplier ${suffix}`, normalizedName: `receivable-supplier-${suffix}`,
    }).returning({ id: inventorySuppliersTable.id });
    supplierId = supplier.id;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, journalRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    setReceivableSettlementTestHook(undefined);
    delete process.env.RECEIVABLE_TEST_HOOK;
  });

  after(async () => {
    try {
      if (entryIds.length) {
        const allocations = await db.select({ id: receivableAllocationsTable.id })
          .from(receivableAllocationsTable)
          .where(inArray(receivableAllocationsTable.settlementJournalEntryId, entryIds));
        if (allocations.length) await db.delete(receivableAllocationsTable)
          .where(inArray(receivableAllocationsTable.id, allocations.map((row) => row.id)));
      }
      await db.delete(receivableAllocationsTable).where(inArray(receivableAllocationsTable.receivableId, createdReceivableIds));
      await db.delete(receivablesTable).where(inArray(receivablesTable.id, createdReceivableIds));
      if (entryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
      await db.delete(employeesTable).where(inArray(employeesTable.id, [employeeId, inactiveEmployeeId]));
      await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, supplierId));
      await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, offsetAccountId));
      if (createdAccount) await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, receivableAccountId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function request(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init, headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
  }
  async function post(lines: unknown[], description = "Receivable integration") {
    const response = await request("/journal/entries", {
      method: "POST",
      body: JSON.stringify({ date: "2099-02-01", description, lines }),
    });
    const value = await response.json() as { id?: number; error?: string };
    if (response.status === 201 && value.id) entryIds.push(value.id);
    return { response, value };
  }
  function debit(amount: number, allocation?: unknown) {
    return [
      { accountId: receivableAccountId, debit: amount, credit: 0, memo: null, ...(allocation ? { allocation } : {}) },
      { accountId: offsetAccountId, debit: 0, credit: amount, memo: null },
    ];
  }
  function settle(amount: number, receivableId: number) {
    return [
      { accountId: offsetAccountId, debit: amount, credit: 0, memo: null },
      { accountId: receivableAccountId, debit: 0, credit: amount, memo: null, allocation: { kind: "settle", receivableId } },
    ];
  }
  async function createEmployeeReceivable(amount = 100) {
    const result = await post(debit(amount, { kind: "create", partyType: "employee", employeeId }));
    assert.equal(result.response.status, 201);
    const [row] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, result.value.id!));
    assert.ok(row);
    createdReceivableIds.push(row.id);
    return { entryId: result.value.id!, receivable: row };
  }

  it("creates employee and supplier receivables", async () => {
    const employee = await createEmployeeReceivable(40);
    assert.equal(employee.receivable.employeeId, employeeId);
    const supplierResult = await post(debit(55, { kind: "create", partyType: "supplier", supplierId }));
    assert.equal(supplierResult.response.status, 201);
    const [supplierRow] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, supplierResult.value.id!));
    assert.ok(supplierRow);
    createdReceivableIds.push(supplierRow.id);
    assert.equal(supplierRow.supplierId, supplierId);
  });

  it("rejects missing metadata, nonexistent employees, and inactive employees", async () => {
    for (const allocation of [
      undefined,
      { kind: "create", partyType: "employee", employeeId: 2_147_483_647 },
      { kind: "create", partyType: "employee", employeeId: inactiveEmployeeId },
    ]) {
      const result = await post(debit(10, allocation));
      assert.equal(result.response.status, allocation ? 400 : 400);
      assert.match(result.value.error ?? "", allocation ? /Employee not found|inactive/ : /allocation metadata/);
      if (result.value.id) assert.fail("failed transaction returned an entry id");
    }
  });

  it("supports partial then full settlement and exposes open receivables", async () => {
    const { receivable } = await createEmployeeReceivable(100);
    const partial = await post(settle(35, receivable.id));
    assert.equal(partial.response.status, 201);
    let [current] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, receivable.id));
    assert.equal(Number(current.openAmount), 65);
    const full = await post(settle(65, receivable.id));
    assert.equal(full.response.status, 201);
    [current] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, receivable.id));
    assert.equal(Number(current.openAmount), 0);
    assert.equal(current.status, "settled");
    const list = await request("/journal/receivables?status=all");
    assert.equal(list.status, 200);
    assert.ok((await list.json() as { id: number }[]).some((row) => row.id === receivable.id));
  });

  it("rolls back an over-settlement and cannot overspend under concurrent settlements", async () => {
    const { receivable } = await createEmployeeReceivable(100);
    const tooMuch = await post(settle(101, receivable.id));
    assert.equal(tooMuch.response.status, 409);
    assert.equal((await db.select().from(receivablesTable).where(eq(receivablesTable.id, receivable.id)))[0].openAmount, 100);
    process.env.RECEIVABLE_TEST_HOOK = "1";
    let entered!: () => void;
    const firstLocked = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const releaseFirst = new Promise<void>((resolve) => { release = resolve; });
    let hookCalls = 0;
    setReceivableSettlementTestHook(async () => {
      hookCalls += 1;
      if (hookCalls === 1) {
        entered();
        await releaseFirst;
      }
    });
    const first = post(settle(60, receivable.id));
    await firstLocked;
    const second = post(settle(60, receivable.id));
    await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    const [a, b] = await Promise.all([first, second]);
    setReceivableSettlementTestHook(undefined);
    delete process.env.RECEIVABLE_TEST_HOOK;
    assert.equal(hookCalls, 2);
    assert.equal([a.response.status, b.response.status].filter((status) => status === 201).length, 1);
    assert.equal([a.response.status, b.response.status].filter((status) => status === 409).length, 1);
    const [current] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, receivable.id));
    assert.equal(Number(current.openAmount), 40);
  });

  it("rolls back journal and receivable effects atomically on invalid party", async () => {
    const description = `atomic-invalid-${randomUUID()}`;
    const result = await post(debit(25, { kind: "create", partyType: "employee", employeeId: inactiveEmployeeId }), description);
    assert.equal(result.response.status, 400);
    assert.equal((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.description, description))).length, 0);
    assert.equal((await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, result.value.id ?? -1))).length, 0);
  });

  it("voids settlement to restore balance, voids an unallocated origin safely, and rejects origin void after settlement", async () => {
    const first = await createEmployeeReceivable(80);
    const payment = await post(settle(30, first.receivable.id));
    assert.equal(payment.response.status, 201);
    const voidPayment = await request(`/journal/entries/${payment.value.id}/void`, { method: "POST", body: "{}" });
    assert.equal(voidPayment.status, 200);
    entryIds.push((await voidPayment.clone().json() as { reversalEntryId: number }).reversalEntryId);
    let [restored] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, first.receivable.id));
    assert.equal(Number(restored.openAmount), 80);

    const unallocated = await createEmployeeReceivable(20);
    const safeVoid = await request(`/journal/entries/${unallocated.entryId}/void`, { method: "POST", body: "{}" });
    assert.equal(safeVoid.status, 200);
    entryIds.push((await safeVoid.clone().json() as { reversalEntryId: number }).reversalEntryId);
    assert.equal((await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, unallocated.entryId))).length, 0);

    const later = await createEmployeeReceivable(50);
    const laterPayment = await post(settle(10, later.receivable.id));
    assert.equal(laterPayment.response.status, 201);
    const conflict = await request(`/journal/entries/${later.entryId}/void`, { method: "POST", body: "{}" });
    assert.equal(conflict.status, 409);
    const [unchangedEntry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, later.entryId));
    const [unchangedReceivable] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, later.receivable.id));
    assert.equal(unchangedEntry.status, "posted");
    assert.equal(Number(unchangedReceivable.openAmount), 40);
  });
});