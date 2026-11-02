import assert from "node:assert/strict";
import { test } from "node:test";
import type { attendanceTable, employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { calculatePayrollMonth } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule, type PayrollCalculationData } from "./route-shared.js";

type Employee = typeof employeesTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
type Attendance = typeof attendanceTable.$inferSelect;
const epoch = new Date(0);
const month = "2026-10"; // 22 Monday–Friday days.
const schedule = { id: 1, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch };
const employee: Employee = {
  id: 1, name: "Office attendance fixture", role: "Test", phone: "", bankAccountNumber: "",
  employeeType: "office", salaryType: "monthly", baseSalary: 2_500_000, socialInsuranceSalary: 1_100_000,
  payrollTaxExempt: true, fullSalaryRegardlessAttendance: false, payFrequency: "twice",
  monthlyExpectedWorkDays: 0, status: "active", joinedAt: "2026-09-07", inactiveAt: null, socialInsuranceProfile: null,
};
const history: History = {
  id: 1, employeeId: 1, effectiveFrom: employee.joinedAt, employeeType: "office", salaryType: "monthly",
  baseSalary: employee.baseSalary, socialInsuranceSalary: employee.socialInsuranceSalary,
  monthlyExpectedWorkDays: 0, payrollTaxExempt: true, fullSalaryRegardlessAttendance: false,
  payFrequency: "twice", createdAt: epoch,
};
function record(date: string, status = "present", employeeId = 1): Attendance {
  return { id: Number(date.slice(-2)), employeeId, date, clockIn: "08:00", clockOut: "16:00",
    hours: ["present", "late"].includes(status) ? 8 : 0, status, createdAt: epoch };
}
function calculate(records: Attendance[], changes: Partial<Employee> = {}, rows?: History[], extra: Partial<PayrollCalculationData> = {}) {
  const current = { ...employee, ...changes };
  return calculatePayrollMonth(month, {
    allEmployees: [current], salaryHistory: rows ?? [{ ...history, ...changes, employeeId: 1, effectiveFrom: current.joinedAt }],
    records, allAdjustments: [], allAdvanceApprovals: [], ...extra,
  }, schedule).lines[0];
}
test("October regression: 19 worked days, one weekend, one leave and three missing weekdays", () => {
  const records = ["01", "02", "05", "06", "07", "08", "09", "12", "13", "14",
    "20", "21", "22", "23", "25", "26", "27", "28", "29"].map(day => record(`2026-10-${day}`));
  records.push(record("2026-10-15", "leave"));
  const line = calculate(records, {}, undefined, {
    allAdvanceApprovals: [{ id: 1, month, totalAmount: 1_250_000, approvalDate: "2026-10-20", approvedAt: epoch,
      lines: [{ employeeId: 1, advanceAmount: 1_250_000, paid: true, paymentDate: "2026-10-21" }] }],
  });
  assert.equal(line.daysWorked, 19);
  assert.equal(line.gross, 2_159_090.91);
  assert.equal(line.advanceAmount, 1_250_000);
  assert.equal(line.socialInsurance, 0);
  assert.equal(line.incomeTax, 0);
  assert.equal(line.net, 909_090.91);
});
test("missing, absent and leave weekdays earn nothing; present and late weekdays are paid", () => {
  const line = calculate([record("2026-10-01"), record("2026-10-02", "late"),
    record("2026-10-05", "absent"), record("2026-10-06", "leave"), record("2026-10-07", "present", 2)]);
  assert.equal(line.daysWorked, 2);
  assert.equal(line.gross, 227_272.73);
  const unworked = calculate([record("2026-10-01", "leave"), record("2026-10-02", "absent")], { payrollTaxExempt: false });
  assert.equal(unworked.gross, 0);
  assert.equal(unworked.socialInsuranceSalary, 0);
  assert.equal(unworked.socialInsurance, 0);
  assert.equal(unworked.incomeTax, 0);
  assert.equal(calculate([]).gross, 0);
});
test("insurance and effective salary use the same actually worked dates", () => {
  const rows = [{ ...history, payrollTaxExempt: false },
    { ...history, id: 2, effectiveFrom: "2026-10-15", baseSalary: 4_400_000, socialInsuranceSalary: 2_200_000, payrollTaxExempt: false }];
  const line = calculate([record("2026-10-01"), record("2026-10-16"), record("2026-10-18", "late")],
    { payrollTaxExempt: false }, rows);
  assert.equal(line.gross, 513_636.36);
  assert.equal(line.socialInsuranceSalary, 250_000);
  assert.equal(line.socialInsurance, 28_750);
  assert.equal(line.incomeTax, 2_125);
});
test("employment boundaries, other employees and dates outside the period cannot add office salary", () => {
  const line = calculate([record("2026-09-30"), record("2026-10-01"), record("2026-10-02"),
    record("2026-10-05"), record("2026-10-06"), record("2026-11-02")],
    { joinedAt: "2026-10-02", inactiveAt: "2026-10-05", status: "inactive" });
  assert.equal(line.daysWorked, 2);
  assert.equal(line.gross, 227_272.73);
});
test("full-salary exception still pays eligible weekdays without attendance, not extra weekends", () => {
  assert.equal(calculate([], { fullSalaryRegardlessAttendance: true }).gross, 2_500_000);
  assert.equal(calculate([record("2026-10-25")], { fullSalaryRegardlessAttendance: true }).gross, 2_500_000);
  const rows = [{ ...history }, { ...history, id: 2, effectiveFrom: "2026-10-15", fullSalaryRegardlessAttendance: true }];
  const line = calculate([record("2026-10-01")], { fullSalaryRegardlessAttendance: true }, rows);
  assert.equal(line.gross, 1_477_272.73); // One worked day plus twelve exception weekdays.
});
test("mixed office/shift month pays office attendance and effective shift rates only", () => {
  const rows = [{ ...history }, { ...history, id: 2, effectiveFrom: "2026-10-15",
    employeeType: "shift", baseSalary: 1_400_000, monthlyExpectedWorkDays: 14 }];
  const line = calculate([record("2026-10-01"), record("2026-10-15"), record("2026-10-18")],
    { employeeType: "shift" }, rows);
  assert.equal(line.gross, 313_636.36);
});
test("recalculation preserves all salary installments, advance installments, deductions and prior debt", () => {
  const extra: Partial<PayrollCalculationData> = {
    openingBalances: [{ employeeId: 1, balanceAmount: -50_000 }],
    allAdvanceApprovals: [{ id: 1, month, totalAmount: 1_250_000, approvalDate: "2026-10-20", approvedAt: epoch,
      lines: [{ employeeId: 1, advanceAmount: 1_250_000, paid: false, payments: [
        { sequence: 1, amount: 100_000, date: "2026-10-20" }, { sequence: 2, amount: 50_000, date: "2026-10-21" },
      ] }] }],
    allAdjustments: [{
      id: 1, employeeId: 1, month, manualDeduction: 10_000, paidAmount: 300_000, secondPaidAmount: 20_000,
      paymentDate: "2026-10-20", secondPaymentDate: "2026-10-30", receivableId: null, journalEntryId: null,
      advanceAmount: 0, taxRelief: 0, additionalPayments: [{ sequence: 3, amount: 15_000, date: "2026-10-31" }], updatedAt: epoch,
    }],
  };
  const original = structuredClone(extra);
  const line = calculate([record("2026-10-01"), record("2026-10-02")], {}, undefined, extra);
  assert.equal(line.gross, 227_272.73);
  assert.equal(line.paidAmount, 335_000);
  assert.equal(line.advanceAmount, 150_000);
  assert.equal(line.carryoverAmount, -50_000);
  assert.equal(line.balanceAmount, -317_727.27);
  assert.deepEqual(extra, original);
});
