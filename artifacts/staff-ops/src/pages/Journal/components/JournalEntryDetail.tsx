import {
  useGetJournalEntry,
  useVoidJournalEntry,
  useListChartOfAccounts,
  getListJournalEntriesQueryKey,
  getGetJournalTrialBalanceQueryKey,
  type JournalEntry,
} from '@workspace/api-client-react';
import { Modal, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { formatMoney, formatDate } from '../utils';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function JournalEntryDetail({ entryId, onClose, role, onEdit }: { entryId: number; onClose: () => void; role: string; onEdit: (entry: JournalEntry) => void }) {
  const queryClient = useQueryClient();
  const { data: entry, isLoading, isError, refetch } = useGetJournalEntry(entryId);
  const { data: accounts } = useListChartOfAccounts();
  const voidEntry = useVoidJournalEntry();

  const handleVoid = () => {
    if (!window.confirm('Энэ гүйлгээг буцаахдаа итгэлтэй байна уу? Энэ үйлдэл буцахгүй.')) return;
    voidEntry.mutate({ id: entryId }, {
      onSuccess: () => {
        toast.success('Гүйлгээ амжилттай буцаагдлаа');
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJournalTrialBalanceQueryKey() });
         queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('/api/journal/receivables') });
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('/api/journal/accounts/') });
        refetch();
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Гүйлгээ буцаахад алдаа гарлаа');
      }
    });
  };

  if (isLoading) return <Modal title={`Журнал #${entryId}`} detail="Ачаалж байна..." onClose={onClose} wide><LoadingBlock className="h-64" /></Modal>;
  if (isError || !entry) return <Modal title={`Журнал #${entryId}`} detail="Алдаа гарлаа" onClose={onClose} wide><ErrorBlock onRetry={() => refetch()} /></Modal>;

  const isDraft = entry.status === 'draft';
  const isVoid = entry.status === 'void';
  const totalDebit = Math.round(entry.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(entry.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0) * 100) / 100;
  const isBalanced = totalDebit === totalCredit;
  const accountLabels = new Map(accounts?.map((account) => [account.id, `${account.code} — ${account.name}`]) ?? []);
  const canVoid = entry.status === 'posted' && (role === 'admin' || role === 'accountant');

  return (
    <Modal title={`Журнал #${entryId}`} detail={entry.description} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-4 text-sm bg-muted/30 p-4 rounded-xl border">
          <div><span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Огноо</span><span className="font-mono font-medium">{formatDate(entry.date)}</span></div>
          <div><span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Төлөв</span>
            <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${isDraft ? 'bg-destructive/10 text-destructive' : isVoid ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
              {isDraft ? 'Ноорог (Тэнцээгүй)' : isVoid ? 'Цуцлагдсан' : 'Батлагдсан'}
            </span>
          </div>
          <div><span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Эх үүсвэр</span><span className="font-medium">{entry.sourceType} {entry.sourceId ? `#${entry.sourceId}` : ''}</span></div>
          {entry.voidedAt && (
            <div><span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Цуцлагдсан огноо</span><span className="font-mono">{formatDate(entry.voidedAt)}</span></div>
          )}
          <div className={`ml-auto rounded-lg px-4 py-2 text-center font-bold ${isBalanced ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
            {isBalanced ? 'Тэнцсэн ✓' : 'Тэнцээгүй ✗'}
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground border-b text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Данс</th>
                  <th className="px-4 py-3 text-right">Дебет</th>
                  <th className="px-4 py-3 text-right">Кредит</th>
                  <th className="px-4 py-3">Тайлбар</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entry.lines.map((line) => (
                  <tr key={line.id} className={`${isVoid ? 'opacity-50 line-through' : ''}`}>
                    <td className="px-4 py-2 text-xs">{accountLabels.get(line.accountId) ?? `Данс #${line.accountId}`}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(line.debit)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(line.credit)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {line.memo || '-'}
                      {line.allocation && <div className="mt-1 text-xs text-primary">{line.allocation.kind === 'settle' ? `Авлага #${line.allocation.receivableId} төлөлт` : `Авлага үүсгэсэн (${line.allocation.partyType === 'employee' ? `ажилтан #${line.allocation.employeeId}` : `нийлүүлэгч #${line.allocation.supplierId}`})`}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-secondary/50 border-t font-bold">
                <tr>
                  <td className="px-4 py-3 text-right uppercase tracking-wider text-xs">Нийт</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${!isBalanced ? 'text-destructive' : 'text-primary'}`}>{formatMoney(totalDebit)}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${!isBalanced ? 'text-destructive' : 'text-primary'}`}>{formatMoney(totalCredit)}</td>
                  <td className="px-4 py-3">
                    {!isBalanced && <span className="text-destructive text-xs ml-2 bg-destructive/10 px-2 py-1 rounded">Зөрүү: {formatMoney(Math.abs(totalDebit - totalCredit))}</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {(canVoid || (isDraft && (role === 'admin' || role === 'accountant'))) && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            {isDraft && (role === 'admin' || role === 'accountant') && (
              <Button variant="outline" onClick={() => onEdit(entry)}>Ноорог засах</Button>
            )}
            {canVoid && (
            <Button variant="destructive" onClick={handleVoid} disabled={voidEntry.isPending}>
              {voidEntry.isPending ? 'Цуцалж байна...' : 'Гүйлгээ буцаах (Void)'}
            </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
