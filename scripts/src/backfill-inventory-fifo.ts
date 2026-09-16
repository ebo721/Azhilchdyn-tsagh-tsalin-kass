/**
 * One-time migration: backfills FIFO lot tracking for inventory.
 *
 * Before this script runs, every purchase line (`inventory_purchase_items`) and
 * every stock issue (`inventory_issues`) exists, but nothing records WHICH
 * purchase line a given issue actually drew stock from -- issues just
 * decremented the item's total `quantity`. This script reconstructs that
 * history: for each inventory item, it replays every purchase (oldest first)
 * and every issue (oldest first, interleaved by date) exactly the way the new
 * FIFO issue logic will going forward, and writes the result as:
 *
 *   - `inventory_purchase_items.remaining_quantity` per lot
 *   - one `inventory_issue_consumptions` row per (issue, lot) pair consumed
 *   - a corrected `inventory_items.quantity` if it had drifted from reality
 *     (this can happen from a pre-existing race condition in the old
 *     edit-issue endpoint that didn't guard against negative stock)
 *
 * SAFE BY DEFAULT: runs as a dry run (prints what it would do, changes
 * nothing) unless you pass --commit. Run the dry run first and read the
 * summary before committing.
 *
 * Usage (run once, after `pnpm --filter @workspace/db run push` has created
 * the new column/table, and against the SAME DATABASE_URL as production):
 *
 *   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
 *     pnpm --filter @workspace/scripts run backfill-inventory-fifo
 *
 *   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
 *     pnpm --filter @workspace/scripts run backfill-inventory-fifo -- --commit
 */
import {
  db,
  inventoryItemsTable,
  inventoryIssueConsumptionsTable,
  inventoryIssuesTable,
  inventoryPurchaseItemsTable,
  inventoryPurchasesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const commit = process.argv.includes("--commit");

type Lot = {
  purchaseItemId: number;
  date: string;
  unitPrice: number;
  available: number;
};

async function main() {
  const [items, purchaseLines, issues] = await Promise.all([
    db.select().from(inventoryItemsTable),
    db
      .select({
        id: inventoryPurchaseItemsTable.id,
        inventoryItemId: inventoryPurchaseItemsTable.inventoryItemId,
        quantity: inventoryPurchaseItemsTable.quantity,
        unitPrice: inventoryPurchaseItemsTable.unitPrice,
        date: inventoryPurchasesTable.date,
      })
      .from(inventoryPurchaseItemsTable)
      .innerJoin(inventoryPurchasesTable, eq(inventoryPurchaseItemsTable.purchaseId, inventoryPurchasesTable.id)),
    db.select().from(inventoryIssuesTable),
  ]);

  const lotsByItem = new Map<number, Lot[]>();
  for (const line of purchaseLines) {
    if (line.inventoryItemId === null) continue;
    const list = lotsByItem.get(line.inventoryItemId) ?? [];
    list.push({
      purchaseItemId: line.id,
      date: line.date,
      unitPrice: Number(line.unitPrice),
      available: Number(line.quantity),
    });
    lotsByItem.set(line.inventoryItemId, list);
  }
  for (const list of lotsByItem.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.purchaseItemId - b.purchaseItemId);
  }

  const issuesByItem = new Map<number, typeof issues>();
  for (const issue of issues) {
    const list = issuesByItem.get(issue.inventoryItemId) ?? [];
    list.push(issue);
    issuesByItem.set(issue.inventoryItemId, list);
  }
  for (const list of issuesByItem.values()) {
    list.sort((a, b) => a.date.localeCompare(String(b.date)) || a.id - b.id);
  }

  const consumptions: Array<{ issueId: number; purchaseItemId: number; quantity: number; unitPrice: number }> = [];
  const quantityCorrections: Array<{ itemId: number; itemName: string; oldQuantity: number; newQuantity: number }> = [];
  const shortfalls: Array<{ itemId: number; itemName: string; issueId: number; missing: number }> = [];

  for (const item of items) {
    const lots = lotsByItem.get(item.id) ?? [];
    const itemIssues = issuesByItem.get(item.id) ?? [];
    for (const issue of itemIssues) {
      let remaining = Number(issue.quantity);
      for (const lot of lots) {
        if (remaining <= 0) break;
        if (lot.available <= 0) continue;
        const take = Math.min(lot.available, remaining);
        consumptions.push({ issueId: issue.id, purchaseItemId: lot.purchaseItemId, quantity: take, unitPrice: lot.unitPrice });
        lot.available = Math.round((lot.available - take) * 1000) / 1000;
        remaining = Math.round((remaining - take) * 1000) / 1000;
      }
      if (remaining > 0.001) {
        shortfalls.push({ itemId: item.id, itemName: item.name, issueId: issue.id, missing: remaining });
      }
    }
    const reconstructedQuantity = Math.round(lots.reduce((total, lot) => total + lot.available, 0) * 1000) / 1000;
    const currentQuantity = Number(item.quantity);
    if (Math.abs(reconstructedQuantity - currentQuantity) > 0.001) {
      quantityCorrections.push({ itemId: item.id, itemName: item.name, oldQuantity: currentQuantity, newQuantity: reconstructedQuantity });
    }
  }

  const allLots = [...lotsByItem.values()].flat();

  console.log(`Items processed: ${items.length}`);
  console.log(`Purchase lots: ${allLots.length}`);
  console.log(`Issues replayed: ${issues.length}`);
  console.log(`Consumption records to create: ${consumptions.length}`);
  console.log(`Quantity corrections needed: ${quantityCorrections.length}`);
  for (const correction of quantityCorrections) {
    console.log(`  - ${correction.itemName} (#${correction.itemId}): ${correction.oldQuantity} -> ${correction.newQuantity}`);
  }
  console.log(`Shortfalls (issue quantity exceeds available lots -- pre-existing data drift): ${shortfalls.length}`);
  for (const shortfall of shortfalls) {
    console.log(`  - ${shortfall.itemName} (#${shortfall.itemId}), issue #${shortfall.issueId}: short by ${shortfall.missing}`);
  }

  if (!commit) {
    console.log("\nDry run only -- no changes written. Re-run with --commit to apply.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const lot of allLots) {
      await tx
        .update(inventoryPurchaseItemsTable)
        .set({ remainingQuantity: lot.available })
        .where(eq(inventoryPurchaseItemsTable.id, lot.purchaseItemId));
    }
    if (consumptions.length > 0) {
      await tx.insert(inventoryIssueConsumptionsTable).values(consumptions);
    }
    for (const correction of quantityCorrections) {
      await tx
        .update(inventoryItemsTable)
        .set({ quantity: correction.newQuantity })
        .where(eq(inventoryItemsTable.id, correction.itemId));
    }
  });

  console.log("\nCommitted.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
