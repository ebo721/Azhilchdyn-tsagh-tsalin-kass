import { and, desc, eq, sql } from "drizzle-orm";
import { bankTransactionsTable, cashClosuresTable, cashTransactionsTable, chartOfAccountsTable, db } from "@workspace/db";
import { lockCashDate } from "./cash-date-lock.js";
import { postBankCashJournal } from "./bank-cash-lifecycle.js";
import { inventoryMaterialLabel, type Tx } from "./route-shared.js";
import { JournalValidationError } from "./journal-posting.js";

export const pendingPurchaseKey = (id: number) => `pending-purchase:${id}`;

export async function pendingPurchaseSuggestions(id: number) {
  const pending = (await listPendingInventoryPurchases()).find(row => row.id === id);
  if (!pending) return null;
  const result = await db.execute(sql`
    SELECT p.id, p.document_name, p.date::text AS date, p.material_type, p.total_amount
    FROM inventory_purchases p
    WHERE p.payment_date IS NULL
      AND p.date <= ${pending.date}
      AND (p.total_amount = ${pending.amount} OR p.material_type = ${pending.materialType})
      AND NOT EXISTS (SELECT 1 FROM cash_transactions c
        WHERE c.source_type = 'inventory_purchase' AND c.source_key = 'purchase:' || p.id::text)
      AND NOT EXISTS (SELECT 1 FROM inventory_purchase_payment_group_members m
        JOIN inventory_purchase_payment_groups g ON g.id = m.group_id
        WHERE m.purchase_id = p.id AND g.status = 'active')
    ORDER BY (p.total_amount = ${pending.amount}) DESC,
      (p.material_type = ${pending.materialType}) DESC, p.date DESC, p.id DESC
  `);
  return result.rows.map(row => {
    const sameAmount = Math.round(Number(row.total_amount) * 100) === Math.round(pending.amount * 100);
    const sameType = row.material_type === pending.materialType;
    return {
      id: Number(row.id), documentName: String(row.document_name), date: String(row.date).slice(0, 10),
      materialType: row.material_type, totalAmount: Number(row.total_amount),
      sameAmount, sameType, linkable: sameAmount && sameType,
    };
  });
}

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
