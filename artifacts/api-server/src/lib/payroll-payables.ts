import {
  db, employeesTable, payrollAttendanceSnapshotsTable, payrollMonthClosuresTable,
  payrollMonthBalancesTable, payrollAdjustmentsTable, payrollAdvanceApprovalsTable,
} from "@workspace/db";
import { GetPayrollResponse, GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { advancePaidAmount } from "./payroll-advance-installments.js";
import { lte } from "drizzle-orm";
import { applyPayrollFinancials } from "./payroll-calc-helpers.js";
import { currentMonth, money, previousMonth } from "./date-utils.js";
import { PayrollBalancesNotReadyError } from "./payroll-balance-store.js";
import type { Tx } from "./route-shared.js";

export type SavedDebtMonth = {
  month: string;
  date: string;
  closed: boolean;
  attendanceNeedsRefresh: boolean;
  invalid?: boolean;
  lines: Array<{ employeeId: number; employeeName?: string; balanceAmount: number }>;
};

/** A carryforward is the SAME debt, not another month's new payable. Select first, then filter. */
export function projectPayrollPayables(
  sources: SavedDebtMonth[], asOfMonth: string, names: ReadonlyMap<number, string> = new Map(),
) {
  const latest = new Map<number, { source: SavedDebtMonth; line: SavedDebtMonth["lines"][number] }>();
  for (const source of [...sources].sort((a, b) => a.month.localeCompare(b.month))) {
    if (source.month > asOfMonth) continue;
    for (const line of source.lines) latest.set(line.employeeId, { source, line });
  }
  const lines = [...latest.values()].flatMap(({ source, line }) => {
    if (source.invalid) throw new PayrollBalancesNotReadyError(source.month);
    if (!Number.isFinite(line.balanceAmount)) throw new Error("Invalid saved payroll balance");
    const remainingBalance = money(line.balanceAmount);
    // Same monthly ±1₮ tolerance as payroll; overpayments are NOT payables.
    if (remainingBalance <= 1) return [];
    return [{
      employeeId: line.employeeId,
      employeeName: names.get(line.employeeId) ?? line.employeeName ?? `Ажилтан #${line.employeeId}`,
      month: source.month, date: source.date, remainingBalance,
      attendanceNeedsRefresh: source.attendanceNeedsRefresh, closed: source.closed,
    }];
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "mn") || a.employeeId - b.employeeId);
  return {
    asOfMonth, hasSavedCalculation: sources.some(source => source.month <= asOfMonth), employeeCount: lines.length,
    totalOutstanding: money(lines.reduce((sum, line) => sum + line.remainingBalance, 0)), lines,
  };
}

/** Read-only projection of saved earnings plus live payments. Never pulls attendance or posts journals. */
export async function readPayrollPayables(connection?: Tx, asOfMonth = currentMonth()) {
  const read = async (tx: Tx) => {
    // Fixed number of bulk reads, not one readSavedPayroll call per historical month/employee.
    const [snapshots, closures, balances, adjustments, approvals, employees] = await Promise.all([
      tx.select().from(payrollAttendanceSnapshotsTable).where(lte(payrollAttendanceSnapshotsTable.month, asOfMonth)),
      tx.select().from(payrollMonthClosuresTable).where(lte(payrollMonthClosuresTable.month, asOfMonth)),
      tx.select().from(payrollMonthBalancesTable).where(lte(payrollMonthBalancesTable.month, asOfMonth)),
      tx.select().from(payrollAdjustmentsTable).where(lte(payrollAdjustmentsTable.month, asOfMonth)),
      tx.select().from(payrollAdvanceApprovalsTable).where(lte(payrollAdvanceApprovalsTable.month, asOfMonth)),
      tx.select({ id: employeesTable.id, name: employeesTable.name }).from(employeesTable),
    ]);
    const balanceByMonth = new Map(balances.map(row => [row.month, row]));
    const closedMonths = closures.map(row => row.month).sort();
    const hasHistoricalDirty = (month: string) => {
      const lastClosed = closedMonths.filter(closed => closed < month).at(-1) ?? "";
      return balances.some(balance => balance.dirty && balance.month < month && balance.month > lastClosed);
    };
    const adjustmentByEmployee = new Map(adjustments.map(row => [`${row.month}:${row.employeeId}`, row]));
    const advances = new Map<string, number>();
    for (const approval of approvals) {
      for (const line of GetPayrollAdvanceResponse.shape.lines.parse(approval.lines)) {
        advances.set(`${approval.month}:${line.employeeId}`, advancePaidAmount(line));
      }
    }
    const sources = new Map<string, SavedDebtMonth>(balances.map(row => [row.month, {
      month: row.month, date: row.periodEnd, closed: false,
      attendanceNeedsRefresh: false, invalid: row.dirty || hasHistoricalDirty(row.month), lines: row.lines,
    }]));
    for (const row of snapshots) {
      const saved = GetPayrollResponse.parse(row.payroll);
      const opening = new Map((balanceByMonth.get(previousMonth(row.month))?.lines ?? [])
        .map(line => [line.employeeId, line.balanceAmount]));
      sources.set(row.month, {
        month: row.month, date: saved.periodEnd, closed: false,
        attendanceNeedsRefresh: balanceByMonth.get(row.month)?.dirty ?? false, invalid: hasHistoricalDirty(row.month),
        lines: saved.lines.map(line => ({
          employeeId: line.employeeId, employeeName: line.employeeName,
          balanceAmount: applyPayrollFinancials(line, adjustmentByEmployee.get(`${row.month}:${line.employeeId}`),
            advances.get(`${row.month}:${line.employeeId}`) ?? 0, opening.get(line.employeeId) ?? line.carryoverAmount).balanceAmount,
        })),
      });
    }
    // Closed months are frozen, even if underlying sources are later touched.
    for (const row of closures) {
      const saved = GetPayrollResponse.parse(row.payroll);
      sources.set(row.month, {
        month: row.month, date: saved.periodEnd, closed: true, attendanceNeedsRefresh: false, lines: saved.lines,
      });
    }
    return projectPayrollPayables([...sources.values()], asOfMonth, new Map(employees.map(row => [row.id, row.name])));
  };
  return connection ? read(connection) : db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
}
