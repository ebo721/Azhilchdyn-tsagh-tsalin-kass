import { and, eq, gt, gte, sql } from "drizzle-orm";
import { db, payrollMonthBalancesTable, payrollMonthClosuresTable } from "@workspace/db";
import { GetPayrollResponse } from "@workspace/api-zod";
import { readSavedPayroll } from "./payroll-attendance-snapshot.js";
import { getPayrollAdvanceSummary } from "./payroll-calc-helpers.js";
import { closingBalances } from "./payroll-balance-store.js";
import { money } from "./date-utils.js";

export class PayrollClosureConflict extends Error {}

export async function closePayrollMonth(month: string, userId: number) {
  return db.transaction(async (tx) => {
    // Source writers and attendance pulls use this same lock order.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payroll-month-balances'))`);
    const [existing] = await tx.select().from(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, month));
    if (existing) return readSavedPayroll(month, tx);
    if ((await tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(gt(payrollMonthClosuresTable.month, month)).limit(1)).length) {
      throw new PayrollClosureConflict("Дараагийн сар хаалттай байна. Хамгийн сүүлийн хаасан сараас эхлэн дахин нээнэ үү.");
    }
    const payroll = await readSavedPayroll(month, tx);
    if (payroll.attendanceNeedsRefresh) {
      throw new PayrollClosureConflict("Эх бүртгэл өөрчлөгдсөн байна. «Цаг татах» дарж бодолтоо шалгасны дараа сарыг хаана уу.");
    }
    const advance = await getPayrollAdvanceSummary(month, tx, { savedOnly: true });
    const lines = closingBalances(
      payroll.lines.map(line => ({ employeeId: line.employeeId, movement: money(line.gross - line.deductions - line.paidAmount) })),
      payroll.lines.map(line => ({ employeeId: line.employeeId, balanceAmount: line.carryoverAmount })),
    );
    await tx.insert(payrollMonthBalancesTable).values({
      month, periodStart: payroll.periodStart, periodEnd: payroll.periodEnd, lines, dirty: false,
    }).onConflictDoUpdate({ target: payrollMonthBalancesTable.month, set: {
      periodStart: payroll.periodStart, periodEnd: payroll.periodEnd, lines, dirty: false, updatedAt: new Date(),
    } });
    const [closed] = await tx.insert(payrollMonthClosuresTable).values({ month, payroll, advance, closedBy: userId }).returning();
    // Later open financial records must explicitly absorb the newly finalized opening.
    await tx.update(payrollMonthBalancesTable).set({ dirty: true }).where(gt(payrollMonthBalancesTable.month, month));
    return GetPayrollResponse.parse({ ...payroll, closedAt: closed.closedAt.toISOString(), closedBy: userId, attendanceNeedsRefresh: false });
  });
}

export async function reopenPayrollMonth(month: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payroll-month-balances'))`);
    if ((await tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(gt(payrollMonthClosuresTable.month, month)).limit(1)).length) {
      throw new PayrollClosureConflict("Дараагийн сар хаалттай байна. Хамгийн сүүлийн хаасан сараас эхлэн дахин нээнэ үү.");
    }
    const [closed] = await tx.delete(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, month)).returning();
    if (!closed) return readSavedPayroll(month, tx);
    await tx.update(payrollMonthBalancesTable).set({ dirty: true })
      .where(and(gte(payrollMonthBalancesTable.month, month), sql`NOT EXISTS (SELECT 1 FROM payroll_month_closures c WHERE c.month = ${payrollMonthBalancesTable.month})`));
    return readSavedPayroll(month, tx);
  });
}
