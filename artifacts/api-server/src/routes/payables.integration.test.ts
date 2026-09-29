import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { after, afterEach, before, describe, it } from "node:test";
import {
  db, chartOfAccountsTable, employeesTable, inventorySuppliersTable,
  journalEntriesTable, journalLinesTable, payablesTable, payableAllocationsTable, usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import { setPayableSettlementTestHook } from "../lib/journal-posting.js";
import journalRouter from "./journal.js";

describe("payable allocation integration", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let payableAccountId: number;
  let offsetAccountId: number;
  let employeeId: number;
  let inactiveEmployeeId: number;
  let supplierId: number;
  let userId: number;
  let createdAccount = false;
  const entryIds: number[] = [];
  const payableIds: number[] = [];

  before(async () => {
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `payable-test-${suffix}`, normalizedUsername: `payable-test-${suffix}`,
      role: "accountant", passwordHash: "not-used",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const [existing] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "2000"));
    if (existing) payableAccountId = existing.id;
    else {
      const [account] = await db.insert(chartOfAccountsTable).values({
        code: "2000", name: "Тест өглөг", type: "liability", normalBalance: "credit",
      }).returning({ id: chartOfAccountsTable.id });
      payableAccountId = account.id;
      createdAccount = true;
    }
    const [offset] = await db.insert(chartOfAccountsTable).values({
      code: `payable-offset-${suffix}`, name: "Payable offset", type: "asset", normalBalance: "debit",
    }).returning({ id: chartOfAccountsTable.id });
    offsetAccountId = offset.id;
    const employees = await db.insert(employeesTable).values([
      { name: `Payable Employee ${suffix}`, role: "test", baseSalary: 1, status: "active" },
      { name: `Inactive Payable Employee ${suffix}`, role: "test", baseSalary: 1, status: "inactive" },
    ]).returning({ id: employeesTable.id });
    employeeId = employees[0].id;
    inactiveEmployeeId = employees[1].id;
    const [supplier] = await db.insert(inventorySuppliersTable).values({
      name: `Payable Supplier ${suffix}`, normalizedName: `payable-supplier-${suffix}`,
    }).returning({ id: inventorySuppliersTable.id });
    supplierId = supplier.id;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, journalRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    setPayableSettlementTestHook(undefined);
    delete process.env.PAYABLE_TEST_HOOK;
  });
  after(async () => {
    try {
      if (entryIds.length) {
        await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.settlementJournalEntryId, entryIds));
      }
      if (payableIds.length) await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.payableId, payableIds));
      if (payableIds.length) await db.delete(payablesTable).where(inArray(payablesTable.id, payableIds));
      if (entryIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
      await db.delete(employeesTable).where(inArray(employeesTable.id, [employeeId, inactiveEmployeeId]));
      await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, supplierId));
      await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, offsetAccountId));
      if (createdAccount) await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, payableAccountId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    } finally {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function request(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init, headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
  }
  async function post(lines: unknown[], description = "Payable integration") {
    const response = await request("/journal/entries", {
      method: "POST", body: JSON.stringify({ date: "2099-02-01", description, lines }),
    });
    const value = await response.json() as { id?: number; error?: string };
    if (response.status === 201 && value.id) entryIds.push(value.id);
    return { response, value };
  }
  function createLines(amount: number, allocation?: unknown) {
    return [
      { accountId: offsetAccountId, debit: amount, credit: 0, memo: null },
      { accountId: payableAccountId, debit: 0, credit: amount, memo: null, ...(allocation ? { allocation } : {}) },
    ];
  }
  function settleLines(amount: number, payableId: number) {
    return [
      { accountId: payableAccountId, debit: amount, credit: 0, memo: null, allocation: { kind: "settle", payableId } },
      { accountId: offsetAccountId, debit: 0, credit: amount, memo: null },
    ];
  }
  async function createEmployeePayable(amount = 100) {
    const result = await post(createLines(amount, { kind: "create", partyType: "employee", employeeId }));
    assert.equal(result.response.status, 201, result.value.error);
    const [payable] = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, result.value.id!));
    assert.ok(payable);
    payableIds.push(payable.id);
    return { entryId: result.value.id!, payable };
  }
  async function voidEntry(entryId: number) {
    const response = await request(`/journal/entries/${entryId}/void`, { method: "POST", body: "{}" });
    if (response.status === 200) entryIds.push((await response.clone().json() as { reversalEntryId: number }).reversalEntryId);
    return response;
  }

  it("creates employee and supplier payables from 2000 credits", async () => {
    const { payable } = await createEmployeePayable(40);
    assert.equal(payable.partyType, "employee");
    assert.equal(payable.partyId, employeeId);
    assert.equal(payable.remainingBalance, 40);
    const result = await post(createLines(55, { kind: "create", partyType: "supplier", supplierId }));
    assert.equal(result.response.status, 201, result.value.error);
    const [supplierPayable] = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, result.value.id!));
    assert.ok(supplierPayable);
    payableIds.push(supplierPayable.id);
    assert.equal(supplierPayable.partyType, "supplier");
    assert.equal(supplierPayable.partyId, supplierId);
  });

  it("rejects missing or wrong metadata and invalid employees atomically", async () => {
    for (const allocation of [
      undefined,
      { kind: "create", partyType: "employee", employeeId: 2_147_483_647 },
      { kind: "create", partyType: "employee", employeeId: inactiveEmployeeId },
      { kind: "settle", receivableId: 1 },
    ]) {
      const description = `invalid-payable-${randomUUID()}`;
      const result = await post(createLines(10, allocation), description);
      assert.equal(result.response.status, 400);
      assert.equal((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.description, description))).length, 0);
    }
    const wrongDirection = await post(settleLines(10, 2_147_483_647));
    assert.equal(wrongDirection.response.status, 404);
  });

  it("settles partially, closes fully, and rolls back an overpayment", async () => {
    const { payable } = await createEmployeePayable(100);
    const partial = await post(settleLines(35, payable.id));
    assert.equal(partial.response.status, 201, partial.value.error);
    let [current] = await db.select().from(payablesTable).where(eq(payablesTable.id, payable.id));
    assert.equal(Number(current.remainingBalance), 65);
    assert.equal(current.status, "open");
    const tooMuch = await post(settleLines(66, payable.id));
    assert.equal(tooMuch.response.status, 409);
    const full = await post(settleLines(65, payable.id));
    assert.equal(full.response.status, 201, full.value.error);
    [current] = await db.select().from(payablesTable).where(eq(payablesTable.id, payable.id));
    assert.equal(Number(current.remainingBalance), 0);
    assert.equal(current.status, "closed");
    const allocations = await db.select().from(payableAllocationsTable).where(eq(payableAllocationsTable.payableId, payable.id));
    assert.deepEqual(allocations.map((row) => Number(row.amount)), [35, 65]);
    assert.equal((await post(settleLines(1, payable.id))).response.status, 409);
  });

  it("prevents concurrent payments from exceeding the remaining balance", async () => {
    const { payable } = await createEmployeePayable(100);
    process.env.PAYABLE_TEST_HOOK = "1";
    let entered!: () => void;
    const firstLocked = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const releaseFirst = new Promise<void>((resolve) => { release = resolve; });
    let hookCalls = 0;
    setPayableSettlementTestHook(async () => {
      hookCalls++;
      if (hookCalls === 1) { entered(); await releaseFirst; }
    });
    const first = post(settleLines(60, payable.id));
    await firstLocked;
    const second = post(settleLines(60, payable.id));
    await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    const results = await Promise.all([first, second]);
    assert.equal(hookCalls, 2);
    assert.deepEqual(results.map(({ response }) => response.status).sort(), [201, 409]);
    const [current] = await db.select().from(payablesTable).where(eq(payablesTable.id, payable.id));
    assert.equal(Number(current.remainingBalance), 40);
  });

  it("restores a voided payment, blocks voiding a paid origin, and can void an unpaid origin", async () => {
    const { entryId, payable } = await createEmployeePayable(80);
    const payment = await post(settleLines(80, payable.id));
    assert.equal(payment.response.status, 201);
    assert.equal((await request(`/journal/entries/${payment.value.id}`, { method: "DELETE" })).status, 409);
    assert.equal((await voidEntry(entryId)).status, 409);
    assert.equal((await voidEntry(payment.value.id!)).status, 200);
    const [restored] = await db.select().from(payablesTable).where(eq(payablesTable.id, payable.id));
    assert.equal(Number(restored.remainingBalance), 80);
    assert.equal(restored.status, "open");
    assert.equal((await db.select().from(payableAllocationsTable).where(eq(payableAllocationsTable.payableId, payable.id))).length, 0);
    assert.equal((await voidEntry(entryId)).status, 200);
    assert.equal((await db.select().from(payablesTable).where(eq(payablesTable.id, payable.id))).length, 0);
  });

  it("voids multiple payable origins by exact line and blocks directly deleting linked journals", async () => {
    const result = await post([
      { accountId: offsetAccountId, debit: 30, credit: 0, memo: null },
      { accountId: payableAccountId, debit: 0, credit: 10, memo: "Employee", allocation: { kind: "create", partyType: "employee", employeeId } },
      { accountId: payableAccountId, debit: 0, credit: 20, memo: "Supplier", allocation: { kind: "create", partyType: "supplier", supplierId } },
    ]);
    assert.equal(result.response.status, 201, result.value.error);
    const rows = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, result.value.id!));
    assert.equal(rows.length, 2);
    payableIds.push(...rows.map((row) => row.id));
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, result.value.id!));
    assert.deepEqual(
      lines.filter((line) => line.accountId === payableAccountId).map((line) => (line.allocation as { payableId: number }).payableId).sort(),
      rows.map((row) => row.id).sort(),
    );
    const deleteResponse = await request(`/journal/entries/${result.value.id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 409);
    assert.equal((await voidEntry(result.value.id!)).status, 200);
    assert.equal((await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, result.value.id!))).length, 0);
  });
});