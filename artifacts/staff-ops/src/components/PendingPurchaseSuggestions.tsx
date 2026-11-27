import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPendingPurchaseSuggestions, getListPendingPurchaseSuggestionsQueryKey, useRegisterPendingInventoryPurchase,
  type PendingInventoryPurchase,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { dateLabel } from '@/lib/app-shared';

export function PendingPurchaseSuggestions({ pending, onLinked, onBusyChange, disabled }: {
  pending: PendingInventoryPurchase; onLinked: () => void; onBusyChange: (busy: boolean) => void; disabled: boolean;
}) {
  const qc = useQueryClient();
  const query = useListPendingPurchaseSuggestions(pending.id, {
    query: { queryKey: getListPendingPurchaseSuggestionsQueryKey(pending.id), staleTime: 0, refetchOnMount: 'always', refetchInterval: 15000 },
  });
  const mutation = useRegisterPendingInventoryPurchase();
  useEffect(() => { onBusyChange(mutation.isPending); return () => onBusyChange(false); }, [mutation.isPending, onBusyChange]);
  const [selected, setSelected] = useState<number | null>(null);
  const link = async () => {
    if (!selected) return;
    mutation.mutate({ id: pending.id, data: { inventoryPurchaseId: selected } }, {
      onSuccess: async () => {
        await qc.invalidateQueries();
        onLinked();
      },
      onError: () => { void query.refetch(); },
    });
  };
  return <section className="mb-4 space-y-3 rounded-xl border border-border p-3" aria-label="Холбох худалдан авалтын санал">
    <h3 className="text-sm font-bold">Өмнө бүртгэсэн худалдан авалттай холбох</h3>
    <p className="text-xs text-muted-foreground">Ижил дүнтэй эсвэл ижил төрлийн, холбогдоогүй худалдан авалтууд. Холбохын тулд дүн болон төрөл хоёулаа таарах ёстой. Барааны үлдэгдэл, касс, журнал давхар нэмэгдэхгүй.</p>
    {query.isLoading ? <LoadingBlock className="h-16" /> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> :
      !query.data?.length ? <p className="text-xs text-muted-foreground">Холбох боломжтой бүртгэл олдсонгүй. Доорх маягтаар шинээр бүртгэж болно.</p> :
      <div className="max-h-64 space-y-2 overflow-y-auto">{query.data.map(row => <label key={row.id} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${row.linkable ? '' : 'opacity-60'}`}>
        <input type="radio" name="pending-purchase-link" disabled={!row.linkable || mutation.isPending || disabled} checked={selected === row.id} onChange={() => setSelected(row.id)} aria-label={`Худалдан авалт #${row.id}`} />
        <span className="min-w-0 break-words">#{row.id} · {dateLabel(row.date)} · {row.documentName}<br />
          <strong>{row.totalAmount.toLocaleString('mn-MN')} ₮</strong> · {row.materialType === 'food' ? 'Хүнс' : 'Хангамж'}<br />
          {row.sameAmount ? 'Дүн таарсан' : 'Дүн зөрүүтэй'} · {row.sameType ? 'Төрөл таарсан' : 'Төрөл зөрүүтэй'}
        </span>
      </label>)}</div>}
    {mutation.isError && <p role="alert" className="text-xs text-destructive">{(mutation.error as { data?: { error?: string } })?.data?.error ?? 'Холбож чадсангүй. Саналыг шинэчиллээ.'}</p>}
    <Button type="button" size="sm" disabled={disabled || mutation.isPending || query.isFetching || !query.data?.some(row => row.id === selected && row.linkable)} onClick={link}>
      {mutation.isPending ? 'Холбож байна...' : 'Сонгосон худалдан авалттай холбох'}
    </Button>
  </section>;
}
