import type { attendanceTable, employeesTable, employeeSalaryHistoryTable } from "@workspace/db";
import { weekdayDatesBetween } from "./route-shared.js";

/** Draft advances require active employment plus worked days or a dated salary guarantee. */
export function hasPayrollAdvanceEntitlement(
  employee: typeof employeesTable.$inferSelect,
  records: Array<typeof attendanceTable.$inferSelect>,
  history: Array<typeof employeeSalaryHistoryTable.$inferSelect>,
  periodStart: string, cutoff: string,
) {
  if (employee.status !== "active") return false;
  const start = employee.joinedAt > periodStart ? employee.joinedAt : periodStart;
  const end = employee.inactiveAt && employee.inactiveAt < cutoff ? employee.inactiveAt : cutoff;
  if (start > end) return false;
  if (records.some(record => record.employeeId === employee.id
    && ["present", "late"].includes(record.status) && String(record.date) >= start && String(record.date) <= end)) return true;
  const dated = history.filter(row => row.employeeId === employee.id)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return weekdayDatesBetween(start, end).some(date =>
    dated.length ? dated.find(row => row.effectiveFrom <= date)?.fullSalaryRegardlessAttendance === true
      : employee.fullSalaryRegardlessAttendance);
}
