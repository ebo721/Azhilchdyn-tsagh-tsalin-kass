export type InventoryLot = {
  id: number;
  date: string;
  source: "purchase" | "opening";
  remainingQuantity: number;
  unitPrice: number;
};

export type InventoryConsumption = {
  quantity: number;
  unitPrice: number;
  purchaseItemId?: number;
  openingBalanceId?: number;
};

export const stockQuantity = (value: number) => Math.round(value * 1000) / 1000;

export function planInventoryLots(lots: InventoryLot[], quantity: number): InventoryConsumption[] | null {
  const ordered = [...lots].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.source === b.source ? a.id - b.id : a.source === "opening" ? -1 : 1));
  let remaining = stockQuantity(quantity);
  const result: InventoryConsumption[] = [];
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = stockQuantity(Math.min(lot.remainingQuantity, remaining));
    if (take <= 0) continue;
    result.push({
      ...(lot.source === "purchase" ? { purchaseItemId: lot.id } : { openingBalanceId: lot.id }),
      quantity: take,
      unitPrice: lot.unitPrice,
    });
    remaining = stockQuantity(remaining - take);
  }
  return remaining > 0 ? null : result;
}
