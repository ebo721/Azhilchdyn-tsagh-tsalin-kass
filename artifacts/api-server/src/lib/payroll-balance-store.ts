import { and, asc, eq, gt, lt, lte, sql } from "drizzle-orm";
import {
  db, employeesTable, employeeSalaryHistoryTable, attendanceTable, payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable, payrollMonthBalancesTable, payrollMonthClosuresTable, type PayrollBalanceEntry,
} from "@workspace/db";
import { calculatePayrollMonth, getPayrollSchedule, payrollPeriod } from "./payroll-calc-helpers.js";
import { daysInMonth, money, nextMonth, previousMonth } from "./date-utils.js";
import type { PayrollCalculationData, Tx } from "./route-shared.js";
import { latestPayrollOpening, assertPayrollOpeningAllows } from "./payroll-opening.js";
import { emptyPayrollEarnings } from "./payroll-empty-line.js";
import { applyPayrollFinancials } from "./payroll-calc-helpers.js";

export class PayrollBalancesNotReadyError extends Error {
  constructor(public month: string) {
    super(`${month}: өмнөх сарын цалингийн авлага/өглөг бэлтгэгдээгүй эсвэл засагдсан байна. “Өмнөх үлдэгдэл шинэчлэх” товчийг дарна уу.`);
  }
}

const lockBalances = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payroll-month-balances'))`);

export function closingBalances(
  movements: Array<Pick<PayrollBalanceEntry, "employeeId" | "movement">>,
  opening: Array<Pick<PayrollBalanceEntry, "employeeId" | "balanceAmount">>,
): PayrollBalanceEntry[] {
  const balances = new Map(opening.map(line => [line.employeeId, line.balanceAmount]));
  const entries = [...movements, ...opening.filter(line => line.balanceAmount !== 0
    && !movements.some(m => m.employeeId === line.employeeId)).map(line => ({ ...line, movement: 0 }))];
  return entries.map(line => {
    const amount = money(line.movement + (balances.get(line.employeeId) ?? 0));
    return { ...line, balanceAmount: Math.abs(amount) <= 1 ? 0 : amount };
  });
}

async function loadMonth(tx: Tx, month: string, common?: Pick<PayrollCalculationData, "allEmployees" | "salaryHistory">, employeeId?: number) {
  const schedule = await getPayrollSchedule(month, tx);
  const period = payrollPeriod(month, schedule);
  const [allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals] = await Promise.all([
    common ? Promise.resolve(common.allEmployees) : tx.select().from(employeesTable).where(employeeId ? eq(employeesTable.id, employeeId) : undefined),
    // Keep future rows visible so salaryAt can distinguish a missing historical
    // baseline from a legacy employee with no history. Filtering them out would
    // allow today's salary/tax settings to leak back into the requested month.
    common ? Promise.resolve(common.salaryHistory) : tx.select().from(employeeSalaryHistoryTable).where(employeeId ? eq(employeeSalaryHistoryTable.employeeId, employeeId) : undefined),
    tx.select().from(attendanceTable).where(and(sql`${attendanceTable.date} BETWEEN ${period.periodStart}::date AND ${period.periodEnd}::date`,
      employeeId ? eq(attendanceTable.employeeId, employeeId) : undefined)),
    tx.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
    tx.select().from(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month)),
  ]);
  return { schedule, period, data: { allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals } };
}

async function openingBalances(tx: Tx, month: string, employees: PayrollCalculationData["allEmployees"], employeeId?: number) {
  const prev = previousMonth(month);
  const baseline = await latestPayrollOpening(tx);
  const [dirty, previous] = await Promise.all([
    tx.select({ month: payrollMonthBalancesTable.month }).from(payrollMonthBalancesTable)
      .where(and(lt(payrollMonthBalancesTable.month, month), eq(payrollMonthBalancesTable.dirty, true),
        baseline ? gt(payrollMonthBalancesTable.month, baseline.month) : undefined,
        employeeId ? sql`${payrollMonthBalancesTable.dirtyEmployeeIds} @> ${JSON.stringify([employeeId])}::jsonb` : undefined,
        sql`${payrollMonthBalancesTable.month} > COALESCE((SELECT max(month) FROM payroll_month_closures WHERE month < ${month}), '')`)).limit(1),
    tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, prev)).limit(1),
  ]);
  const prevEnd = `${prev}-${String(daysInMonth(prev)).padStart(2, "0")}`;
  if (dirty.length || (!previous.length && employees.some(e => e.joinedAt <= prevEnd))) {
    throw new PayrollBalancesNotReadyError(month);
  }
  return previous[0]?.lines ?? [];
}

