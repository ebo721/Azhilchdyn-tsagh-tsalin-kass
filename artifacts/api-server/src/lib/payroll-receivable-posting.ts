import { and, eq, inArray } from "drizzle-orm";
import { chartOfAccountsTable, receivablesTable } from "@workspace/db";
import { postJournalEntry } from "./journal-posting.js";
import type { Tx } from "./route-shared.js";

export async function ensurePayrollReceivableJournal(tx: Tx, input: {
  employeeId: number; employeeName: string; month: string; amount: number;
  receivableId: number; date: string | null; adjustmentId: number | null; journalEntryId: number | null;
}) {
  const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
  if (input.amount <= 0) throw fail("Авлагаас суутгах дүн 0-ээс их байх ёстой", 400);
  const [receivable] = await tx.select().from(receivablesTable).where(eq(receivablesTable.id, input.receivableId)).for("update");
  if (!receivable || Number(receivable.employeeId) !== input.employeeId) throw fail("Сонгосон авлага энэ ажилтанд хамаарахгүй байна");
  if (input.journalEntryId || !input.date) return input.journalEntryId;
  const accounts = await tx.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable).where(and(inArray(chartOfAccountsTable.code, ["1200", "2100"]), eq(chartOfAccountsTable.isActive, true)));
  const receivableAccountId = accounts.find(account => account.code === "1200")?.id;
  const payrollPayableAccountId = accounts.find(account => account.code === "2100")?.id;
  if (!receivableAccountId || !payrollPayableAccountId) throw fail("1200 болон 2100 данс идэвхтэй байх шаардлагатай");
  const posting = await postJournalEntry(tx, {
    date: input.date, description: `${input.employeeName} · ${input.month} сарын цалингаас авлага суутгав`,
    sourceType: "payroll_receivable", sourceId: input.adjustmentId, createdBy: null,
    lines: [
      { accountId: payrollPayableAccountId, debit: input.amount, credit: 0 },
      { accountId: receivableAccountId, debit: 0, credit: input.amount, allocation: { kind: "settle", receivableId: input.receivableId } },
    ],
  });
  if (posting.status !== "posted") throw new Error("Payroll receivable journal must be balanced");
  return posting.journalEntryId;
}
