import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPayrollAdvanceQueryKey, getGetPayrollQueryKey, getGetPayrollPayablesQueryKey, getGetDashboardQueryKey,
  getListJournalReceivablesQueryKey, getListJournalEntriesQueryKey, getGetJournalTrialBalanceQueryKey,
  useListJournalReceivables, useUpdatePayrollAdvanceReceivable, type PayrollAdvanceLine } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui-primitives';
import { money, today, dateLabel } from '@/lib/app-shared';

export function AdvanceReceivableDeduction({ line, month, closed, readOnly }: {
  line: PayrollAdvanceLine; month: string; closed: boolean; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [receivableId, setReceivableId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const qc = useQueryClient();
  const mutation = useUpdatePayrollAdvanceReceivable();
  const receivables = useListJournalReceivables({ status: 'all' }, { query: {
    enabled: open, queryKey: getListJournalReceivablesQueryKey({ status: 'all' }),
  } });
  const deduction = line.receivableDeduction ?? 0;
  const paid = line.paidAmount ?? (line.paid ? line.advanceAmount - deduction : 0);
  const rows = (receivables.data ?? []).filter(r => r.partyType === 'employee' && r.partyId === line.employeeId
    && (r.status === 'open' || r.id === line.receivableId));
  const selected = rows.find(r => String(r.id) === receivableId);
  const limit = Math.min(line.advanceAmount, (selected?.openAmount ?? 0) + (selected?.id === line.receivableId ? deduction : 0));
  const valid = Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= limit && Boolean(receivableId) && Boolean(date);
  const save = (remove = false) => {
    mutation.mutate({ data: { month, employeeId: line.employeeId, receivableId: remove ? null : Number(receivableId),
      amount: remove ? 0 : Number(amount), date } }, {
      onSuccess: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) }),
          qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetPayrollPayablesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
          qc.invalidateQueries({ queryKey: getListJournalReceivablesQueryKey() }),
          qc.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetJournalTrialBalanceQueryKey() }),
        ]);
        setOpen(false);
      },
    });
  };
  return <div className="mt-2 space-y-1 text-xs">
    {deduction > 0 && <p data-testid={`advance-receivable-deduction-${line.employeeId}`}>Авлагад: {money(deduction)} · {line.receivableDate ? dateLabel(line.receivableDate) : ''}</p>}
    <p className="font-semibold" data-testid={`advance-net-${line.employeeId}`}>Шилжүүлэх нийт: {money(line.netAdvanceAmount ?? line.advanceAmount - deduction)}</p>
    {!readOnly && <Button type="button" variant="outline" size="sm" disabled={closed || paid > 0}
      title={paid > 0 ? 'Суутгалыг өөрчлөхийн өмнө олголтыг буцаана уу' : undefined}
      data-testid={`button-advance-receivable-${line.employeeId}`}
      onClick={() => {
        setReceivableId(line.receivableId ? String(line.receivableId) : '');
        setAmount(deduction ? String(deduction) : '');
        setDate(line.receivableDate ?? today());
        mutation.reset();
        setOpen(true);
      }}>{deduction > 0 ? 'Суутгал засах' : 'Авлага суутгах'}</Button>}
    {open && <Modal title={`${line.employeeName} · Авлага суутгах`}
      detail="Суутгал батлахад авлага буурч, зөвхөн үлдсэн дүнг урьдчилгаа болгон шилжүүлнэ. Сүүл цалинд давхар суутгахгүй."
      onClose={() => { if (!mutation.isPending) setOpen(false); }}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (valid) save(); }}>
        <p className="text-sm">Батлагдсан урьдчилгаа: <strong>{money(line.advanceAmount)}</strong></p>
        <label className="block space-y-1 text-sm">Ажилтны авлага
          <select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={receivableId}
            onChange={e => setReceivableId(e.target.value)} disabled={mutation.isPending} data-testid="select-advance-receivable">
            <option value="">Авлага сонгоно уу</option>
            {rows.map(r => <option key={r.id} value={r.id}>#{r.id} · Үлдэгдэл {money(r.openAmount)}</option>)}
          </select>
        </label>
        {receivables.isLoading && <p className="text-sm">Авлага ачаалж байна...</p>}
        {receivables.isError && <p className="text-sm text-destructive">Авлага татахад алдаа гарлаа. <button type="button" className="underline" onClick={() => void receivables.refetch()}>Дахин оролдох</button></p>}
        {!receivables.isLoading && !receivables.isError && !rows.length && <p className="text-sm text-muted-foreground">Энэ ажилтны нээлттэй авлага алга.</p>}
        <label className="block space-y-1 text-sm">Суутгах дүн
          <input type="number" min="0.01" max={limit} step="0.01" value={amount} disabled={mutation.isPending}
            onChange={e => setAmount(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3" data-testid="input-advance-receivable-amount" />
        </label>
        <label className="block space-y-1 text-sm">Суутгалын огноо
          <input type="date" value={date} disabled={mutation.isPending} onChange={e => setDate(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3" data-testid="input-advance-receivable-date" />
        </label>
        <p className="rounded-lg bg-secondary p-3 text-sm" data-testid="advance-receivable-net-preview">Шилжүүлэх нийт: <strong>{money(Math.max(0, line.advanceAmount - (Number(amount) || 0)))}</strong></p>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {deduction > 0 && <Button type="button" variant="outline" disabled={mutation.isPending || !date} onClick={() => {
            if (window.confirm('Суутгалыг буцааж, авлагын үлдэгдлийг сэргээх үү?')) save(true);
          }} data-testid="button-remove-advance-receivable">Суутгал буцаах</Button>}
          <Button type="submit" disabled={!valid || mutation.isPending || receivables.isError || receivables.isLoading} data-testid="button-save-advance-receivable">{mutation.isPending ? 'Хадгалж байна...' : 'Суутгал батлах'}</Button>
        </div>
      </form>
    </Modal>}
  </div>;
}
