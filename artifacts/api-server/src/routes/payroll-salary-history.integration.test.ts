import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import {
  attendanceTable,
  db,
  employeesTable,
  employeeSalaryHistoryTable,
  usersTable,
} from "@workspace/db";
import app from "../app.ts";
import { createStaffSession, hrCookie } from "../lib/hr-session.ts";

describe("effective-dated payroll salary", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let employeeId: number;
  let insuredEmployeeId: number;

  before(async () => {
    process.env.SESSION_SECRET = "payroll-salary-history-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;

    const [employee] = await db.insert(employeesTable).values({
      name: `Salary history test ${process.pid}`,
      role: "Test",
      phone: "",
      employeeType: "office",
      salaryType: "monthly",
      baseSalary: 2_200_000,
      socialInsuranceSalary: 0,
      payrollTaxExempt: true,
      monthlyExpectedWorkDays: 0,
      status: "inactive",
      joinedAt: "2099-01-08",
      inactiveAt: "2099-01-23",
    }).returning({ id: employeesTable.id });
    employeeId = employee.id;
    await db.insert(employeeSalaryHistoryTable).values([
      {
        employeeId,
        effectiveFrom: "2099-01-08",
        employeeType: "office",
        baseSalary: 1_100_000,
        socialInsuranceSalary: 0,
        payrollTaxExempt: true,
      },
      {
        employeeId,
        effectiveFrom: "2099-01-18",
        employeeType: "office",
        baseSalary: 2_200_000,
        socialInsuranceSalary: 0,
        payrollTaxExempt: true,
      },
    ]);
    await db.insert(attendanceTable).values({
      employeeId,
      date: "2099-01-20",
      clockIn: "",
      clockOut: "",
      hours: 0,
      status: "leave",
    });
    const [insuredEmployee] = await db.insert(employeesTable).values({
      name: `Insured salary test ${process.pid}`,
      role: "Test",
      phone: "",
      employeeType: "office",
      salaryType: "monthly",
      baseSalary: 2_000_000,
      socialInsuranceSalary: 1_000_000,
      payrollTaxExempt: false,
      monthlyExpectedWorkDays: 0,
      status: "active",
      joinedAt: "2099-01-01",
    }).returning({ id: employeesTable.id });
    insuredEmployeeId = insuredEmployee.id;
    await db.insert(employeeSalaryHistoryTable).values({
      employeeId: insuredEmployeeId,
      effectiveFrom: "2099-01-01",
      employeeType: "office",
      baseSalary: 2_000_000,
      socialInsuranceSalary: 1_000_000,
      payrollTaxExempt: false,
    });
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    await db.delete(employeesTable).where(eq(employeesTable.id, insuredEmployeeId));
    server.close();
  });

  it("prorates old and new monthly salaries and excludes leave days", async () => {
    const response = await fetch(`${baseUrl}/api/payroll?month=2099-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(response.status, 200);
    const payroll = await response.json() as {
      lines: Array<{ employeeId: number; gross: number; payable: number }>;
    };
    const line = payroll.lines.find((item) => item.employeeId === employeeId);
    assert.ok(line, "Inactive employee overlapping the payroll month must remain in the report");

    const allWeekdays = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      const date = `2099-01-${String(day).padStart(2, "0")}`;
      const weekday = new Date(Date.UTC(2099, 0, day)).getUTCDay();
      return { date, isWeekday: weekday >= 1 && weekday <= 5 };
    }).filter((item) => item.isWeekday);
    const expectedGross = allWeekdays.reduce((total, item) => {
      if (item.date < "2099-01-08" || item.date > "2099-01-23") return total;
      if (item.date === "2099-01-20") return total;
      return total + (item.date < "2099-01-18" ? 1_100_000 : 2_200_000) / allWeekdays.length;
    }, 0);

    assert.equal(line.gross, Math.round(expectedGross * 100) / 100);
    assert.equal(line.payable, line.gross);
  });

  it("calculates insurance, income tax, and relief from the insurance salary", async () => {
    const response = await fetch(`${baseUrl}/api/payroll?month=2099-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(response.status, 200);
    const payroll = await response.json() as {
      lines: Array<{
        employeeId: number;
        socialInsuranceSalary: number;
        socialInsurance: number;
        taxableIncome: number;
        calculatedIncomeTax: number;
        taxRelief: number;
        incomeTax: number;
      }>;
    };
    const line = payroll.lines.find((item) => item.employeeId === insuredEmployeeId);
    assert.ok(line);
    assert.equal(line.socialInsuranceSalary, 1_000_000);
    assert.equal(line.socialInsurance, 115_000);
    assert.equal(line.taxableIncome, 885_000);
    assert.equal(line.calculatedIncomeTax, 88_500);
    assert.equal(line.taxRelief, 18_000);
    assert.equal(line.incomeTax, 70_500);
  });

  it("replaces later salary history when a new salary is effective from an earlier date", async () => {
    const response = await fetch(`${baseUrl}/api/employees/${employeeId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        baseSalary: 3_300_000,
        salaryEffectiveDate: "2099-01-08",
      }),
    });
    assert.equal(response.status, 200);

    const history = await db.select()
      .from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, employeeId));
    assert.deepEqual(
      history.map((row) => ({
        effectiveFrom: row.effectiveFrom,
        baseSalary: Number(row.baseSalary),
      })),
      [{ effectiveFrom: "2099-01-08", baseSalary: 3_300_000 }],
    );

    const payrollResponse = await fetch(`${baseUrl}/api/payroll?month=2099-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(payrollResponse.status, 200);
    const payroll = await payrollResponse.json() as {
      lines: Array<{ employeeId: number; gross: number }>;
    };
    const line = payroll.lines.find((item) => item.employeeId === employeeId);
    assert.ok(line);

    const allWeekdays = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      const date = `2099-01-${String(day).padStart(2, "0")}`;
      const weekday = new Date(Date.UTC(2099, 0, day)).getUTCDay();
      return { date, isWeekday: weekday >= 1 && weekday <= 5 };
    }).filter((item) => item.isWeekday);
    const paidDays = allWeekdays.filter((item) =>
      item.date >= "2099-01-08"
      && item.date <= "2099-01-23"
      && item.date !== "2099-01-20"
    ).length;
    assert.equal(line.gross, Math.round((paidDays * 3_300_000 / allWeekdays.length) * 100) / 100);
  });
});