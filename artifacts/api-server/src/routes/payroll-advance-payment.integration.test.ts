import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  cashTransactionsTable,
  db,
  employeesTable,
  payrollAdvanceApprovalsTable,
} from "@workspace/db";
import app from "../app.ts";
import { createStaffSession, hrCookie } from "../lib/hr-session.ts";

describe("concurrent payroll advance payments", () => {
  let month: string;
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let employeeIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "payroll-advance-concurrency-test";
    adminCookie = `${hrCookie.name}=${createStaffSession("admin")}`;
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

    const payrollResponse = await fetch(`${baseUrl}/api/payroll?month=${month}`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(payrollResponse.status, 200);
    const payroll = await payrollResponse.json() as {
      lines: Array<{ employeeId: number; advanceAmount: number }>;
    };
    assert.deepEqual(
      employeeIds.map((id) => payroll.lines.find((line) => line.employeeId === id)?.advanceAmount),
      amounts,
    );
  });
});