async function saveMonth(tx: Tx, month: string, loaded: Awaited<ReturnType<typeof loadMonth>>, opening: PayrollBalanceEntry[], employeeId?: number) {
  const summary = calculatePayrollMonth(month, { ...loaded.data, openingBalances: opening }, loaded.schedule);
  if (employeeId && summary.lines.length === 0 && loaded.data.allEmployees[0]) {
    const employee = loaded.data.allEmployees[0];
    const adjustment = loaded.data.allAdjustments.find(a => a.employeeId === employeeId);
    const advance = (loaded.data.allAdvanceApprovals[0]?.lines as Array<{ employeeId: number; paid?: boolean; advanceAmount: number }> | undefined)
      ?.find(l => l.employeeId === employeeId && l.paid);
    summary.lines.push({ ...emptyPayrollEarnings(employee),
      ...applyPayrollFinancials({ gross: 0, socialInsurance: 0, incomeTax: 0 }, adjustment,
        Number(advance?.advanceAmount ?? 0), opening.find(l => l.employeeId === employeeId)?.balanceAmount ?? 0) });
  }
  const lines = summary.lines.map(line => ({
    employeeId: line.employeeId,
    movement: money(line.gross - line.deductions - line.paidAmount),
    balanceAmount: line.balanceAmount,
  }));
  const [existing] = employeeId ? await tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, month)) : [];
  const merged = employeeId ? [...(existing?.lines ?? []).filter(l => l.employeeId !== employeeId), ...lines] : lines;
  const pending = employeeId ? (existing?.dirtyEmployeeIds ?? []).filter(id => id !== employeeId) : [];
  const pendingEarnings = employeeId ? (existing?.earningsDirtyEmployeeIds ?? []).filter(id => id !== employeeId) : [];
  await tx.insert(payrollMonthBalancesTable).values({
    month, periodStart: loaded.period.periodStart, periodEnd: loaded.period.periodEnd, lines: merged, dirty: pending.length > 0, dirtyEmployeeIds: pending, earningsDirtyEmployeeIds: pendingEarnings,
  }).onConflictDoUpdate({ target: payrollMonthBalancesTable.month, set: {
    periodStart: loaded.period.periodStart, periodEnd: loaded.period.periodEnd, lines: merged, dirty: pending.length > 0, dirtyEmployeeIds: pending, earningsDirtyEmployeeIds: pendingEarnings, updatedAt: new Date(),
  } });
  return { summary, lines };
}

/** Rebase later saved FINANCIAL movements only; do not read later or earlier attendance. */
export async function rebaseLater(tx: Tx, month: string, opening: PayrollBalanceEntry[]) {
  const [later, closures] = await Promise.all([
    tx.select().from(payrollMonthBalancesTable)
      .where(gt(payrollMonthBalancesTable.month, month)).orderBy(asc(payrollMonthBalancesTable.month)),
    tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(gt(payrollMonthClosuresTable.month, month)),
  ]);
  const closedMonths = new Set(closures.map(row => row.month));
  let expected = nextMonth(month);
  for (const row of later) {
    if (row.month !== expected) break;
    if (closedMonths.has(row.month)) break;
    const lines = closingBalances(row.lines, opening);
    if (JSON.stringify(lines) !== JSON.stringify(row.lines)) {
      await tx.update(payrollMonthBalancesTable).set({ lines, updatedAt: new Date() })
        .where(eq(payrollMonthBalancesTable.month, row.month));
    }
    opening = lines;
    expected = nextMonth(row.month);
  }
}

