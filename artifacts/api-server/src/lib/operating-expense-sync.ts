import { and, eq } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, operatingExpensesTable } from "@workspace/db";
import { cashAccountForCategory } from "./cash-account.js";

const SYSTEM_SOURCES = ["payroll", "payroll_advance", "inventory_purchase", "fixed_asset_purchase"];
const OPERATING_EXPENSE_CATEGORY = "Үйл ажиллагааны зардал";

const expenseAccountCode = (category: string) => {
  const normalized = category.toLocaleLowerCase("mn-MN");
  if (normalized.includes("түрээс")) return "6100";
  if (normalized.includes("тээвэр") || normalized.includes("шатахуун")) return "6200";
  if (normalized.includes("цахилгаан") || normalized.includes("дулаан") || normalized.includes("ус")) return "6300";
  if (normalized.includes("интернет") || normalized.includes("холбоо")) return "6400";
  if (normalized.includes("засвар")) return "6500";
  return "6900";
};

export async function syncOperatingExpenseForBankCash(tx: any, bankId: number, cashId: number) {
  const [[bank], [cash]] = await Promise.all([
    tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId)).for("update"),
    tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashId)).for("update"),
  ]);
  if (!bank || !cash || bank.type !== "expense" || (cash.sourceType && SYSTEM_SOURCES.includes(cash.sourceType))) return null;
  const [existing] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bankId)).for("update");
  const [byCash] = existing ? [existing] : await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, cashId)).for("update");
  const [linkedAccount] = byCash ? await tx.select({ name: chartOfAccountsTable.name }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, byCash.accountId)) : [];
  if (byCash && !linkedAccount) throw new Error(`Operating expense account ${byCash.accountId} is missing`);
  const subcategory = cash.category === OPERATING_EXPENSE_CATEGORY
    ? (linkedAccount?.name ?? "Бусад")
    : cash.category;
  const accountCode = expenseAccountCode(subcategory);
  if (!byCash) {
    const defaults: Record<string, string> = {
      "6100": "Түрээсийн зардал",
      "6200": "Тээврийн зардал",
      "6300": "Цахилгаан, дулаан, ус",
      "6400": "Харилцаа холбоо, интернэт",
      "6500": "Засвар үйлчилгээ",
      "6900": "Бусад үйл ажиллагааны зардал",
    };
    await tx.insert(chartOfAccountsTable).values({
      code: accountCode,
      name: defaults[accountCode],
      type: "expense",
    }).onConflictDoNothing({ target: chartOfAccountsTable.code });
  }
  const [fallbackAccount] = byCash ? [null] : await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, accountCode),
    eq(chartOfAccountsTable.type, "expense"),
  ));
  if (!byCash && !fallbackAccount) throw new Error(`Operating expense account ${accountCode} is missing`);
  const values = {
    description: cash.description, accountId: byCash?.accountId ?? fallbackAccount.id, date: String(cash.date), amount: Number(cash.amount),
    paymentDate: String(cash.date), paymentAmount: Number(cash.amount), bankTransactionId: bankId, cashTransactionId: cashId,
  };
  if (cash.category !== OPERATING_EXPENSE_CATEGORY) {
    const cashAccount = await cashAccountForCategory(tx, OPERATING_EXPENSE_CATEGORY);
    await tx.update(cashTransactionsTable).set({
      category: OPERATING_EXPENSE_CATEGORY,
      accountId: cashAccount?.id ?? null,
    }).where(eq(cashTransactionsTable.id, cashId));
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