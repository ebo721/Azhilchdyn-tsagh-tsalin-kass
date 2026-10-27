import assert from "node:assert/strict";
import { test } from "node:test";
import type { attendanceTable, employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { calculatePayrollAdvanceLine, shiftDailyRate } from "./payroll-calc-helpers.js";
import { PayrollConfigurationError } from "./shift-insurance.js";

type Employee = typeof employeesTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
type Attendance = typeof attendanceTable.$inferSelect;
const employee: Employee = {
  id: 1, name: "Transition fixture", role: "Test", phone: "", bankAccountNumber: "",
  socialInsuranceProfile: null, employeeType: "shift", salaryType: "monthly",
  baseSalary: 2_500_000, socialInsuranceSalary: 0, payrollTaxExempt: false,
  fullSalaryRegardlessAttendance: false, monthlyExpectedWorkDays: 14,
  payFrequency: "twice", status: "active", joinedAt: "2026-09-16", inactiveAt: null,
};
const history = (effectiveFrom: string, type: "office" | "shift", overrides: Partial<History> = {}): History => ({
  id: 1, employeeId: 1, effectiveFrom, employeeType: type, salaryType: "monthly",
  baseSalary: 2_500_000, socialInsuranceSalary: 0, payrollTaxExempt: false,
  fullSalaryRegardlessAttendance: false, payFrequency: "twice",
  monthlyExpectedWorkDays: type === "office" ? 0 : 14, createdAt: new Date(0), ...overrides,
});
const attendance = (date: string, overrides: Partial<Attendance> = {}): Attendance => ({
  id: 1, employeeId: 1, date, status: "present", clockIn: "08:00", clockOut: "16:00",
  hours: 8, createdAt: new Date(0), ...overrides,
});
const rows = [
  history("2026-09-16", "shift"),
  history("2026-09-17", "office"),
  history("2026-10-14", "shift"),
];
const records = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11].map(day => attendance(`2026-10-${String(day).padStart(2, "0")}`));
const calculate = (historyRows = rows, attendanceRows = records, current = employee) =>
  calculatePayrollAdvanceLine(current, attendanceRows, historyRows, "2026-10-01", "2026-10-31", "2026-10-15");

test("office through the 13th with no shift attendance gets 50% of monthly office salary, not 25 million", () => {
  const line = calculate();
  assert.equal(line.daysWorked, 10);
  assert.equal(line.dailySalary, 0);
  assert.equal(line.totalSalary, 2_500_000);
  assert.equal(line.advanceAmount, 1_250_000);
  assert.equal(line.paid, false);
});

test("mixed office/shift advance adds only shift-date attendance at each effective rate", () => {
  const line = calculate([...rows, history("2026-10-15", "shift", { baseSalary: 2_800_000 })],
    [...records, attendance("2026-10-14"), attendance("2026-10-15"), attendance("2026-10-20")]);
  assert.equal(line.daysWorked, 12);
  assert.equal(line.advanceAmount, 1_628_571.43);
  assert.equal(line.dailySalary, 178_571.43);
});

test("shift to office transition preserves shift earnings and adds the office half once", () => {
  const line = calculate([history("2026-09-16", "shift"), history("2026-10-14", "office")],
    [attendance("2026-10-01"), attendance("2026-10-14")]);
  assert.equal(line.advanceAmount, 1_428_571.43);
});

test("old office settings outside the advance period do not add an office advance", () => {
  const line = calculate([history("2026-09-16", "office"), history("2026-10-01", "shift")]);
  assert.equal(line.advanceAmount, 1_785_714.29);
  assert.equal(line.dailySalary, 178_571.43);
});

test("future office history is ignored and attendance order does not change shift earnings", () => {
  const line = calculate([history("2026-09-16", "shift"), history("2026-10-16", "office")], [...records].reverse());
  assert.equal(line.advanceAmount, 1_785_714.29);
});

test("pure office keeps 50% even without attendance; office salary changes use latest effective rate once", () => {
  assert.equal(calculate([history("2026-09-16", "office")], []).advanceAmount, 1_250_000);
  assert.equal(calculate([history("2026-09-16", "office"), history("2026-10-10", "office", {
    baseSalary: 2_800_000,
  })]).advanceAmount, 1_400_000);
});

test("daily shift pay does not need expected days, but monthly shift pay must never divide by a guessed one", () => {
  assert.equal(shiftDailyRate({ salaryType: "daily", baseSalary: 100_000, monthlyExpectedWorkDays: 0 }), 100_000);
  for (const days of [0, -1, 1.5]) {
    assert.throws(() => shiftDailyRate({ salaryType: "monthly", baseSalary: 2_500_000, monthlyExpectedWorkDays: days }),
      PayrollConfigurationError);
  }
});

test("attendance must belong to the employee, employment dates and the advance period", () => {
  const line = calculate([history("2026-09-16", "shift")], [
    attendance("2026-09-30"), attendance("2026-10-01"), attendance("2026-10-02", { status: "late" }),
    attendance("2026-10-03", { status: "leave" }), attendance("2026-10-04", { status: "absent" }),
    attendance("2026-10-05", { employeeId: 2 }), attendance("2026-10-16"),
  ], { ...employee, joinedAt: "2026-10-02", inactiveAt: "2026-10-02" });
  assert.equal(line.daysWorked, 1);
  assert.equal(line.advanceAmount, 178_571.43);
});
