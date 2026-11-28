import { and, eq, sql } from "drizzle-orm";
import { db, cashClosuresTable, employeesTable, payrollAdvanceApprovalsTable, payrollMonthClosuresTable } from "@workspace/db";
import { GetPayrollAdvanceResponse, type PayrollAdvanceReceivableInput } from "@workspace/api-zod";
import { advanceNetAmount, advancePaidAmount } from "./payroll-advance-installments.js";
import { ensurePayrollReceivableJournal } from "./payroll-receivable-posting.js";
import { voidJournalEntry } from "./journal-posting.js";
import { lockCashDate } from "./cash-date-lock.js";
import { isValidCalendarDate, money } from "./date-utils.js";

const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** Explicit non-cash settlement. No second manual deduction is added to final payroll. */
export async function updateAdvanceReceivable(input: PayrollAdvanceReceivableInput) {
  if (!isValidCalendarDate(input.date)) throw fail("Суутгалын огноог зөв оруулна уу", 400);
  if ((input.amount > 0) !== (input.receivableId !== null)) throw fail("Авлага болон суутгах дүнг хамт сонгоно уу", 400);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    const [closed] = await tx.select().from(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, input.month));
    if (closed) throw fail("Цалингийн сар хаалттай");
    const [approval] = await tx.select().from(payrollAdvanceApprovalsTable)
      .where(eq(payrollAdvanceApprovalsTable.month, input.month)).for("update");
    if (!approval) throw fail("Эхлээд урьдчилгаа цалинг батална уу");
    const lines = GetPayrollAdvanceResponse.shape.lines.parse(approval.lines);
    const line = lines.find(row => row.employeeId === input.employeeId);
    if (!line) throw fail("Урьдчилгааны жагсаалтад ажилтан олдсонгүй", 404);
    if (money(input.amount) > money(line.advanceAmount)) throw fail("Суутгал урьдчилгааны дүнгээс хэтрэхгүй байна", 400);
    // Retrying an identical request must not post a second journal.
    if ((line.receivableId ?? null) === input.receivableId
      && money(line.receivableDeduction ?? 0) === money(input.amount)
      && (input.amount === 0 || line.receivableDate === input.date)) return;
    if (advancePaidAmount(line) > 0) throw fail("Эхлээд урьдчилгааны олголтыг буцаана уу. Олгосон дүнтэй үед суутгалыг өөрчлөхгүй.");
    for (const date of [...new Set([input.date, line.receivableDate].filter((d): d is string => Boolean(d)))].sort()) {
      await lockCashDate(tx, date);
      if ((await tx.select().from(cashClosuresTable).where(eq(cashClosuresTable.date, date))).length) {
        throw fail("Касс өндөрлөсөн өдрийн суутгалыг өөрчлөх боломжгүй");
      }
    }
    if (line.receivableJournalEntryId) {
      await voidJournalEntry(tx, { journalEntryId: line.receivableJournalEntryId, voidedBy: null });
    }
    let journalEntryId: number | null = null;
    if (input.receivableId !== null) {
      const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, input.employeeId));
      if (!employee) throw fail("Ажилтан олдсонгүй", 404);
      journalEntryId = await ensurePayrollReceivableJournal(tx, {
        employeeId: input.employeeId, employeeName: employee.name, month: input.month,
        amount: money(input.amount), receivableId: input.receivableId, date: input.date,
        adjustmentId: null, journalEntryId: null, advance: true,
      });
    }
    const updated = { ...line, receivableId: input.receivableId, receivableDeduction: money(input.amount),
      receivableDate: input.amount > 0 ? input.date : null, receivableJournalEntryId: journalEntryId };
    updated.paid = advanceNetAmount(updated) === 0;
    await tx.update(payrollAdvanceApprovalsTable).set({
      lines: lines.map(row => row.employeeId === input.employeeId ? updated : row),
    }).where(and(eq(payrollAdvanceApprovalsTable.id, approval.id), eq(payrollAdvanceApprovalsTable.month, input.month)));
  });
}
