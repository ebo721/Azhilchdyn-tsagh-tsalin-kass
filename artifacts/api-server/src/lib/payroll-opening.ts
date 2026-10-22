import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db, employeesTable, payrollMonthBalancesTable, payrollMonthClosuresTable, payrollOpeningBalancesTable, payrollRefreshRevisionTable } from "@workspace/db";
import type { PayrollOpeningConfirmation } from "@workspace/api-zod";
import { currentMonth, money } from "./date-utils.js";
import { getPayrollSchedule, payrollPeriod } from "./payroll-calc-helpers.js";
import { rebaseLater } from "./payroll-balance-store.js";
import type { Tx, DbClient } from "./route-shared.js";

export class PayrollOpeningConflict extends Error {}

export async function latestPayrollOpening(connection: DbClient = db) {
  const [row] = await connection.select().from(payrollOpeningBalancesTable).orderBy(desc(payrollOpeningBalancesTable.id)).limit(1);
  return row;
}

export async function payrollOpeningDraft(month: string, connection: DbClient = db) {
  const [baseline, employees, saved, revisions] = await Promise.all([
    latestPayrollOpening(connection),
    connection.select().from(employeesTable).orderBy(asc(employeesTable.id)),
    connection.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, month)),
    connection.select().from(payrollRefreshRevisionTable).where(eq(payrollRefreshRevisionTable.id, 1)),
  ]);
  const end = `${month}-31`;
  const prior = new Map((baseline?.month === month ? baseline.lines : saved[0]?.lines ?? [])
    .map(line => [line.employeeId, line.balanceAmount]));
  const names = new Map(employees.filter(e => e.joinedAt <= end).map(e => [e.id, e.name]));
  // A deleted/renamed employee must not make a confirmed debt disappear.
  if (baseline?.month === month) for (const line of baseline.lines) {
    if (!names.has(line.employeeId)) names.set(line.employeeId, line.employeeName);
  }
  return {
    month, confirmedMonth: baseline?.month ?? null, confirmedAt: baseline?.confirmedAt.toISOString() ?? null,
    confirmedBy: baseline?.confirmedBy ?? null, revision: baseline?.id ?? 0,
    sourceRevision: revisions[0]?.revision ?? 0, note: baseline?.note ?? "",
    reviewEmployeeIds: baseline?.reviewEmployeeIds ?? [],
    lines: [...names].map(([employeeId, employeeName]) => ({
      employeeId, employeeName, balanceAmount: prior.has(employeeId) ? money(Number(prior.get(employeeId))) : null,
    })),
  };
}

export async function confirmPayrollOpening(input: PayrollOpeningConfirmation, userId: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payroll-month-balances'))`);
    // Deferred employee invalidation must be visible before confirming a revision.
    await tx.execute(sql`SET CONSTRAINTS payroll_employee_change IMMEDIATE`);
    if (input.month > currentMonth() || !input.verified) throw new PayrollOpeningConflict("Ирээдүйн сарын үлдэгдэл батлахгүй. Дүнг тулгаж баталгаажуулна уу.");
    const draft = await payrollOpeningDraft(input.month, tx);
    if (input.revision !== draft.revision || input.sourceRevision !== draft.sourceRevision) {
      throw new PayrollOpeningConflict("Эх бүртгэл эсвэл баталгаажуулалт өөрчлөгдсөн. Шинэ мэдээллийг нээж тулгаад дахин батална уу.");
    }
    if (draft.confirmedMonth && draft.confirmedMonth !== input.month) {
      throw new PayrollOpeningConflict("Баталгаажсан эхний үлдэгдлийн сарыг өөрчлөхгүй. Тэр сарын дүнг админ дахин тулгаж батална уу.");
    }
    if (input.lines.length !== draft.lines.length || new Set(input.lines.map(l => l.employeeId)).size !== input.lines.length
      || draft.lines.some(l => !input.lines.some(i => i.employeeId === l.employeeId))) {
      throw new PayrollOpeningConflict("Бүх ажилтны өглөг/авлагыг нэг удаа бүрэн оруулна уу. Үлдэгдэлгүй бол 0 гэж тодорхой оруулна.");
    }
    if ((await tx.select({ month: payrollMonthClosuresTable.month }).from(payrollMonthClosuresTable)
      .where(gt(payrollMonthClosuresTable.month, input.month)).limit(1)).length) {
      throw new PayrollOpeningConflict("Дараагийн сар хаалттай байна. Эхний үлдэгдлийг өөрчлөхийн өмнө админ дараагийн хаалтуудыг нээнэ үү.");
    }
    const names = new Map(draft.lines.map(l => [l.employeeId, l.employeeName]));
    const lines = input.lines.map(l => ({
      employeeId: l.employeeId, employeeName: names.get(l.employeeId)!, balanceAmount: money(l.balanceAmount),
    }));
    const [old] = await tx.select().from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, input.month));
    const [closed] = await tx.select().from(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, input.month));
    if (closed && (!old || lines.some(line => money(old.lines.find(l => l.employeeId === line.employeeId)?.balanceAmount ?? 0) !== line.balanceAmount)
      || old.lines.some(l => l.balanceAmount && !lines.some(n => n.employeeId === l.employeeId)))) {
      throw new PayrollOpeningConflict("Хаасан сарын баталгаажсан үлдэгдэлтэй дүн зөрж байна. Админ эхлээд сарыг нээнэ үү.");
    }
    const period = payrollPeriod(input.month, await getPayrollSchedule(input.month, tx));
    const balances = lines.map(l => ({ employeeId: l.employeeId, balanceAmount: l.balanceAmount, movement: 0 }));
    if (!closed) await tx.insert(payrollMonthBalancesTable).values({
      month: input.month, periodStart: period.periodStart, periodEnd: period.periodEnd, lines: balances,
      dirty: false, dirtyEmployeeIds: [], earningsDirtyEmployeeIds: [],
    }).onConflictDoUpdate({ target: payrollMonthBalancesTable.month, set: {
      lines: balances, periodStart: period.periodStart, periodEnd: period.periodEnd,
      dirty: false, dirtyEmployeeIds: [], earningsDirtyEmployeeIds: [], updatedAt: new Date(),
    } });
    await tx.insert(payrollOpeningBalancesTable).values({
      month: input.month, lines, note: input.note.trim(), confirmedBy: userId,
    });
    await rebaseLater(tx, input.month, closed ? old!.lines : balances);
    return payrollOpeningDraft(input.month, tx);
  });
}

export async function assertPayrollOpeningAllows(month: string, employeeId: number | undefined, tx: Tx) {
  const opening = await latestPayrollOpening(tx);
  if (!opening) return;
  if (month <= opening.month) throw new PayrollOpeningConflict("Энэ сар баталгаажсан эхний үлдэгдэлд багтсан. Эхний үлдэгдлийг админ хянаж дахин батална уу.");
  if (employeeId === undefined ? opening.reviewEmployeeIds.length : opening.reviewEmployeeIds.includes(employeeId)) {
    throw new PayrollOpeningConflict("Өмнөх эх бүртгэл өөрчлөгдсөн тул энэ ажилтны эхний үлдэгдлийг админ хянаж дахин батална уу.");
  }
}
