import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Plus, Search } from 'lucide-react';
import {
  getListJournalPayablesQueryKey, getListJournalReceivablesQueryKey,
  useListJournalPayables, useListJournalReceivables,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeading } from '@/components/ui-primitives';
import { formatDate } from '@/pages/Journal/utils';

type Tab = 'receivables' | 'payables';
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ArAp({ canCreate }: { canCreate: boolean }) {
  const [tab, setTab] = useState<Tab>('receivables');
  const [party, setParty] = useState('');
  const [, navigate] = useLocation();
  const receivables = useListJournalReceivables({ status: 'all' }, {
    query: { queryKey: getListJournalReceivablesQueryKey({ status: 'all' }), enabled: tab === 'receivables', refetchOnMount: 'always' },
  });
  const payables = useListJournalPayables({ status: 'all' }, {
    query: { queryKey: getListJournalPayablesQueryKey({ status: 'all' }), enabled: tab === 'payables', refetchOnMount: 'always' },
  });

  const rows = useMemo(() => tab === 'receivables'
    ? (receivables.data ?? []).map((row) => ({ ...row, balance: row.openAmount }))
    : (payables.data ?? []).map((row) => ({ ...row, balance: row.remainingBalance })),
  [tab, receivables.data, payables.data]);
  const parties = useMemo(() => [...new Map(rows.map((row) => [
    `${row.partyType}:${row.partyId}`,
    { key: `${row.partyType}:${row.partyId}`, label: `${row.partyLabel} (${row.partyType === 'employee' ? 'Ажилтан' : 'Харилцагч'})` },
  ])).values()].sort((a, b) => a.label.localeCompare(b.label, 'mn')), [rows]);
  const filteredRows = rows.filter((row) => !party || `${row.partyType}:${row.partyId}` === party);
  const current = tab === 'receivables' ? receivables : payables;

  return (
    <div className="page-enter space-y-6">
      <PageHeading
        eyebrow="Нягтлан бодох бүртгэл"
        title="Авлага, Өглөг"
        detail="Ажилтан, харилцагчийн бүртгэл болон үлдэгдэл"
        action={canCreate && (
          <Button onClick={() => navigate(`/journal/new?account=${tab === 'receivables' ? '1200' : '2000'}`)}>
            <Plus className="mr-2 size-4" /> Шинээр үүсгэх
          </Button>
        )}
      />

      <div className="flex flex-col justify-between gap-4 border-b border-border sm:flex-row sm:items-end">
        <div role="tablist" aria-label="Авлага болон өглөг" className="flex gap-6">
          {([
            ['receivables', 'Авлага'],
            ['payables', 'Өглөг'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls="ar-ap-table"
              onClick={() => { setTab(value); setParty(''); }}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pb-3">
          <label htmlFor="ar-ap-party" className="mb-1 block text-xs font-semibold text-muted-foreground">Ажилтан / харилцагч</label>
          <select
            id="ar-ap-party"
            value={party}
            onChange={(event) => setParty(event.target.value)}
            className="w-full min-w-52 rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">Бүгд</option>
            {parties.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      <div id="ar-ap-table" role="tabpanel" className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {current.isLoading ? (
          <div className="p-8"><LoadingBlock className="h-48" /></div>
        ) : current.isError ? (
          <div className="p-8"><ErrorBlock onRetry={() => { void current.refetch(); }} /></div>
        ) : filteredRows.length === 0 ? (
          <EmptyState title="Бүртгэл олдсонгүй" detail={party ? 'Энэ талд хамаарах бүртгэл алга.' : 'Одоогоор бүртгэл алга.'} icon={Search} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">Тал</th>
                  <th scope="col" className="px-4 py-3 text-right">Дүн</th>
                  <th scope="col" className="px-4 py-3 text-right">Үлдэгдэл</th>
                  <th scope="col" className="px-4 py-3">Огноо</th>
                  <th scope="col" className="px-4 py-3">Төлөв</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{row.partyLabel}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.partyType === 'employee' ? 'Ажилтан' : 'Харилцагч'}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{money.format(row.originalAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{money.format(row.balance)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.status === 'open' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {row.status === 'open' ? 'Нээлттэй' : tab === 'receivables' ? 'Төлөгдсөн' : 'Хаагдсан'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}