import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { GetPayrollResponse, type PayrollSummary, type PayrollLine } from "@workspace/api-zod";
import type { employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { buildPayrollWorkbook, payrollWorkbookHeaders, PayrollWorkbookError } from "./payroll-workbook.js";
import { calculatePayrollMonth } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule } from "./route-shared.js";

const epoch = new Date(0);
const employee: typeof employeesTable.$inferSelect = {
  id: 1, name: "Fixture", role: "Жолооч", phone: "", bankAccountNumber: "00001234",
  employeeType: "office", salaryType: "monthly", baseSalary: 2_500_000, socialInsuranceSalary: 1_000_000,
  payrollTaxExempt: true, fullSalaryRegardlessAttendance: false, payFrequency: "twice",
  monthlyExpectedWorkDays: 0, status: "active", joinedAt: "2026-09-01", inactiveAt: null,
  socialInsuranceProfile: { registrationNumber: "тт00123456", clanName: "Ургийн", parentName: "Эцгийн",
    insuranceTypeCode: "", occupationCode: "", citizenship: "", email: "" },
};
const rate: typeof employeeSalaryHistoryTable.$inferSelect = {
  id: 1, employeeId: 1, effectiveFrom: employee.joinedAt, employeeType: "office", salaryType: "monthly",
  baseSalary: 2_500_000, socialInsuranceSalary: 1_000_000, monthlyExpectedWorkDays: 0,
  payrollTaxExempt: true, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: epoch,
};
function summary(changes: Partial<PayrollLine> = {}): PayrollSummary {
  const result = calculatePayrollMonth("2026-10", { allEmployees: [employee], salaryHistory: [rate], records: [],
    allAdjustments: [], allAdvanceApprovals: [] }, { id: 1, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch });
  result.lines[0] = { ...result.lines[0], ...changes };
  return GetPayrollResponse.parse(result);
}
async function load(value = summary(), employees = [employee], history = [rate]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildPayrollWorkbook(value, employees, history) as never);
  return workbook;
}
test("exports insured and exempt rows, identities as text, all requested salary columns and cached totals", async () => {
  const value = summary({ daysWorked: 19, hours: 152, gross: 2_159_090.91, advanceAmount: 1_250_000,
    deductions: 1_250_000, carryoverAmount: 50_000, paidAmount: 100_000, remainingAmount: 859_090.91 });
  const workbook = await load(value);
  const sheet = workbook.worksheets[0];
  assert.deepEqual((sheet.getRow(4).values as unknown[]).slice(1), [...payrollWorkbookHeaders]);
  assert.equal(sheet.getCell("C5").value, "Эцгийн");
  assert.equal(sheet.getCell("D5").value, "Fixture");
  assert.equal(sheet.getCell("E5").value, "ТТ00123456");
  assert.equal(sheet.getCell("E5").numFmt, "@");
  assert.equal(sheet.getCell("F5").value, "Жолооч");
  assert.equal(sheet.getCell("I5").value, 2_500_000);
  assert.equal(sheet.getCell("J5").value, 19);
  assert.equal(sheet.getCell("K5").value, 22);
  assert.equal(sheet.getCell("M5").value, 2_159_090.91);
  assert.equal(sheet.getCell("O5").value, 0); // Exempt employees must not be filtered out.
  assert.equal(sheet.getCell("R5").value, 1_250_000);
  assert.equal(sheet.getCell("T5").value, 909_090.91); // Excludes prior debt and recorded final payments.
  assert.equal(sheet.getCell("U5").value, 100_000);
  assert.equal(sheet.getCell("V5").value, 50_000);
  assert.equal(sheet.getCell("X5").value, 859_090.91);
  assert.deepEqual(sheet.getCell("M6").value, { formula: "SUM(M5:M5)", result: 2_159_090.91 });
  assert.equal(sheet.views[0].state, "frozen");
  assert.ok(sheet.autoFilter);
});
test("uses effective historical rates, includes every mixed-type interval and ignores future/current settings", async () => {
  const history = [rate, { ...rate, id: 2, effectiveFrom: "2026-10-15", employeeType: "shift", baseSalary: 1_800_000, monthlyExpectedWorkDays: 14 },
    { ...rate, id: 3, effectiveFrom: "2026-11-01", baseSalary: 99_000_000 }];
  const workbook = await load(summary(), [{ ...employee, baseSalary: 99_000_000 }], history);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("I5").value, 1_800_000);
  assert.equal(sheet.getCell("K5").value, 14);
  assert.match(String(sheet.getCell("Z5").value), /тохиргоо өөрчлөгдсөн/);
  const settings = workbook.worksheets[1];
  assert.equal(settings.rowCount, 3);
  assert.equal(settings.getCell("B2").value, "2026-10-01");
  assert.equal(settings.getCell("C2").value, "2026-10-14");
  assert.equal(settings.getCell("B3").value, "2026-10-15");
  assert.equal(settings.getCell("C3").value, "2026-10-31");
});
test("missing profile fields and history remain blank with warnings, never invented", async () => {
  const workbook = await load(summary(), [{ ...employee, socialInsuranceProfile: null }], []);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("E5").value, "");
  assert.equal(sheet.getCell("I5").value, "");
  assert.match(String(sheet.getCell("Z5").value), /Регистр дутуу/);
  assert.match(String(sheet.getCell("Z5").value), /тарифын түүх алга/);
  assert.equal(sheet.getCell("D5").value, employee.name);
});
test("does not interpret formula-like employee text as a spreadsheet formula", async () => {
  const workbook = await load(summary({ employeeName: "=1+1", role: "+SUM(A1)" }));
  assert.equal(workbook.worksheets[0].getCell("D5").type, ExcelJS.ValueType.String);
  assert.equal(workbook.worksheets[0].getCell("D5").value, "=1+1");
  assert.equal(workbook.worksheets[0].getCell("F5").value, "+SUM(A1)");
});
test("respects employment boundaries for office expected days and retains saved sources untouched", async () => {
  const value = summary({ carryoverAmount: -500, remainingAmount: 0, overpaidAmount: 500 });
  const before = structuredClone({ value, employee, rate });
  const workbook = await load(value, [{ ...employee, joinedAt: "2026-10-14", inactiveAt: "2026-10-16" }]);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("K5").value, 3);
  assert.equal(sheet.getCell("W5").value, 500);
  assert.equal(sheet.getCell("Y5").value, 500);
  assert.deepEqual({ value, employee, rate }, before);
});
test("rejects missing, stale and unreviewed saved payroll rather than exporting incomplete figures", async () => {
  for (const changes of [{ calculationReady: false }, { attendanceNeedsRefresh: true }, { openingBalanceReviewRequired: true }]) {
    await assert.rejects(buildPayrollWorkbook(summary(changes), [employee], [rate]), (error: unknown) => error instanceof PayrollWorkbookError && error.status === 409);
  }
  await assert.rejects(buildPayrollWorkbook({ ...summary(), lines: [] }, [employee], [rate]), (error: unknown) => error instanceof PayrollWorkbookError && error.status === 422);
});