/** Calculation path for explicit pull/repair: one period of attendance plus saved prior finances. */
export async function readMonthlyPayroll(month: string, connection?: Tx, employeeId?: number) {
  const calculate = async (tx: Tx) => {
    await lockBalances(tx);
    await assertPayrollOpeningAllows(month, employeeId, tx);
    if ((await tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(eq(payrollMonthClosuresTable.month, month))).length) {
      throw Object.assign(new Error("Цалингийн сар хаалттай. Админ эхлээд дахин нээнэ үү."), { code: "PCL01" });
    }
    const loaded = await loadMonth(tx, month, undefined, employeeId);
    const opening = await openingBalances(tx, month, loaded.data.allEmployees, employeeId);
    const result = await saveMonth(tx, month, loaded, opening, employeeId);
    const [saved] = await tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, month));
    await rebaseLater(tx, month, saved.lines);
    return result.summary;
  };
  return connection ? calculate(connection) : db.transaction(calculate);
}

/** Explicit, resumable initialization/repair, NOT part of a normal payroll GET.
 * Each batch computes at most six missing/dirty months, each with its own bounded attendance query.
 * Clean months reuse saved financial records and never read attendance.
 */
export async function rebuildPayrollBalances(throughMonth: string) {
  return db.transaction(async tx => {
    await lockBalances(tx);
    const baseline = await latestPayrollOpening(tx);
    const [allEmployees, salaryHistory, saved] = await Promise.all([
      tx.select().from(employeesTable),
      tx.select().from(employeeSalaryHistoryTable),
      tx.select().from(payrollMonthBalancesTable).where(lte(payrollMonthBalancesTable.month, throughMonth))
        .orderBy(asc(payrollMonthBalancesTable.month)),
    ]);
    const [anchor] = await tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(lte(payrollMonthClosuresTable.month, throughMonth)).orderBy(sql`${payrollMonthClosuresTable.month} DESC`).limit(1);
    const anchorMonth = baseline && (!anchor || baseline.month > anchor.month) ? baseline.month : anchor?.month;
    const first = anchorMonth ? nextMonth(anchorMonth)
      : allEmployees.reduce((min, e) => e.joinedAt.slice(0, 7) < min ? e.joinedAt.slice(0, 7) : min, throughMonth);
    // Employment-date corrections can move the baseline forward. Discard only
    // derived pre-baseline snapshots; attendance and paid amounts are untouched.
    if (!anchorMonth) await tx.delete(payrollMonthBalancesTable).where(lt(payrollMonthBalancesTable.month, first));
    const byMonth = new Map(saved.map(row => [row.month, row]));
    let opening: PayrollBalanceEntry[] = anchorMonth ? byMonth.get(anchorMonth)?.lines ?? [] : [];
    if (anchorMonth && !byMonth.has(anchorMonth)) throw new PayrollBalancesNotReadyError(throughMonth);
    const processedMonths: string[] = [];
    let last = anchor?.month ?? first;
    for (let month = first; month <= throughMonth; month = nextMonth(month)) {
      const row = byMonth.get(month);
      if (!row || row.dirty) {
        if (processedMonths.length === 6) {
          await rebaseLater(tx, previousMonth(month), opening);
          return { complete: false, processedMonths, nextMonth: month };
        }
        const loaded = await loadMonth(tx, month, { allEmployees, salaryHistory });
        const result = await saveMonth(tx, month, loaded, opening);
        opening = result.lines;
        processedMonths.push(month);
      } else {
        // Recalculate carryover using financial movements, including the ±1₮ tolerance.
        opening = closingBalances(row.lines, opening);
        if (JSON.stringify(opening) !== JSON.stringify(row.lines)) {
          await tx.update(payrollMonthBalancesTable).set({ lines: opening, updatedAt: new Date() })
            .where(eq(payrollMonthBalancesTable.month, month));
        }
      }
      last = month;
    }
    await rebaseLater(tx, last, opening);
    return { complete: true, processedMonths, nextMonth: null };
  });
}
