import { useListPendingInventoryPurchases, type PendingInventoryPurchase } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { dateLabel } from '@/lib/app-shared';

export function PendingInventoryPurchases({ month, materialType, canRegister, onRegister }: {
  month: string; materialType: 'food' | 'supply'; canRegister: boolean;
  onRegister: (row: PendingInventoryPurchase) => void;
}) {
  const query = useListPendingInventoryPurchases();
  const rows = query.data?.filter(row => row.date.startsWith(month) && row.materialType === materialType) ?? [];
  if (query.isLoading) return <LoadingBlock className="h-24" />;
  if (query.isError) return <ErrorBlock onRetry={() => query.refetch()} />;
  return <section className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4" data-testid="pending-inventory-purchases">
    <h2 className="text-sm font-bold">Бүртгэлгүй худалдан авалт ({rows.length})</h2>
    <p className="text-xs text-muted-foreground">Касс, журнал бичигдсэн. Бараа, тоо хэмжээ, харилцагч тодорхойгүй тул барааны үлдэгдэлд ороогүй.</p>
    {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">Сонгосон сарын бүртгэлгүй худалдан авалт алга.</p>}
    {rows.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-border p-3" data-testid={`pending-purchase-${row.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-amber-800">Бүртгэлгүй · {dateLabel(row.date)}</span>
        <strong className="font-mono text-sm">{new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 2 }).format(row.amount)} ₮</strong>
      </div>
      <p className="break-words text-sm">{row.description || 'Утгагүй'}</p>
      <p className="break-words text-xs text-muted-foreground">Данс: {row.accountCode} {row.accountName} · Банкны гүйлгээний данс: {row.bankAccount || '—'}</p>
      {canRegister && <Button size="sm" variant="outline" onClick={() => onRegister(row)} data-testid={`register-pending-purchase-${row.id}`}>Бүртгэх</Button>}
    </article>)}
  </section>;
}
