import { useState } from 'react';
import { getListJournalEntriesQueryKey, useListJournalEntries, useGetAuthSession, type JournalEntry } from '@workspace/api-client-react';
import { PageHeading, EmptyState, LoadingBlock, ErrorBlock, StatCard } from '@/components/ui-primitives';
import { formatMoney, formatDate } from './utils';
import { Button } from '@/components/ui/button';
import { Library, Plus, Search, Layers, FileText } from 'lucide-react';
import { JournalEntryDetail } from './components/JournalEntryDetail';
import { JournalEntryForm } from './components/JournalEntryForm';
import { LedgerView } from './components/LedgerView';
import { TrialBalance } from './components/TrialBalance';

export function Journal() {
  const { data: session } = useGetAuthSession();
  const role = session?.role || 'viewer';
  
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  const { data: entries, isLoading, isError, refetch } = useListJournalEntries({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }, {
    query: {
      queryKey: getListJournalEntriesQueryKey({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
      refetchOnMount: 'always',
    },
  });

  const [detailId, setDetailId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [showTrialBalance, setShowTrialBalance] = useState(false);

  const canCreate = role === 'admin' || role === 'accountant';

  const totalPosted = entries?.filter(e => e.status === 'posted').length || 0;
  const totalDraft = entries?.filter(e => e.status === 'draft').length || 0;

  return (
    <div className="page-enter space-y-6">
      <PageHeading 
        eyebrow="Нягтлан бодох бүртгэл" 
        title="Ерөнхий журнал" 
        detail="Бүх дансны давхар бичилтийн гүйлгээ"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowTrialBalance(true)}>
              <Layers className="size-4 mr-2" />
              Шалгах баланс
            </Button>
            <Button variant="outline" onClick={() => setShowLedger(true)}>
              <FileText className="size-4 mr-2" />
              Дансны карт
            </Button>
            {canCreate && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="size-4 mr-2" />
                Журнал бичих
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Батлагдсан" value={totalPosted.toString()} meta="Нийт хэвийн гүйлгээ" icon={Library} tone="teal" />
        <StatCard label="Ноорог" value={totalDraft.toString()} meta="Тэнцээгүй (засах шаардлагатай)" icon={Library} tone={totalDraft > 0 ? 'orange' : 'blue'} />
        <div className="flex items-center gap-4 p-5 rounded-2xl border bg-card">
          <div className="w-full space-y-3">
            <label className="text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground block">Хугацаа</label>
            <div className="flex items-center gap-2">
              <label htmlFor="journal-date-from" className="sr-only">Эхлэх огноо</label>
              <input id="journal-date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full text-sm border rounded-md px-2 py-1.5 bg-background" />
              <span className="text-muted-foreground">-</span>
              <label htmlFor="journal-date-to" className="sr-only">Дуусах огноо</label>
              <input id="journal-date-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full text-sm border rounded-md px-2 py-1.5 bg-background" />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto min-h-[400px]">
          {isLoading ? (
            <div className="p-8"><LoadingBlock className="h-64" /></div>
          ) : isError ? (
            <div className="p-8"><ErrorBlock onRetry={() => refetch()} /></div>
          ) : entries?.length === 0 ? (
            <EmptyState title="Журналын бичилт олдсонгүй" detail="Сонгосон хугацаанд ямар нэг гүйлгээ бүртгэгдээгүй байна." icon={Search} />
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground border-b text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Огноо</th>
                  <th className="px-4 py-3">Дугаар</th>
                  <th className="px-4 py-3 w-1/3">Утга</th>
                  <th className="px-4 py-3">Эх үүсвэр</th>
                  <th className="px-4 py-3 text-right">Нийт дүн</th>
                  <th className="px-4 py-3">Төлөв</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries?.map((entry) => {
                  const isDraft = entry.status === 'draft';
                  const isVoid = entry.status === 'void';
                  const total = entry.totalDebit;
                  
                  return (
                    <tr key={entry.id} className={`hover:bg-muted/50 transition-colors ${isVoid ? 'opacity-60 bg-muted/20 line-through' : isDraft ? 'bg-amber-50/80 dark:bg-amber-950/25' : ''}`} data-testid={`journal-entry-${entry.id}`}>
                      <td className="px-4 py-3 font-mono text-xs">{formatDate(entry.date)}</td>
                      <td className="px-4 py-3 font-mono font-medium">#{entry.id}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{entry.description}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{entry.sourceType} {entry.sourceId ? `#${entry.sourceId}` : ''}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatMoney(total)}</td>
                      <td className="px-4 py-3">
                        {isDraft ? (
                          <span className="inline-block px-2 py-0.5 bg-destructive/10 text-destructive text-[10px] font-bold rounded uppercase tracking-wider">Тэнцээгүй</span>
                        ) : isVoid ? (
                          <span className="inline-block px-2 py-0.5 bg-muted text-muted-foreground text-[10px] font-bold rounded uppercase tracking-wider">Цуцлагдсан</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded uppercase tracking-wider">Хэвийн</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(entry.id)}>
                          Дэлгэрэнгүй
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detailId !== null && (
        <JournalEntryDetail
          entryId={detailId}
          onClose={() => setDetailId(null)}
          role={role}
          onEdit={(entry) => {
            setDetailId(null);
            setEditingEntry(entry);
          }}
        />
      )}
      
      {showForm && (
        <JournalEntryForm onClose={() => setShowForm(false)} />
      )}

      {editingEntry && (
        <JournalEntryForm entry={editingEntry} onClose={() => setEditingEntry(null)} />
      )}
      
      {showLedger && (
        <LedgerView accountId={null} onClose={() => setShowLedger(false)} />
      )}
      
      {showTrialBalance && (
        <TrialBalance onClose={() => setShowTrialBalance(false)} />
      )}
    </div>
  );
}
