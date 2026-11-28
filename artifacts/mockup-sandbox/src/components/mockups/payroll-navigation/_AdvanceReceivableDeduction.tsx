// @ts-nocheck
// Extracted from artifacts/staff-ops/src/components/AdvanceReceivableDeduction.tsx; services replaced with local demo boundaries.
import { useState } from 'react';
import { useQueryClient } from './_api';
import { getGetPayrollAdvanceQueryKey, getGetPayrollQueryKey, getGetPayrollPayablesQueryKey, getGetDashboardQueryKey,
  getListJournalReceivablesQueryKey, getListJournalEntriesQueryKey, getGetJournalTrialBalanceQueryKey,
  useListJournalReceivables, useUpdatePayrollAdvanceReceivable, type PayrollAdvanceLine } from './_api';
import { Button } from './_Button';
import { Modal } from './_primitives';
import { money, today, dateLabel } from './_app-shared';
import { payrollReceivableBalance } from './_receivable-balance';

export function AdvanceReceivableDeduction({ line, month, closed, readOnly }: {
  line: PayrollAdvanceLine; month: string; closed: boolean; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const qc = useQueryClient();
  const mutation = useUpdatePayrollAdvanceReceivable();
  const receivables = useListJournalReceivables({ status: 'all' }, { query: {
    enabled: open, queryKey: getListJournalReceivablesQueryKey({ status: 'all' }),
  } });
  const deduction = line.receivableDeduction ?? 0;
  const paid = line.paidAmount ?? (line.paid ? line.advanceAmount - deduction : 0);
  const balance = payrollReceivableBalance(receivables.data ?? [], line.employeeId, deduction);
  const limit = Math.min(line.advanceAmount, balance.available);
  const valid = Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= limit && Boolean(date);
  const save = (remove = false) => {
    mutation.mutate({ data: { month, employeeId: line.employeeId,
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
        <div className="rounded-lg bg-secondary p-3 text-sm" data-testid="advance-total-receivable">
          Нийт авлагын үлдэгдэл: <strong>{money(balance.open)}</strong>
          {deduction > 0 && <p className="mt-1 text-xs text-muted-foreground">Одоогийн суутгалыг оролцуулж засах боломжтой: {money(balance.available)}</p>}
        </div>
        {receivables.isLoading && <p className="text-sm">Авлага ачаалж байна...</p>}
        {receivables.isError && <p className="text-sm text-destructive">Авлага татахад алдаа гарлаа. <button type="button" className="underline" onClick={() => void receivables.refetch()}>Дахин оролдох</button></p>}
        {!receivables.isLoading && !receivables.isError && balance.available === 0 && <p className="text-sm text-muted-foreground">Энэ ажилтны нээлттэй авлага алга.</p>}
        <label className="block space-y-1 text-sm">Суутгах дүн
          <input type="number" min="0.01" max={limit} step="0.01" value={amount} disabled={mutation.isPending}
            onChange={e => setAmount(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3" data-testid="input-advance-receivable-amount" />
        </label>
        {Number(amount) > limit && <p role="alert" className="text-sm text-destructive">Суутгал нийт авлага болон урьдчилгааны дүнгээс хэтрэхгүй байна.</p>}
        <p className="text-xs text-muted-foreground">Хэсэгчлэн суутгаж болно. Хуучин авлагаас эхлэн автоматаар хуваарилна.</p>
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
