import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { attendanceTable, db, employeesTable, employeeSalaryHistoryTable, payrollMonthClosuresTable } from "@workspace/db";
import { GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { getPayrollAdvanceSummary } from "./payroll-calc-helpers.js";
import { hasPayrollAdvanceEntitlement } from "./payroll-advance-eligibility.js";
import { money } from "./date-utils.js";
import type { DbClient } from "./route-shared.js";

/** Read-only roster projection; approved payments and saved earnings are never rewritten. */
export async function readPayrollAdvanceRegister(month: string, connection: DbClient = db, ignoreApproval = false) {
  const summary = GetPayrollAdvanceResponse.parse(
    await getPayrollAdvanceSummary(month, connection, { savedOnly: true, ignoreApproval }));
  if (!summary.lines.length) return summary;
  const ids = summary.lines.map(line => line.employeeId);
  const [employees, closed] = await Promise.all([
    connection.select().from(employeesTable).where(inArray(employeesTable.id, ids)),
    connection.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(eq(payrollMonthClosuresTable.month, month)),
  ]);
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  const enriched = summary.lines.map(line => ({
    ...line, bankAccountNumber: byId.get(line.employeeId)?.bankAccountNumber ?? line.bankAccountNumber ?? "",
  }));
  // A closed month's roster must not depend on today's employment status.
  if (closed.length) return GetPayrollAdvanceResponse.parse({ ...summary, lines: enriched });
  const [records, history] = await Promise.all([
    connection.select().from(attendanceTable).where(and(
      inArray(attendanceTable.employeeId, ids), gte(attendanceTable.date, summary.periodStart),
      lte(attendanceTable.date, summary.advancePeriodEnd))),
    connection.select().from(employeeSalaryHistoryTable).where(inArray(employeeSalaryHistoryTable.employeeId, ids)),
  ]);
  const lines = enriched.filter(line => {
    const employee = byId.get(line.employeeId);
    return employee && hasPayrollAdvanceEntitlement(employee, records, history, summary.periodStart, summary.advancePeriodEnd);
  });
  return GetPayrollAdvanceResponse.parse({
    ...summary, lines, totalAmount: money(lines.reduce((sum, line) => sum + line.advanceAmount, 0)),
  });
}
