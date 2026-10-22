import assert from "node:assert/strict";
import { test } from "node:test";
import type { employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { calculatePayrollAdvanceLine, calculatePayrollMonth, salaryAt } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule, weekdayDatesBetween, type PayrollCalculationData } from "./route-shared.js";
import { PayrollConfigurationError } from "./shift-insurance.js";

type Employee = typeof employeesTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
const epoch = new Date(0);
const employee: Employee = {
  id: 1, name: "Historical tax fixture", role: "Test", phone: "", bankAccountNumber: "",
  employeeType: "office", salaryType: "monthly", baseSalary: 2_200_000,
  socialInsuranceSalary: 1_000_000, payrollTaxExempt: false,
  fullSalaryRegardlessAttendance: false, payFrequency: "twice",
  monthlyExpectedWorkDays: 0, status: "active", joinedAt: "2026-08-20",
  inactiveAt: null, socialInsuranceProfile: null,
};
function history(effectiveFrom: string, exempt: boolean, id = 1): History {
  return {
    id, employeeId: 1, effectiveFrom, employeeType: "office", salaryType: "monthly",
    baseSalary: 2_200_000, socialInsuranceSalary: exempt ? 0 : 1_000_000,
    payrollTaxExempt: exempt, fullSalaryRegardlessAttendance: false,
    monthlyExpectedWorkDays: 0, payFrequency: "twice", createdAt: epoch,
  };
}
const records = weekdayDatesBetween("2026-09-01", "2026-09-30").map((date, i) => ({
  id: i + 1, employeeId: 1, date, clockIn: "08:00", clockOut: "16:00",
  status: "present", hours: 8, createdAt: epoch,
}));
function calculate(rows: History[], current: Employee = employee, extra: Partial<PayrollCalculationData> = {}, month = "2026-09") {
  return calculatePayrollMonth(month, {
    allEmployees: [current], salaryHistory: rows, records,
    allAdjustments: [], allAdvanceApprovals: [], ...extra,
  }, { id: 1, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch });
}

test("missing historical coverage must not import current insured settings into an exempt month", () => {
  const rows = [history("2026-09-09", true), history("2026-10-01", false, 2)];
  assert.throws(() => calculate(rows), error =>
    error instanceof PayrollConfigurationError
    && error.message.includes(employee.name)
    && error.message.includes("2026-09-01")
    && error.message.includes("2026-09-09"));
});

test("advance calculations reject the same historical gap instead of using current salary", () => {
  const rows = [history("2026-09-09", true), history("2026-10-01", false, 2)];
  assert.throws(() => calculatePayrollAdvanceLine(employee, records, rows,
    "2026-09-01", "2026-09-30", "2026-09-15"), PayrollConfigurationError);
});

test("future-only history is a coverage gap, not a legacy employee without history", () => {
  assert.throws(() => calculate([history("2026-10-01", false)]), PayrollConfigurationError);
});

test("corrected exempt baseline gives zero insurance, income tax and relief despite current insured settings", () => {
  const line = calculate([history("2026-08-20", true), history("2026-10-01", false, 2)]).lines[0];
  assert.equal(line.socialInsuranceSalary, 0);
  assert.equal(line.socialInsurance, 0);
  assert.equal(line.incomeTax, 0);
  assert.equal(line.taxRelief, 0);
  assert.equal(line.gross, 2_200_000);
});

test("a future exemption must not silently exempt an earlier insured month", () => {
  const rows = [history("2026-08-20", false), history("2026-10-14", true, 2)];
  const line = calculate(rows, { ...employee, payrollTaxExempt: true, socialInsuranceSalary: 0 }).lines[0];
  assert.equal(line.socialInsuranceSalary, 1_000_000);
  assert.equal(line.socialInsurance, 115_000);
  assert.equal(line.incomeTax, 70_500);
});

test("a midmonth exemption taxes only the covered insured days", () => {
  const line = calculate([history("2026-08-20", false), history("2026-09-16", true, 2)],
    { ...employee, payrollTaxExempt: true, socialInsuranceSalary: 0 }).lines[0];
  assert.equal(line.socialInsuranceSalary, 500_000);
  assert.equal(line.socialInsurance, 57_500);
  assert.equal(line.incomeTax, 24_250);
});

