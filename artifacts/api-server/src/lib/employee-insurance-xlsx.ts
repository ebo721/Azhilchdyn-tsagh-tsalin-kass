import ExcelJS from "exceljs";
import type { SocialInsuranceProfile } from "@workspace/api-zod";

export type InsuranceImportSource = { rowNumber: number; name: string; phone: string; profile: SocialInsuranceProfile; issues: string[] };
export class EmployeeImportError extends Error {
  constructor(message: string, public status: 409 | 422 = 422) { super(message); }
}
export const maxEmployeeImportBytes = 1024 * 1024;
const headers = ["Регистрийн дугаар", "Ургийн овог", "Эцэг/эхийн нэр", "Нэр"] as const;
const normalizeHeader = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Import identity/reporting fields only, never the template's salary columns. */
export async function parseEmployeeInsuranceXlsx(buffer: Buffer): Promise<InsuranceImportSource[]> {
  if (!buffer.length || buffer.length > maxEmployeeImportBytes) throw new EmployeeImportError("Excel файлын хэмжээ 1 MB-аас ихгүй байна.");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); }
  catch { throw new EmployeeImportError("Excel файл уншигдсангүй. НДШ-ийн .xlsx загварыг сонгоно уу."); }
  let found: { sheet: ExcelJS.Worksheet; headerRow: number; columns: Map<string, number> } | undefined;
  for (const sheet of workbook.worksheets) {
    for (let row = 1; row <= Math.min(sheet.rowCount, 30); row++) {
      const columns = new Map<string, number>();
      let duplicate = false;
      sheet.getRow(row).eachCell((cell, col) => {
        const key = normalizeHeader(cell.text);
        if (columns.has(key)) duplicate = true;
        columns.set(key, col);
      });
      if (headers.every(header => columns.has(normalizeHeader(header)))) {
        if (duplicate) throw new EmployeeImportError("НДШ хүснэгтийн баганын нэр давхардсан байна.");
        if (found) throw new EmployeeImportError("НДШ-ийн хүснэгт олон хуудсанд байна. Нэг хүснэгттэй файл сонгоно уу.");
        found = { sheet, headerRow: row, columns };
        break;
      }
    }
  }
  if (!found) throw new EmployeeImportError("«Регистрийн дугаар», «Ургийн овог», «Эцэг/эхийн нэр», «Нэр» баганууд олдсонгүй.");
  const { sheet, headerRow, columns } = found;
  if (sheet.rowCount - headerRow > 5000) throw new EmployeeImportError("Excel файлд хэт олон мөр байна. Зөвхөн ажилтны мэдээлэлтэй мөрүүдийг үлдээнэ үү.");
  const results: InsuranceImportSource[] = [];
  for (let number = headerRow + 1; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const text = (label: string) => {
      const col = columns.get(normalizeHeader(label));
      return col ? row.getCell(col).text.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
    };
    const name = text("Нэр");
    const profile: SocialInsuranceProfile = {
      givenName: name, registrationNumber: text("Регистрийн дугаар").replace(/\s/g, "").toUpperCase(),
      clanName: text("Ургийн овог"), parentName: text("Эцэг/эхийн нэр"),
      insuranceTypeCode: text("Даатгуулагчийн төрөл"), occupationCode: text("Ажил мэргэжлийн ангилал"),
      citizenship: text("Иргэншил"), email: text("Цахим шуудангийн хаяг"),
    };
    const phone = text("Харилцах утасны дугаар");
    if (![name, phone, ...Object.values(profile)].some(Boolean)) continue;
    const issues: string[] = [];
    if (!name) issues.push("Нэр дутуу");
    if (name.length > 100 || profile.clanName.length > 100 || profile.parentName.length > 100) issues.push("Овог/нэр 100 тэмдэгтээс урт");
    if (profile.registrationNumber && !/^[А-ЯӨҮЁ]{2}\d{8}$/u.test(profile.registrationNumber)) issues.push("Регистр 2 кирилл үсэг, 8 цифр байх ёстой");
    if (profile.insuranceTypeCode && /^\d{1,5}$/.test(profile.insuranceTypeCode)) profile.insuranceTypeCode = profile.insuranceTypeCode.padStart(5, "0");
    if (profile.insuranceTypeCode && !/^\d{5}$/.test(profile.insuranceTypeCode)) issues.push("Даатгуулагчийн код 5 цифр байх ёстой");
    if (profile.occupationCode && !/^\d{4}-\d{2}$/.test(profile.occupationCode)) issues.push("Ажил мэргэжлийн код 0000-00 хэлбэртэй байна");
    if (profile.email.toLowerCase() === "empty") profile.email = "";
    if (profile.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) || profile.email.length > 200)) issues.push("Цахим шуудан буруу");
    if (phone.length > 50 || profile.citizenship.length > 100) issues.push("Холбоо барих мэдээлэл хэт урт");
    results.push({ rowNumber: number, name, phone, profile, issues });
    if (results.length > 500) throw new EmployeeImportError("Нэг удаад 500 хүртэл ажилтны мэдээлэл уншуулна.");
  }
  if (!results.length) throw new EmployeeImportError("Excel файлд ажилтны мэдээлэл алга.");
  const counts = new Map<string, number>();
  for (const row of results) if (row.profile.registrationNumber) counts.set(row.profile.registrationNumber, (counts.get(row.profile.registrationNumber) ?? 0) + 1);
  for (const row of results) if ((counts.get(row.profile.registrationNumber) ?? 0) > 1) row.issues.push("Файл дотор регистр давхардсан");
  return results;
}
