import { and, eq, gt, lte, sql } from "drizzle-orm";
import {
  bankTransactionsTable,
  cashClosuresTable,
  chartOfAccountsTable,
  db,
  inventoryIssueConsumptionsTable,
  inventoryItemsTable,
  inventoryOpeningBalancesTable,
  inventoryOpeningConsumptionsTable,
  inventoryPurchaseItemsTable,
  inventoryPurchasesTable,
  inventoryPurchasePaymentGroupMembersTable,
  inventoryPurchasePaymentGroupsTable,
} from "@workspace/db";
import { money } from "./date-utils.js";
import type { Tx } from "./route-shared.js";
import { planInventoryLots, stockQuantity, type InventoryConsumption } from "./inventory-lot-plan.js";

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
export async function planInventoryFifoConsumption(tx: Tx, inventoryItemId: number, quantity: number, asOfDate?: string) {
  await tx.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, inventoryItemId)).for("update");
  const lots = await tx
    .select({
      id: inventoryPurchaseItemsTable.id,
      date: inventoryPurchasesTable.date,
      remainingQuantity: inventoryPurchaseItemsTable.remainingQuantity,
      unitPrice: inventoryPurchaseItemsTable.unitPrice,
    })
    .from(inventoryPurchaseItemsTable)
    .innerJoin(inventoryPurchasesTable, eq(inventoryPurchaseItemsTable.purchaseId, inventoryPurchasesTable.id))
    .where(and(
      eq(inventoryPurchaseItemsTable.inventoryItemId, inventoryItemId),
      gt(inventoryPurchaseItemsTable.remainingQuantity, 0),
      asOfDate ? lte(inventoryPurchasesTable.date, asOfDate) : undefined,
    ))
    .orderBy(inventoryPurchasesTable.date, inventoryPurchaseItemsTable.id)
    .for("update");
  const openingLots = await tx.select().from(inventoryOpeningBalancesTable)
    .where(and(eq(inventoryOpeningBalancesTable.inventoryItemId, inventoryItemId), gt(inventoryOpeningBalancesTable.remainingQuantity, 0),
      asOfDate ? lte(inventoryOpeningBalancesTable.date, asOfDate) : undefined))
    .orderBy(inventoryOpeningBalancesTable.date, inventoryOpeningBalancesTable.id).for("update");
  return planInventoryLots([
    ...lots.map((lot) => ({ ...lot, source: "purchase" as const })),
    ...openingLots.map((lot) => ({ ...lot, source: "opening" as const })),
  ], quantity);
}

/** Writes a plan from planInventoryFifoConsumption: draws down the lots, records the
 * consumption ledger, and decrements the item's total quantity. Returns the FIFO cost. */
export async function applyInventoryFifoConsumption(
  tx: Tx,
  issueId: number,
  inventoryItemId: number,
  consumptions: InventoryConsumption[],
) {
  for (const consumption of consumptions) {
    if (consumption.purchaseItemId !== undefined) {
      await tx.update(inventoryPurchaseItemsTable)
        .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} - ${consumption.quantity}` })
        .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
    } else if (consumption.openingBalanceId !== undefined) {
      await tx.update(inventoryOpeningBalancesTable)
        .set({ remainingQuantity: sql`${inventoryOpeningBalancesTable.remainingQuantity} - ${consumption.quantity}` })
        .where(eq(inventoryOpeningBalancesTable.id, consumption.openingBalanceId));
    }
  }
  const purchased = consumptions.filter((line) => line.purchaseItemId !== undefined);
  const opening = consumptions.filter((line) => line.openingBalanceId !== undefined);
  if (purchased.length > 0) {
    await tx.insert(inventoryIssueConsumptionsTable).values(
      purchased.map((line) => ({ issueId, purchaseItemId: line.purchaseItemId!, quantity: line.quantity, unitPrice: line.unitPrice })),
    );
  }
  if (opening.length > 0) {
    await tx.insert(inventoryOpeningConsumptionsTable).values(
      opening.map((line) => ({ issueId, openingBalanceId: line.openingBalanceId!, quantity: line.quantity, unitPrice: line.unitPrice })),
    );
  }
  const totalQuantity = stockQuantity(consumptions.reduce((total, consumption) => total + consumption.quantity, 0));
  await tx.update(inventoryItemsTable)
    .set({ quantity: sql`${inventoryItemsTable.quantity} - ${totalQuantity}` })
    .where(eq(inventoryItemsTable.id, inventoryItemId));
  return money(consumptions.reduce((total, consumption) => total + consumption.quantity * consumption.unitPrice, 0));
}

/** Undoes a previous applyInventoryFifoConsumption for this issue: adds the
 * consumed quantity back to its original lots and to the item's total, then
 * clears the consumption ledger for this issue. */
export async function reverseInventoryFifoConsumption(tx: Tx, issueId: number, inventoryItemId: number) {
  await tx.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, inventoryItemId)).for("update");
  const consumptions = await tx.select().from(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
  const opening = await tx.select().from(inventoryOpeningConsumptionsTable).where(eq(inventoryOpeningConsumptionsTable.issueId, issueId));
  for (const consumption of consumptions) {
    await tx.update(inventoryPurchaseItemsTable)
      .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} + ${consumption.quantity}` })
      .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
  }
  for (const line of opening) {
    await tx.update(inventoryOpeningBalancesTable)
      .set({ remainingQuantity: sql`${inventoryOpeningBalancesTable.remainingQuantity} + ${line.quantity}` })
      .where(eq(inventoryOpeningBalancesTable.id, line.openingBalanceId));
  }
  const totalQuantity = stockQuantity([...consumptions, ...opening].reduce((total, consumption) => total + Number(consumption.quantity), 0));
  if (totalQuantity > 0) {
    await tx.update(inventoryItemsTable)
      .set({ quantity: sql`${inventoryItemsTable.quantity} + ${totalQuantity}` })
      .where(eq(inventoryItemsTable.id, inventoryItemId));
  }
  await tx.delete(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
  await tx.delete(inventoryOpeningConsumptionsTable).where(eq(inventoryOpeningConsumptionsTable.issueId, issueId));
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
    documentNumber: purchase.documentNumber,
    materialType: purchase.materialType,
    accountId: purchase.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    supplierName: purchase.documentName,
    responsibleUserId: purchase.responsibleUserId,
    responsibleEmployeeId: purchase.responsibleEmployeeId,
    responsibleName: purchase.responsibleName,
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