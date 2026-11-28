import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Clock3, X } from 'lucide-react';
import { getListPendingInventoryPurchasesQueryKey, useListPendingInventoryPurchases, type PendingInventoryPurchase } from '@workspace/api-client-react';
import { ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { dateLabel } from '@/lib/app-shared';
import { cn } from '@/lib/utils';

type Scope = { month: string; materialType: 'food' | 'supply' };
const amount = (n: number) => `${new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 2 }).format(n)} ₮`;

function usePendingRows({ month, materialType }: Scope) {
  const query = useListPendingInventoryPurchases({ query: { queryKey: getListPendingInventoryPurchasesQueryKey() } });
  const rows = query.data?.filter((row) => row.date.startsWith(month) && row.materialType === materialType) ?? [];
  return { query, rows };
}

/** Toolbar launcher: bank-paid purchases awaiting item registration. */
export function PendingPurchasesLauncher({ onOpen, ...scope }: Scope & { onOpen: () => void }) {
  const { query, rows } = usePendingRows(scope);
  const count = rows.length;
  return <button type="button" onClick={onOpen} className={cn('inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors', count > 0 ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'border-border bg-card text-muted-foreground hover:bg-secondary')} aria-label={`Бүртгэл хүлээгдэж буй ${query.isLoading ? '' : query.isError ? 'мэдээлэл татахад алдаатай' : count}`} aria-haspopup="dialog" data-testid="button-open-pending-purchases">
    <Clock3 className="size-4" /><span className="sm:hidden">Хүлээгдэж буй</span><span className="hidden sm:inline">Бүртгэл хүлээгдэж буй</span>
    <span className={cn('min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[11px]', count > 0 ? 'bg-amber-600 text-amber-50' : 'bg-secondary')} data-testid="value-pending-purchases-count">{query.isLoading ? '…' : query.isError ? '!' : count}</span>
  </button>;
}

/** Right-side drawer (fullscreen on phones) listing pending registrations. */
export function PendingInventoryPurchasesDrawer({ open, onOpenChange, canRegister, onRegister, monthLabel, ...scope }: Scope & {
  open: boolean; onOpenChange: (open: boolean) => void; canRegister: boolean; monthLabel: string;
  onRegister: (row: PendingInventoryPurchase) => void;
}) {
  const { query, rows } = usePendingRows(scope);
  const total = rows.reduce((t, r) => t + r.amount, 0);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-full flex-col border-l border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:max-w-2xl" data-testid="pending-inventory-purchases">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6">
          <div>
            <Dialog.Title className="text-lg font-bold tracking-tight">Бүртгэл хүлээгдэж буй ({rows.length})</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">Банкаар төлөгдсөн, касс ба журнал бичигдсэн. Бараа, тоо хэмжээ, харилцагч бүртгэгдээгүй тул үлдэгдэлд ороогүй. {monthLabel}.</Dialog.Description>
          </div>
          <Dialog.Close className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Хаах" data-testid="button-close-pending-purchases"><X className="size-4" /></Dialog.Close>
        </header>
        {rows.length > 0 && <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-5 py-2 text-xs sm:px-6"><span className="font-semibold text-muted-foreground">Нийт банкны дүн</span><strong className="font-mono" data-testid="value-pending-purchases-total">{amount(total)}</strong></div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.isLoading ? <div className="space-y-2 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div>
            : query.isError ? <div className="p-5"><ErrorBlock onRetry={() => query.refetch()} /></div>
            : rows.length === 0 ? <div className="grid place-items-center px-6 py-16 text-center" data-testid="pending-purchases-empty"><Clock3 className="size-8 text-muted-foreground/60" /><p className="mt-3 text-sm font-bold">Бүртгэл хүлээгдэж буй худалдан авалт алга</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">Сонгосон сар, төрөлд банкаар төлөгдөөд бараа нь бүртгэгдээгүй гүйлгээ байхгүй.</p></div>
            : <ul className="divide-y divide-border">{rows.map((row) => {
              const body = <>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900">Бараа бүртгээгүй</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Банкаар төлсөн · #{row.id}</span><span className="text-xs text-muted-foreground">{dateLabel(row.date)}</span></div>
                  <p className="mt-1.5 break-words text-sm font-semibold">{row.description || 'Утгагүй'}</p>
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{row.accountCode} {row.accountName} · Данс: {row.bankAccount || '—'}</p>
                </div>
                <strong className="shrink-0 font-mono text-sm">{amount(row.amount)}</strong>
                {canRegister && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </>;
              return <li key={row.id} data-testid={`pending-purchase-${row.id}`}>
                {canRegister
                  ? <button type="button" onClick={() => onRegister(row)} className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none sm:px-6" aria-label={`${row.description || 'Гүйлгээ'} бүртгэх`} data-testid={`register-pending-purchase-${row.id}`}>{body}</button>
                  : <div className="flex items-start gap-3 px-5 py-3 sm:px-6">{body}</div>}
              </li>;
            })}</ul>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
