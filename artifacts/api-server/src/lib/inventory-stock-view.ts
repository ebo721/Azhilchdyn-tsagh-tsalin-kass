import type { inventoryItemsTable } from "@workspace/db";
import { money } from "./date-utils.js";

type Lot = {
  inventoryItemId: number | null;
  remainingQuantity: number | string;
  unitPrice: number | string;
};

/** Shared by stock listing and item edits so both return the same live valuation/documents. */
export function formatInventoryStock(
  items: Array<typeof inventoryItemsTable.$inferSelect>,
  lots: Array<Lot & { documentNumber: string }>,
  openingLots: Lot[],
) {
  const values = new Map<number, number>();
  const documents = new Map<number, Set<string>>();
  for (const lot of [...lots, ...openingLots]) {
    if (lot.inventoryItemId === null) continue;
    values.set(lot.inventoryItemId, (values.get(lot.inventoryItemId) ?? 0) +
      Number(lot.remainingQuantity) * Number(lot.unitPrice));
    if ("documentNumber" in lot && Number(lot.remainingQuantity) > 0) {
      const numbers = documents.get(lot.inventoryItemId) ?? new Set<string>();
      numbers.add(String(lot.documentNumber));
      documents.set(lot.inventoryItemId, numbers);
    }
  }
  return items.map(item => ({
    id: item.id, materialType: item.materialType, name: item.name, category: item.category, unit: item.unit,
    quantity: Number(item.quantity), totalValue: money(values.get(item.id) ?? 0),
    purchaseDocumentNumbers: [...(documents.get(item.id) ?? [])].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    createdAt: item.createdAt.toISOString(),
  }));
}
