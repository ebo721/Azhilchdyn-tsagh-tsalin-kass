import { and, desc, eq, lte, sql } from "drizzle-orm";
import {
  db, inventoryClosingBalancesTable, inventoryItemsTable, inventoryOpeningBalancesTable,
  inventoryPurchaseItemsTable, inventoryPurchasesTable,
} from "@workspace/db";
import { money } from "./date-utils.js";
import { stockQuantity } from "./inventory-lot-plan.js";
import type { Tx } from "./route-shared.js";

export class InventoryClosingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Original receipt/issue quantities reconstruct end-of-day stock; current lot
 * balances already include later movements and are not a historical balance. */
export async function inventoryClosingQuote(client: Tx | typeof db, inventoryItemId: number, date: string) {
  const [stock] = await client.select({
    bookQuantity: sql<string>`(
      coalesce((select sum(quantity) from inventory_opening_balances where inventory_item_id = ${inventoryItemId} and date <= ${date}::date), 0)
      + coalesce((select sum(l.quantity) from inventory_purchase_items l join inventory_purchases p on p.id = l.purchase_id
        where l.inventory_item_id = ${inventoryItemId} and p.date <= ${date}::date), 0)
      - coalesce((select sum(i.quantity) from inventory_issues i left join inventory_closing_balances c on c.issue_id = i.id
        where i.inventory_item_id = ${inventoryItemId} and i.date <= ${date}::date and (c.id is null or c.approved_at is not null)), 0)
    )`,
  }).from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  if (!stock) throw new InventoryClosingError(404, "Бараа материал олдсонгүй");
  const bookQuantity = stockQuantity(Number(stock.bookQuantity));
  if (bookQuantity < 0) throw new InventoryClosingError(409, "Сонгосон огнооны бүртгэлийн үлдэгдэл сөрөг байна. Орлого, зарлагын огноог шалгана уу.");
  const [purchase] = await client.select({ unitPrice: inventoryPurchaseItemsTable.unitPrice })
    .from(inventoryPurchaseItemsTable)
    .innerJoin(inventoryPurchasesTable, eq(inventoryPurchasesTable.id, inventoryPurchaseItemsTable.purchaseId))
    .where(and(eq(inventoryPurchaseItemsTable.inventoryItemId, inventoryItemId), lte(inventoryPurchasesTable.date, date)))
    .orderBy(desc(inventoryPurchasesTable.date), desc(inventoryPurchasesTable.id), desc(inventoryPurchaseItemsTable.id)).limit(1);
  if (purchase) return { inventoryItemId, date, bookQuantity, unitPrice: Number(purchase.unitPrice), priceSource: "purchase" as const };
  const [opening] = await client.select({ unitPrice: inventoryOpeningBalancesTable.unitPrice }).from(inventoryOpeningBalancesTable)
    .where(and(eq(inventoryOpeningBalancesTable.inventoryItemId, inventoryItemId), lte(inventoryOpeningBalancesTable.date, date)))
    .orderBy(desc(inventoryOpeningBalancesTable.date), desc(inventoryOpeningBalancesTable.id)).limit(1);
  return { inventoryItemId, date, bookQuantity, unitPrice: opening ? Number(opening.unitPrice) : null, priceSource: opening ? "opening" as const : "none" as const };
}

export async function inventoryClosingView(client: Tx | typeof db, id: number) {
  const [row] = await client.select({ count: inventoryClosingBalancesTable, item: inventoryItemsTable })
    .from(inventoryClosingBalancesTable).innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, inventoryClosingBalancesTable.inventoryItemId))
    .where(eq(inventoryClosingBalancesTable.id, id));
  if (!row) throw new InventoryClosingError(404, "Эцсийн үлдэгдлийн бүртгэл олдсонгүй");
  return formatInventoryClosing(row);
}

export function formatInventoryClosing({ count, item }: {
  count: typeof inventoryClosingBalancesTable.$inferSelect; item: typeof inventoryItemsTable.$inferSelect;
}) {
  return {
    ...count, itemName: item.name, materialType: item.materialType, unit: item.unit,
    totalAmount: money(count.quantity * count.unitPrice),
    difference: stockQuantity(count.bookQuantity - count.quantity),
    status: count.issueId === null ? "recorded" : count.approvedAt === null ? "pending" : "confirmed",
    createdAt: count.createdAt.toISOString(),
  };
}
