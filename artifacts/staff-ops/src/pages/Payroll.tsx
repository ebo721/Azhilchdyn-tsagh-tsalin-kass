import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPayrollPayablesQueryKey, getGetCashSummaryQueryKey, getListCashTransactionsQueryKey, getListCashClosuresQueryKey } from '@workspace/api-client-react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { CalendarDays, Banknote, Check, Coins, Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { downloadSocialInsuranceReport, useRefreshEmployeePayroll } from '@workspace/api-client-react';
import { getGetDashboardQueryKey, getGetPayrollAdvanceQueryKey, getGetPayrollQueryKey, getGetPayrollScheduleQueryKey, getListJournalReceivablesQueryKey, useApprovePayrollAdvance, useClosePayrollMonth, useReopenPayrollMonth, useGetAuthSession, useGetPayroll, useGetPayrollAdvance, useGetPayrollSchedule, useListCashClosures, useListJournalReceivables, useUpdatePayrollAdvancePayment, useUpdatePayrollSchedule, useUpsertPayrollAdjustment, type PayrollLine, type PayrollScheduleInput, type PayrollSummary } from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { MonthNavigator } from '@/components/MonthNavigator';
import { dateLabel, currentMonth, money, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { PayrollOpeningBalances } from '@/components/PayrollOpeningBalances';
import { rebuildPayrollBalances } from '@workspace/api-client-react';
import { getListJournalEntriesQueryKey, getGetJournalTrialBalanceQueryKey } from '@workspace/api-client-react';

const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
const cm = (line: PayrollLine, amount: number) => (line.calculationReady === false ? '—' : money(amount));
const payrollRemaining = (line: PayrollLine) => {
  const amount = Math.max(0, line.gross - line.deductions) - line.paidAmount + line.carryoverAmount;
  return Math.abs(amount) <= 1 ? 0 : amount;
};
const remainingLabel = (amount: number) =>
  Math.abs(amount) <= 1 ? money(0) : amount > 0 ? money(amount) : `(${money(Math.abs(amount))})`;
type PayrollAdjustmentForm = {
  manualDeduction: string;
  receivableId: string;
  paidAmount: string;
  paymentDate: string;
  secondPaidAmount: string;
  secondPaymentDate: string;
};
type ExtraRow = { sequence: number; amount: string; date: string; saved: boolean };
const round2 = (n: number) => Number(n.toFixed(2));

function PayrollAdjustmentModal({ line, month, onClose }: { line: PayrollLine; month: string; onClose: () => void }) {
  const save = useUpsertPayrollAdjustment();
  const deletion = useQueueDeletion();
  const receivables = useListJournalReceivables({ status: 'all' });
  const qc = useQueryClient();
  const savedExtras = line.additionalPayments ?? [];
  const extraSum = savedExtras.reduce((t, p) => t + p.amount, 0);
  const [extras, setExtras] = useState<ExtraRow[]>(() => savedExtras.map((p) => ({ sequence: p.sequence, amount: String(p.amount), date: p.date, saved: true })));
  const [extraError, setExtraError] = useState<string | null>(null);
  const addExtra = () => setExtras((rows) => [...rows, { sequence: Math.max(2, ...savedExtras.map((p) => p.sequence), ...rows.map((r) => r.sequence)) + 1, amount: '', date: today(), saved: false }]);
  const patchExtra = (sequence: number, patch: Partial<ExtraRow>) => setExtras((rows) => rows.map((r) => r.sequence === sequence ? { ...r, ...patch } : r));
  const form = useForm<PayrollAdjustmentForm>({
    defaultValues: {
      manualDeduction: String(line.manualDeduction),
      receivableId: line.receivableId === null ? '' : String(line.receivableId),
      paidAmount: String(round2(line.paidAmount - line.secondPaidAmount - extraSum)),
      paymentDate: line.paymentDate ?? today(),
      secondPaidAmount: String(line.secondPaidAmount),
      secondPaymentDate: line.secondPaymentDate ?? today(),
    },
  });
  const submit = (values: PayrollAdjustmentForm) => {
    setExtraError(null);
    const additionalPayments: { sequence: number; amount: number; date: string }[] = [];
    for (const row of extras) {
      const raw = row.amount.trim();
      if (!row.saved && raw === '') continue;
      const amount = Number(raw);
      if (raw === '' || !Number.isFinite(amount) || amount <= 0) { setExtraError(`${row.sequence}-р гүйлгээний дүн 0-ээс их байх ёстой.`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) { setExtraError(`${row.sequence}-р гүйлгээний огноог сонгоно уу.`); return; }
      additionalPayments.push({ sequence: row.sequence, amount, date: row.date });
    }
    if (additionalPayments.length > 1000) { setExtraError('Нэмэлт гүйлгээ 1000-аас хэтрэхгүй.'); return; }
    save.mutate({
      data: {
        employeeId: line.employeeId,
        month,
        manualDeduction: Number(values.manualDeduction),
        receivableId: values.receivableId ? Number(values.receivableId) : null,
        paidAmount: Number(values.paidAmount),
        paymentDate: Number(values.paidAmount) > 0 ? values.paymentDate : null,
        secondPaidAmount: Number(values.secondPaidAmount),
        secondPaymentDate: Number(values.secondPaidAmount) > 0 ? values.secondPaymentDate : null,
        additionalPayments,
      },
    }, {
      onSuccess: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) }),
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
          qc.invalidateQueries({ queryKey: getListJournalReceivablesQueryKey({ status: 'all' }) }),
          qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }),
          qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }),
          qc.invalidateQueries({ queryKey: getListCashClosuresQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetPayrollPayablesQueryKey() }),
          qc.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetJournalTrialBalanceQueryKey() }),
        ]);
        onClose();
      },
    });
  };
  const employeeReceivables = (receivables.data ?? []).filter((receivable) =>
    receivable.partyType === 'employee'
    && receivable.partyId === line.employeeId
    && (receivable.status === 'open' || receivable.id === line.receivableId)
  );
  const removePayment = async (sequence: number) => {
    if (!window.confirm(`${line.employeeName}-ийн ${sequence}-р цалингийн гүйлгээг устгах уу?`)) return;
    await deletion.request(
      `/payroll-adjustments/${month}/${line.employeeId}/transactions/${sequence}`,
      `${line.employeeName} · ${month} · ${sequence}-р цалингийн гүйлгээ`,
    );
    onClose();
  };
  return <Modal title={`${line.employeeName} · Цалингийн тохируулга`} detail={`${month.replace('-', ' оны ')} сарын урьдчилгаа, хөнгөлөлт, суутгал болон шилжүүлсэн дүнг оруулна.`} onClose={onClose}>
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-xs font-semibold text-muted-foreground">Цалин хүлээн авах банкны данс</p>
      <p className="mt-2 break-all font-mono text-base font-semibold select-all" data-testid="value-payroll-bank-account">{line.bankAccountNumber || 'Бүртгээгүй'}</p>
      {!line.bankAccountNumber && <p className="mt-1 text-xs text-muted-foreground">Ажилтны бүртгэлийн «Засах» хэсэгт дансыг оруулна уу.</p>}
    </div>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-payroll-adjustment">
      <div className="rounded-xl border border-border bg-secondary/40 p-4 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Гарт олгох цалин</span>
          <strong className="font-mono text-foreground">{money(Math.max(0, line.gross - line.deductions))}</strong>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Олгосон цалин (−)</span>
          <strong className="font-mono text-foreground">{money(line.paidAmount)}</strong>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Цалингийн өглөг (+)</span>
          <strong className="font-mono text-orange-800">{money(Math.max(0, line.carryoverAmount))}</strong>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Цалингийн авлага (−)</span>
          <strong className="font-mono text-sky-700">{money(Math.max(0, -line.carryoverAmount))}</strong>
        </div>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
          <span className="font-bold text-foreground">Олговол зохих цалин</span>
          <strong className="font-mono text-primary">{money(line.balanceAmount)}</strong>
        </div>
      </div>
      <div className="rounded-xl border border-accent/50 bg-accent/15 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{line.employeeType === 'shift' ? 'Урьдчилгаа цалин' : 'Урьдчилгаа цалин · 50%'}</span><strong className="font-mono text-sm">{money(line.advanceAmount)}</strong></div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-xs font-semibold"><span>ХХОАТ хөнгөлөлт</span><div className="mt-1 flex h-10 w-full items-center rounded-lg border border-input bg-secondary/40 px-3 font-mono text-sm">{money(line.taxRelief)}</div><p className="text-[11px] font-normal text-muted-foreground">НДШ тооцох цалингийн шатлалаар автоматаар тооцно.</p></div>
        <label className="space-y-2 text-xs font-semibold">Гараар оруулах суутгал<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('manualDeduction', { required: true, min: 0 })} data-testid="input-payroll-manual-deduction" /></label>
        <label className="space-y-2 text-xs font-semibold sm:col-span-2">Суутгалаар хаах авлага
          <select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('receivableId')} data-testid="select-payroll-receivable">
            <option value="">Авлагатай холбохгүй</option>
            {employeeReceivables.map((receivable) => (
              <option key={receivable.id} value={receivable.id}>
                #{receivable.id} · Үлдэгдэл {money(receivable.openAmount)}
              </option>
            ))}
          </select>
          <p className="text-[11px] font-normal text-muted-foreground">Авлага сонговол суутгалын дүн үлдэгдлээс хэтрэхгүй байна.</p>
        </label>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний дүн<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('paymentDate')} data-testid="input-payroll-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.paidAmount - line.secondPaidAmount - extraSum <= 0 || deletion.isPending} onClick={() => removePayment(1)} aria-label="1-р гүйлгээг устгах" title="1-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-1"><Trash2 className="size-4" /></Button></div>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний дүн<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('secondPaidAmount', { required: true, min: 0 })} data-testid="input-payroll-second-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('secondPaymentDate')} data-testid="input-payroll-second-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.secondPaidAmount <= 0 || deletion.isPending} onClick={() => removePayment(2)} aria-label="2-р гүйлгээг устгах" title="2-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-2"><Trash2 className="size-4" /></Button></div>
      <div className="space-y-3 sm:col-span-2">{extras.map((row) => <div key={row.sequence} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-testid={`row-payroll-extra-${row.sequence}`}><label className="space-y-2 text-xs font-semibold">{row.sequence}-р гүйлгээний дүн<input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => patchExtra(row.sequence, { amount: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" data-testid={`input-payroll-extra-amount-${row.sequence}`} /></label><label className="space-y-2 text-xs font-semibold">{row.sequence}-р гүйлгээний огноо<input type="date" value={row.date} onChange={(e) => patchExtra(row.sequence, { date: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid={`input-payroll-extra-date-${row.sequence}`} /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deletion.isPending} onClick={() => row.saved ? removePayment(row.sequence) : setExtras((rows) => rows.filter((r) => r.sequence !== row.sequence))} aria-label={`${row.sequence}-р гүйлгээг устгах`} title={`${row.sequence}-р гүйлгээг устгах`} data-testid={`button-delete-payroll-payment-${row.sequence}`}><Trash2 className="size-4" /></Button></div>)}<Button type="button" variant="outline" onClick={addExtra} disabled={save.isPending} data-testid="button-add-payroll-payment">Гүйлгээ нэмэх</Button></div>
      </div>
      {extraError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-payroll-extra">{extraError}</p>}
      {save.isError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-payroll-adjustment">{save.error instanceof Error ? save.error.message : 'Цалингийн тохируулга хадгалж чадсангүй.'}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={save.isPending} data-testid="button-save-payroll-adjustment">{save.isPending ? 'Хадгалж байна...' : 'Тохируулга хадгалах'}</Button></div>
    </form></Form>
  </Modal>;
}

function PayrollScheduleSettingsModal({ onClose }: { onClose: () => void }) {
  const query = useGetPayrollSchedule();
  const update = useUpdatePayrollSchedule();
  const qc = useQueryClient();
  const form = useForm<PayrollScheduleInput>({ defaultValues: { periodStartDay: 26, advanceCutoffDay: 10, periodEndDay: 25, advancePayDay: 10, finalPayDay: 25 } });

  const initRef = useRef(false);
  useEffect(() => {
    if (query.data && !initRef.current) {
      initRef.current = true;
      form.reset({
        periodStartDay: query.data.periodStartDay,
        advanceCutoffDay: query.data.advanceCutoffDay,
        periodEndDay: query.data.periodEndDay,
        advancePayDay: query.data.advancePayDay,
        finalPayDay: query.data.finalPayDay,
      });
    }
  }, [query.data, form]);

  const submit = (data: PayrollScheduleInput) => {
    update.mutate({ data }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollScheduleQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey() });
        onClose();
      }
    });
  };

  const periodStartDay = form.watch('periodStartDay');
  const periodEndDay = form.watch('periodEndDay');
  const advancePayDay = form.watch('advancePayDay');
  const finalPayDay = form.watch('finalPayDay');

  return (
    <Modal title="Цалингийн хуваарь" detail="Цалингийн мөчлөг болон олгох өдрүүдийг тохируулна. (31 = сарын сүүлийн өдөр)" onClose={onClose}>
      {query.isLoading ? <LoadingBlock className="h-40" /> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="form-payroll-schedule">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold">Мөчлөг эхлэх өдөр<input type="number" min="1" max="31" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('periodStartDay', { valueAsNumber: true, required: true, min: 1, max: 31 })} data-testid="input-schedule-period-start" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Мөчлөг дуусах өдөр<input type="number" min="1" max="31" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('periodEndDay', { valueAsNumber: true, required: true, min: 1, max: 31 })} data-testid="input-schedule-period-end" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Урьдчилгаа таслах өдөр<input type="number" min="1" max="31" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('advanceCutoffDay', { valueAsNumber: true, required: true, min: 1, max: 31 })} data-testid="input-schedule-advance-cutoff" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Урьдчилгаа олгох өдөр<input type="number" min="1" max="31" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('advancePayDay', { valueAsNumber: true, required: true, min: 1, max: 31 })} data-testid="input-schedule-advance-pay" /></label>
              <label className="space-y-1.5 text-xs font-semibold">Сүүл цалин олгох өдөр<input type="number" min="1" max="31" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('finalPayDay', { valueAsNumber: true, required: true, min: 1, max: 31 })} data-testid="input-schedule-final-pay" /></label>
            </div>
            {Number(periodStartDay) > Number(periodEndDay) && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                Мөчлөг эхлэх өдөр нь дуусах өдрөөс хойно байгаа тул цалингийн мөчлөг өмнөх сараас эхэлж тухайн сард дуусна гэж тооцогдоно.
              </div>
            )}
            {Number(finalPayDay) < Number(advancePayDay) && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                Сүүл цалин олгох өдөр нь урьдчилгаа олгох өдрөөс өмнө байгаа тул сүүл цалинг дараа сарын {Number(finalPayDay)}-нд олгоно гэж тооцогдоно.
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-schedule">Болих</Button>
              <Button type="submit" disabled={update.isPending} data-testid="button-save-schedule">{update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button>
            </div>
          </form>
        </Form>
      )}
    </Modal>
  );
}

