import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { employeesTable } from "@workspace/db";
import { buildInsuranceWorkbook, insuranceUploadHeaders, InsuranceReportValidationError } from "./social-insurance-report.js";

const employee: typeof employeesTable.$inferSelect = {
  id: 1, name: "Fixture only", role: "Test", phone: "0012345678", bankAccountNumber: "",
  employeeType: "shift", salaryType: "daily", baseSalary: 100_000,
  socialInsuranceSalary: 1_200_000, payrollTaxExempt: false,
  fullSalaryRegardlessAttendance: false, payFrequency: "twice", monthlyExpectedWorkDays: 15,
  status: "active", joinedAt: "2026-01-01", inactiveAt: null,
  socialInsuranceProfile: { registrationNumber: "ТТ00000000", clanName: "Fixture", parentName: "Example",
    insuranceTypeCode: "01001", occupationCode: "0000-00", citizenship: "Монгол", email: "" },
};
const line = { employeeId: 1, socialInsuranceSalary: 800_000 };
describe("social insurance upload workbook", () => {
  it("has exactly one data sheet, 15 template headers and numeric amounts", async () => {
    const data = await buildInsuranceWorkbook([line], [employee]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as never);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["data"]);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.columnCount, 15);
    assert.equal(sheet.rowCount, 2);
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), [...insuranceUploadHeaders]);
    assert.equal(sheet.getCell("A2").value, "ТТ00000000");
    assert.equal(sheet.getCell("E2").value, "01001");
    assert.equal(sheet.getCell("F2").value, "0000-00");
    assert.equal(sheet.getCell("G2").result, 800_000);
    assert.equal(sheet.getCell("G2").formula, "H2+I2+J2+K2+L2");
    assert.equal(sheet.getCell("H2").value, 800_000);
    assert.equal(sheet.getCell("I2").value, 0);
    assert.equal(sheet.getCell("L2").value, 0);
    assert.equal(sheet.getCell("N2").value, "0012345678");
    assert.equal(sheet.getCell("O2").value, "empty");
  });
  it("excludes zero-base rows even if their metadata is incomplete", async () => {
    const data = await buildInsuranceWorkbook([line, { employeeId: 2, socialInsuranceSalary: 0 }], [
      employee, { ...employee, id: 2, socialInsuranceProfile: null },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as never);
    assert.equal(workbook.worksheets[0].rowCount, 2);
  });
  it("blocks incomplete or duplicate registry metadata instead of exporting partial rows", async () => {
    await assert.rejects(buildInsuranceWorkbook([line], [{ ...employee, socialInsuranceProfile: null }]), /Регистр/);
    await assert.rejects(buildInsuranceWorkbook([line, { ...line, employeeId: 2 }], [employee, { ...employee, id: 2 }]), /Давхардсан регистр/);
    await assert.rejects(buildInsuranceWorkbook([line], [{ ...employee, socialInsuranceProfile: { ...employee.socialInsuranceProfile!, insuranceTypeCode: "1001" } }]), /5 оронтой/);
  });
  it("does not interpret employee-entered text as a formula", async () => {
    const data = await buildInsuranceWorkbook([line], [{ ...employee, name: '=HYPERLINK("https://example.com")' }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as never);
    assert.equal(workbook.worksheets[0].getCell("D2").type, ExcelJS.ValueType.String);
  });
  it("reports empty periods and missing employee records clearly", async () => {
    await assert.rejects(buildInsuranceWorkbook([], []), InsuranceReportValidationError);
    await assert.rejects(buildInsuranceWorkbook([line], []), /бүртгэл олдсонгүй/);
  });
});
