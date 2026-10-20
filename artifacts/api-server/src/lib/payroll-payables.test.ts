import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPayrollPayables, type SavedDebtMonth } from "./payroll-payables.js";
import { PayrollBalancesNotReadyError } from "./payroll-balance-store.js";

const source = (month: string, amounts: number[], extra: Partial<SavedDebtMonth> = {}): SavedDebtMonth => ({
  month, date: `${month}-28`, closed: false, attendanceNeedsRefresh: false,
  lines: amounts.map((balanceAmount, i) => ({ employeeId: i + 1, employeeName: `Employee ${i + 1}`, balanceAmount })),
  ...extra,
});
test("a carried balance is counted once, not added across months", () => {
  const result = projectPayrollPayables([source("2026-08", [100]), source("2026-09", [150])], "2026-09");
  assert.equal(result.totalOutstanding, 150);
  assert.equal(result.employeeCount, 1);
  assert.equal(result.lines[0].month, "2026-09");
});
test("zero, overpayments and the payroll tolerance clear older debts", () => {
  const result = projectPayrollPayables([source("2026-08", [100, 100, 100]), source("2026-09", [0, -50, 1])], "2026-09");
  assert.equal(result.totalOutstanding, 0);
  assert.equal(result.lines.length, 0);
  assert.equal(result.hasSavedCalculation, true);
});
test("future months are excluded and former employees retain their last saved debt", () => {
  const result = projectPayrollPayables([
    source("2026-08", [100, 40]), source("2026-09", [150]), source("2026-10", [5000, 5000]),
  ], "2026-09", new Map([[2, "Updated name"]]));
  assert.equal(result.totalOutstanding, 190);
  assert.equal(result.lines.find(line => line.employeeId === 2)?.employeeName, "Updated name");
});
test("stale historical debt fails explicitly, but later frozen sources supersede it", () => {
  assert.throws(() => projectPayrollPayables([source("2026-09", [100], { invalid: true })], "2026-09"), PayrollBalancesNotReadyError);
  const result = projectPayrollPayables([source("2026-08", [100], { invalid: true }), source("2026-09", [120], { closed: true })], "2026-09");
  assert.equal(result.totalOutstanding, 120);
  assert.equal(result.lines[0].closed, true);
});
test("current dirty attendance is a visible warning, not an implicit attendance pull", () => {
  const result = projectPayrollPayables([source("2026-09", [99.99], { attendanceNeedsRefresh: true })], "2026-09");
  assert.equal(result.totalOutstanding, 99.99);
  assert.equal(result.lines[0].attendanceNeedsRefresh, true);
});
test("no saved calculations are distinct from a fully paid saved calculation", () => {
  assert.equal(projectPayrollPayables([], "2026-09").hasSavedCalculation, false);
  assert.equal(projectPayrollPayables([source("2026-09", [0])], "2026-09").hasSavedCalculation, true);
});
