import { and, eq } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, operatingExpensesTable } from "@workspace/db";

const SYSTEM_SOURCES = ["payroll", "payroll_advance", "inventory_purchase", "fixed_asset_purchase"];
const OPERATING_EXPENSE_CATEGORY = "Үйл ажиллагааны зардал";

export async function syncOperatingExpenseForBankCash(tx: any, bankId: number, cashId: number) {
  const [[bank], [cash]] = await Promise.all([
    tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId)).for("update"),
    tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashId)).for("update"),
  ]);
  if (!bank || !cash || bank.type !== "expense" || (cash.sourceType && SYSTEM_SOURCES.includes(cash.sourceType))) return null;
  const [existing] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bankId)).for("update");
  const [byCash] = existing ? [existing] : await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, cashId)).for("update");
  const subcategory = cash.category === OPERATING_EXPENSE_CATEGORY
    ? (byCash?.category ?? "Бусад")
    : cash.category;
  const values = {
    description: cash.description, category: subcategory, date: String(cash.date), amount: Number(cash.amount),
    paymentDate: String(cash.date), paymentAmount: Number(cash.amount), bankTransactionId: bankId, cashTransactionId: cashId,
  };
  if (cash.category !== OPERATING_EXPENSE_CATEGORY) {
    await tx.update(cashTransactionsTable).set({ category: OPERATING_EXPENSE_CATEGORY }).where(eq(cashTransactionsTable.id, cashId));
  }
  if (byCash) return (await tx.update(operatingExpensesTable).set(values).where(eq(operatingExpensesTable.id, byCash.id)).returning())[0];
  const [created] = await tx.insert(operatingExpensesTable).values(values).onConflictDoNothing().returning();
  if (created) return created;
  const [resolved] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bankId));
  return resolved ?? null;
}

export async function reconcileOperatingExpenses(tx: any) {
  const pairs = await tx.select({ bankId: bankTransactionsTable.id, cashId: cashTransactionsTable.id })
    .from(bankTransactionsTable).innerJoin(cashTransactionsTable, eq(bankTransactionsTable.cashTransactionId, cashTransactionsTable.id))
    .where(eq(bankTransactionsTable.type, "expense"));
  for (const pair of pairs) await syncOperatingExpenseForBankCash(tx, pair.bankId, pair.cashId);
  return tx.select().from(operatingExpensesTable);
}