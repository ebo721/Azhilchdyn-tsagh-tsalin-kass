import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { employeesTable, payrollAdjustmentsTable, payrollAdvanceApprovalsTable, payrollAttendanceSnapshotsTable, payrollMonthBalancesTable, payrollMonthClosuresTable, payrollScheduleSettingsTable } from "@workspace/db";
import { GetPayrollResponse, GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { applyPayrollFinancials, payrollPeriod, payrollSummaryTotals } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule, type Tx } from "./route-shared.js";
import { nextMonth, previousMonth, money } from "./date-utils.js";
import { latestPayrollOpening } from "./payroll-opening.js";
import { emptyPayrollEarnings } from "./payroll-empty-line.js";

/** Saved earnings only. No attendance reads and no database writes. */
export async function readSelectivePayroll(month: string, tx: Tx) {
  const baseline = await latestPayrollOpening(tx);
  if (!baseline || month <= baseline.month) return null;
  const [snapshots, schedules, employees, adjustments, approvals, ledgers, previous, closed] = await Promise.all([
    tx.select().from(payrollAttendanceSnapshotsTable).where(eq(payrollAttendanceSnapshotsTable.month, month)),
    tx.select().from(payrollScheduleSettingsTable).where(lte(payrollScheduleSettingsTable.effectiveFromMonth, month))
      .orderBy(desc(payrollScheduleSettingsTable.effectiveFromMonth)).limit(1),
    tx.select().from(employeesTable).orderBy(asc(employeesTable.id)),
    tx.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
    tx.select().from(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month)),
    tx.select({ month: payrollMonthBalancesTable.month, dirtyIds: payrollMonthBalancesTable.dirtyEmployeeIds,
      lines: payrollMonthBalancesTable.lines,
      employeeIds: sql<number[]>`ARRAY(SELECT (line->>'employeeId')::integer FROM jsonb_array_elements(${payrollMonthBalancesTable.lines}) AS line)` })
      .from(payrollMonthBalancesTable).where(and(gt(payrollMonthBalancesTable.month, baseline.month), lte(payrollMonthBalancesTable.month, month))),
    tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, previousMonth(month))),
    tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable).where(lte(payrollMonthClosuresTable.month, month)),
  ]);
  const schedule = schedules[0] ?? { id: 0, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: new Date(0) };
  const period = payrollPeriod(month, schedule);
  const snapshot = snapshots[0] ? GetPayrollResponse.parse(snapshots[0].payroll) : undefined;
  const saved = new Map(snapshot?.lines.map(l => [l.employeeId, l]));
  const lastSavedBalance = (employeeId: number) =>
    previous[0]?.lines.find(l => l.employeeId === employeeId)?.balanceAmount
    ?? [...ledgers].filter(l => l.month < month).reverse()
      .flatMap(l => l.lines.filter(line => line.employeeId === employeeId))
      .at(0)?.balanceAmount
    ?? baseline.lines.find(l => l.employeeId === employeeId)?.balanceAmount
    ?? 0;
  const byMonth = new Map(ledgers.map(l => [l.month, l]));
  const closedMonths = new Set(closed.map(c => c.month));
  const advanceLines = approvals[0] ? GetPayrollAdvanceResponse.shape.lines.parse(approvals[0].lines) : [];
  const paidAdvances = new Map(advanceLines.filter(l => l.paid).map(l => [l.employeeId, l.advanceAmount]));
  const rows = employees.filter(e => (e.joinedAt <= period.periodEnd && (!e.inactiveAt || e.inactiveAt >= period.periodStart))
    || saved.has(e.id) || Number(lastSavedBalance(e.id)) !== 0);
  const lines = rows.map(employee => {
    const old = saved.get(employee.id);
    const refreshMonths: string[] = [];
    for (let m = nextMonth(baseline.month); m <= month; m = nextMonth(m)) {
      if (closedMonths.has(m)) continue;
      const ledger = byMonth.get(m);
      // Financial carryovers of ended employees still require valid records.
      if (employee.joinedAt.slice(0, 7) <= m
        && (!ledger?.employeeIds.includes(employee.id) || ledger.dirtyIds.includes(employee.id))) refreshMonths.push(m);
    }
    const calculationReady = Boolean(old && old.calculationReady !== false);
    if (!calculationReady && !refreshMonths.includes(month)) refreshMonths.push(month);
    const base = old ?? emptyPayrollEarnings(employee);
    return {
      ...base, employeeName: employee.name, role: employee.role, bankAccountNumber: employee.bankAccountNumber ?? "",
      ...applyPayrollFinancials(base, adjustments.find(a => a.employeeId === employee.id),
        money(paidAdvances.get(employee.id) ?? 0), lastSavedBalance(employee.id)),
      calculationReady, refreshMonths, attendanceNeedsRefresh: refreshMonths.length > 0,
      openingBalanceReviewRequired: baseline.reviewEmployeeIds.includes(employee.id),
    };
  });
  return GetPayrollResponse.parse({
    month, ...period, schedule, ...payrollSummaryTotals(lines), lines, openingBalanceMonth: baseline.month,
    attendancePulledAt: snapshots[0]?.pulledAt.toISOString(), closedAt: null, closedBy: null,
    attendanceNeedsRefresh: lines.some(l => l.attendanceNeedsRefresh || l.openingBalanceReviewRequired),
  });
}
