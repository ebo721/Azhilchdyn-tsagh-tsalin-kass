import { ArrowRightLeft, ChevronRight, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { InventoryPurchase } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { PurchaseBankConnection } from '@/components/PurchaseBankConnection';
import { AccountLabel } from '@/pages/Cash';
import { dateLabel, money } from '@/lib/app-shared';
import { cn } from '@/lib/utils';
import { PackageOpen } from 'lucide-react';

type Actions = {
  onOpen: (p: InventoryPurchase) => void; onEdit: (p: InventoryPurchase) => void; onReclassify: (p: InventoryPurchase) => void;
  onDelete: (p: InventoryPurchase) => void; onPayment: (p: InventoryPurchase, pay: boolean) => void;
  paymentBusy: boolean; deleteBusy: boolean; readOnly: boolean;
};

const badge = 'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold';
function PaidBadge({ p }: { p: InventoryPurchase }) {
  return <span className={cn(badge, p.paid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-orange-200 bg-orange-50 text-orange-800')} data-testid={`status-inventory-payment-${p.id}`}>{p.paid ? 'Төлсөн' : 'Төлөөгүй'}</span>;
}
function ReceiptBadge({ p }: { p: InventoryPurchase }) {
  return <span className={cn(badge, p.hasReceipt ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{p.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span>;
}
function PaymentButton({ p, a }: { p: InventoryPurchase; a: Actions }) {
  if (a.readOnly) return null;
  return <Button type="button" size="sm" variant={p.paid ? 'ghost' : 'outline'} className="h-7 px-2 text-xs" disabled={a.paymentBusy} onClick={(e) => { e.stopPropagation(); a.onPayment(p, !p.paid); }} aria-label={p.paid ? `${p.supplierName} төлбөр цуцлах` : `${p.supplierName} төлбөр банкны гүйлгээтэй холбох`} data-testid={`checkbox-inventory-payment-${p.id}`}>{p.paid ? 'Төлбөр цуцлах' : 'Төлбөр холбох'}</Button>;
}
function RowMenu({ p, a }: { p: InventoryPurchase; a: Actions }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className="size-8" onClick={(e) => e.stopPropagation()} aria-label={`${p.supplierName} үйлдлүүд`} data-testid={`button-actions-inventory-${p.id}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
      <DropdownMenuItem onSelect={() => a.onOpen(p)} data-testid={`button-view-inventory-${p.id}`}><Eye className="size-4" />Дэлгэрэнгүй</DropdownMenuItem>
      {p.editable && !a.readOnly && <>
        <DropdownMenuItem onSelect={() => a.onEdit(p)} data-testid={`button-edit-inventory-${p.id}`}><Pencil className="size-4" />Засах</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.onReclassify(p)} data-testid={`button-reclassify-inventory-${p.id}`}><ArrowRightLeft className="size-4" />Үйл ажиллагааны зардал руу шилжүүлэх</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={a.deleteBusy} onSelect={() => a.onDelete(p)} className="text-destructive focus:text-destructive" data-testid={`button-delete-inventory-${p.id}`}><Trash2 className="size-4" />Устгах</DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function InventoryPurchaseList({ rows, totalCount, totalAmount, accounts, isLoading, isError, onRetry, page, pageCount, pageSize, onPage, hasFilters, ...a }: Actions & {
  rows: InventoryPurchase[]; totalCount: number; totalAmount: number; accounts: Array<{ code: string | null; name: string | null }>;
  isLoading: boolean; isError: boolean; onRetry: () => void; page: number; pageCount: number; pageSize: number; onPage: (p: number) => void; hasFilters: boolean;
}) {
  const from = totalCount ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, totalCount);
  return <section aria-label="Бүртгэлтэй худалдан авалт" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card" data-testid="inventory-purchase-list">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-sm font-bold">Бүртгэлтэй худалдан авалт</h2><span className="font-mono text-xs text-muted-foreground" data-testid="text-inventory-purchase-count">{totalCount} бүртгэл</span><span className="text-xs text-muted-foreground">Нийт <strong className="font-mono text-primary" data-testid="value-inventory-purchase-total">{money(totalAmount)}</strong></span></div>
      <div className="flex flex-wrap gap-1.5" data-testid="inventory-purchase-linked-accounts">{accounts.length ? accounts.map((acc) => <div key={acc.code} className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs"><AccountLabel code={acc.code} name={acc.name} /></div>) : <AccountLabel code={null} name={null} />}</div>
    </div>
    {isLoading ? <div className="space-y-2 p-4"><LoadingBlock className="h-11" /><LoadingBlock className="h-11" /><LoadingBlock className="h-11" /></div>
      : isError ? <ErrorBlock onRetry={onRetry} />
      : !totalCount ? <EmptyState title="Худалдан авалт олдсонгүй" detail={hasFilters ? 'Хайлт эсвэл шүүлтүүрээ өөрчлөөд үзнэ үү.' : 'Сонгосон сар болон бараа материалын төрөлд тохирох худалдан авалт алга.'} icon={PackageOpen} />
      : <>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto md:hidden" data-testid="inventory-purchase-mobile-scroll">{rows.map((p) => <li key={p.id} className="p-3" data-testid={`inventory-purchase-mobile-${p.id}`}>
          <div className="flex items-start gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => a.onOpen(p)}>
              <div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-bold">{p.supplierName}</p><p className="shrink-0 font-mono text-sm font-bold text-primary">{money(p.totalAmount)}</p></div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground"><span data-testid={`text-inventory-purchase-mobile-document-${p.id}`}>{p.documentNumber}</span> · {dateLabel(p.date)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-purchase-mobile-custodian-${p.id}`}>Хариуцагч: {p.responsibleName ?? '—'}</p>
            </button>
            <RowMenu p={p} a={a} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5"><PaidBadge p={p} /><ReceiptBadge p={p} /><span className="ml-auto"><PaymentButton p={p} a={a} /></span></div>
          <PurchaseBankConnection purchase={p} />
        </li>)}</ul>
        <div className="hidden min-h-0 flex-1 overflow-auto md:block" data-testid="inventory-purchase-table-scroll">
          <table className="w-full min-w-[920px] text-left">
            <thead className="sticky top-0 z-10 bg-secondary text-[10px] uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]"><tr><th className="px-4 py-2.5">Харилцагч · Баримт</th><th className="px-3 py-2.5">Огноо</th><th className="px-3 py-2.5">Хариуцагч</th><th className="px-3 py-2.5 text-right">Дүн</th><th className="px-3 py-2.5">Төлөв</th><th className="px-3 py-2.5">Банк</th><th className="px-3 py-2.5 text-right">Үйлдэл</th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((p) => <tr key={p.id} onClick={() => a.onOpen(p)} className="cursor-pointer transition-colors hover:bg-secondary/40" data-testid={`inventory-purchase-${p.id}`}>
              <td className="px-4 py-2"><button type="button" className="text-left text-sm font-semibold hover:underline focus-visible:underline focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); a.onOpen(p); }}>{p.supplierName}</button><p className="whitespace-nowrap font-mono text-[11px] text-muted-foreground"><span data-testid={`text-inventory-purchase-document-${p.id}`}>{p.documentNumber}</span> · {p.items.length} бараа</p></td>
              <td className="whitespace-nowrap px-3 py-2 text-sm">{dateLabel(p.date)}</td>
              <td className="px-3 py-2 text-sm" data-testid={`text-purchase-custodian-${p.id}`}>{p.responsibleName ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm font-bold text-primary">{money(p.totalAmount)}</td>
              <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><PaidBadge p={p} /><ReceiptBadge p={p} /></div>{p.paid && p.paymentDate && <p className="mt-0.5 text-[10px] text-muted-foreground">{dateLabel(p.paymentDate)} · {money(p.paymentAmount ?? 0)}</p>}</td>
              <td className="px-3 py-2 [&>div]:mt-0"><PurchaseBankConnection purchase={p} /></td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-end gap-1"><PaymentButton p={p} a={a} /><RowMenu p={p} a={a} /></div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/30 px-3 py-2" data-testid="inventory-purchase-pager">
          <p className="text-xs text-muted-foreground" data-testid="text-inventory-purchase-range">{totalCount}-с {from}–{to}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="button-inventory-purchases-previous"><ChevronRight className="size-4 rotate-180" />Өмнөх</Button>
            <span className="min-w-14 text-center font-mono text-xs font-bold">{page} / {pageCount}</span>
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={page >= pageCount} onClick={() => onPage(page + 1)} data-testid="button-inventory-purchases-next">Дараах<ChevronRight className="size-4" /></Button>
          </div>
        </div>
      </>}
  </section>;
}
