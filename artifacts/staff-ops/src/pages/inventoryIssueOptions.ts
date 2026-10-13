export type IssueCatalogItem = { id: number; quantity: number };

/** Strictly positive stock only; when editing, the original item stays with quantity + original issue quantity. */
export function issueCatalogOptions<T extends IssueCatalogItem>(
  catalog: T[] | undefined,
  editing?: { inventoryItemId: number; quantity: number } | null,
): Array<T & { available: number }> {
  return (catalog ?? [])
    .map((item) => ({ ...item, available: item.quantity + (editing && editing.inventoryItemId === item.id ? editing.quantity : 0) }))
    .filter((item) => item.available > 0);
}
