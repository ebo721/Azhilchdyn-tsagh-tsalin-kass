import { and, desc, eq, sql } from "drizzle-orm";
import { bankTransactionsTable, cashClosuresTable, cashTransactionsTable, chartOfAccountsTable, db } from "@workspace/db";
import { lockCashDate } from "./cash-date-lock.js";
import { postBankCashJournal } from "./bank-cash-lifecycle.js";
import { inventoryMaterialLabel, type Tx } from "./route-shared.js";
import { JournalValidationError } from "./journal-posting.js";

export const pendingPurchaseKey = (id: number) => `pending-purchase:${id}`;

/** No invented supplier or stock line: the existing bank/cash pair is the pending document. */
export async function listPendingInventoryPurchases() {
  const rows = await db.select({ bank: bankTransactionsTable, account: chartOfAccountsTable })
    .from(bankTransactionsTable)
    .innerJoin(cashTransactionsTable, and(
      eq(bankTransactionsTable.cashTransactionId, cashTransactionsTable.id),
      eq(cashTransactionsTable.bankTransactionId, bankTransactionsTable.id),
      eq(cashTransactionsTable.sourceType, "bank_transaction"),
      sql`${cashTransactionsTable.sourceKey} = 'pending-purchase:' || ${bankTransactionsTable.id}::text`,
    ))
    .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, bankTransactionsTable.accountId))
    .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id));
  return rows.map(({ bank, account }) => ({
    id: bank.id, date: bank.transactionAt.toISOString().slice(0, 10),
    amount: Number(bank.amount), description: bank.description, bankAccount: bank.account,
    accountCode: account.code, accountName: account.name,
    materialType: account.code === "1510" ? "supply" : "food",
  }));
}

export async function postPendingInventoryPurchase(
  tx: Tx,
  bank: typeof bankTransactionsTable.$inferSelect,
  account: typeof chartOfAccountsTable.$inferSelect,
) {
  const date = bank.transactionAt.toISOString().slice(0, 10);
  await lockCashDate(tx, date);
  const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
  if (closed) throw new JournalValidationError("Өндөрлөсөн өдөр худалдан авалт бүртгэх боломжгүй");
  const category = inventoryMaterialLabel(account.code === "1510" ? "supply" : "food");
  const [cash] = await tx.insert(cashTransactionsTable).values({
    type: "expense", category, accountId: account.id,
    description: bank.description, amount: Number(bank.amount), date,
    sourceType: "bank_transaction", sourceKey: pendingPurchaseKey(bank.id),
    bankTransactionId: bank.id, bankVerifiedAt: new Date(),
  }).returning();
  const journalEntryId = await postBankCashJournal(tx, bank, cash, account);
  await tx.update(cashTransactionsTable).set({ journalEntryId }).where(eq(cashTransactionsTable.id, cash.id));
  await tx.update(bankTransactionsTable).set({
    cashTransactionId: cash.id, transferredAt: new Date(), accountId: account.id, journalEntryId,
  }).where(eq(bankTransactionsTable.id, bank.id));
  return { id: bank.id, journalEntryId };
}
