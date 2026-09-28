import { eq } from "drizzle-orm";
import { cashClosuresTable, chartOfAccountsTable, db, operatingExpensesTable } from "@workspace/db";

export async function isCashDateClosed(date: string) {
  const [closure] = await db
    .select({ id: cashClosuresTable.id })
    .from(cashClosuresTable)
    .where(eq(cashClosuresTable.date, date));
  return Boolean(closure);
}

export function operatingExpenseResponse(row: typeof operatingExpensesTable.$inferSelect, category: string) {
  return { ...row, category, date: String(row.date), amount: Number(row.amount), paymentDate: row.paymentDate ? String(row.paymentDate) : null,
    paymentAmount: row.paymentAmount === null ? null : Number(row.paymentAmount), bankTransactionId: row.bankTransactionId,
    cashTransactionId: row.cashTransactionId, createdAt: String(row.createdAt) };
}

export async function operatingExpenseAccountName(accountId: number) {
  const [account] = await db
    .select({ name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, accountId));
  if (!account) throw new Error(`Operating expense account ${accountId} is missing`);
  return account.name;
}