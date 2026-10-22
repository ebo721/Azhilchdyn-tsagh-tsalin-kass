import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { db, employeesTable, payrollAttendanceSnapshotsTable, payrollMonthBalancesTable, payrollMonthClosuresTable } from "@workspace/db";
import { GetPayrollResponse, GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { getPayrollAdvanceSummary, payrollSummaryTotals } from "./payroll-calc-helpers.js";
import { readMonthlyPayroll, rebaseLater } from "./payroll-balance-store.js";
import { assertPayrollOpeningAllows, latestPayrollOpening, PayrollOpeningConflict } from "./payroll-opening.js";
import { readSavedPayroll } from "./payroll-attendance-snapshot.js";
import { nextMonth } from "./date-utils.js";

/** The source lock serializes individual updates and preserves all other employee lines. */
export async function refreshEmployeePayroll(month: string, employeeId: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payroll-month-balances'))`);
    await tx.execute(sql`SET CONSTRAINTS payroll_employee_change IMMEDIATE`);
    await assertPayrollOpeningAllows(month, employeeId, tx);
    const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (!employee) throw new PayrollOpeningConflict("Ажилтан олдсонгүй.");
    const baseline = await latestPayrollOpening(tx);
    const start = baseline ? nextMonth(baseline.month) : employee.joinedAt.slice(0, 7);
    if (!baseline && start !== month) {
      throw new PayrollOpeningConflict("Эхний өглөг/авлагын үлдэгдлийг баталгаажуулна уу. Өмнөх бүх сарын ирцийг автоматаар татахгүй.");
    }
    const [ledgers, snapshots, closures] = await Promise.all([
      tx.select().from(payrollMonthBalancesTable).where(and(gt(payrollMonthBalancesTable.month, baseline?.month ?? ""), lte(payrollMonthBalancesTable.month, month)))
        .orderBy(asc(payrollMonthBalancesTable.month)),
      tx.select().from(payrollAttendanceSnapshotsTable).where(and(gt(payrollAttendanceSnapshotsTable.month, baseline?.month ?? ""), lte(payrollAttendanceSnapshotsTable.month, month))),
      tx.select().from(payrollMonthClosuresTable).where(lte(payrollMonthClosuresTable.month, month)),
    ]);
    if (closures.some(c => c.month === month)) throw new PayrollOpeningConflict("Цалингийн сар хаалттай. Админ эхлээд дахин нээнэ үү.");
    for (let m = start; m <= month; m = nextMonth(m)) {
      if (employee.joinedAt.slice(0, 7) > m || closures.some(c => c.month === m)) continue;
      const ledger = ledgers.find(l => l.month === m);
      const old = snapshots.find(s => s.month === m);
      const saved = old ? GetPayrollResponse.parse(old.payroll) : undefined;
      const savedLine = saved?.lines.find(l => l.employeeId === employeeId && l.calculationReady !== false);
      if (m !== month && ledger?.lines.some(l => l.employeeId === employeeId) && !ledger.dirtyEmployeeIds.includes(employeeId)) continue;
      const financialOnly = Boolean(savedLine && ledger && !ledger.earningsDirtyEmployeeIds.includes(employeeId));
      let payroll;
      if (financialOnly) {
        const live = await readSavedPayroll(m, tx);
        const line = live.lines.find(l => l.employeeId === employeeId)!;
        const entries = [...ledger!.lines.filter(l => l.employeeId !== employeeId), {
          employeeId, movement: Math.round((line.gross - line.deductions - line.paidAmount) * 100) / 100,
          balanceAmount: line.balanceAmount,
        }];
        const pending = ledger!.dirtyEmployeeIds.filter(id => id !== employeeId);
        await tx.update(payrollMonthBalancesTable).set({
          lines: entries, dirty: pending.length > 0, dirtyEmployeeIds: pending, updatedAt: new Date(),
        }).where(eq(payrollMonthBalancesTable.month, m));
        await rebaseLater(tx, m, entries);
        payroll = { ...live, lines: [line] };
      } else {
        payroll = await readMonthlyPayroll(m, tx, employeeId);
      }
      const advance = GetPayrollAdvanceResponse.parse(financialOnly && old
        ? old.advance : await getPayrollAdvanceSummary(m, tx, { ignoreApproval: true, employeeId }));
      const lines = [...(saved?.lines ?? []).filter(l => l.employeeId !== employeeId),
        ...payroll.lines.map(l => ({ ...l, calculationReady: true, attendanceNeedsRefresh: false, refreshMonths: [] }))];
      const oldAdvance = old ? GetPayrollAdvanceResponse.parse(old.advance) : undefined;
      const advanceLines = [...(oldAdvance?.lines ?? []).filter(l => l.employeeId !== employeeId),
        ...advance.lines.filter(l => l.employeeId === employeeId)];
      const mergedPayroll = { ...payroll, lines, ...payrollSummaryTotals(lines) };
      const mergedAdvance = { ...advance, lines: advanceLines, totalAmount: advanceLines.reduce((n, l) => n + l.advanceAmount, 0) };
      const pulledAt = financialOnly && old ? old.pulledAt : new Date();
      await tx.insert(payrollAttendanceSnapshotsTable).values({ month: m, payroll: mergedPayroll, advance: mergedAdvance, pulledAt })
        .onConflictDoUpdate({ target: payrollAttendanceSnapshotsTable.month, set: { payroll: mergedPayroll, advance: mergedAdvance, pulledAt } });
    }
    return {
      payroll: await readSavedPayroll(month, tx),
      advance: GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month, tx, { savedOnly: true })),
    };
  });
}
