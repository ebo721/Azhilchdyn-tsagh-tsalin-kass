import assert from "node:assert/strict";
import { test } from "node:test";
import type { employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { calculatePayrollMonth } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule, weekdayDatesBetween, type PayrollCalculationData } from "./route-shared.js";

type Employee = typeof employeesTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
const epoch = new Date(0);
const month = "2026-09"; // 22 weekdays.
const schedule = { id: 1, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch };
const weekdays = weekdayDatesBetween(`${month}-01`, `${month}-30`);
const employee: Employee = {
  id: 1, name: "Office weekend fixture", role: "Test", phone: "", bankAccountNumber: "",
  employeeType: "office", salaryType: "monthly", baseSalary: 2_200_000, socialInsuranceSalary: 1_100_000,
  payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice",
  monthlyExpectedWorkDays: 0, status: "active", joinedAt: "2026-08-01", inactiveAt: null, socialInsuranceProfile: null,
};
function calculate(
  leave: string[], weekends: string[], changes: Partial<Employee> = {},
  salaryHistory: History[] = [], extra: Partial<PayrollCalculationData> = {},
) {
  const records = [...weekdays, ...weekends].map((date, i) => ({
    id: i + 1, employeeId: 1, date, clockIn: "08:00", clockOut: "16:00",
    status: leave.includes(date) ? "leave" : "present", hours: leave.includes(date) ? 0 : 8, createdAt: epoch,
  }));
  const current = { ...employee, ...changes };
  const registeredHistory: History[] = salaryHistory.length ? salaryHistory : [{
    id: 1, employeeId: current.id, effectiveFrom: current.joinedAt,
    employeeType: current.employeeType, salaryType: current.salaryType,
    baseSalary: Number(current.baseSalary), socialInsuranceSalary: Number(current.socialInsuranceSalary),
    monthlyExpectedWorkDays: current.monthlyExpectedWorkDays, payrollTaxExempt: current.payrollTaxExempt,
    fullSalaryRegardlessAttendance: current.fullSalaryRegardlessAttendance,
    payFrequency: current.payFrequency, createdAt: epoch,
  }];
  return calculatePayrollMonth(month, {
    allEmployees: [current], salaryHistory: registeredHistory, records,
    allAdjustments: [], allAdvanceApprovals: [], ...extra,
  }, schedule).lines[0];
}
test("weekday leave does not discard worked weekends when total attendance is below 22", () => {
  const line = calculate(["2026-09-11", "2026-09-18", "2026-09-22"], ["2026-09-13", "2026-09-20"]);
  assert.equal(line.daysWorked, 21);
  assert.equal(line.gross, 2_100_000);
  assert.equal(line.socialInsuranceSalary, 1_050_000);
});
test("the two September attendance patterns both pay 21/22 of their monthly base", () => {
  const cases = [
    { baseSalary: 1_800_000, leave: ["2026-09-11", "2026-09-18", "2026-09-22"], weekends: ["2026-09-13", "2026-09-20"], expected: 1_718_181.82 },
    { baseSalary: 2_500_000, leave: ["2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16", "2026-09-22", "2026-09-24", "2026-09-29"],
      weekends: ["2026-09-12", "2026-09-13", "2026-09-19", "2026-09-20", "2026-09-26", "2026-09-27"], expected: 2_386_363.64 },
  ];
  for (const entry of cases) {
    const line = calculate(entry.leave, entry.weekends, { baseSalary: entry.baseSalary, payrollTaxExempt: true });
    assert.equal(line.daysWorked, 21); assert.equal(line.gross, entry.expected);
    assert.equal(line.socialInsurance, 0); assert.equal(line.incomeTax, 0);
  }
});
test("weekend pay remains additional when all weekdays have been worked", () => {
  const line = calculate([], ["2026-09-12", "2026-09-13"]);
  assert.equal(line.gross, 2_400_000);
  assert.equal(line.socialInsuranceSalary, 1_200_000);
});
test("late weekends count, leave and absence weekends do not", () => {
  const records = ["late", "leave", "absent"].map((status, i) => ({
    id: i + 1, employeeId: 1, date: ["2026-09-12", "2026-09-13", "2026-09-19"][i],
    clockIn: "09:00", clockOut: "17:00", hours: status === "late" ? 8 : 0, status, createdAt: epoch,
  }));
  const line = calculate([], [], {}, [], { records });
  assert.equal(line.daysWorked, 1);
  assert.equal(line.gross, 2_300_000); // Existing monthly-office weekday entitlement is unchanged.
  assert.equal(line.socialInsuranceSalary, 1_150_000);
});
test("weekend earnings and insurance use salary effective on each worked date", () => {
  const history: History[] = [
    { id: 1, employeeId: 1, effectiveFrom: "2026-08-01", employeeType: "office", salaryType: "monthly",
      baseSalary: 2_200_000, socialInsuranceSalary: 1_100_000, monthlyExpectedWorkDays: 0,
      payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: epoch },
    { id: 2, employeeId: 1, effectiveFrom: "2026-09-15", employeeType: "office", salaryType: "monthly",
      baseSalary: 4_400_000, socialInsuranceSalary: 2_200_000, monthlyExpectedWorkDays: 0,
      payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: epoch },
  ];
  const base = calculate([], [], {}, history);
  const withWeekends = calculate([], ["2026-09-13", "2026-09-20"], {}, history);
  assert.equal(withWeekends.gross - base.gross, 300_000);
  assert.equal(withWeekends.socialInsuranceSalary - base.socialInsuranceSalary, 150_000);
});
test("weekends outside employment are excluded and inactive date is inclusive", () => {
  const line = calculate([], ["2026-09-05", "2026-09-12", "2026-09-13", "2026-09-19", "2026-09-20"],
    { joinedAt: "2026-09-10", inactiveAt: "2026-09-19", status: "inactive" });
  assert.equal(line.gross, 1_000_000); // Seven eligible weekdays plus three worked weekend days.
  assert.equal(line.socialInsuranceSalary, 500_000);
});
test("full salary override does not double-count weekends and no attendance still pays no new salary", () => {
  const full = calculate(["2026-09-11"], ["2026-09-12", "2026-09-13"], { fullSalaryRegardlessAttendance: true });
  assert.equal(full.gross, 2_200_000); assert.equal(full.socialInsuranceSalary, 1_100_000);
  const empty = calculate([], [], {}, [], { records: [] });
  assert.equal(empty.gross, 0); assert.equal(empty.socialInsuranceSalary, 0);
});
test("shift calculations are unchanged", () => {
  const line = calculate(["2026-09-11", "2026-09-18", "2026-09-22"], ["2026-09-13", "2026-09-20"],
    { employeeType: "shift", salaryType: "daily", baseSalary: 100_000, monthlyExpectedWorkDays: 22 });
  assert.equal(line.gross, 2_100_000); assert.equal(line.socialInsuranceSalary, 1_050_000);
});
test("weekend recalculation preserves first/second payments, financial carryover and source inputs", () => {
  const extra: Partial<PayrollCalculationData> = {
    openingBalances: [{ employeeId: 1, balanceAmount: 50_000 }],
    allAdjustments: [{
      id: 1, employeeId: 1, month, manualDeduction: 10_000, paidAmount: 300_000, secondPaidAmount: 20_000,
      paymentDate: "2026-09-15", secondPaymentDate: "2026-09-30", receivableId: null, journalEntryId: null,
      advanceAmount: 0, taxRelief: 0, additionalPayments: [], updatedAt: epoch,
    }],
  };
  const original = structuredClone(extra);
  const line = calculate(["2026-09-11", "2026-09-18", "2026-09-22"], ["2026-09-13", "2026-09-20"],
    { payrollTaxExempt: true }, [], extra);
  assert.equal(line.gross, 2_100_000);
  assert.equal(line.paidAmount, 320_000); assert.equal(line.secondPaidAmount, 20_000);
  assert.equal(line.carryoverAmount, 50_000); assert.equal(line.balanceAmount, 1_820_000);
  assert.deepEqual(extra, original);
});
