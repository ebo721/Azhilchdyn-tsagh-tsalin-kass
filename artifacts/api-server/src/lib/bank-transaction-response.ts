import type { bankTransactionsTable } from "@workspace/db";

/** Shared bank facts for bank lists and the narrowly scoped cash detail view. */
export const bankTransactionResponse = (
  row: typeof bankTransactionsTable.$inferSelect,
  accountCode: string | null = null,
  accountName: string | null = null,
) => ({
  id: row.id, transactionAt: row.transactionAt.toISOString(), type: row.type as "income" | "expense",
  amount: Number(row.amount), accountId: row.accountId, accountCode, accountName,
  account: row.account, counterparty: row.counterparty, description: row.description,
  executedAt: row.executedAt?.toISOString() ?? null, balance: row.balance === null ? null : Number(row.balance),
  transferredAt: row.transferredAt?.toISOString() ?? null, cashTransactionId: row.cashTransactionId,
  bankAccountId: row.bankAccountId, bankName: row.bankName, bankAccountNumber: row.bankAccountNumber,
  createdAt: row.createdAt.toISOString(),
});
