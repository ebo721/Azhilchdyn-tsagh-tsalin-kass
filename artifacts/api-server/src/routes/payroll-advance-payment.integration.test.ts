import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  attendanceTable,
  cashTransactionsTable,
  db,
  employeesTable,
  chartOfAccountsTable,
  journalEntriesTable,
  payrollAdvanceApprovalsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("concurrent payroll advance payments", () => {
  let month: string;
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let employeeIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "payroll-advance-concurrency-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const usedMonths = new Set(
      (await db.select({ month: payrollAdvanceApprovalsTable.month }).from(payrollAdvanceApprovalsTable))
        .map((row) => row.month),
    );
    const availableMonths = Array.from({ length: 120 }, (_, index) => {
      const year = 2090 + Math.floor(index / 12);
      return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
    });
    const availableMonth = availableMonths.find((candidate) => !usedMonths.has(candidate));
    assert.ok(availableMonth, "A free future month is required for the integration test");
    month = availableMonth;
    const employees = await db.insert(employeesTable).values([
      { name: `Advance concurrency A ${process.pid}`, role: "test", baseSalary: 1_000_000 },
      { name: `Advance concurrency B ${process.pid}`, role: "test", baseSalary: 1_000_000 },
    ]).returning({ id: employeesTable.id, name: employeesTable.name });
    employeeIds = employees.map((employee) => employee.id);
    await db.insert(payrollAdvanceApprovalsTable).values({
      month,
      approvalDate: `${month}-15`,
      totalAmount: 200_000,
      lines: employees.map((employee) => ({
        employeeId: employee.id,
        employeeName: employee.name,
        employeeType: "office",
        baseSalary: 1_000_000,
        daysWorked: 0,
        dailySalary: 0,
        totalSalary: 1_000_000,
        advanceAmount: 100_000,
        paid: false,
        paymentDate: null,
      })),
    });
  });

  after(async () => {
    if (employeeIds.length > 0) {
      const [approval] = await db.select({ id: payrollAdvanceApprovalsTable.id })
        .from(payrollAdvanceApprovalsTable)
        .where(eq(payrollAdvanceApprovalsTable.month, month));
      if (approval) {
        const payrollEntries = await db.select({ id: journalEntriesTable.id })
          .from(journalEntriesTable)
          .where(and(
            eq(journalEntriesTable.sourceType, "payroll"),
            eq(journalEntriesTable.sourceId, approval.id),
          ));
        const payrollIds = payrollEntries.map((entry) => entry.id);
        if (payrollIds.length) {
          await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.sourceId, payrollIds));
          await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, payrollIds));
        }
      }
      await db.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "payroll_advance"),
        inArray(cashTransactionsTable.sourceKey, employeeIds.map((id) => `${month}:${id}`)),
      ));
      await db.delete(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month));
      await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
    }
    server.close();
  });

  it("serializes edits so both approval lines, deductions, and cash expenses survive", async () => {
    const amounts = [125_000, 135_000];
    const responses = await Promise.all(employeeIds.map((employeeId, index) => (
      fetch(`${baseUrl}/api/payroll-advance/payment`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({
          month,
          employeeId,
          advanceAmount: amounts[index],
          paid: true,
          paymentDate: "2098-11-15",
        }),
      })
    )));
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);

    const [approval] = await db.select().from(payrollAdvanceApprovalsTable)
      .where(eq(payrollAdvanceApprovalsTable.month, month));
    const lines = approval.lines as Array<{ employeeId: number; advanceAmount: number; paid: boolean }>;
    assert.equal(Number(approval.totalAmount), 260_000);
    assert.deepEqual(
      employeeIds.map((id) => lines.find((line) => line.employeeId === id)?.advanceAmount),
      amounts,
    );
    assert.ok(employeeIds.every((id) => lines.find((line) => line.employeeId === id)?.paid === true));

    const cashRows = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "payroll_advance"),
      inArray(cashTransactionsTable.sourceKey, employeeIds.map((id) => `${month}:${id}`)),
    ));
    assert.equal(cashRows.length, 2);
    assert.deepEqual(
      employeeIds.map((id) => Number(cashRows.find((row) => row.sourceKey === `${month}:${id}`)?.amount)),
      amounts,
    );
    assert.ok(cashRows.every((row) => row.journalEntryId === null));

    const repeat = await fetch(`${baseUrl}/api/payroll-advance/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        month,
        employeeId: employeeIds[0],
        advanceAmount: amounts[0],
        paid: true,
        paymentDate: "2098-11-15",
      }),
    });
    assert.equal(repeat.status, 200);
    const repeatedCash = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "payroll_advance"),
      eq(cashTransactionsTable.sourceKey, `${month}:${employeeIds[0]}`),
    ));
    assert.equal(repeatedCash[0]?.journalEntryId, null);

    const changed = await fetch(`${baseUrl}/api/payroll-advance/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        month,
        employeeId: employeeIds[0],
        advanceAmount: 130_000,
        paid: true,
        paymentDate: "2098-11-16",
      }),
    });
    assert.equal(changed.status, 200);
    const changedCash = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "payroll_advance"),
      eq(cashTransactionsTable.sourceKey, `${month}:${employeeIds[0]}`),
    ));
    assert.equal(changedCash[0]?.journalEntryId, null);

    const payrollResponse = await fetch(`${baseUrl}/api/payroll?month=${month}`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(payrollResponse.status, 200);
    const payroll = await payrollResponse.json() as {
      lines: Array<{ employeeId: number; advanceAmount: number }>;
    };
    assert.deepEqual(
      employeeIds.map((id) => payroll.lines.find((line) => line.employeeId === id)?.advanceAmount),
      [130_000, amounts[1]],
    );
  });

  it("refreshes salary and worked days when a paid line is changed back to unpaid", async () => {
    const employeeId = employeeIds[0];
    await db.update(employeesTable)
      .set({ baseSalary: 1_200_000 })
      .where(eq(employeesTable.id, employeeId));
    await db.insert(attendanceTable).values({
      employeeId,
      date: `${month}-10`,
      clockIn: "09:00",
      clockOut: "18:00",
      hours: 8,
      status: "present",
    });
    await db.insert(attendanceTable).values([
      {
        employeeId,
        date: `${month}-16`,
        clockIn: "09:00",
        clockOut: "18:00",
        hours: 8,
        status: "present",
      },
      {
        employeeId,
        date: `${month}-17`,
        clockIn: "09:00",
        clockOut: "18:00",
        hours: 8,
        status: "present",
      },
    ]);

    const response = await fetch(`${baseUrl}/api/payroll-advance/payment`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        month,
        employeeId,
        advanceAmount: 125_000,
        paid: false,
        paymentDate: null,
      }),
    });
    assert.equal(response.status, 200);

    const result = await response.json() as {
      totalAmount: number;
      lines: Array<{
        employeeId: number;
        baseSalary: number;
        daysWorked: number;
        totalSalary: number;
        advanceAmount: number;
        paid: boolean;
        paymentDate: string | null;
      }>;
    };
    const refreshedLine = result.lines.find((line) => line.employeeId === employeeId);
    assert.ok(refreshedLine);
    assert.equal(refreshedLine.baseSalary, 1_200_000);
    assert.equal(refreshedLine.daysWorked, 1);
    assert.equal(refreshedLine.totalSalary, 1_200_000);
    assert.equal(refreshedLine.advanceAmount, 600_000);
    assert.equal(refreshedLine.paid, false);
    assert.equal(refreshedLine.paymentDate, null);

    const cashRows = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "payroll_advance"),
      eq(cashTransactionsTable.sourceKey, `${month}:${employeeId}`),
    ));
    assert.equal(cashRows.length, 0);
    const [approval] = await db.select({ id: payrollAdvanceApprovalsTable.id })
      .from(payrollAdvanceApprovalsTable)
      .where(eq(payrollAdvanceApprovalsTable.month, month));
    const payrollEntries = await db.select({ id: journalEntriesTable.id, status: journalEntriesTable.status })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.sourceType, "payroll"),
        eq(journalEntriesTable.sourceId, approval.id),
      ));
    assert.equal(payrollEntries.length, 0);
  });

  it("records payment without requiring an active automatic-posting account", async () => {
    const employeeId = employeeIds[1];
    const [cashAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1000"));
    assert.ok(cashAccount);
    await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, cashAccount.id));
    try {
      const response = await fetch(`${baseUrl}/api/payroll-advance/payment`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          month,
          employeeId,
          advanceAmount: 140_000,
          paid: true,
          paymentDate: "2098-11-17",
        }),
      });
      assert.equal(response.status, 200);
      const [approval] = await db.select().from(payrollAdvanceApprovalsTable)
        .where(eq(payrollAdvanceApprovalsTable.month, month));
      const line = (approval.lines as Array<{ employeeId: number; advanceAmount: number; paid: boolean }>)
        .find((candidate) => candidate.employeeId === employeeId);
      assert.equal(line?.advanceAmount, 140_000);
      assert.equal(line?.paid, true);
      const cashRows = await db.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "payroll_advance"),
        eq(cashTransactionsTable.sourceKey, `${month}:${employeeId}`),
      ));
      assert.equal(cashRows[0]?.amount, 140_000);
      assert.equal(cashRows[0]?.journalEntryId, null);
    } finally {
      await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, cashAccount.id));
    }
  });
});