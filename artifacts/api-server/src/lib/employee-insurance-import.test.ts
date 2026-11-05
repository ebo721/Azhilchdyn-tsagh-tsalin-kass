import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import type { employeesTable } from "@workspace/db";
import { parseEmployeeInsuranceXlsx, EmployeeImportError } from "./employee-insurance-xlsx.js";
import { previewInsuranceRows, planEmployeeInsuranceUpdates, createEmployeeImportToken, readEmployeeImportToken, employeeRosterHash } from "./employee-insurance-import.js";
import { insuranceUploadHeaders } from "./social-insurance-report.js";

const sourceProfile = { givenName: "ТЕСТ", registrationNumber: "ТТ00123456", clanName: "УРГИЙН",
  parentName: "ЭЦГИЙН", insuranceTypeCode: "01001", occupationCode: "1120-11", citizenship: "Монгол", email: "" };
const source = { rowNumber: 2, name: "ТЕСТ", phone: "", profile: sourceProfile, issues: [] as string[] };
function employee(id = 1, changes: Partial<typeof employeesTable.$inferSelect> = {}): typeof employeesTable.$inferSelect {
  return { id, name: "Э.Тест", role: "Test", phone: "99000000", bankAccountNumber: "00001234", socialInsuranceProfile: null,
    employeeType: "office", salaryType: "monthly", baseSalary: 2_500_000, socialInsuranceSalary: 1_000_000,
    payrollTaxExempt: false, fullSalaryRegardlessAttendance: true, payFrequency: "twice", monthlyExpectedWorkDays: 0,
    status: "active", joinedAt: "2026-09-01", inactiveAt: null, ...changes };
}
async function xlsx(rows: unknown[][], intro = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  if (intro) sheet.addRow(["НДШ тайлан", "НДШ тайлан"]);
  sheet.addRow([...insuranceUploadHeaders]);
  rows.forEach(row => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const input = ["ТТ00123456", "УРГИЙН", "ЭЦГИЙН", "ТЕСТ", "01001", "1120-11", 9_000_000, 8_000_000, 1_000_000, 0, 0, 0, "Монгол", "", "empty"];

test("reads the supplied 15-column insurance format, preserves leading codes and ignores every salary value", async () => {
  const [row] = await parseEmployeeInsuranceXlsx(await xlsx([input], true));
  assert.equal(row.rowNumber, 3);
  assert.equal(row.profile.registrationNumber, "ТТ00123456");
  assert.equal(row.profile.insuranceTypeCode, "01001");
  assert.equal(row.profile.email, "");
  assert.deepEqual(Object.keys(row).sort(), ["issues", "name", "phone", "profile", "rowNumber"]);
  assert.deepEqual(row.issues, []);
});
test("bad or duplicate registrations and codes are reported per row rather than assigned automatically", async () => {
  const rows = await parseEmployeeInsuranceXlsx(await xlsx([input, [...input.slice(0, 4), "bad", ...input.slice(5)]]));
  assert.ok(rows.every(r => r.issues.some(i => /регистр давхардсан/.test(i))));
  assert.equal(previewInsuranceRows(rows, [employee()])[0].status, "invalid");
  await assert.rejects(parseEmployeeInsuranceXlsx(Buffer.from("invalid")), EmployeeImportError);
  await assert.rejects(parseEmployeeInsuranceXlsx(Buffer.alloc(1024 * 1024 + 1)), EmployeeImportError);
});
test("unique initial+name can match; parent names distinguish different people with the same given name", () => {
  assert.equal(previewInsuranceRows([source], [employee()])[0].suggestedEmployeeId, 1);
  const roster = [employee(1, { socialInsuranceProfile: { ...sourceProfile, parentName: "ӨӨР" } }),
    employee(2, { socialInsuranceProfile: { ...sourceProfile, registrationNumber: "" } })];
  const row = previewInsuranceRows([{ ...source, profile: { ...sourceProfile, registrationNumber: "" } }], roster)[0];
  assert.equal(row.suggestedEmployeeId, 2);
});
test("identical parent/given names always ask, even if one registration matches exactly", () => {
  const roster = [employee(1, { socialInsuranceProfile: sourceProfile }), employee(2)];
  const row = previewInsuranceRows([source], roster)[0];
  assert.equal(row.status, "ambiguous");
  assert.equal(row.suggestedEmployeeId, null);
  assert.equal(row.candidates.length, 2);
});
test("conflicting saved registration and mismatching register-owned name require explicit review", () => {
  const row = previewInsuranceRows([source], [employee(1, { socialInsuranceProfile: { ...sourceProfile, registrationNumber: "АА00123456" } })])[0];
  assert.equal(row.status, "conflict");
  assert.equal(row.suggestedEmployeeId, null);
  const wrongName = previewInsuranceRows([source], [employee(1, { name: "Ө.ӨӨР", socialInsuranceProfile: { ...sourceProfile, givenName: "ӨӨР", parentName: "ӨӨР" } })])[0];
  assert.equal(wrongName.status, "conflict");
});
test("blank Excel cells never erase saved values; only identity metadata and phone can change", () => {
  const roster = [employee(1, { socialInsuranceProfile: { ...sourceProfile, clanName: "ХУУЧИН", email: "fixture@example.com" } })];
  const before = structuredClone(roster);
  const plan = planEmployeeInsuranceUpdates([source], [{ rowNumber: 2, employeeId: 1 }], roster);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].phone, "99000000");
  assert.equal(plan.updates[0].socialInsuranceProfile.email, "fixture@example.com");
  assert.deepEqual(Object.keys(plan.updates[0]).sort(), ["employeeId", "phone", "socialInsuranceProfile"]);
  assert.deepEqual(roster, before);
  const repeated = planEmployeeInsuranceUpdates([source], [{ rowNumber: 2, employeeId: 1 }], [{ ...roster[0], ...plan.updates[0] }]);
  assert.equal(repeated.unchanged, 1);
});
test("every row requires a decision; invalid rows must be skipped and a person cannot receive two rows", () => {
  assert.throws(() => planEmployeeInsuranceUpdates([source], [], [employee()]), EmployeeImportError);
  assert.throws(() => planEmployeeInsuranceUpdates([source, { ...source, rowNumber: 3 }], [
    { rowNumber: 2, employeeId: 1 }, { rowNumber: 3, employeeId: 1 },
  ], [employee()]), EmployeeImportError);
  assert.throws(() => planEmployeeInsuranceUpdates([{ ...source, issues: ["bad"] }], [{ rowNumber: 2, employeeId: 1 }], [employee()]), EmployeeImportError);
  assert.equal(planEmployeeInsuranceUpdates([{ ...source, issues: ["bad"] }], [{ rowNumber: 2, employeeId: null }], [employee()]).skipped, 1);
});
test("a manual unmatched choice is allowed but cannot steal another employee's registration", () => {
  const roster = [employee(1), employee(2, { socialInsuranceProfile: { ...sourceProfile, givenName: "ӨӨР" } })];
  assert.throws(() => planEmployeeInsuranceUpdates([source], [{ rowNumber: 2, employeeId: 1 }], roster), /Регистр өөр ажилтанд/);
  assert.equal(planEmployeeInsuranceUpdates([source], [{ rowNumber: 2, employeeId: 2 }], roster).updates.length, 1);
});
test("preview tokens are bound to actor, expire, reject tampering, and hash metadata not salary", t => {
  const roster = [employee()];
  const token = createEmployeeImportToken([source], roster, 1);
  assert.deepEqual(readEmployeeImportToken(token, 1).rows, [source]);
  assert.throws(() => readEmployeeImportToken(token, 2), EmployeeImportError);
  assert.throws(() => readEmployeeImportToken(token + "x", 1), EmployeeImportError);
  assert.equal(employeeRosterHash(roster), employeeRosterHash([{ ...roster[0], baseSalary: 999 }]));
  assert.notEqual(employeeRosterHash(roster), employeeRosterHash([{ ...roster[0], phone: "changed" }]));
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 21 * 60 * 1000);
  assert.throws(() => readEmployeeImportToken(token, 1), EmployeeImportError);
});
