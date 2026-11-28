// @ts-nocheck
// Extracted from artifacts/staff-ops/src/lib/inventory-sections.ts; services replaced with local demo boundaries.
export const inventorySections = [
  { value: 'stock', label: 'Үлдэгдэл' },
  { value: 'purchases', label: 'Худалдан авалт' },
  { value: 'issues', label: 'Зарлага' },
  { value: 'requests', label: 'Захиалга' },
  { value: 'suppliers', label: 'Харилцагч' },
] as const;
export type InventorySection = typeof inventorySections[number]['value'];
export const INVENTORY_PATH = '/inventory';
export function parseInventorySection(search: string): InventorySection {
  const value = new URLSearchParams(search).get('section');
  return inventorySections.find((s) => s.value === value)?.value ?? 'stock';
}
export function inventorySectionHref(section: InventorySection) {
  return section === 'stock' ? INVENTORY_PATH : `${INVENTORY_PATH}?section=${section}`;
}
