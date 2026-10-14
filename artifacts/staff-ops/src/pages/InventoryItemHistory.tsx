import {
  getListInventoryOpeningBalancesQueryKey, getListInventoryPurchasesQueryKey,
  useListInventoryOpeningBalances, useListInventoryPurchases,
} from '@workspace/api-client-react';
import { ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { dateLabel, money } from '@/lib/app-shared';

type HistoryRow = {
  id: number;
  date: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
};

function HistorySection({ title, kind, rows, loading, error, retry }: {
  title: string;
  kind: 'opening' | 'purchase';
  rows: HistoryRow[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  return <section className="space-y-3" data-testid={`inventory-item-history-${kind}`}>
    <h3 className="text-sm font-bold">{title}</h3>
    {loading ? <LoadingBlock className="h-16" /> : error ? <ErrorBlock onRetry={retry} />
      : !rows.length ? <p className="text-xs text-muted-foreground">{kind === 'opening' ? 'Эхний үлдэгдэл бүртгэгдээгүй.' : 'Худалдан авалт бүртгэгдээгүй.'}</p>
      : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left">
        <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr>
          <th className="px-3 py-2">Огноо</th><th className="px-3 py-2 text-right">Тоо</th>
          <th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Нэгж үнэ</th>
          <th className="px-3 py-2 text-right">Нийт үнэ</th>
        </tr></thead>
        <tbody className="divide-y divide-border">{rows.map(row => <tr key={row.id} data-testid={`row-inventory-item-${kind}-${row.id}`}>
          <td className="px-3 py-3 text-sm font-semibold"><time dateTime={row.date}>{dateLabel(row.date)}</time></td>
          <td className="px-3 py-3 text-right font-mono text-sm">{row.quantity}</td>
          <td className="px-3 py-3 text-sm text-muted-foreground">{row.unit}</td>
          <td className="px-3 py-3 text-right font-mono text-sm">{money(row.unitPrice)}</td>
          <td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(row.totalAmount)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

const newestFirst = (a: HistoryRow, b: HistoryRow) => b.date.localeCompare(a.date) || b.id - a.id;

export function InventoryItemHistory({ itemId }: { itemId: number }) {
  const purchases = useListInventoryPurchases({ query: { queryKey: getListInventoryPurchasesQueryKey(), staleTime: 15000, refetchOnMount: 'always' } });
  const openings = useListInventoryOpeningBalances({ query: { queryKey: getListInventoryOpeningBalancesQueryKey(), staleTime: 15000, refetchOnMount: 'always' } });
  const purchaseRows = purchases.data?.flatMap(purchase => purchase.items
    .filter(line => line.inventoryItemId === itemId)
    .map(line => ({ ...line, date: purchase.date }))).sort(newestFirst) ?? [];
  const openingRows = openings.data?.filter(row => row.inventoryItemId === itemId).sort(newestFirst) ?? [];

  return <div className="max-h-[60vh] space-y-6 overflow-y-auto" data-testid="inventory-item-history">
    <p className="text-xs text-muted-foreground">Бүх огнооны орлогын түүх. Тоо болон үнэ нь тухайн бүртгэлийн анхны утга; одоогийн үлдэгдэл биш. Эхний үлдэгдэл нь худалдан авалт биш.</p>
    <HistorySection title="Эхний үлдэгдэл" kind="opening" rows={openingRows} loading={openings.isLoading}
      error={openings.isError} retry={() => { void openings.refetch(); }} />
    <HistorySection title="Худалдан авалтын түүх · бүх сар" kind="purchase" rows={purchaseRows} loading={purchases.isLoading}
      error={purchases.isError} retry={() => { void purchases.refetch(); }} />
  </div>;
}
