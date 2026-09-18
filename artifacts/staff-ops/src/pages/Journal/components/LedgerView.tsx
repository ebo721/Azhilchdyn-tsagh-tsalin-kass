import { useState } from 'react';
import { useGetJournalAccountLedger, useListChartOfAccounts, getGetJournalAccountLedgerQueryKey } from '@workspace/api-client-react';
import { Modal, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { formatMoney, formatDate } from '../utils';

export function LedgerView({ accountId, onClose }: { accountId: number | null; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(accountId);
  const { data: accounts } = useListChartOfAccounts();
  const { data: ledger, isLoading, isError, refetch } = useGetJournalAccountLedger(selectedId ?? 0, {
    query: { enabled: !!selectedId, queryKey: getGetJournalAccountLedgerQueryKey(selectedId ?? 0) }
  });

  return (
    <Modal title="Дэлгэрэнгүй бүртгэл" detail="Дансны карточк" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex gap-4 items-center">
          <label htmlFor="journal-ledger-account" className="text-sm font-semibold whitespace-nowrap">Данс сонгох:</label>
          <select 
            id="journal-ledger-account"
            className="w-full sm:w-80 rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedId || ''}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            <option value="" disabled>Сонгох...</option>
            {accounts?.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
            ))}
          </select>
        </div>

        {selectedId ? (
          isLoading ? (
            <LoadingBlock className="h-64" />
          ) : isError ? (
            <ErrorBlock onRetry={() => refetch()} />
          ) : ledger ? (
            <div className="space-y-4">
              <div className="flex justify-between items-end border-b pb-2">
                <div>
                  <h3 className="font-bold text-lg">{ledger.code} - {ledger.name}</h3>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Хэвийн үлдэгдэл: {ledger.normalBalance === 'debit' ? 'Дебет' : 'Кредит'}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-secondary/50 text-muted-foreground border-b text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Огноо</th>
                        <th className="px-4 py-3">Журнал №</th>
                        <th className="px-4 py-3 text-right">Дебет</th>
                        <th className="px-4 py-3 text-right">Кредит</th>
                        <th className="px-4 py-3 text-right">Үлдэгдэл</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ledger.entries.map((entry, idx) => (
                        <tr key={idx} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-2 font-mono text-xs">{formatDate(entry.date)}</td>
                          <td className="px-4 py-2 font-mono text-xs">#{entry.journalEntryId}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(entry.debit)}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(entry.credit)}</td>
                          <td className={`px-4 py-2 text-right font-mono text-xs font-bold ${entry.balance < 0 ? 'text-destructive' : ''}`}>
                            {formatMoney(Math.abs(entry.balance))}
                          </td>
                        </tr>
                      ))}
                      {ledger.entries.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Гүйлгээ алга</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null
        ) : (
          <div className="min-h-32 flex items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
            Данс сонгож харна уу.
          </div>
        )}
      </div>
    </Modal>
  );
}
