import { useState, useMemo } from 'react';
import {
  useCreateJournalEntry,
  useUpdateJournalEntry,
  useListChartOfAccounts,
  getListJournalEntriesQueryKey,
  getGetJournalTrialBalanceQueryKey,
  useListEmployees,
  useListJournalSuppliers,
  useListJournalReceivables,
  type JournalEntry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui-primitives';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatMoney } from '../utils';
import { format } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';

type EditableJournalLine = {
  id: number;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
  allocation?: { kind: 'create'; partyType: 'employee' | 'supplier'; employeeId?: number; supplierId?: number } | { kind: 'settle'; receivableId: number };
};

export function JournalEntryForm({ onClose, entry }: { onClose: () => void; entry?: JournalEntry }) {
  const queryClient = useQueryClient();
  const createEntry = useCreateJournalEntry();
  const updateEntry = useUpdateJournalEntry();
  const { data: accounts } = useListChartOfAccounts();
  const { data: employees } = useListEmployees();
  const { data: suppliers } = useListJournalSuppliers();
  const { data: receivables } = useListJournalReceivables({ status: 'open' });
  const isEditing = Boolean(entry);
  
  const [date, setDate] = useState(entry?.date ?? format(new Date(), 'yyyy-MM-dd'));
  const [description, setDescription] = useState(entry?.description ?? '');
  const [lines, setLines] = useState<EditableJournalLine[]>(entry
    ? entry.lines.map((line, index) => ({
      id: index + 1,
      accountId: String(line.accountId),
      debit: Number(line.debit) > 0 ? String(line.debit) : '',
      credit: Number(line.credit) > 0 ? String(line.credit) : '',
      memo: line.memo ?? '',
       allocation: line.allocation ?? undefined,
    }))
    : [
      { id: 1, accountId: '', debit: '', credit: '', memo: '' },
      { id: 2, accountId: '', debit: '', credit: '', memo: '' },
    ]);

  const addLine = () => {
    setLines((current) => [...current, { id: Math.max(...current.map((line) => line.id)) + 1, accountId: '', debit: '', credit: '', memo: '' }]);
  };

  const removeLine = (id: number) => {
    if (lines.length <= 2) return;
    setLines((current) => current.filter((line) => line.id !== id));
  };

  const updateLine = (id: number, field: keyof Omit<EditableJournalLine, 'id'>, value: string) => {
    setLines((current) => current.map((line) => {
      if (line.id !== id) return line;
      if (field === 'debit') return {
        ...line, debit: value, credit: '',
        allocation: Number(value) > 0 && line.allocation?.kind === 'create' ? line.allocation : undefined,
      };
      if (field === 'credit') return {
        ...line, credit: value, debit: '',
        allocation: Number(value) > 0 && line.allocation?.kind === 'settle' ? line.allocation : undefined,
      };
      if (field === 'accountId' && accounts?.find((account) => String(account.id) === value)?.code !== '1200') return { ...line, accountId: value, allocation: undefined };
      return { ...line, [field]: value };
    }));
  };
  const updateAllocation = (id: number, allocation: EditableJournalLine['allocation']) =>
    setLines((current) => current.map((line) => line.id === id ? { ...line, allocation } : line));

  const { totalDebit, totalCredit, diff } = useMemo(() => {
    const td = Math.round(lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
    const tc = Math.round(lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0) * 100) / 100;
    return { totalDebit: td, totalCredit: tc, diff: Math.abs(td - tc) };
  }, [lines]);

  const isBalanced = diff === 0 && totalDebit > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error('Гүйлгээний утга оруулна уу');
      return;
    }
    
    const validLines = lines.filter(l => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) {
      toast.error('Доод тал нь 2 мөр оруулна уу');
      return;
    }

    const normalizedLines = validLines.map(l => ({
      accountId: Number(l.accountId),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || null,
      ...(l.allocation ? { allocation: l.allocation } : {}),
    }));
    for (const line of validLines) {
      const account = accounts?.find((candidate) => String(candidate.id) === line.accountId);
      if (account?.code === '1200' && !line.allocation) {
        toast.error('1200 Авлагын мөрөнд ажилтан, нийлүүлэгч эсвэл өмнөх авлага сонгоно уу');
        return;
      }
      if (account?.code === '1200' && line.allocation?.kind === 'create' &&
        ((line.allocation.partyType === 'employee' && !line.allocation.employeeId) ||
          (line.allocation.partyType === 'supplier' && !line.allocation.supplierId))) {
        toast.error('Авлага хуваарилах этгээдийг сонгоно уу');
        return;
      }
      if (account?.code === '1200' && line.allocation?.kind === 'settle' && !line.allocation.receivableId) {
        toast.error('Төлөгдөх өмнөх авлагыг сонгоно уу');
        return;
      }
    }
    const callbacks = {
      onSuccess: (res: JournalEntry) => {
        toast.success(res.status === 'draft' ? 'Ноорог журнал хадгалагдлаа (Тэнцээгүй)' : isEditing ? 'Ноорог журнал тэнцэж, батлагдлаа' : 'Журнал амжилттай бүртгэгдлээ');
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJournalTrialBalanceQueryKey() });
         queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('/api/journal/receivables') });
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('/api/journal/accounts/') });
        onClose();
      },
      onError: (error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Журнал хадгалахад алдаа гарлаа');
      },
    };
    if (entry) {
      updateEntry.mutate({ id: entry.id, data: { lines: normalizedLines } }, callbacks);
    } else {
      createEntry.mutate({ data: { date, description, lines: normalizedLines } }, callbacks);
    }
  };

  return (
    <Modal title={isEditing ? `Ноорог журнал #${entry?.id} засах` : 'Шинэ журнал бичилт'} detail={isEditing ? 'Дебет, кредитийн мөрүүдийг тэнцүүлж батална.' : 'Гараар журнал бичих'} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="journal-entry-date" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Огноо</label>
            <input id="journal-entry-date" type="date" required disabled={isEditing} value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="journal-entry-description" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Гүйлгээний утга</label>
            <input id="journal-entry-description" type="text" required disabled={isEditing} value={description} onChange={e => setDescription(e.target.value)} placeholder="Жишээ: Касснаас банкинд тушаав" className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60" />
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground border-b text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 w-1/3">Данс</th>
                  <th className="px-4 py-3 w-1/6">Дебет</th>
                  <th className="px-4 py-3 w-1/6">Кредит</th>
                  <th className="px-4 py-3 w-1/4">Тайлбар (Заавал биш)</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((line, idx) => (
                  <tr key={line.id}>
                    <td className="p-2">
                      <select required aria-label={`${idx + 1}-р мөрийн данс`} value={line.accountId} onChange={e => updateLine(line.id, 'accountId', e.target.value)} className="w-full rounded border-transparent bg-transparent px-2 py-1.5 text-sm hover:bg-muted focus:bg-background focus:border-border">
                        <option value="" disabled>Данс сонгох...</option>
                        {accounts?.map(acc => <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>)}
                      </select>
                    {accounts?.find((account) => String(account.id) === line.accountId)?.code === '1200' && (
                      <div className="mt-1 space-y-1">
                        {Number(line.debit) > 0 ? (
                          <div className="flex gap-2">
                            <select className="rounded border px-2 py-1" value={line.allocation?.kind === 'create' ? line.allocation.partyType : ''} onChange={(e) => updateAllocation(line.id, e.target.value === 'employee' ? { kind: 'create', partyType: 'employee' } : { kind: 'create', partyType: 'supplier' })}>
                              <option value="">Авлага хуваарилах...</option><option value="employee">Ажилтан</option><option value="supplier">Нийлүүлэгч</option>
                            </select>
                            {line.allocation?.kind === 'create' && line.allocation.partyType === 'employee' && <select className="rounded border px-2 py-1" value={line.allocation.employeeId ?? ''} onChange={(e) => updateAllocation(line.id, { kind: 'create', partyType: 'employee', employeeId: Number(e.target.value) })}><option value="">Ажилтан сонгох</option>{employees?.filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
                            {line.allocation?.kind === 'create' && line.allocation.partyType === 'supplier' && <select className="rounded border px-2 py-1" value={line.allocation.supplierId ?? ''} onChange={(e) => updateAllocation(line.id, { kind: 'create', partyType: 'supplier', supplierId: Number(e.target.value) })}><option value="">Нийлүүлэгч сонгох</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
                          </div>
                        ) : Number(line.credit) > 0 ? (
                          <select className="w-full rounded border px-2 py-1" value={line.allocation?.kind === 'settle' ? line.allocation.receivableId : ''} onChange={(e) => updateAllocation(line.id, { kind: 'settle', receivableId: Number(e.target.value) })}>
                            <option value="">Өмнөх авлага сонгох...</option>{receivables?.map((r) => <option key={r.id} value={r.id}>{r.partyLabel} — үлдэгдэл {formatMoney(r.openAmount)}</option>)}
                          </select>
                        ) : null}
                      </div>
                    )}
                    </td>
                    <td className="p-2">
                      <input aria-label={`${idx + 1}-р мөрийн дебет`} type="number" min="0" step="0.01" value={line.debit} onChange={e => updateLine(line.id, 'debit', e.target.value)} placeholder="0.00" className="w-full rounded border-transparent bg-transparent px-2 py-1.5 text-sm text-right font-mono hover:bg-muted focus:bg-background focus:border-border" />
                    </td>
                    <td className="p-2">
                      <input aria-label={`${idx + 1}-р мөрийн кредит`} type="number" min="0" step="0.01" value={line.credit} onChange={e => updateLine(line.id, 'credit', e.target.value)} placeholder="0.00" className="w-full rounded border-transparent bg-transparent px-2 py-1.5 text-sm text-right font-mono hover:bg-muted focus:bg-background focus:border-border" />
                    </td>
                    <td className="p-2">
                      <input aria-label={`${idx + 1}-р мөрийн тайлбар`} type="text" value={line.memo} onChange={e => updateLine(line.id, 'memo', e.target.value)} placeholder="Мөрийн тайлбар" className="w-full rounded border-transparent bg-transparent px-2 py-1.5 text-sm hover:bg-muted focus:bg-background focus:border-border" />
                    </td>
                    <td className="p-2 text-center">
                      <button type="button" onClick={() => removeLine(line.id)} disabled={lines.length <= 2} className="p-1.5 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label={`${idx + 1}-р мөрийг устгах`}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-secondary/50 border-t font-bold">
                <tr>
                  <td className="px-4 py-3">
                    <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-7 text-xs"><Plus className="size-3 mr-1" /> Мөр нэмэх</Button>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${!isBalanced ? 'text-destructive' : 'text-primary'}`}>{formatMoney(totalDebit)}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${!isBalanced ? 'text-destructive' : 'text-primary'}`}>{formatMoney(totalCredit)}</td>
                  <td colSpan={2} className="px-4 py-3 text-xs text-destructive text-right">
                    {!isBalanced && diff > 0 && `Зөрүү: ${formatMoney(diff)}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {!isBalanced && diff > 0 && (
          <div className="bg-destructive/10 text-destructive text-xs p-3 rounded-lg flex items-center gap-2">
            <span className="font-bold border border-destructive px-1 rounded uppercase tracking-wider text-[10px]">АНХААР</span>
            Дебет Кредит тэнцээгүй байна. Хадгалсан тохиолдолд НООРОГ төлөвтэй үлдэнэ.
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Болих</Button>
          <Button type="submit" disabled={createEntry.isPending || updateEntry.isPending || totalDebit === 0 && totalCredit === 0}>
            {createEntry.isPending || updateEntry.isPending ? 'Хадгалж байна...' : isEditing ? 'Ноорог шинэчлэх' : 'Хадгалах'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
