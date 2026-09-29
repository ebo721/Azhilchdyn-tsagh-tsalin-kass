import { and, eq, gt, sql } from "drizzle-orm";
import {
  bankTransactionsTable,
  cashClosuresTable,
  chartOfAccountsTable,
  db,
  inventoryIssueConsumptionsTable,
  inventoryItemsTable,
  inventoryPurchaseItemsTable,
  inventoryPurchasesTable,
  inventoryPurchasePaymentGroupMembersTable,
  inventoryPurchasePaymentGroupsTable,
} from "@workspace/db";
import { money } from "./date-utils.js";
import type { Tx } from "./route-shared.js";

export class InventoryBankPaymentConflictError extends Error {}
export class OperatingExpenseBankPaymentConflictError extends Error {}

// Keep the shared route exports stable; the scoring implementation lives in one place.
export { descriptionTokens, bankSuggestionScore as inventoryBankSuggestionScore } from "./bank-suggestion-score.js";

/**
 * Reads available purchase lots for an item oldest-first (locking them for the
 * rest of this transaction) and works out which lot(s) an issue of `quantity`
 * would draw from. Read-only -- writes nothing. Returns null if the eligible
 * lots don't cover the requested quantity.
 */
export async function planInventoryFifoConsumption(tx: Tx, inventoryItemId: number, quantity: number) {
  const lots = await tx
    .select({
      id: inventoryPurchaseItemsTable.id,
      remainingQuantity: inventoryPurchaseItemsTable.remainingQuantity,
      unitPrice: inventoryPurchaseItemsTable.unitPrice,
    })
    .from(inventoryPurchaseItemsTable)
    .innerJoin(inventoryPurchasesTable, eq(inventoryPurchaseItemsTable.purchaseId, inventoryPurchasesTable.id))
    .where(and(
      eq(inventoryPurchaseItemsTable.inventoryItemId, inventoryItemId),
      gt(inventoryPurchaseItemsTable.remainingQuantity, 0),
    ))
    .orderBy(inventoryPurchasesTable.date, inventoryPurchaseItemsTable.id)
    .for("update");
  let remaining = quantity;
  const consumptions: Array<{ purchaseItemId: number; quantity: number; unitPrice: number }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.remainingQuantity), remaining);
    if (take <= 0) continue;
    consumptions.push({ purchaseItemId: lot.id, quantity: take, unitPrice: Number(lot.unitPrice) });
    remaining = money(remaining - take);
  }
  if (remaining > 0.0005) return null;
  return consumptions;
}

/** Writes a plan from planInventoryFifoConsumption: draws down the lots, records the
 * consumption ledger, and decrements the item's total quantity. Returns the FIFO cost. */
export async function applyInventoryFifoConsumption(
  tx: Tx,
  issueId: number,
  inventoryItemId: number,
  consumptions: Array<{ purchaseItemId: number; quantity: number; unitPrice: number }>,
) {
  for (const consumption of consumptions) {
    await tx.update(inventoryPurchaseItemsTable)
      .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} - ${consumption.quantity}` })
      .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
  }
  if (consumptions.length > 0) {
    await tx.insert(inventoryIssueConsumptionsTable).values(
      consumptions.map((consumption) => ({ issueId, ...consumption })),
    );
  }
  const totalQuantity = money(consumptions.reduce((total, consumption) => total + consumption.quantity, 0));
  await tx.update(inventoryItemsTable)
    .set({ quantity: sql`${inventoryItemsTable.quantity} - ${totalQuantity}` })
    .where(eq(inventoryItemsTable.id, inventoryItemId));
  return money(consumptions.reduce((total, consumption) => total + consumption.quantity * consumption.unitPrice, 0));
}

/** Undoes a previous applyInventoryFifoConsumption for this issue: adds the
 * consumed quantity back to its original lots and to the item's total, then
 * clears the consumption ledger for this issue. */
export async function reverseInventoryFifoConsumption(tx: Tx, issueId: number, inventoryItemId: number) {
  const consumptions = await tx.select().from(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
  for (const consumption of consumptions) {
    await tx.update(inventoryPurchaseItemsTable)
      .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} + ${consumption.quantity}` })
      .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
  }
  const totalQuantity = money(consumptions.reduce((total, consumption) => total + Number(consumption.quantity), 0));
  if (totalQuantity > 0) {
    await tx.update(inventoryItemsTable)
      .set({ quantity: sql`${inventoryItemsTable.quantity} + ${totalQuantity}` })
      .where(eq(inventoryItemsTable.id, inventoryItemId));
  }
  await tx.delete(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
}

export async function inventoryPurchaseResponse(id: number) {
  const [row] = await db.select({
    purchase: inventoryPurchasesTable,
    accountCode: chartOfAccountsTable.code,
    accountName: chartOfAccountsTable.name,
  }).from(inventoryPurchasesTable)
    .leftJoin(chartOfAccountsTable, eq(inventoryPurchasesTable.accountId, chartOfAccountsTable.id))
    .where(eq(inventoryPurchasesTable.id, id));
  if (!row) return null;
  const purchase = row.purchase;
  const [items, closure] = await Promise.all([
    db.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id)),
    db.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, purchase.date)),
  ]);
  const [paymentGroup] = await db.select({
    bankTransactionId: inventoryPurchasePaymentGroupsTable.bankTransactionId,
  }).from(inventoryPurchasePaymentGroupMembersTable)
    .innerJoin(inventoryPurchasePaymentGroupsTable, eq(
      inventoryPurchasePaymentGroupsTable.id,
      inventoryPurchasePaymentGroupMembersTable.groupId,
    ))
    .where(and(
      eq(inventoryPurchasePaymentGroupMembersTable.purchaseId, id),
      eq(inventoryPurchasePaymentGroupsTable.status, "active"),
    )).limit(1);
  return {
    id: purchase.id,
    materialType: purchase.materialType,
    accountId: purchase.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    supplierName: purchase.documentName,
    hasReceipt: purchase.hasReceipt,
    date: purchase.date,
    totalAmount: Number(purchase.totalAmount),
    paid: purchase.paymentDate !== null,
    paymentDate: purchase.paymentDate,
    paymentAmount: purchase.paymentAmount === null ? null : Number(purchase.paymentAmount),
    paymentGroupBankTransactionId: paymentGroup?.bankTransactionId ?? null,
    createdAt: purchase.createdAt.toISOString(),
    editable: closure.length === 0,
    items: items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalAmount: Number(item.totalAmount),
    })),
  };
}