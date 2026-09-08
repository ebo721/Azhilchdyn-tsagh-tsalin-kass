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
  payrollAdjustmentsTable,
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
    await db.insert(attendanceTable).values([
      {
        employeeId: insuredEmployeeId,
        date: "2099-01-01",
        clockIn: "",
        clockOut: "",
        hours: 0,
        status: "absent",
      },
      {
        employeeId: insuredEmployeeId,
        date: "2099-02-02",
        clockIn: "",
        clockOut: "",
        hours: 0,
        status: "absent",
      },
    ]);
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

  it("does not calculate salary or payroll taxes when the month has no attendance", async () => {
    const response = await fetch(`${baseUrl}/api/payroll?month=2099-03`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(response.status, 200);
    const payroll = await response.json() as {
      lines: Array<{
        employeeId: number;
        gross: number;
        socialInsurance: number;
        incomeTax: number;
      }>;
    };
    const line = payroll.lines.find((item) => item.employeeId === insuredEmployeeId);
    assert.ok(line);
    assert.equal(line.gross, 0);
    assert.equal(line.socialInsurance, 0);
    assert.equal(line.incomeTax, 0);
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

  it("adds daily salary when an office employee works beyond the required weekdays", async () => {
    const weekdays = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      const date = `2099-01-${String(day).padStart(2, "0")}`;
      const weekday = new Date(Date.UTC(2099, 0, day)).getUTCDay();
      return { date, isWeekday: weekday >= 1 && weekday <= 5 };
    }).filter((item) => item.isWeekday);
    const extraDate = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      const date = `2099-01-${String(day).padStart(2, "0")}`;
      const weekday = new Date(Date.UTC(2099, 0, day)).getUTCDay();
      return { date, isWeekend: weekday === 0 || weekday === 6 };
    }).find((item) => item.isWeekend)?.date;
    assert.ok(extraDate);

    await db.insert(attendanceTable).values([
      ...weekdays.map(({ date }) => ({
        employeeId: insuredEmployeeId,
        date,
        clockIn: "09:00",
        clockOut: "18:00",
        hours: 8,
        status: "present",
      })),
      {
        employeeId: insuredEmployeeId,
        date: extraDate,
        clockIn: "09:00",
        clockOut: "18:00",
        hours: 8,
        status: "present",
      },
    ]);

    const response = await fetch(`${baseUrl}/api/payroll?month=2099-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(response.status, 200);
    const payroll = await response.json() as {
      lines: Array<{
        employeeId: number;
        daysWorked: number;
        gross: number;
        socialInsuranceSalary: number;
      }>;
    };
    const line = payroll.lines.find((item) => item.employeeId === insuredEmployeeId);
    assert.ok(line);
    assert.equal(line.daysWorked, weekdays.length + 1);
    assert.equal(line.gross, Math.round((2_000_000 + 2_000_000 / weekdays.length) * 100) / 100);
    assert.equal(
      line.socialInsuranceSalary,
      Math.round((1_000_000 + 1_000_000 / weekdays.length) * 100) / 100,
    );
  });

  it("carries underpayment and overpayment into the next month's payable salary", async () => {
    const januaryResponse = await fetch(`${baseUrl}/api/payroll?month=2099-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(januaryResponse.status, 200);
    const januaryPayroll = await januaryResponse.json() as {
      lines: Array<{ employeeId: number; payable: number }>;
    };
    const januaryLine = januaryPayroll.lines.find((item) => item.employeeId === insuredEmployeeId);
    assert.ok(januaryLine);

    const [adjustment] = await db.insert(payrollAdjustmentsTable).values({
      employeeId: insuredEmployeeId,
      month: "2099-01",
      paidAmount: januaryLine.payable,
      paymentDate: "2099-01-31",
      secondPaidAmount: 0,
      manualDeduction: 0,
      taxRelief: 0,
    }).returning({ id: payrollAdjustmentsTable.id });

    const getFebruaryLine = async () => {
      const response = await fetch(`${baseUrl}/api/payroll?month=2099-02`, {
        headers: { cookie: adminCookie },
      });
      assert.equal(response.status, 200);
      const payroll = await response.json() as {
        lines: Array<{
          employeeId: number;
          carryoverAmount: number;
          payable: number;
          remainingAmount: number;
          overpaidAmount: number;
        }>;
      };
      const line = payroll.lines.find((item) => item.employeeId === insuredEmployeeId);
      assert.ok(line);
      return line;
    };

    const balanced = await getFebruaryLine();
    assert.equal(balanced.carryoverAmount, 0);

    await db.update(payrollAdjustmentsTable)
      .set({ paidAmount: januaryLine.payable - 1 })
      .where(eq(payrollAdjustmentsTable.id, adjustment.id));
    const oneTugrikUnder = await getFebruaryLine();
    assert.equal(oneTugrikUnder.carryoverAmount, 0);

    await db.update(payrollAdjustmentsTable)
      .set({ paidAmount: januaryLine.payable + 1 })
      .where(eq(payrollAdjustmentsTable.id, adjustment.id));
    const oneTugrikOver = await getFebruaryLine();
    assert.equal(oneTugrikOver.carryoverAmount, 0);

    await db.update(payrollAdjustmentsTable)
      .set({ paidAmount: januaryLine.payable - 100_000 })
      .where(eq(payrollAdjustmentsTable.id, adjustment.id));
    const underpaid = await getFebruaryLine();
    assert.equal(underpaid.carryoverAmount, 100_000);
    assert.equal(underpaid.payable, balanced.payable + 100_000);

    await db.update(payrollAdjustmentsTable)
      .set({ paidAmount: januaryLine.payable + 150_000 })
      .where(eq(payrollAdjustmentsTable.id, adjustment.id));
    const overpaid = await getFebruaryLine();
    assert.equal(overpaid.carryoverAmount, -150_000);
    assert.equal(overpaid.payable, balanced.payable - 150_000);
  });

  it("allows correcting salary history without changing an already paid amount", async () => {
    const [historyRow] = await db.select()
      .from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, employeeId))
      .orderBy(employeeSalaryHistoryTable.effectiveFrom)
      .limit(1);
    assert.ok(historyRow);

    const paidAmount = 750_000;
    await db.insert(payrollAdjustmentsTable).values({
      employeeId,
      month: "2099-01",
      paidAmount,
      paymentDate: "2099-01-31",
      secondPaidAmount: 0,
      manualDeduction: 0,
      taxRelief: 0,
    });

    const response = await fetch(
      `${baseUrl}/api/employees/${employeeId}/salary-history/${historyRow.id}`,
      {
        method: "PATCH",
        headers: {
          cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          effectiveFrom: "2099-01-07",
          baseSalary: 1_200_000,
          socialInsuranceSalary: 0,
        }),
      },
    );
    assert.equal(response.status, 200);

    const [adjustment] = await db.select()
      .from(payrollAdjustmentsTable)
      .where(eq(payrollAdjustmentsTable.employeeId, employeeId));
    assert.equal(Number(adjustment.paidAmount), paidAmount);

    const [employee] = await db.select()
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId));
    assert.equal(employee.joinedAt, "2099-01-08");
  });
});