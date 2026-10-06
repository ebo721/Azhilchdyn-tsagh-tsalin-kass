import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { pool, type employeesTable, type attendanceTable, type employeeSalaryHistoryTable } from "@workspace/db";
import { getPayrollSchedule, getPayrollSummary, monthlyIncomeTaxRelief, payrollPeriod } from "./payroll-calc-helpers.js";
import { weekdayDatesBetween, type PayrollCalculationData } from "./route-shared.js";
import { needsShiftWorkDays, PayrollConfigurationError } from "./shift-insurance.js";

type Employee = typeof employeesTable.$inferSelect;
type Attendance = typeof attendanceTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
const month = "2099-02";
let start: string;
let end: string;
function day(offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function employee(changes: Partial<Employee> = {}): Employee {
  return { id: 999, name: "Insurance fixture", role: "Test", phone: "", bankAccountNumber: "",
    employeeType: "shift", salaryType: "daily", baseSalary: 100_000,
    socialInsuranceSalary: 1_200_000, payrollTaxExempt: false,
    fullSalaryRegardlessAttendance: false, payFrequency: "twice",
    monthlyExpectedWorkDays: 15, status: "active", joinedAt: start,
    inactiveAt: null, socialInsuranceProfile: null, ...changes };
}
function attendance(offset: number, status = "present"): Attendance {
  return { id: offset + 1, employeeId: 999, date: day(offset), clockIn: "08:00", clockOut: "16:00", hours: 8, status, createdAt: new Date(0) };
}
async function calculate(e: Employee, records: Attendance[], salaryHistory: History[] = [], extra: Partial<PayrollCalculationData> = {}) {
  const summary = await getPayrollSummary(month, {
    allEmployees: [e], salaryHistory, records, allAdjustments: [], allAdvanceApprovals: [], ...extra,
  });
  assert.equal(summary.lines.length, 1);
  return summary.lines[0];
}

before(async () => {
  const period = payrollPeriod(month, await getPayrollSchedule(month));
  start = period.periodStart;
  end = period.periodEnd;
});
after(() => pool.end());

describe("actual shift attendance insurance proration", () => {
  it("uses 10 actual days / 15 expected days for daily-paid workers", async () => {
    const line = await calculate(employee(), Array.from({ length: 10 }, (_, i) => attendance(i)));
    assert.equal(line.daysWorked, 10);
    assert.equal(line.gross, 1_000_000);
    assert.equal(line.socialInsuranceSalary, 800_000);
    assert.equal(line.socialInsurance, 92_000);
    assert.equal(line.taxableIncome, 708_000);
    assert.equal(line.taxRelief, 18_000);
    assert.equal(line.incomeTax, 52_800);
  });
  it("uses the same insurance base for monthly-paid shift workers", async () => {
    const line = await calculate(employee({ salaryType: "monthly", baseSalary: 1_500_000 }), [attendance(0), attendance(1)]);
    assert.equal(line.gross, 200_000);
    assert.equal(line.socialInsuranceSalary, 160_000);
  });
  it("counts weekends and late attendance, excludes leave, absence, and out-of-employment days", async () => {
    const line = await calculate(employee({ joinedAt: day(1), inactiveAt: day(5), status: "inactive" }),
      [attendance(0), attendance(1), attendance(2, "late"), attendance(3, "leave"), attendance(4, "absent"), attendance(5), attendance(6)]);
    assert.equal(line.daysWorked, 3);
    assert.equal(line.hours, 24);
    assert.equal(line.socialInsuranceSalary, 240_000);
    assert.equal(line.gross, 300_000);
  });
  it("does not cap insurance at expected days", async () => {
    const line = await calculate(employee({ monthlyExpectedWorkDays: 2 }), [attendance(0), attendance(1), attendance(2)]);
    assert.equal(line.socialInsuranceSalary, 1_800_000);
  });
  it("uses each attendance date's insured salary and expected-days history", async () => {
    const e = employee();
    const history: History[] = [
      { id: 1, employeeId: e.id, effectiveFrom: start, employeeType: "shift", salaryType: "daily", monthlyExpectedWorkDays: 15,
        baseSalary: 100_000, socialInsuranceSalary: 1_200_000, payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: new Date(0) },
      { id: 2, employeeId: e.id, effectiveFrom: day(2), employeeType: "shift", salaryType: "daily", monthlyExpectedWorkDays: 10,
        baseSalary: 120_000, socialInsuranceSalary: 1_500_000, payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: new Date(0) },
    ];
    const line = await calculate(e, [attendance(0), attendance(1), attendance(2)], history);
    assert.equal(line.socialInsuranceSalary, 310_000);
    assert.equal(line.gross, 320_000);
  });
  it("leaves tax-exempt shifts and shifts without worked days untaxed", async () => {
    const exempt = await calculate(employee({ payrollTaxExempt: true, monthlyExpectedWorkDays: 0 }), [attendance(0)]);
    assert.equal(exempt.socialInsuranceSalary, 0);
    assert.equal(exempt.incomeTax, 0);
    assert.equal(exempt.taxRelief, 0);
    const absent = await calculate(employee(), [attendance(0, "absent"), attendance(1, "leave")]);
    assert.equal(absent.socialInsuranceSalary, 0);
    const noRecords = await calculate(employee(), []);
    assert.equal(noRecords.gross, 0);
    assert.equal(noRecords.socialInsuranceSalary, 0);
  });
  it("reports an invalid denominator instead of silently using office weekdays", async () => {
    await assert.rejects(calculate(employee({ monthlyExpectedWorkDays: 0 }), [attendance(0)]), PayrollConfigurationError);
    assert.equal(needsShiftWorkDays(employee()), true);
    assert.equal(needsShiftWorkDays(employee({ payrollTaxExempt: true })), false);
  });
  it("preserves the full-salary override and office proration", async () => {
    const full = await calculate(employee({ fullSalaryRegardlessAttendance: true }), []);
    assert.equal(full.socialInsuranceSalary, 1_200_000);
    assert.equal(full.gross, 1_500_000);
    const office = await calculate(employee({ employeeType: "office", salaryType: "monthly", baseSalary: 1_500_000, monthlyExpectedWorkDays: 0 }), [attendance(0)]);
    assert.equal(office.socialInsuranceSalary, 1_200_000);
    const noAttendance = await calculate(employee({ employeeType: "office", salaryType: "monthly" }), []);
    assert.equal(noAttendance.socialInsuranceSalary, 0);
    const weekday = weekdayDatesBetween(start, end)[0];
    const leave = { ...attendance(0), date: weekday, status: "leave" };
    const prorated = await calculate(employee({ employeeType: "office", salaryType: "monthly" }), [leave]);
    assert.equal(prorated.socialInsuranceSalary, Math.round(1_200_000 * (weekdayDatesBetween(start, end).length - 1) / weekdayDatesBetween(start, end).length * 100) / 100);
  });
  it("keeps recorded payments unchanged during recalculation", async () => {
    const line = await calculate(employee(), [attendance(0)], [], {
      allAdjustments: [{
        id: 1, employeeId: 999, month, manualDeduction: 0, paidAmount: 50_000, paymentDate: day(0),
        secondPaidAmount: 10_000, secondPaymentDate: day(1), receivableId: null, journalEntryId: null,
        advanceAmount: 0, taxRelief: 0, updatedAt: new Date(0),
      }],
    });
    assert.equal(line.paidAmount, 60_000);
    assert.equal(line.secondPaidAmount, 10_000);
    assert.equal(line.balanceAmount, line.gross - line.deductions - 60_000);
  });
  it("retains the existing relief brackets", () => {
    assert.equal(monthlyIncomeTaxRelief(800_000), 18_000);
    assert.equal(monthlyIncomeTaxRelief(3_100_000), 0);
  });
});