export function Payroll() {
  const [preparingBalances, setPreparingBalances] = useState(false);
  const [balanceProgress, setBalanceProgress] = useState('');
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balancesAbort = useRef<AbortController | null>(null);
  useEffect(() => () => balancesAbort.current?.abort(), []);
  const [downloadingInsurance, setDownloadingInsurance] = useState(false);
  const [insuranceError, setInsuranceError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('month') ?? '';
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonth();
  });
  const selectedMonth = useRef(month);
  selectedMonth.current = month;
  const refreshEmployee = useRefreshEmployeePayroll();
  const [refreshingIds, setRefreshingIds] = useState<number[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [refreshFailures, setRefreshFailures] = useState<Record<number, string>>({});
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [refreshingAdvanceEmployeeId, setRefreshingAdvanceEmployeeId] = useState<number | null>(null);
  const [advanceApprovalDate, setAdvanceApprovalDate] = useState(today());
  const [advanceDates, setAdvanceDates] = useState<Record<number, string>>({});
  const [advanceAmounts, setAdvanceAmounts] = useState<Record<number, string>>({});
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month }, { query: { queryKey: getGetPayrollAdvanceQueryKey({ month }), enabled: showAdvance } });
  const cashClosures = useListCashClosures();
  const closedCashDates = new Set(cashClosures.data?.map((closure) => closure.date) ?? []);
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const approveAdvance = useApprovePayrollAdvance();
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: getGetPayrollPayablesQueryKey(), refetchType: 'none' });
  }, [qc, query.data, advanceQuery.data]);
  const deletion = useQueueDeletion();
  const revertAdvanceApproval = deletion;
  const updateAdvancePayment = useUpdatePayrollAdvancePayment();
  const closePayroll = useClosePayrollMonth();
  const reopenPayroll = useReopenPayrollMonth();
  const [closureError, setClosureError] = useState<string | null>(null);
  const closed = Boolean(query.data?.closedAt);
  const role = session.data?.role;
  const canEditPayroll = ['admin', 'accountant', 'hr'].includes(role ?? '');
  const canClose = role === 'admin' || role === 'accountant';
  useEffect(() => {
    if (closed) { setSelectedLine(null); setRefreshingAdvanceEmployeeId(null); setAdvanceAmounts({}); setAdvanceDates({}); }
  }, [closed]);
  const applyClosure = async (summary: PayrollSummary) => {
    await qc.cancelQueries({ queryKey: getGetPayrollQueryKey({ month: summary.month }) });
    qc.setQueryData(getGetPayrollQueryKey({ month: summary.month }), summary);
    qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month: summary.month }) });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const closureMessage = (error: unknown) => error instanceof Error ? error.message : 'Үйлдэл амжилтгүй боллоо.';
  const closeMonth = () => {
    if (!window.confirm(`${mongolianMonthLabel(month)}-ийг хаах уу?\n\nХаасны дараа сарын үлдэгдэл (авлага/өглөг) түгжигдэнэ, цалингийн мөр болон урьдчилгааг засах боломжгүй болно. Дараагийн сарын шилжих үлдэгдэл энэ хадгалсан үлдэгдлээс авагдана.`)) return;
    const target = month;
    setClosureError(null);
    closePayroll.mutate({ month: target }, { onSuccess: applyClosure, onError: (e) => { if (selectedMonth.current === target) setClosureError(closureMessage(e)); } });
  };
  const reopenMonth = () => {
    if (!window.confirm(`${mongolianMonthLabel(month)}-ийг дахин нээх үү?\n\nАнхааруулга: хойно хаагдсан сарууд байвал эхлээд тэдгээрийг дахин нээсэн байх шаардлагатай.`)) return;
    const target = month;
    setClosureError(null);
    reopenPayroll.mutate({ month: target }, { onSuccess: applyClosure, onError: (e) => { if (selectedMonth.current === target) setClosureError(closureMessage(e)); } });
  };
  useEffect(() => {
    setSelectedLine(null);
    setRefreshingAdvanceEmployeeId(null);
    setClosureError(null);
    setAdvanceAmounts({});
    setAdvanceDates({});
    setAttendanceError(null);
    setRefreshFailures({});
    setRefreshNotice(null);
  }, [month]);
  const payrollTotals = (query.data?.lines ?? []).filter((line) => line.calculationReady !== false).reduce(
    (totals, line) => ({
      gross: totals.gross + Number(line.gross),
      advanceAmount: totals.advanceAmount + Number(line.advanceAmount),
      payable: totals.payable + Math.max(0, Number(line.gross) - Number(line.deductions)),
      paidAmount: totals.paidAmount + Number(line.paidAmount),
      remaining: totals.remaining + payrollRemaining(line),
    }),
    { gross: 0, advanceAmount: 0, payable: 0, paidAmount: 0, remaining: 0 },
  );
  const partial = !closed && (query.data?.lines ?? []).some((line) => line.calculationReady === false || line.attendanceNeedsRefresh || line.openingBalanceReviewRequired);
  const displayedAdvanceTotal = (advanceQuery.data?.lines ?? []).reduce((total, line) => {
    const amount = Number(advanceAmounts[line.employeeId] ?? line.advanceAmount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const refreshOne = async (employeeId: number, resetDraft = true): Promise<boolean> => {
    if (closed) return false;
    const requestedMonth = month;
    setRefreshingIds((ids) => [...ids, employeeId]);
    setRefreshFailures((f) => { const next = { ...f }; delete next[employeeId]; return next; });
    try {
      const result = await refreshEmployee.mutateAsync({ month: requestedMonth, employeeId });
      qc.setQueryData(getGetPayrollQueryKey({ month: requestedMonth }), result.payroll);
      qc.setQueryData(getGetPayrollAdvanceQueryKey({ month: requestedMonth }), result.advance);
      void qc.invalidateQueries({ queryKey: getGetPayrollPayablesQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      if (selectedMonth.current === requestedMonth && resetDraft && !result.advance.approved) {
        setAdvanceAmounts((amounts) => { const next = { ...amounts }; delete next[employeeId]; return next; });
      }
      return true;
    } catch (error) {
      if (selectedMonth.current === requestedMonth) setRefreshFailures((f) => ({ ...f, [employeeId]: error instanceof Error ? error.message : 'Шинэчилж чадсангүй.' }));
      return false;
    } finally {
      setRefreshingIds((ids) => { const i = ids.indexOf(employeeId); return i < 0 ? ids : [...ids.slice(0, i), ...ids.slice(i + 1)]; });
    }
  };
  const refreshAdvanceEmployee = async (employeeId: number) => {
    setRefreshingAdvanceEmployeeId(employeeId);
    try { await refreshOne(employeeId, true); } finally { setRefreshingAdvanceEmployeeId(null); }
  };
  const needsRefresh = (line: PayrollLine) => line.calculationReady === false || line.attendanceNeedsRefresh === true;
  const refreshableLines = (query.data?.lines ?? []).filter((line) => needsRefresh(line) && !line.openingBalanceReviewRequired);
  const reviewBlockedCount = (query.data?.lines ?? []).filter((line) => line.openingBalanceReviewRequired).length;
  const refreshAllChanged = async () => {
    if (closed || bulkRunning || !refreshableLines.length) return;
    const targetMonth = month;
    const ids = refreshableLines.map((line) => line.employeeId);
    setBulkRunning(true);
    setRefreshNotice(null);
    let ok = 0;
    for (const id of ids) {
      if (selectedMonth.current !== targetMonth) break;
      if (await refreshOne(id, true)) ok += 1;
    }
    setBulkRunning(false);
    if (selectedMonth.current === targetMonth) setRefreshNotice(`${ok}/${ids.length} ажилтан шинэчлэгдлээ.${ok < ids.length ? ' Алдаатай мөрүүдийг доороос харна уу.' : ''}`);
  };
  const approve = () => {
    if (closed) return;
    if (!advanceApprovalDate) {
      window.alert('Батлах огноог сонгоно уу.');
      return;
    }
    const lines = (advanceQuery.data?.lines ?? []).map((line) => ({
      employeeId: line.employeeId,
      advanceAmount: Number(advanceAmounts[line.employeeId] ?? line.advanceAmount),
    }));
    if (lines.some((line) => !Number.isFinite(line.advanceAmount) || line.advanceAmount < 0)) {
      window.alert('Олгох урьдчилгааны дүнгүүдийг зөв оруулна уу.');
      return;
    }
    if (!window.confirm(`${month} сарын урьдчилгаа цалинг зассан дүнгээр ${advanceApprovalDate} огноогоор батлах уу? Баталсны дараа энэ жагсаалтын дүн өөрчлөгдөхгүй.`)) return;
    approveAdvance.mutate({ data: { month, approvalDate: advanceApprovalDate, lines } }, {
      onSuccess: () => {
        setAdvanceAmounts({});
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) });
      },
    });
  };
  const downloadInsurance = async () => {
    setDownloadingInsurance(true);
    setInsuranceError(null);
    try {
      const workbook = await downloadSocialInsuranceReport({ month }, { responseType: 'blob' });
      const url = URL.createObjectURL(workbook);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NDSH-${month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setInsuranceError(error instanceof Error ? error.message : 'НДШ тайлан татаж чадсангүй.');
    } finally {
      setDownloadingInsurance(false);
    }
  };
  const prepareBalances = async () => {
    if (closed) return;
    const targetMonth = month;
    const controller = new AbortController();
    balancesAbort.current = controller;
    setPreparingBalances(true);
    setBalanceError(null);
    setBalanceProgress('Өмнөх сарын авлага/өглөгийг бэлтгэж байна…');
    let lastNextMonth = '';
    let count = 0;
    try {
      while (true) {
        const result = await rebuildPayrollBalances({ month: targetMonth }, { signal: controller.signal });
        count += result.processedMonths.length;
        setBalanceProgress(`${count} сарын үлдэгдэл шинэчлэгдлээ.`);
        if (result.complete) break;
        if (!result.nextMonth || result.nextMonth <= lastNextMonth) {
          throw new Error('Бүртгэл зэрэг өөрчлөгдсөн тул үлдэгдэл шинэчлэх ажиллагааг дахин эхлүүлнэ үү.');
        }
        lastNextMonth = result.nextMonth;
      }
      await qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
    } catch (error) {
      if (!controller.signal.aborted) {
        setBalanceError(error instanceof Error ? error.message : 'Өмнөх үлдэгдэл бэлтгэж чадсангүй.');
      }
    } finally {
      setPreparingBalances(false);
    }
  };
  const revertApproval = () => {
    if (closed) return;
    if (!window.confirm(`${month} сарын урьдчилгаа цалингийн батлалтыг устгах уу?`)) return;
    deletion.request(`/payroll-advance/approval?month=${month}`, `${month} сарын урьдчилгаа цалингийн батлалт`);
  };
  const setAdvancePaid = (employeeId: number, paid: boolean, existingAmount: number, existingDate?: string | null) => {
    if (closed) return;
    const paymentDate = paid ? (advanceDates[employeeId] || existingDate || advanceQuery.data?.approvalDate || today()) : null;
    const advanceAmount = Number(advanceAmounts[employeeId] ?? existingAmount);
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      window.alert('Олгох урьдчилгааны дүнг зөв оруулна уу.');
      return;
    }
    updateAdvancePayment.mutate({ data: { month, employeeId, advanceAmount, paid, paymentDate } }, {
      onSuccess: () => {
        if (!paid) {
          setAdvanceAmounts((amounts) => {
            const next = { ...amounts };
            delete next[employeeId];
            return next;
          });
          setAdvanceDates((dates) => {
            const next = { ...dates };
            delete next[employeeId];
            return next;
          });
        }
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) });
      },
    });
  };
  return <div className="page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
      {(session.data?.role === 'admin' || session.data?.role === 'accountant') && <Button onClick={downloadInsurance} variant="outline" disabled={downloadingInsurance || query.isFetching || query.isError || !month} data-testid="button-download-insurance-report"><Download className="size-4" />{downloadingInsurance ? 'Тайлан бэлдэж байна...' : 'НДШ тайлан · Excel'}</Button>}
      <Button onClick={() => setShowScheduleSettings(true)} variant="outline" data-testid="button-payroll-schedule-settings"><CalendarDays className="size-4" />Цалингийн хуваарь</Button>
      {['admin', 'accountant', 'hr'].includes(session.data?.role ?? '') && <Button onClick={() => void refreshAllChanged()} variant="outline" disabled={bulkRunning || closed || refreshableLines.length === 0} title={closed ? 'Сар хаагдсан' : refreshableLines.length === 0 ? 'Шинэчлэх ажилтан алга' : undefined} data-testid="button-refresh-changed-payroll"><RefreshCw className={cn('size-4', bulkRunning && 'animate-spin')} />{bulkRunning ? 'Шинэчилж байна...' : `Өөрчлөгдсөнийг шинэчлэх (${refreshableLines.length})`}</Button>}
      <Button onClick={() => setShowAdvance((value) => !value)} variant={showAdvance ? 'default' : 'outline'} data-testid="button-payroll-advance"><Coins className="size-4" />Урьдчилгаа цалин</Button>
      <MonthNavigator month={month} onChange={setMonth} prefix="payroll" ariaLabel="Цалингийн сар сонгох" />
    </div>
    {query.data && !query.isError && (closed ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="status-payroll-closed"><p className="text-sm"><strong>Сар хаагдсан</strong> · {new Date(query.data.closedAt as string).toLocaleString('mn-MN')}. Үлдэгдэл түгжигдсэн, засвар хийх боломжгүй.</p>{role === 'admin' && <Button variant="outline" onClick={reopenMonth} disabled={reopenPayroll.isPending} data-testid="button-reopen-payroll-month">{reopenPayroll.isPending ? 'Нээж байна...' : 'Дахин нээх'}</Button>}</div> : canClose && <div className="mb-5 flex justify-end"><Button onClick={closeMonth} disabled={closePayroll.isPending} data-testid="button-close-payroll-month">{closePayroll.isPending ? 'Хааж байна...' : 'Сар хаах'}</Button></div>)}
    {closureError && <p role="alert" className="mb-5 whitespace-pre-line text-sm text-destructive" data-testid="payroll-closure-error">{closureError}</p>}

    {!query.data?.openingBalanceMonth && ((query.isError && query.error instanceof Error && query.error.message.includes('өмнөх сарын')) || attendanceError?.includes('өмнөх сарын')) && <div className="mb-5 space-y-3 rounded-xl border border-border bg-card p-4" data-testid="payroll-balances-required">
      <p className="text-xs font-semibold text-muted-foreground">Нарийвчилсан сонголт (эхний үлдэгдэл байхгүй үед)</p>
      <p className="text-sm">Өмнөх сарын хадгалсан авлага/өглөгийг нэг удаа бэлтгэх, эсвэл хуучин сарын засварыг тусгах шаардлагатай. Ердийн цалин бодолт зөвхөн сонгосон цалингийн хугацааны ирцийг уншина.</p>
      {(session.data?.role === 'admin' || session.data?.role === 'accountant') && <Button onClick={prepareBalances} disabled={preparingBalances || closed} data-testid="button-prepare-payroll-balances">{preparingBalances ? 'Шинэчилж байна…' : 'Өмнөх үлдэгдэл шинэчлэх'}</Button>}
      {balanceProgress && <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="payroll-balances-progress">{balanceProgress}</p>}
      {balanceError && <p role="alert" className="whitespace-pre-line text-sm text-destructive" data-testid="payroll-balances-error">{balanceError}</p>}
    </div>}
    {canEditPayroll && <PayrollOpeningBalances month={month} role={role} closed={closed} openingBalanceMonth={query.data?.openingBalanceMonth} reviewRequiredCount={reviewBlockedCount} legacyAvailable={!query.data?.openingBalanceMonth} />}
    {refreshNotice && <p role="status" className="mb-4 text-sm font-medium text-primary" data-testid="payroll-refresh-notice">{refreshNotice}</p>}
    {Object.keys(refreshFailures).length > 0 && <div role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="payroll-refresh-failures"><p className="font-semibold">Шинэчлэхэд алдаа гарсан ажилтнууд:</p><ul className="mt-1 list-disc pl-5">{Object.entries(refreshFailures).map(([id, message]) => <li key={id}>{query.data?.lines.find((l) => l.employeeId === Number(id))?.employeeName ?? `#${id}`}: {message}</li>)}</ul></div>}
    {attendanceError && <p role="alert" className="mb-5 whitespace-pre-line text-sm text-destructive" data-testid="payroll-attendance-error">{attendanceError}</p>}
    {query.data?.attendancePulledAt && <p className="mb-4 text-sm text-muted-foreground" data-testid="payroll-attendance-status">Сүүлд цаг татсан: {new Date(query.data.attendancePulledAt).toLocaleString('mn-MN')}. {query.data.attendanceNeedsRefresh ? 'Эх бүртгэл өөрчлөгдсөн. Хадгалсан тооцоог харуулж байна; Өөрчлөгдсөн ажилтныг «Шинэчлэх» үйлдлээр шинэчилнэ үү.' : 'Хадгалсан тооцоог харуулж байна.'}</p>}
    {insuranceError && <div role="alert" className="mb-5 whitespace-pre-line rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="error-insurance-report">{insuranceError}</div>}
    {query.isError && query.error instanceof Error && <p role="alert" className="mb-5 whitespace-pre-line text-sm text-destructive">{query.error.message}</p>}
    {!query.isLoading && !query.isError && query.data && (
      <div className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="panel-payroll-schedule-info">
        <h3 className="mb-3 text-sm font-bold">Цалингийн мөчлөг ({month})</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Бүтэн мөчлөг</p><p className="mt-1 font-mono text-xs">{query.data.periodStart} — {query.data.periodEnd}</p></div>
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Урьдчилгаа хүртэлх</p><p className="mt-1 font-mono text-xs">{query.data.periodStart} — {query.data.advancePeriodEnd}</p></div>
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Урьдчилгаа олгох</p><p className="mt-1 font-mono text-xs">{query.data.advancePaymentDate}</p></div>
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Сүүл цалин олгох</p><p className="mt-1 font-mono text-xs">{query.data.finalPaymentDate}</p></div>
        </div>
      </div>
    )}

    {showAdvance && <section className="mb-6 overflow-hidden rounded-2xl border border-accent/60 bg-card shadow-sm" data-testid="section-payroll-advance">
      <div className="flex flex-col justify-between gap-4 border-b border-border bg-accent/10 px-5 py-4 sm:flex-row sm:items-center">
        <h2 className="text-lg font-bold">{month.replace('-', ' оны ')} сарын урьдчилгаа цалин</h2>
        {advanceQuery.data?.approved ? <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="status-advance-approved"><Check className="mr-2 inline size-4" />Батлагдсан · {advanceQuery.data.approvalDate ? dateLabel(advanceQuery.data.approvalDate) : ''}</div><Button variant="outline" onClick={revertApproval} disabled={revertAdvanceApproval.isPending || closed} data-testid="button-revert-payroll-advance">{revertAdvanceApproval.isPending ? 'Хүсэлт илгээж байна...' : 'Батлалт устгах хүсэлт'}</Button></div> : <div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs font-semibold">Батлах огноо<input type="date" value={advanceApprovalDate} onChange={(event) => setAdvanceApprovalDate(event.target.value)} className="block h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-payroll-advance-approval-date" /></label><Button onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading || closed} data-testid="button-approve-payroll-advance"><Check className="size-4" />{approveAdvance.isPending ? 'Баталж байна...' : 'Урьдчилгаа батлах'}</Button></div>}
      </div>
      {advanceQuery.isLoading ? <div className="p-5"><LoadingBlock className="h-36" /></div> : advanceQuery.isError ? <div className="p-5"><ErrorBlock onRetry={() => advanceQuery.refetch()} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">Ажилласан хоног</th><th className="px-5 py-3 text-right">Өдрийн цалин</th><th className="px-5 py-3 text-right">Нийт олгох цалин</th><th className="px-5 py-3 text-right">Олгох урьдчилгаа</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead>
          <tbody className="divide-y divide-border">{advanceQuery.data?.lines.map((line) => { const selectedDate = advanceDates[line.employeeId] ?? line.paymentDate ?? advanceQuery.data?.approvalDate ?? today(); const cashClosed = closedCashDates.has(selectedDate) || Boolean(line.paymentDate && closedCashDates.has(line.paymentDate)); const isRefreshing = refreshingAdvanceEmployeeId === line.employeeId; return <tr key={line.employeeId}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.employeeType === 'shift' ? 'Ээлжийн ажилтан' : 'Оффис ажилтан'}</p></td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'office' ? money(line.baseSalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.daysWorked}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'shift' ? money(line.dailySalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.totalSalary)}</td><td className="px-5 py-4 text-right"><input type="number" min="0" step="1000" value={advanceAmounts[line.employeeId] ?? String(line.advanceAmount)} disabled={closed || Boolean(advanceQuery.data?.approved && (line.paid || cashClosed))} onChange={(event) => setAdvanceAmounts((amounts) => ({ ...amounts, [line.employeeId]: event.target.value }))} className="h-8 w-32 rounded-lg border border-input bg-background px-2 text-right font-mono text-sm font-bold text-primary outline-none focus:border-primary" data-testid={`input-advance-amount-${line.employeeId}`} /></td><td className="px-5 py-4 text-center"><input type="date" value={selectedDate} disabled={closed || !advanceQuery.data?.approved || line.paid} onChange={(event) => setAdvanceDates((dates) => ({ ...dates, [line.employeeId]: event.target.value }))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary" data-testid={`input-advance-payment-date-${line.employeeId}`} /></td><td className="px-5 py-4 text-center">{advanceQuery.data?.approved ? <Button size="sm" variant={line.paid ? 'default' : 'outline'} disabled={updateAdvancePayment.isPending || cashClosed || closed} onClick={() => setAdvancePaid(line.employeeId, !line.paid, line.advanceAmount, line.paymentDate)} title={cashClosed ? 'Энэ өдрийн касс өндөрлөсөн' : undefined} data-testid={`button-advance-paid-${line.employeeId}`}>{line.paid ? <><Check className="size-3.5" />Олгосон</> : 'Олгоогүй'}</Button> : <span className="text-xs text-muted-foreground">Батлаагүй</span>}</td><td className="px-5 py-4 text-right"><Button size="sm" variant="outline" disabled={closed || Boolean(advanceQuery.data?.approved) || advanceQuery.isFetching} onClick={() => refreshAdvanceEmployee(line.employeeId)} title={advanceQuery.data?.approved ? 'Батлагдсан урьдчилгааны мэдээлэл өөрчлөгдөхгүй' : 'Цалин болон ажилласан хоногийн мэдээллийг шинэчлэх'} data-testid={`button-refresh-advance-employee-${line.employeeId}`}><RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />{isRefreshing ? 'Шинэчилж байна...' : 'Шинэчлэх'}</Button></td></tr>; })}</tbody>
          <tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={5} className="px-5 py-4 text-right text-sm font-bold">Нийт олгох урьдчилгаа</td><td className="px-5 py-4 text-right font-mono text-base font-bold text-primary" data-testid="value-total-payroll-advance">{money(displayedAdvanceTotal)}</td><td colSpan={3} /></tr></tfoot>
        </table>
      </div>}
      {revertAdvanceApproval.isError && <p className="border-t border-border bg-destructive/5 px-5 py-3 text-xs font-medium text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </section>}
    {query.isLoading ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="payroll-table">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын задаргаа</h2><span className="flex items-center gap-2">{partial && <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary" data-testid="badge-payroll-partial">Дутуу / төсөөлөл — эцсийн дүн биш</span>}<span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.lines?.length ?? 0} мөр</span></span></div>
        {!query.data?.lines?.length ? <EmptyState title="Энэ сард цалин тооцоолоогүй" detail="Ирцийн бүртгэл нэмэгдсэний дараа энд ажилтны мөрүүд гарна." icon={Banknote} /> : <div className="overflow-x-auto"><table className="w-full min-w-[2240px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3">Ажилласан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">НДШ</th><th className="px-5 py-3 text-right">ХХОАТ</th><th className="px-5 py-3 text-right">Хөнгөлөлт</th><th className="px-5 py-3 text-right">Урьдчилгаа цалин</th><th className="px-5 py-3 text-right">Бусад суутгал</th><th className="px-5 py-3 text-right">Гарт олгох</th><th className="px-5 py-3 text-right">Олгосон дүн</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Цалингийн авлага</th><th className="px-5 py-3 text-right">Цалингийн өглөг</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.lines.map((line) => { const cashClosed = Boolean((line.paymentDate && closedCashDates.has(line.paymentDate)) || (line.secondPaymentDate && closedCashDates.has(line.secondPaymentDate)) || (line.additionalPayments ?? []).some((p) => closedCashDates.has(p.date))); const currentDifference = payrollRemaining(line); return <tr key={line.employeeId} className="hover:bg-secondary/35" data-testid={`row-payroll-${line.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.role}</p>{line.calculationReady === false && <p className="mt-1 text-[11px] font-semibold text-muted-foreground" data-testid={`status-payroll-uncomputed-${line.employeeId}`}>Тооцоолоогүй</p>}{line.openingBalanceReviewRequired ? <p className="mt-1 max-w-[16rem] text-[11px] font-semibold text-primary" data-testid={`status-payroll-baseline-review-${line.employeeId}`}>Эхний үлдэгдэл хянагдаагүй тул татах боломжгүй. Админ баталгаажуулна.</p> : needsRefresh(line) && <div className="mt-1 flex flex-wrap items-center gap-2">{line.attendanceNeedsRefresh && <span className="text-[11px] font-semibold text-orange-800">Ирц өөрчлөгдсөн{line.refreshMonths?.length ? `: ${line.refreshMonths.join(', ')}` : ''}</span>}{line.calculationReady === false && line.refreshMonths?.length ? <span className="text-[11px] text-muted-foreground">Сар: {line.refreshMonths.join(', ')}</span> : null}{canEditPayroll && <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={closed || bulkRunning || refreshingIds.includes(line.employeeId)} onClick={() => void refreshOne(line.employeeId)} aria-label={`${line.employeeName} шинэчлэх`} data-testid={`button-refresh-payroll-employee-${line.employeeId}`}><RefreshCw className={cn('size-3', refreshingIds.includes(line.employeeId) && 'animate-spin')} />{refreshingIds.includes(line.employeeId) ? 'Шинэчилж байна...' : 'Шинэчлэх'}</Button>}</div>}</td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{line.daysWorked} өдөр</td><td className="px-5 py-4 text-right font-mono text-sm">{cm(line, line.gross)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{cm(line, line.socialInsurance)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{cm(line, line.incomeTax)}</td><td className="px-5 py-4 text-right font-mono text-sm text-sky-700">{cm(line, line.taxRelief)}</td><td className="px-5 py-4 text-right font-mono text-sm">{cm(line, line.advanceAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm">{cm(line, line.manualDeduction)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{cm(line, Math.max(0, line.gross - line.deductions))}</td><td className="px-5 py-4 text-right font-mono text-sm">{cm(line, line.paidAmount)}</td><td className="px-5 py-4 text-center font-mono text-xs text-muted-foreground">{line.paymentDate ?? '—'}</td><td className="px-5 py-4 text-center"><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', line.paidAmount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} data-testid={`status-payroll-paid-${line.employeeId}`}>{line.paidAmount > 0 ? 'Олгосон' : 'Олгоогүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-sky-700" data-testid={`value-payroll-receivable-${line.employeeId}`}>{cm(line, Math.max(0, -line.carryoverAmount))}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-orange-800" data-testid={`value-payroll-payable-${line.employeeId}`}>{cm(line, Math.max(0, line.carryoverAmount))}</td><td className={cn('px-5 py-4 text-right font-mono text-sm font-bold', currentDifference < -1 ? 'text-sky-700' : currentDifference > 1 ? 'text-orange-800' : 'text-muted-foreground')} data-testid={`value-payroll-remaining-${line.employeeId}`}>{line.calculationReady === false ? '—' : remainingLabel(currentDifference)}</td><td className="px-5 py-4 text-right"><Button size="icon" variant="outline" disabled={cashClosed || closed} title={cashClosed ? 'Гүйлгээний өдрийн касс өндөрлөсөн' : undefined} onClick={() => setSelectedLine(line)} aria-label={`${line.employeeName} цалингийн мэдээлэл оруулах`} data-testid={`button-payroll-adjustment-${line.employeeId}`}><Pencil className="size-3.5" /></Button></td></tr>; })}</tbody><tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={2} className="px-5 py-4 text-right text-sm font-bold">Нийт</td><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-gross">{money(payrollTotals.gross)}</td><td colSpan={3} /><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-advance">{money(payrollTotals.advanceAmount)}</td><td /><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary" data-testid="value-payroll-total-payable">{money(payrollTotals.payable)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-paid">{money(payrollTotals.paidAmount)}</td><td colSpan={4} /><td className={cn('px-5 py-4 text-right font-mono text-sm font-bold', payrollTotals.remaining < -1 ? 'text-sky-700' : payrollTotals.remaining > 1 ? 'text-orange-800' : 'text-muted-foreground')} data-testid="value-payroll-total-remaining">{remainingLabel(payrollTotals.remaining)}</td><td /></tr></tfoot></table></div>}
      </section>
    </>}
    {selectedLine && !closed && <PayrollAdjustmentModal line={selectedLine} month={month} onClose={() => setSelectedLine(null)} />}
    {showScheduleSettings && <PayrollScheduleSettingsModal onClose={() => setShowScheduleSettings(false)} />}
  </div>;
}
