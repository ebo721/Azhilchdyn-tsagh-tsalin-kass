import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { GetPayrollResponse } from "@workspace/api-zod";
import { readSavedPayroll } from "./payroll-attendance-snapshot.js";
import { payrollSummaryTotals } from "./payroll-calc-helpers.js";
import type { Tx } from "./route-shared.js";

type Payroll = ReturnType<typeof GetPayrollResponse.parse>;

/** The register is an earnings view, not the complete financial carryforward ledger. */
export function projectPayrollRegister(payroll: Payroll, eligibleIds: ReadonlySet<number>) {
  const lines = payroll.lines.filter(line => eligibleIds.has(line.employeeId));
  return GetPayrollResponse.parse({
    ...payroll, lines, ...payrollSummaryTotals(lines),
    attendanceNeedsRefresh: !payroll.closedAt && lines.some(line =>
      line.calculationReady === false || line.attendanceNeedsRefresh || line.openingBalanceReviewRequired),
  });
}

/**
 * Saved earnings remain authoritative. For zero/uncomputed rows, check only
 * membership evidence, not salary amounts: present/late employment dates or
 * an effective guaranteed-salary weekday. No recalculation or financial writes.
 */
export async function readPayrollRegister(month: string, connection?: Tx) {
  const read = async (tx: Tx) => {
    const payroll = await readSavedPayroll(month, tx);
    const eligible = new Set(payroll.lines.filter(line =>
      line.calculationReady !== false && (line.gross > 0 || line.daysWorked > 0),
    ).map(line => line.employeeId));
    // Closed months are immutable: project only their saved earnings.
    const candidates = payroll.closedAt ? [] : payroll.lines
      .filter(line => !eligible.has(line.employeeId)).map(line => line.employeeId);
    if (candidates.length) {
      const result = await tx.execute<{ id: number }>(sql`
        SELECT e.id FROM employees e
        WHERE e.id IN (${sql.join(candidates.map(id => sql`${id}`), sql`, `)})
          AND e.joined_at <= ${payroll.periodEnd}::date
          AND (e.inactive_at IS NULL OR e.inactive_at >= ${payroll.periodStart}::date)
          AND (
            EXISTS (
              SELECT 1 FROM attendance a WHERE a.employee_id = e.id
                AND a.status IN ('present', 'late')
                AND a.date BETWEEN GREATEST(e.joined_at, ${payroll.periodStart}::date)
                  AND LEAST(COALESCE(e.inactive_at, ${payroll.periodEnd}::date), ${payroll.periodEnd}::date)
            )
            OR EXISTS (
              SELECT 1
              FROM generate_series(
                GREATEST(e.joined_at, ${payroll.periodStart}::date)::timestamp,
                LEAST(COALESCE(e.inactive_at, ${payroll.periodEnd}::date), ${payroll.periodEnd}::date)::timestamp,
                interval '1 day'
              ) d(day)
              LEFT JOIN LATERAL (
                SELECT h.full_salary_regardless_attendance FROM employee_salary_history h
                WHERE h.employee_id = e.id AND h.effective_from <= d.day::date
                ORDER BY h.effective_from DESC LIMIT 1
              ) h ON true
              WHERE EXTRACT(ISODOW FROM d.day) <= 5
                AND COALESCE(h.full_salary_regardless_attendance,
                  CASE WHEN NOT EXISTS (SELECT 1 FROM employee_salary_history x WHERE x.employee_id = e.id)
                    THEN e.full_salary_regardless_attendance ELSE false END)
            )
          )
      `);
      for (const row of result.rows) eligible.add(row.id);
    }
    return projectPayrollRegister(payroll, eligible);
  };
  return connection ? read(connection) : db.transaction(read, {
    isolationLevel: "repeatable read", accessMode: "read only",
  });
}