test("history lookup is employee-scoped and does not mutate history order", () => {
  const rows = [history("2026-10-01", false, 2), history("2026-08-20", true)];
  const before = structuredClone(rows);
  assert.equal(salaryAt(employee, rows, "2026-09-01").payrollTaxExempt, true);
  assert.deepEqual(rows, before);
  assert.throws(() => salaryAt(employee, [{ ...rows[0], employeeId: 2 }], "2026-09-01"),
    PayrollConfigurationError);
});

test("no history never falls back to undated employee-register tax settings", () => {
  for (const exempt of [true, false]) {
    const current = { ...employee, payrollTaxExempt: exempt };
    assert.throws(() => calculate([], current), PayrollConfigurationError);
    assert.throws(() => calculatePayrollAdvanceLine(current, records, [],
      "2026-09-01", "2026-09-30", "2026-09-15"), PayrollConfigurationError);
  }
});

test("both directions of a register/history exemption mismatch stop salary and advance calculations", () => {
  for (const exempt of [true, false]) {
    const current = { ...employee, payrollTaxExempt: exempt };
    const rows = [history("2026-08-20", !exempt)];
    assert.throws(() => calculate(rows, current), error =>
      error instanceof PayrollConfigurationError && error.message.includes("зөрүүтэй"));
    assert.throws(() => calculatePayrollAdvanceLine(current, records, rows,
      "2026-09-01", "2026-09-30", "2026-09-15"), PayrollConfigurationError);
  }
});

test("a historical exemption remains zero after later registration changes to insured", () => {
  const rows = [history("2026-08-20", true), history("2026-10-01", false, 2)];
  const line = calculate(rows).lines[0];
  assert.equal(line.socialInsurance, 0);
  assert.equal(line.incomeTax, 0);
  assert.equal(line.taxRelief, 0);
});

test("an attendance-free July before September salary history earns zero without guessing tax settings", () => {
  const current = { ...employee, joinedAt: "2026-07-01" };
  const line = calculate([history("2026-09-08", false)], current, {
    records: [], openingBalances: [{ employeeId: 1, balanceAmount: 123_456 }],
  }, "2026-07").lines[0];
  assert.equal(line.gross, 0);
  assert.equal(line.daysWorked, 0);
  assert.equal(line.socialInsuranceSalary, 0);
  assert.equal(line.socialInsurance, 0);
  assert.equal(line.incomeTax, 0);
  assert.equal(line.taxRelief, 0);
  assert.equal(line.carryoverAmount, 123_456);
  assert.equal(line.balanceAmount, 123_456);
});

test("no history and no attendance does not block a zero-earning month", () => {
  const line = calculate([], employee, { records: [] }).lines[0];
  assert.equal(line.gross, 0);
  assert.equal(line.socialInsurance, 0);
  assert.equal(line.incomeTax, 0);
});

test("worked August dates before September history still require explicit salary coverage", () => {
  const current = { ...employee, joinedAt: "2026-07-01" };
  const augustRecords = records.slice(0, 15).map(record => ({
    ...record, date: record.date.replace("2026-09", "2026-08"),
  }));
  assert.throws(() => calculate([history("2026-09-08", false)], current,
    { records: augustRecords }, "2026-08"), PayrollConfigurationError);
});

test("a historical full-salary override still pays an attendance-free month", () => {
  const current = { ...employee, joinedAt: "2026-07-01" };
  const rows = [{ ...history("2026-07-01", false), fullSalaryRegardlessAttendance: true },
    history("2026-09-08", false, 2)];
  const line = calculate(rows, current, { records: [] }, "2026-07").lines[0];
  assert.equal(line.gross, 2_200_000);
  assert.equal(line.socialInsuranceSalary, 1_000_000);
});

test("an undocumented full-salary override cannot silently become a zero-earning month", () => {
  assert.throws(() => calculate([], { ...employee, fullSalaryRegardlessAttendance: true },
    { records: [] }), PayrollConfigurationError);
});
