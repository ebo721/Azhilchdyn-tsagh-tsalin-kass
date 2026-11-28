import { useState } from 'react';
import { CalendarDays, ChevronRight, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type PurchaseFilters = { search: string; bank: 'all' | 'linked' | 'unlinked'; payment: 'all' | 'paid' | 'unpaid'; receipt: 'all' | 'with' | 'without' };
export const defaultPurchaseFilters: PurchaseFilters = { search: '', bank: 'all', payment: 'all', receipt: 'all' };

const selectCls = 'h-9 w-full rounded-lg border border-input bg-background px-2 text-sm';

export function InventoryPurchaseToolbar({ month, monthLabel, onMonthChange, onShiftMonth, filters, onFiltersChange, materialSelector, pendingLauncher }: {
  month: string; monthLabel: string; onMonthChange: (m: string) => void; onShiftMonth: (delta: number) => void;
  filters: PurchaseFilters; onFiltersChange: (f: PurchaseFilters) => void;
  materialSelector: React.ReactNode; pendingLauncher: React.ReactNode;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const active = (['bank', 'payment', 'receipt'] as const).filter((k) => filters[k] !== 'all').length;
  const set = <K extends keyof PurchaseFilters>(k: K, v: PurchaseFilters[K]) => onFiltersChange({ ...filters, [k]: v });
  return <div className="mb-3 shrink-0 space-y-2" data-testid="inventory-purchase-toolbar">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card">
        <button type="button" onClick={() => onShiftMonth(-1)} className="grid size-10 place-items-center border-r border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-inventory-purchase-previous-month"><ChevronRight className="size-4 rotate-180" /></button>
        <div className="flex items-center gap-2 px-2 sm:px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-16 cursor-pointer items-center text-sm font-semibold sm:min-w-28"><span className="sm:hidden">{month.replace('-', '.')}</span><span className="hidden sm:inline">{monthLabel}</span><input type="month" value={month} onChange={(e) => e.target.value && onMonthChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Бараа материалын худалдан авалтын сар сонгох" data-testid="input-inventory-purchase-month" /></label></div>
        <button type="button" onClick={() => onShiftMonth(1)} className="grid size-10 place-items-center border-l border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-inventory-purchase-next-month"><ChevronRight className="size-4" /></button>
      </div>
      {materialSelector}
      <div className="relative min-w-[14rem] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={filters.search} onChange={(e) => set('search', e.target.value)} className="h-10 pl-9" placeholder="Харилцагч, баримт, бараагаар хайх" aria-label="Худалдан авалт хайх" data-testid="input-search-inventory-purchases" /></div>
      <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} aria-controls="inventory-purchase-filter-panel" className={cn('inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-bold', showFilters || active ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card text-foreground hover:bg-secondary')} data-testid="button-inventory-purchase-filters"><SlidersHorizontal className="size-4" />Шүүлтүүр{active > 0 && <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground" data-testid="value-inventory-purchase-filter-count">{active}</span>}</button>
      {pendingLauncher}
    </div>
    {showFilters && <div id="inventory-purchase-filter-panel" className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" data-testid="inventory-purchase-filter-panel">
      <label className="space-y-1 text-[11px] font-bold text-muted-foreground">Банкны холбоос<select value={filters.bank} onChange={(e) => set('bank', e.target.value as PurchaseFilters['bank'])} className={selectCls} data-testid="filter-purchase-bank-link"><option value="all">Бүгд</option><option value="linked">Холбогдсон</option><option value="unlinked">Холбогдоогүй</option></select></label>
      <label className="space-y-1 text-[11px] font-bold text-muted-foreground">Төлбөр<select value={filters.payment} onChange={(e) => set('payment', e.target.value as PurchaseFilters['payment'])} className={selectCls} data-testid="filter-purchase-payment"><option value="all">Бүгд</option><option value="paid">Төлсөн</option><option value="unpaid">Төлөөгүй</option></select></label>
      <label className="space-y-1 text-[11px] font-bold text-muted-foreground">Баримт<select value={filters.receipt} onChange={(e) => set('receipt', e.target.value as PurchaseFilters['receipt'])} className={selectCls} data-testid="filter-purchase-receipt"><option value="all">Бүгд</option><option value="with">Баримттай</option><option value="without">Баримтгүй</option></select></label>
      <button type="button" onClick={() => onFiltersChange({ ...defaultPurchaseFilters, search: filters.search })} disabled={!active} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold text-muted-foreground hover:bg-secondary disabled:opacity-40" data-testid="button-reset-inventory-purchase-filters"><RotateCcw className="size-3.5" />Цэвэрлэх</button>
    </div>}
  </div>;
}
