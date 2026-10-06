import ExcelJS from "exceljs";
import type { employeesTable } from "@workspace/db";

export const insuranceUploadHeaders = [
  "Регистрийн дугаар", "Ургийн овог", "Эцэг/эхийн нэр", "Нэр",
  "Даатгуулагчийн төрөл", "Ажил мэргэжлийн ангилал",
  "Цалин хөлс, түүнтэй адилтгах орлого", "Үндсэн цалин",
  "Шагнал урамшуулал", "Нэмэгдэл, нэмэгдэл хөлс",
  "Хоол, унааны үнийн хөнгөлөлт",
  "Түлээ, нүүрсний үнийн хөнгөлөлт, адилтгах орлого",
  "Иргэншил", "Харилцах утасны дугаар", "Цахим шуудангийн хаяг",
] as const;

type Employee = typeof employeesTable.$inferSelect;
type InsuredPayrollLine = { employeeId: number; socialInsuranceSalary: number };
export class InsuranceReportValidationError extends Error {}

/** Only real insured payroll rows are included. Never copy the template's sample people. */
export async function buildInsuranceWorkbook(lines: InsuredPayrollLine[], employees: Employee[]) {
  const byId = new Map(employees.map(e => [e.id, e]));
  const included = lines.filter(line => line.socialInsuranceSalary > 0);
  const problems: string[] = [];
  const rows: Array<Array<string | number>> = [];
  const registrationNumbers = new Set<string>();
  for (const line of included) {
    const employee = byId.get(line.employeeId);
    if (!employee) throw new InsuranceReportValidationError("Ажилтны бүртгэл олдсонгүй. Тайланг дахин татна уу.");
    const profile = employee.socialInsuranceProfile;
    const missing = [
      ["registrationNumber", "Регистр"], ["clanName", "Ургийн овог"],
      ["parentName", "Эцэг/эхийн нэр"], ["insuranceTypeCode", "Даатгуулагчийн төрөл"],
      ["occupationCode", "Ажил мэргэжлийн код"], ["citizenship", "Иргэншил"],
    ].filter(([key]) => !profile?.[key as keyof NonNullable<typeof profile>]?.trim()).map(([, label]) => label);
    if (!employee.name.trim()) missing.push("Нэр");
    if (profile?.insuranceTypeCode && !/^\d{5}$/.test(profile.insuranceTypeCode.trim())) missing.push("Даатгуулагчийн 5 оронтой код");
    if (profile?.occupationCode && !/^\d{4}-\d{2}$/.test(profile.occupationCode.trim())) missing.push("Ажил мэргэжлийн код (0000-00)");
    const registration = profile?.registrationNumber.trim().toUpperCase() ?? "";
    if (registrationNumbers.has(registration) && registration) missing.push("Давхардсан регистр");
    registrationNumbers.add(registration);
    if (missing.length) {
      problems.push(`${employee.name}: ${missing.join(", ")}`);
      continue;
    }
    const p = profile!;
    const amount = Math.round(line.socialInsuranceSalary * 100) / 100;
    rows.push([
      registration, p.clanName.trim(), p.parentName.trim(), employee.name.trim(),
      p.insuranceTypeCode.trim(), p.occupationCode.trim(), amount, amount,
      0, 0, 0, 0, p.citizenship.trim(), employee.phone.trim(), p.email.trim() || "empty",
    ]);
  }
  if (problems.length) throw new InsuranceReportValidationError(
    `НДШ тайлан татахаас өмнө Ажилтнууд хэсэгт мэдээллийг гүйцээнэ үү:\n${problems.join("\n")}`,
  );
  if (!rows.length) throw new InsuranceReportValidationError("Сонгосон сард НДШ тооцох цалинтай ажилтан байхгүй байна.");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow([...insuranceUploadHeaders]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const added = sheet.addRow(row);
    for (const col of [1, 2, 3, 4, 5, 6, 13, 14, 15]) added.getCell(col).numFmt = "@";
    for (const col of [7, 8, 9, 10, 11, 12]) added.getCell(col).numFmt = "0.00";
    added.getCell(7).value = { formula: `H${added.number}+I${added.number}+J${added.number}+K${added.number}+L${added.number}`, result: Number(row[6]) };
  }
  sheet.columns.forEach((col, index) => { col.width = index >= 6 && index <= 11 ? 22 : 25; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
