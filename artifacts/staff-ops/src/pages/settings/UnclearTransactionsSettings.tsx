import { EyeOff } from 'lucide-react';
import {
  useListUnclearTransactions,
  type UnclearTransaction,
} from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { bankDateTimeLabel } from '@/pages/Cash';
import { dateLabel, money } from '@/App';

export function UnclearTransactionsSettings() {
  const list = useListUnclearTransactions();
  const sourceLabel = (row: UnclearTransaction) => row.source === 'bank' ? 'Банк' : 'Касс';
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-unclear-transactions">
    <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Тодорхойгүй гүйлгээ</h2><p className="mt-1 text-xs text-muted-foreground">Үндсэн банк болон кассын жагсаалтаас нуусан, database-д хадгалагдсан гүйлгээнүүд.</p></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Тодорхойгүй гүйлгээ алга" detail="Админ гүйлгээг тодорхойгүй болгосон үед энд харагдана." icon={EyeOff} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Эх үүсвэр</th><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Төрөл</th><th className="px-5 py-3">Утга</th><th className="px-5 py-3">Данс / ангилал</th><th className="px-5 py-3 text-right">Дүн</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((row) => <tr key={`${row.source}-${row.id}`} data-testid={`row-unclear-${row.source}-${row.id}`}><td className="px-5 py-4"><span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-bold">{sourceLabel(row)}</span></td><td className="whitespace-nowrap px-5 py-4 font-mono text-xs">{row.source === 'bank' ? bankDateTimeLabel(row.occurredAt) : dateLabel(row.occurredAt)}</td><td className="px-5 py-4 text-sm">{row.type === 'income' ? 'Орлого' : 'Зарлага'}</td><td className="max-w-80 px-5 py-4 text-sm font-medium">{row.description || '—'}</td><td className="px-5 py-4 text-sm text-muted-foreground">{row.account || row.category || '—'}</td><td className={cn('whitespace-nowrap px-5 py-4 text-right font-mono text-sm font-bold', row.type === 'income' ? 'text-primary' : 'text-orange-800')}>{row.type === 'income' ? '+' : '−'}{money(row.amount)}</td></tr>)}</tbody></table></div>}
  </section>;
}