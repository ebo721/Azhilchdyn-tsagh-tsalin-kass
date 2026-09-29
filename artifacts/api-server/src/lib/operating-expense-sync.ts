import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, operatingExpensesTable } from "@workspace/db";
import { cashAccountForCategory, shouldMirrorCashAsOperatingExpense } from "./cash-account.js";

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
  const usesBankAccount = cash.sourceType === "bank_transaction"
    && cash.category === OPERATING_EXPENSE_CATEGORY
    && bank.accountId !== null && cash.accountId === bank.accountId;
  const canonicalCashAccount = await cashAccountForCategory(tx, cash.category);
  if (!usesBankAccount && canonicalCashAccount && cash.accountId !== canonicalCashAccount.id) {
    await tx.update(cashTransactionsTable).set({
      accountId: canonicalCashAccount.id,
    }).where(eq(cashTransactionsTable.id, cashId));
  } else if (!canonicalCashAccount && cash.category !== OPERATING_EXPENSE_CATEGORY) {
    const fallbackCashAccount = await cashAccountForCategory(tx, OPERATING_EXPENSE_CATEGORY);
    await tx.update(cashTransactionsTable).set({
      category: OPERATING_EXPENSE_CATEGORY,
      accountId: fallbackCashAccount?.id ?? null,
    }).where(eq(cashTransactionsTable.id, cashId));
  }
  if (!shouldMirrorCashAsOperatingExpense(cash.category)) {
    await tx.delete(operatingExpensesTable).where(or(
      eq(operatingExpensesTable.bankTransactionId, bankId),
      eq(operatingExpensesTable.cashTransactionId, cashId),
    ));
    return null;
  }
  const [existing] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bankId)).for("update");
  const [byCash] = existing ? [existing] : await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, cashId)).for("update");
  const [linkedAccount] = byCash ? await tx.select({ name: chartOfAccountsTable.name }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, byCash.accountId)) : [];
  if (byCash && !linkedAccount) throw new Error(`Operating expense account ${byCash.accountId} is missing`);
  const subcategory = cash.category === OPERATING_EXPENSE_CATEGORY
    ? (linkedAccount?.name ?? "Бусад")
    : cash.category;
  const accountCode = expenseAccountCode(subcategory);
  if (!byCash && !usesBankAccount) {
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
      normalBalance: "debit",
    }).onConflictDoNothing({ target: chartOfAccountsTable.code });
  }
  const [fallbackAccount] = byCash || usesBankAccount ? [null] : await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, accountCode),
    eq(chartOfAccountsTable.type, "expense"),
  ));
  if (!byCash && !usesBankAccount && !fallbackAccount) throw new Error(`Operating expense account ${accountCode} is missing`);
  const values = {
    description: cash.description, accountId: byCash?.accountId ?? (usesBankAccount ? bank.accountId! : fallbackAccount!.id), date: String(cash.date), amount: Number(cash.amount),
    paymentDate: String(cash.date), paymentAmount: Number(cash.amount), bankTransactionId: bankId, cashTransactionId: cashId,
  };
  if (byCash) return (await tx.update(operatingExpensesTable).set(values).where(eq(operatingExpensesTable.id, byCash.id)).returning())[0];
  const [created] = await tx.insert(operatingExpensesTable).values(values).onConflictDoNothing().returning();
  if (created) return created;
  const [resolved] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bankId));
  return resolved ?? null;
}

export async function reconcileOperatingExpenses(
  tx: any,
  report?: (stats: { candidatePairCount: number; syncedCount: number; elapsedMs: number }) => void,
) {
  const started = performance.now();
  const pairs = await tx.select({ bank: bankTransactionsTable, cash: cashTransactionsTable })
    .from(bankTransactionsTable).innerJoin(cashTransactionsTable, eq(bankTransactionsTable.cashTransactionId, cashTransactionsTable.id))
    .where(and(
      eq(bankTransactionsTable.type, "expense"),
      or(isNull(cashTransactionsTable.sourceType), notInArray(cashTransactionsTable.sourceType, SYSTEM_SOURCES)),
    ))
    .orderBy(bankTransactionsTable.id)
    .for("update", { of: [bankTransactionsTable, cashTransactionsTable] });

  const bankIds = pairs.map((pair: any) => pair.bank.id as number);
  const cashIds = pairs.map((pair: any) => pair.cash.id as number);
  const linkedExpenses = pairs.length
    ? await tx.select().from(operatingExpensesTable).where(or(
      inArray(operatingExpensesTable.bankTransactionId, bankIds),
      inArray(operatingExpensesTable.cashTransactionId, cashIds),
    )).for("update")
    : [];
  const byBank = new Map<number, typeof operatingExpensesTable.$inferSelect>(
    linkedExpenses.filter((expense: typeof operatingExpensesTable.$inferSelect) => expense.bankTransactionId !== null)
      .map((expense: typeof operatingExpensesTable.$inferSelect) => [expense.bankTransactionId!, expense]),
  );
  const byCash = new Map<number, typeof operatingExpensesTable.$inferSelect>(
    linkedExpenses.filter((expense: typeof operatingExpensesTable.$inferSelect) => expense.cashTransactionId !== null)
      .map((expense: typeof operatingExpensesTable.$inferSelect) => [expense.cashTransactionId!, expense]),
  );
  const [canonicalAccount] = pairs.some((pair: any) => pair.cash.category === OPERATING_EXPENSE_CATEGORY)
    ? await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(and(
      eq(chartOfAccountsTable.code, "6900"),
      eq(chartOfAccountsTable.type, "expense"),
    ))
    : [];

  let syncedCount = 0;
  for (const { bank, cash } of pairs) {
    const expense = byBank.get(bank.id) ?? byCash.get(cash.id);
    const keepsBankAccount = cash.sourceType === "bank_transaction"
      && bank.accountId !== null && cash.accountId === bank.accountId;
    const isCurrent = cash.category === OPERATING_EXPENSE_CATEGORY
      && canonicalAccount
      && (keepsBankAccount || cash.accountId === canonicalAccount.id)
      && expense
      && expense.bankTransactionId === bank.id
      && expense.cashTransactionId === cash.id
      && expense.description === cash.description
      && expense.date === cash.date
      && expense.amount === cash.amount
      && expense.paymentDate === cash.date
      && expense.paymentAmount === cash.amount;
    if (isCurrent) continue;
    await syncOperatingExpenseForBankCash(tx, bank.id, cash.id);
    syncedCount++;
  }
  const rows = await tx.select().from(operatingExpensesTable);
  report?.({ candidatePairCount: pairs.length, syncedCount, elapsedMs: Math.round(performance.now() - started) });
  return rows;
}