import { and, asc, eq, sql } from "drizzle-orm";
import { db, employeesTable, payrollAttendanceSnapshotsTable, payrollAdjustmentsTable, payrollAdvanceApprovalsTable, payrollMonthBalancesTable } from "@workspace/db";
import { GetPayrollResponse, GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { PayrollBalancesNotReadyError, readMonthlyPayroll } from "./payroll-balance-store.js";
import { applyPayrollFinancials, getPayrollAdvanceSummary, payrollSummaryTotals } from "./payroll-calc-helpers.js";
import { previousMonth, money } from "./date-utils.js";

export class PayrollSnapshotMissingError extends Error {
  constructor(month: string) {
    super(`${month}: хадгалсан цалингийн тооцоо алга. “Цаг татах” товчийг дарж нэг удаа тооцоолно уу.`);
  }
}

/** Only this explicit action reads attendance and replaces saved earnings. */
export async function pullPayrollAttendance(month: string) {
  return db.transaction(async (tx) => {
    // Same order as payroll source writes: source lock, then financial balance lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    const payroll = await readMonthlyPayroll(month, tx);
    const advance = await getPayrollAdvanceSummary(month, tx, { ignoreApproval: true });
    const pulledAt = new Date();
    await tx.insert(payrollAttendanceSnapshotsTable).values({ month, payroll, advance, pulledAt })
      .onConflictDoUpdate({ target: payrollAttendanceSnapshotsTable.month, set: { payroll, advance, pulledAt } });
    const visibleAdvance = await getPayrollAdvanceSummary(month, tx, { savedOnly: true });
    return {
      payroll: GetPayrollResponse.parse({ ...payroll, attendancePulledAt: pulledAt.toISOString(), attendanceNeedsRefresh: false }),
      advance: GetPayrollAdvanceResponse.parse({ ...visibleAdvance, attendancePulledAt: pulledAt.toISOString() }),
    };
  });
}

/** Display cached earnings plus live financial movements; never reads attendance or writes. */
export async function readSavedPayroll(month: string) {
  return db.transaction(async (tx) => {
    const [snapshot] = await tx.select().from(payrollAttendanceSnapshotsTable).where(eq(payrollAttendanceSnapshotsTable.month, month));
    if (!snapshot) throw new PayrollSnapshotMissingError(month);
    const saved = GetPayrollResponse.parse(snapshot.payroll);
    const [adjustments, approvals, previous, dirty, employees] = await Promise.all([
      tx.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
      tx.select().from(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month)),
      tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, previousMonth(month))),
      tx.select({ month: payrollMonthBalancesTable.month }).from(payrollMonthBalancesTable)
        .where(and(eq(payrollMonthBalancesTable.dirty, true), sql`${payrollMonthBalancesTable.month} <= ${month}`))
        .orderBy(asc(payrollMonthBalancesTable.month)).limit(1),
      tx.select({ id: employeesTable.id, name: employeesTable.name, role: employeesTable.role, bankAccountNumber: employeesTable.bankAccountNumber }).from(employeesTable),
    ]);
    // A stale historical debt is not a valid opening balance. Ask for explicit repair,
    // never silently display a guessed carryover or read historical attendance in a GET.
    if (dirty[0] && dirty[0].month < month) throw new PayrollBalancesNotReadyError(month);
    const byEmployee = new Map(adjustments.map((row) => [row.employeeId, row]));
    const approvedLines = approvals[0] ? GetPayrollAdvanceResponse.shape.lines.parse(approvals[0].lines) : [];
    const paidAdvances = new Map(approvedLines.filter((line) => line.paid === true)
      .map((line) => [line.employeeId, Number(line.advanceAmount)]));
    const opening = new Map((previous[0]?.lines ?? []).map((row) => [row.employeeId, row.balanceAmount]));
    const reporting = new Map(employees.map((employee) => [employee.id, employee]));
    const lines = saved.lines.map((line) => ({
      ...line,
      ...(reporting.has(line.employeeId) ? {
        employeeName: reporting.get(line.employeeId)!.name,
        role: reporting.get(line.employeeId)!.role,
        bankAccountNumber: reporting.get(line.employeeId)!.bankAccountNumber ?? "",
      } : {}),
      ...applyPayrollFinancials(line, byEmployee.get(line.employeeId), money(paidAdvances.get(line.employeeId) ?? 0), opening.get(line.employeeId) ?? line.carryoverAmount),
    }));
    return GetPayrollResponse.parse({
      ...saved, ...payrollSummaryTotals(lines), lines,
      attendancePulledAt: snapshot.pulledAt.toISOString(), attendanceNeedsRefresh: dirty.length > 0,
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
