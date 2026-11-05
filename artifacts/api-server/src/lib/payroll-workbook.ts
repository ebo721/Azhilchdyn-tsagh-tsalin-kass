import ExcelJS from "exceljs";
import type { employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import type { PayrollSummary } from "@workspace/api-zod";
import { weekdayDatesBetween } from "./route-shared.js";
import { money } from "./date-utils.js";

type Employee = typeof employeesTable.$inferSelect;
type History = typeof employeeSalaryHistoryTable.$inferSelect;
export class PayrollWorkbookError extends Error {
  constructor(message: string, public status: 409 | 422) { super(message); }
}
export const payrollWorkbookHeaders = [
  "№", "Ургийн овог", "Эцэг/эхийн нэр", "Нэр", "Регистрийн дугаар", "Албан тушаал",
  "Ажилтны төрөл", "Цалингийн төрөл", "Үндсэн цалин (тариф)", "Ажилласан хоног",
  "Ажиллах ёстой хоног", "Ажилласан цаг", "Бодсон нийт цалин", "НДШ тооцох цалин",
  "НДШ (ажилтан)", "ХХОАТ", "ХХОАТ хөнгөлөлт", "Олгосон урьдчилгаа",
  "Бусад суутгал", "Гарт олгох", "Олгосон цалин", "Өмнөх сарын өглөг",
  "Өмнөх сарын авлага", "Олгох үлдэгдэл", "Илүү олголт", "Тайлбар",
] as const;

function dayBefore(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
const employeeTypeLabel = (type: string) => type === "office" ? "Оффис" : "Ээлж";
const salaryTypeLabel = (type: string) => type === "monthly" ? "Сарын" : "Өдрийн";

/** Saved earnings only. Reporting metadata/rates are dated; no attendance reads or writes. */
export async function buildPayrollWorkbook(summary: PayrollSummary, employees: Employee[], history: History[]) {
  if (!summary.lines.length) throw new PayrollWorkbookError("Сонгосон сард хадгалсан цалингийн мөр байхгүй байна.", 422);
  const stale = summary.lines.filter(line => line.calculationReady === false
    || line.attendanceNeedsRefresh || line.openingBalanceReviewRequired);
  if (stale.length || summary.attendanceNeedsRefresh) throw new PayrollWorkbookError(
    `Тайлан татахаас өмнө цалингийн бодолт, өмнөх үлдэгдлийг шинэчилж баталгаажуулна уу.${stale.length ? `\n${stale.map(l => l.employeeName).join(", ")}` : ""}`, 409,
  );
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Staff Ops";
  const sheet = workbook.addWorksheet("Цалингийн хүснэгт", {
    views: [{ state: "frozen", xSplit: 6, ySplit: 4 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.mergeCells(1, 1, 1, payrollWorkbookHeaders.length);
  sheet.getCell("A1").value = `${summary.month} сарын цалингийн хүснэгт`;
  sheet.getCell("A1").font = { bold: true, size: 16 };
  sheet.mergeCells(2, 1, 2, payrollWorkbookHeaders.length);
  sheet.getCell("A2").value = `Бодох хугацаа: ${summary.periodStart} – ${summary.periodEnd}. Хадгалсан бодолт; урьдчилгаа, олголтыг дахин бодохгүй.`;
  sheet.mergeCells(3, 1, 3, payrollWorkbookHeaders.length);
  sheet.getCell("A3").value = "Үндсэн тариф, ажиллах ёстой хоног: хугацааны сүүлийн хүчинтэй тохиргоо. Өөрчлөлтийг «Тохиргооны түүх» хуудаснаас харна. Гарт олгох дүнд өмнөх үлдэгдэл ороогүй.";
  const header = sheet.getRow(4);
  header.values = [...payrollWorkbookHeaders];
  header.height = 42;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D6156" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const settings = workbook.addWorksheet("Тохиргооны түүх", { views: [{ state: "frozen", ySplit: 1 }] });
  settings.addRow(["Нэр", "Хүчинтэй эхлэх", "Хүчинтэй дуусах", "Ажилтны төрөл", "Цалингийн төрөл",
    "Үндсэн тариф", "НДШ сарын суурь", "Сард ажиллах ээлжийн хоног", "НДШ/ХХОАТ-аас чөлөөлөгдсөн", "Бүтэн цалингийн нөхцөл"]);
  settings.getRow(1).font = { bold: true };
  settings.getRow(1).alignment = { wrapText: true };
  settings.getRow(1).height = 42;
  const byEmployee = new Map(employees.map(employee => [employee.id, employee]));
  const historyByEmployee = new Map<number, History[]>();
  for (const row of history) {
    const rows = historyByEmployee.get(row.employeeId) ?? [];
    rows.push(row);
    historyByEmployee.set(row.employeeId, rows);
  }
  for (const rows of historyByEmployee.values()) rows.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  summary.lines.forEach((line, index) => {
    const employee = byEmployee.get(line.employeeId);
    const profile = employee?.socialInsuranceProfile;
    const eligibleStart = employee && employee.joinedAt > summary.periodStart ? employee.joinedAt : summary.periodStart;
    const eligibleEnd = employee?.inactiveAt && employee.inactiveAt < summary.periodEnd ? employee.inactiveAt : summary.periodEnd;
    const employeeHistory = historyByEmployee.get(line.employeeId) ?? [];
    const salary = employeeHistory.filter(row => row.effectiveFrom <= eligibleEnd).at(-1);
    const notes: string[] = [];
    if (!profile?.parentName?.trim()) notes.push("Эцэг/эхийн нэр дутуу");
    if (!profile?.registrationNumber?.trim()) notes.push("Регистр дутуу");
    if (!salary) notes.push("Хугацаанд хүчинтэй тарифын түүх алга");
    const intervals = employeeHistory.flatMap((row, i) => {
      const start = row.effectiveFrom > eligibleStart ? row.effectiveFrom : eligibleStart;
      const next = employeeHistory[i + 1]?.effectiveFrom;
      const end = next && next <= eligibleEnd ? dayBefore(next) : eligibleEnd;
      return start <= end ? [{ row, start, end }] : [];
    });
    if (intervals.length > 1) notes.push("Сарын дундуур тохиргоо өөрчлөгдсөн");
    let expected: number | string = "";
    if (eligibleStart > eligibleEnd) expected = 0;
    else if (salary?.employeeType === "office") expected = weekdayDatesBetween(eligibleStart, eligibleEnd).length;
    else if (salary && Number.isInteger(salary.monthlyExpectedWorkDays) && salary.monthlyExpectedWorkDays > 0) expected = salary.monthlyExpectedWorkDays;
    else notes.push("Ажиллах ёстой ээлжийн хоног тохируулаагүй");
    const row = sheet.addRow([
      index + 1, profile?.clanName?.trim() ?? "", profile?.parentName?.trim() ?? "",
      line.employeeName, profile?.registrationNumber?.trim().toUpperCase() ?? "", line.role,
      salary ? employeeTypeLabel(salary.employeeType) : "", salary ? salaryTypeLabel(salary.salaryType) : "",
      salary ? Number(salary.baseSalary) : "", line.daysWorked, expected, line.hours, line.gross,
      line.socialInsuranceSalary, line.socialInsurance, line.incomeTax, line.taxRelief, line.advanceAmount,
      line.manualDeduction, money(Math.max(0, line.gross - line.deductions)), line.paidAmount,
      money(Math.max(0, line.carryoverAmount)), money(Math.max(0, -line.carryoverAmount)),
      line.remainingAmount, line.overpaidAmount, notes.join("; "),
    ]);
    for (let column = 2; column <= 8; column++) row.getCell(column).numFmt = "@";
    for (let column = 9; column <= 25; column++) row.getCell(column).numFmt = "#,##0.00";
    if (index % 2 === 1) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F6F4" } }; });
    for (const { row: rate, start, end } of intervals) {
      const added = settings.addRow([line.employeeName, start, end, employeeTypeLabel(rate.employeeType), salaryTypeLabel(rate.salaryType),
        Number(rate.baseSalary), Number(rate.socialInsuranceSalary), rate.employeeType === "shift" ? rate.monthlyExpectedWorkDays : "",
        rate.payrollTaxExempt ? "Тийм" : "Үгүй", rate.fullSalaryRegardlessAttendance ? "Тийм" : "Үгүй"]);
      added.getCell(6).numFmt = "#,##0.00";
      added.getCell(7).numFmt = "#,##0.00";
    }
  });
  const last = sheet.rowCount;
  const totals = sheet.addRow(["Нийт"]);
  totals.font = { bold: true };
  for (const column of [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
    const letter = sheet.getColumn(column).letter;
    const sum = summary.lines.reduce((total, _, index) => total + Number(sheet.getRow(index + 5).getCell(column).value), 0);
    totals.getCell(column).value = { formula: `SUM(${letter}5:${letter}${last})`, result: money(sum) };
    totals.getCell(column).numFmt = "#,##0.00";
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: payrollWorkbookHeaders.length } };
  sheet.columns.forEach((column, i) => { column.width = i === 0 ? 6 : i === 25 ? 55 : i < 6 ? 24 : 20; });
  sheet.pageSetup.printTitlesRow = "1:4";
  settings.autoFilter = `A1:J${settings.rowCount}`;
  settings.columns.forEach(column => { column.width = 25; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
