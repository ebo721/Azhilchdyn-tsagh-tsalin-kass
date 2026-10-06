import { and, asc, eq, gt, lt, lte, sql } from "drizzle-orm";
import {
  db, employeesTable, employeeSalaryHistoryTable, attendanceTable, payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable, payrollMonthBalancesTable, type PayrollBalanceEntry,
} from "@workspace/db";
import { calculatePayrollMonth, getPayrollSchedule, payrollPeriod } from "./payroll-calc-helpers.js";
import { daysInMonth, money, nextMonth, previousMonth } from "./date-utils.js";
import type { PayrollCalculationData, Tx } from "./route-shared.js";

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
  return movements.map(line => {
    const amount = money(line.movement + (balances.get(line.employeeId) ?? 0));
    return { ...line, balanceAmount: Math.abs(amount) <= 1 ? 0 : amount };
  });
}

async function loadMonth(tx: Tx, month: string, common?: Pick<PayrollCalculationData, "allEmployees" | "salaryHistory">) {
  const schedule = await getPayrollSchedule(month, tx);
  const period = payrollPeriod(month, schedule);
  const [allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals] = await Promise.all([
    common ? Promise.resolve(common.allEmployees) : tx.select().from(employeesTable),
    common ? Promise.resolve(common.salaryHistory) : tx.select().from(employeeSalaryHistoryTable).where(lte(employeeSalaryHistoryTable.effectiveFrom, period.periodEnd)),
    tx.select().from(attendanceTable).where(sql`${attendanceTable.date} BETWEEN ${period.periodStart}::date AND ${period.periodEnd}::date`),
    tx.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
    tx.select().from(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month)),
  ]);
  return { schedule, period, data: { allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals } };
}

async function openingBalances(tx: Tx, month: string, employees: PayrollCalculationData["allEmployees"]) {
  const prev = previousMonth(month);
  const [dirty, previous] = await Promise.all([
    tx.select({ month: payrollMonthBalancesTable.month }).from(payrollMonthBalancesTable)
      .where(and(lt(payrollMonthBalancesTable.month, month), eq(payrollMonthBalancesTable.dirty, true))).limit(1),
    tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, prev)).limit(1),
  ]);
  const prevEnd = `${prev}-${String(daysInMonth(prev)).padStart(2, "0")}`;
  if (dirty.length || (!previous.length && employees.some(e => e.joinedAt <= prevEnd))) {
    throw new PayrollBalancesNotReadyError(month);
  }
  return previous[0]?.lines ?? [];
}

async function saveMonth(tx: Tx, month: string, loaded: Awaited<ReturnType<typeof loadMonth>>, opening: PayrollBalanceEntry[]) {
  const summary = calculatePayrollMonth(month, { ...loaded.data, openingBalances: opening }, loaded.schedule);
  const lines = summary.lines.map(line => ({
    employeeId: line.employeeId,
    movement: money(line.gross - line.deductions - line.paidAmount),
    balanceAmount: line.balanceAmount,
  }));
  await tx.insert(payrollMonthBalancesTable).values({
    month, periodStart: loaded.period.periodStart, periodEnd: loaded.period.periodEnd, lines, dirty: false,
  }).onConflictDoUpdate({ target: payrollMonthBalancesTable.month, set: {
    periodStart: loaded.period.periodStart, periodEnd: loaded.period.periodEnd, lines, dirty: false, updatedAt: new Date(),
  } });
  return { summary, lines };
}

/** Rebase later saved FINANCIAL movements only; do not read later or earlier attendance. */
async function rebaseLater(tx: Tx, month: string, opening: PayrollBalanceEntry[]) {
  const later = await tx.select().from(payrollMonthBalancesTable)
    .where(gt(payrollMonthBalancesTable.month, month)).orderBy(asc(payrollMonthBalancesTable.month));
  let expected = nextMonth(month);
  for (const row of later) {
    if (row.month !== expected) break;
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
export async function readMonthlyPayroll(month: string, connection?: Tx) {
  const calculate = async (tx: Tx) => {
    await lockBalances(tx);
    const loaded = await loadMonth(tx, month);
    const opening = await openingBalances(tx, month, loaded.data.allEmployees);
    const result = await saveMonth(tx, month, loaded, opening);
    await rebaseLater(tx, month, result.lines);
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
    const [allEmployees, salaryHistory, saved] = await Promise.all([
      tx.select().from(employeesTable),
      tx.select().from(employeeSalaryHistoryTable),
      tx.select().from(payrollMonthBalancesTable).where(lte(payrollMonthBalancesTable.month, throughMonth))
        .orderBy(asc(payrollMonthBalancesTable.month)),
    ]);
    const first = allEmployees.reduce((min, e) => e.joinedAt.slice(0, 7) < min ? e.joinedAt.slice(0, 7) : min, throughMonth);
    // Employment-date corrections can move the baseline forward. Discard only
    // derived pre-baseline snapshots; attendance and paid amounts are untouched.
    await tx.delete(payrollMonthBalancesTable).where(lt(payrollMonthBalancesTable.month, first));
    const byMonth = new Map(saved.map(row => [row.month, row]));
    let opening: PayrollBalanceEntry[] = [];
    const processedMonths: string[] = [];
    let last = first;
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
