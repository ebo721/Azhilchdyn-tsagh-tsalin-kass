import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { chartOfAccountsTable, journalEntriesTable, receivablesTable } from "@workspace/db";
import { postJournalEntry } from "./journal-posting.js";
import type { Tx } from "./route-shared.js";
import { money } from "./date-utils.js";

type SettlementInput = {
  employeeId: number; employeeName: string; month: string; amount: number;
  receivableId: number; date: string | null; adjustmentId: number | null; journalEntryId: number | null;
  advance?: boolean;
};

/** Retain the explicit single-document contract for historical callers. */
export async function ensurePayrollReceivableJournal(tx: Tx, input: SettlementInput) {
  return (await settlePayrollReceivables(tx, input)).journalEntryId;
}

/** Undefined receivableId means FIFO across the employee's registered open debts. */
export async function settlePayrollReceivables(tx: Tx, input: Omit<SettlementInput, "receivableId"> & { receivableId?: number }) {
  const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
  if (!Number.isFinite(input.amount) || input.amount <= 0 || money(input.amount) !== input.amount) {
    throw fail("Авлагаас суутгах дүн 0-ээс их, хоёр орны нарийвчлалтай байна", 400);
  }
  const rows = await tx.select({ id: receivablesTable.id, employeeId: receivablesTable.employeeId, openAmount: receivablesTable.openAmount })
    .from(receivablesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, receivablesTable.originJournalEntryId))
    .where(input.receivableId === undefined
      ? and(eq(receivablesTable.employeeId, input.employeeId), gt(receivablesTable.openAmount, 0), eq(journalEntriesTable.status, "posted"))
      : eq(receivablesTable.id, input.receivableId))
    .orderBy(asc(journalEntriesTable.date), asc(receivablesTable.id))
    .for("update", { of: receivablesTable });
  if (input.receivableId !== undefined && (!rows[0] || rows[0].employeeId !== input.employeeId)) {
    throw fail("Сонгосон авлага энэ ажилтанд хамаарахгүй байна");
  }
  if (input.journalEntryId) return { journalEntryId: input.journalEntryId, receivableId: input.receivableId ?? rows[0]?.id ?? null };
  const total = money(rows.reduce((sum, row) => sum + Number(row.openAmount), 0));
  if (money(input.amount) > total) throw fail(`Суутгах дүн ажилтны нийт авлагын үлдэгдэл (${total}₮)-ээс их байна`);
  if (!input.date) return { journalEntryId: null, receivableId: input.receivableId ?? rows[0]?.id ?? null };
  let remaining = money(input.amount);
  const allocations = rows.flatMap(row => {
    const amount = money(Math.min(remaining, Number(row.openAmount)));
    remaining = money(remaining - amount);
    return amount > 0 ? [{ receivableId: row.id, amount }] : [];
  });
  const accounts = await tx.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable).where(and(inArray(chartOfAccountsTable.code, ["1200", "2100"]), eq(chartOfAccountsTable.isActive, true)));
  const receivableAccountId = accounts.find(account => account.code === "1200")?.id;
  const payrollPayableAccountId = accounts.find(account => account.code === "2100")?.id;
  if (!receivableAccountId || !payrollPayableAccountId) throw fail("1200 болон 2100 данс идэвхтэй байх шаардлагатай");
  const posting = await postJournalEntry(tx, {
    date: input.date, description: `${input.employeeName} · ${input.month} сарын ${input.advance ? "урьдчилгаанаас" : "цалингаас"} авлага суутгав`,
    sourceType: input.advance ? "payroll_advance_receivable" : "payroll_receivable", sourceId: input.adjustmentId, createdBy: null,
    lines: [
      { accountId: payrollPayableAccountId, debit: input.amount, credit: 0 },
      ...allocations.map(allocation => ({
        accountId: receivableAccountId, debit: 0, credit: allocation.amount,
        allocation: { kind: "settle" as const, receivableId: allocation.receivableId },
      })),
    ],
  });
  if (posting.status !== "posted") throw new Error("Payroll receivable journal must be balanced");
  return { journalEntryId: posting.journalEntryId, receivableId: allocations[0].receivableId };
}
