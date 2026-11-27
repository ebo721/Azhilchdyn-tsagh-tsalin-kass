import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, payrollMonthBalancesTable, payrollMonthClosuresTable } from "@workspace/db";
import type { Tx } from "./route-shared.js";
import { PayrollClosureConflict } from "./payroll-month-close.js";

/** Use payroll's saved effective period, which may cross calendar months. */
export async function attendanceClosures(from: string, to: string, connection: typeof db | Tx = db) {
  return connection.select({
    month: payrollMonthClosuresTable.month,
    periodStart: payrollMonthBalancesTable.periodStart,
    periodEnd: payrollMonthBalancesTable.periodEnd,
    closedAt: payrollMonthClosuresTable.closedAt,
  }).from(payrollMonthClosuresTable)
    .innerJoin(payrollMonthBalancesTable, eq(payrollMonthBalancesTable.month, payrollMonthClosuresTable.month))
    .where(and(lte(payrollMonthBalancesTable.periodStart, to), gte(payrollMonthBalancesTable.periodEnd, from)))
    .orderBy(asc(payrollMonthClosuresTable.month));
}

/** Acquire before employee/row locks, matching payroll close and source writers. */
export async function assertAttendanceOpen(tx: Tx, from: string, to = from): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
  const [closure] = await attendanceClosures(from, to, tx);
  if (closure) {
    throw new PayrollClosureConflict(`Цалингийн ${closure.month} сар хаалттай тул ${closure.periodStart} – ${closure.periodEnd} хугацааны ирцийг өөрчлөхгүй. Админ эхлээд сарыг дахин нээнэ үү.`);
  }
}
