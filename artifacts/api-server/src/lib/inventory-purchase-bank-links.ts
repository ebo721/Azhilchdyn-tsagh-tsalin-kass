import { and, eq, sql } from "drizzle-orm";
import {
  db, bankTransactionsTable, cashTransactionsTable,
  inventoryPurchasePaymentGroupsTable, inventoryPurchasePaymentGroupMembersTable,
} from "@workspace/db";

/** Read current reciprocal links, never infer bank funding from a payment date. */
export async function inventoryPurchaseBankLinks() {
  const [single, grouped] = await Promise.all([
    db.select({ sourceKey: cashTransactionsTable.sourceKey, bank: bankTransactionsTable })
      .from(cashTransactionsTable)
      .innerJoin(bankTransactionsTable, and(
        eq(bankTransactionsTable.id, cashTransactionsTable.bankTransactionId),
        eq(bankTransactionsTable.cashTransactionId, cashTransactionsTable.id),
      ))
      .where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        sql`${cashTransactionsTable.sourceKey} ~ '^purchase:[0-9]+$'`,
      )),
    db.select({ purchaseId: inventoryPurchasePaymentGroupMembersTable.purchaseId, bank: bankTransactionsTable })
      .from(inventoryPurchasePaymentGroupMembersTable)
      .innerJoin(inventoryPurchasePaymentGroupsTable, eq(inventoryPurchasePaymentGroupsTable.id, inventoryPurchasePaymentGroupMembersTable.groupId))
      .innerJoin(bankTransactionsTable, and(
        eq(bankTransactionsTable.id, inventoryPurchasePaymentGroupsTable.bankTransactionId),
        eq(bankTransactionsTable.cashTransactionId, inventoryPurchasePaymentGroupsTable.cashTransactionId),
      ))
      .where(eq(inventoryPurchasePaymentGroupsTable.status, "active")),
  ]);
  const connection = (bank: typeof bankTransactionsTable.$inferSelect, kind: "single" | "group") => ({
    id: bank.id, transactionAt: bank.transactionAt.toISOString(), amount: Number(bank.amount),
    description: bank.description, account: bank.account, kind,
  });
  return new Map([
    ...single.map(row => [Number(row.sourceKey!.slice(9)), connection(row.bank, "single")] as const),
    ...grouped.map(row => [row.purchaseId, connection(row.bank, "group")] as const),
  ]);
}
