import { bankTransactionsTable, inventoryPurchasesTable } from "@workspace/db";

export class InventoryBankPaymentConflictError extends Error {}
export class OperatingExpenseBankPaymentConflictError extends Error {}

export const descriptionTokens = (value: string) => new Set(value.toLocaleLowerCase("mn-MN").match(/[\p{L}\p{N}]+/gu) ?? []);
export const inventoryBankSuggestionScore = (
  purchase: typeof inventoryPurchasesTable.$inferSelect,
  bank: typeof bankTransactionsTable.$inferSelect,
) => {
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  const distance = Math.abs((Date.parse(`${purchase.date}T00:00:00Z`) - Date.parse(`${bankDate}T00:00:00Z`)) / 86_400_000);
  const bankAmount = Number(bank.amount);
  const purchaseAmount = Number(purchase.totalAmount);
  const amountCloseness = Math.max(0, 1 - Math.abs(bankAmount - purchaseAmount) / Math.max(bankAmount, purchaseAmount, 1));
  const bankTokens = descriptionTokens(`${bank.description} ${bank.counterparty}`);
  const purchaseTokens = descriptionTokens(purchase.documentName);
  const overlap = [...bankTokens].filter((token) => purchaseTokens.has(token)).length;
  const tokenOverlap = overlap / Math.max(new Set([...bankTokens, ...purchaseTokens]).size, 1);
  return Math.round((0.4 * (1 - distance / 7) + 0.35 * amountCloseness + 0.25 * tokenOverlap) * 10_000) / 100;
};