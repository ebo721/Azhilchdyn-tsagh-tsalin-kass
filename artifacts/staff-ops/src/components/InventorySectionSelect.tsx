import { inventorySections, type InventorySection } from '@/lib/inventory-sections';

/** Compact section selector for phones; desktop navigation lives in the sidebar. */
export function InventorySectionSelect({ value, onChange }: { value: InventorySection; onChange: (s: InventorySection) => void }) {
  return <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold lg:hidden">
    <span className="shrink-0 text-muted-foreground">Хэсэг</span>
    <select value={value} onChange={(e) => onChange(e.target.value as InventorySection)} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm font-bold" aria-label="Бараа материалын хэсэг сонгох" data-testid="select-inventory-section">
      {inventorySections.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  </label>;
}
