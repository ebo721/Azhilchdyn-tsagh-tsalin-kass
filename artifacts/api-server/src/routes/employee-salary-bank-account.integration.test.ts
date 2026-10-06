import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, db, employeesTable, usersTable } from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("employee salary recipient account", () => {
  let server: Server;
  let url: string;
  let employeeId: number;
  const bankIds: number[] = [];
  const cashIds: number[] = [];
  const userIds: number[] = [];
  const cookies = new Map<string, string>();
  const savedAccount = "009999999999";

  before(async () => {
    process.env.SESSION_SECRET = "employee-salary-account-test";
    for (const role of ["admin", "hr", "accountant", "warehouse"]) {
      const username = `salary-account-${role}-${process.pid}-${Date.now()}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "test" }).returning();
      userIds.push(user.id);
      cookies.set(role, `${hrCookie.name}=${createStaffSession(user)}`);
    }
    const [employee] = await db.insert(employeesTable).values({
      name: `salary-account-${process.pid}`, role: "fixture", baseSalary: 1000,
      joinedAt: "2026-01-01", bankAccountNumber: savedAccount,
    }).returning();
    employeeId = employee.id;
    server = app.listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/employees/${employeeId}/salary-bank-account`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null }).where(inArray(bankTransactionsTable.id, bankIds));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  async function payment(account: string, date: string, sourceType = "payroll", verified = true, sourceKey?: string) {
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense", category: "salary", description: "salary account fixture", amount: 1000,
      date, sourceType, sourceKey: sourceKey ?? `${date.slice(0, 7)}:${employeeId}`,
    }).returning();
    cashIds.push(cash.id);
    const [bank] = await db.insert(bankTransactionsTable).values({
      type: "expense", amount: 1000, account, description: "salary account fixture",
      transactionAt: new Date(`${date}T00:00:00Z`), bankAccountNumber: "112222333344",
      fingerprint: `salary-account-${cash.id}`, cashTransactionId: cash.id,
    }).returning();
    bankIds.push(bank.id);
    await db.update(cashTransactionsTable).set({
      bankTransactionId: bank.id, bankVerifiedAt: verified ? new Date() : null,
    }).where(eq(cashTransactionsTable.id, cash.id));
    return bank;
  }

  const read = (role = "admin") => fetch(url, { headers: { Cookie: cookies.get(role)! } });

  it("reports no linked payment instead of guessing by employee name", async () => {
    assert.equal((await read()).status, 404);
    await payment("001111111111", "2026-01-15", "payroll", false);
    assert.equal((await read()).status, 404);
  });

  it("returns only the newest verified recipient, supports advances, and does not save", async () => {
    await payment("MN000000000000000001", "2026-02-15");
    const latest = await payment(" 001234567890 ", "2026-03-15", "payroll_advance");
    await payment("006666666666", "2026-04-15", "payroll", true, "2026-04:0");
    await payment("007777777777", "2026-05-15", "other");
    await payment("008888888888", "2026-06-15", "payroll", false);
    for (const role of ["admin", "hr", "accountant"]) {
      const response = await read(role);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { bankAccountNumber: "001234567890", bankTransactionId: latest.id });
    }
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
    assert.equal(employee.bankAccountNumber, savedAccount);
    assert.equal((await read("warehouse")).status, 403);
    assert.equal((await fetch(url)).status, 401);
  });

  it("does not fall back to an older account when the newest is masked", async () => {
    await payment("MN00****0001", "2026-07-15");
    assert.equal((await read()).status, 422);
  });
});
