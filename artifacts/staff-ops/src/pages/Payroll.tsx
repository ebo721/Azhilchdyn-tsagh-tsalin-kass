import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPayrollPayablesQueryKey, getGetCashSummaryQueryKey, getListCashTransactionsQueryKey, getListCashClosuresQueryKey, getListAttendanceClosuresQueryKey } from '@workspace/api-client-react';
import { useForm } from 'react-hook-form';
import { payrollReceivableBalance } from '@/lib/payroll-receivable-balance';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { CalendarDays, Check, Download, RefreshCw, Trash2, Search, LockKeyhole } from 'lucide-react';
import { PayrollRegister, PayrollEmployee, PayrollValue, PayrollDetail } from '@/components/PayrollRegister';
import { parsePayrollSection, payrollMonth } from '@/lib/payroll-sections';
import { downloadPayrollWorkbook, downloadSocialInsuranceReport, useRefreshEmployeePayroll } from '@workspace/api-client-react';
import { getGetDashboardQueryKey, getGetPayrollAdvanceQueryKey, getGetPayrollQueryKey, getGetPayrollScheduleQueryKey, getListJournalReceivablesQueryKey, useApprovePayrollAdvance, useClosePayrollMonth, useReopenPayrollMonth, useGetAuthSession, useGetPayroll, useGetPayrollAdvance, useGetPayrollSchedule, useListCashClosures, useListJournalReceivables, useUpdatePayrollAdvancePayment, useUpdatePayrollSchedule, useUpsertPayrollAdjustment, type PayrollLine, type PayrollScheduleInput, type PayrollSummary } from '@workspace/api-client-react';
import { ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { MonthNavigator } from '@/components/MonthNavigator';
import { dateLabel, currentMonth, money, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { PayrollOpeningBalances } from '@/components/PayrollOpeningBalances';
import { AdvancePaymentHistory } from '@/components/AdvancePaymentHistory';
import { AdvanceReceivableDeduction } from '@/components/AdvanceReceivableDeduction';
import { rebuildPayrollBalances } from '@workspace/api-client-react';
import { getListJournalEntriesQueryKey, getGetJournalTrialBalanceQueryKey } from '@workspace/api-client-react';
import { getListShiftPlansQueryKey, useListShifts, useListShiftPlans } from '@workspace/api-client-react';

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
  settleReceivables: boolean;
  paidAmount: string;
  paymentDate: string;
  secondPaidAmount: string;
  secondPaymentDate: string;
};
type ExtraRow = { sequence: number; amount: string; date: string; saved: boolean };
type AdvanceEmployeeFilter = 'all' | 'shift' | 'office';
const round2 = (n: number) => Number(n.toFixed(2));
const filterPayrollAdvanceLines = <T extends { employeeId: number; employeeType: string }>(
  lines: T[], filter: AdvanceEmployeeFilter, shiftFilter = 'all',
  plans: Array<{ employeeId: number; shiftId: number; date: string }> = [],
  periodStart?: string, periodEnd?: string,
) => {
  const assigned = new Set(plans.filter(plan => String(plan.shiftId) === shiftFilter
    && (!periodStart || plan.date >= periodStart) && (!periodEnd || plan.date <= periodEnd))
    .map(plan => plan.employeeId));
  return lines.filter(line => (filter === 'all' || line.employeeType === filter)
    && (shiftFilter === 'all' || assigned.has(line.employeeId)));
};

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
      settleReceivables: line.receivableId !== null || line.manualDeduction === 0,
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
        receivableId: null,
        settleReceivables: values.settleReceivables,
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
          qc.invalidateQueries({ queryKey: getListJournalReceivablesQueryKey() }),
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
  const balance = payrollReceivableBalance(receivables.data ?? [], line.employeeId, line.receivableDeduction ?? 0);
  const settling = form.watch('settleReceivables');
  const deduction = Number(form.watch('manualDeduction'));
  const receivableInvalid = settling && deduction > 0
    && (receivables.isLoading || receivables.isError || deduction > balance.available);
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
        <div className="space-y-2 text-xs sm:col-span-2">
          <p className="rounded-lg bg-secondary p-3" data-testid="payroll-total-receivable">Нийт авлагын үлдэгдэл: <strong>{money(balance.open)}</strong></p>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" {...form.register('settleReceivables')} data-testid="checkbox-payroll-settle-receivables" />
            Суутгалыг ажилтны нийт авлагаас хасах
          </label>
          {settling && <p className="text-muted-foreground">Хэсэгчлэн суутгаж болно. Хуучин авлагаас эхлэн автоматаар хуваарилна.
            {(line.receivableDeduction ?? 0) > 0 && <> Одоогийн суутгалыг оролцуулж засах боломжтой: {money(balance.available)}.</>}
          </p>}
          {receivables.isLoading && <p>Авлага ачаалж байна...</p>}
          {receivables.isError && <p role="alert" className="text-destructive">Авлага татахад алдаа гарлаа. <button type="button" className="underline" onClick={() => void receivables.refetch()}>Дахин оролдох</button></p>}
          {settling && deduction > balance.available && !receivables.isLoading && !receivables.isError
            && <p role="alert" className="text-destructive">Суутгах дүн нийт авлагын үлдэгдлээс их байна.</p>}
        </div>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний дүн<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('paymentDate')} data-testid="input-payroll-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.paidAmount - line.secondPaidAmount - extraSum <= 0 || deletion.isPending} onClick={() => removePayment(1)} aria-label="1-р гүйлгээг устгах" title="1-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-1"><Trash2 className="size-4" /></Button></div>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний дүн<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('secondPaidAmount', { required: true, min: 0 })} data-testid="input-payroll-second-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('secondPaymentDate')} data-testid="input-payroll-second-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.secondPaidAmount <= 0 || deletion.isPending} onClick={() => removePayment(2)} aria-label="2-р гүйлгээг устгах" title="2-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-2"><Trash2 className="size-4" /></Button></div>
      <div className="space-y-3 sm:col-span-2">{extras.map((row) => <div key={row.sequence} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-testid={`row-payroll-extra-${row.sequence}`}><label className="space-y-2 text-xs font-semibold">{row.sequence}-р гүйлгээний дүн<input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => patchExtra(row.sequence, { amount: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" data-testid={`input-payroll-extra-amount-${row.sequence}`} /></label><label className="space-y-2 text-xs font-semibold">{row.sequence}-р гүйлгээний огноо<input type="date" value={row.date} onChange={(e) => patchExtra(row.sequence, { date: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid={`input-payroll-extra-date-${row.sequence}`} /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deletion.isPending} onClick={() => row.saved ? removePayment(row.sequence) : setExtras((rows) => rows.filter((r) => r.sequence !== row.sequence))} aria-label={`${row.sequence}-р гүйлгээг устгах`} title={`${row.sequence}-р гүйлгээг устгах`} data-testid={`button-delete-payroll-payment-${row.sequence}`}><Trash2 className="size-4" /></Button></div>)}<Button type="button" variant="outline" onClick={addExtra} disabled={save.isPending} data-testid="button-add-payroll-payment">Гүйлгээ нэмэх</Button></div>
      </div>
      {extraError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-payroll-extra">{extraError}</p>}
      {save.isError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-payroll-adjustment">{save.error instanceof Error ? save.error.message : 'Цалингийн тохируулга хадгалж чадсангүй.'}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={save.isPending || receivableInvalid} data-testid="button-save-payroll-adjustment">{save.isPending ? 'Хадгалж байна...' : 'Тохируулга хадгалах'}</Button></div>
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
  const search = useSearch();
  const [, navigate] = useLocation();
  const section = parsePayrollSection(search);
  const showAdvance = section === 'advance';
  const [preparingBalances, setPreparingBalances] = useState(false);
  const [balanceProgress, setBalanceProgress] = useState('');
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balancesAbort = useRef<AbortController | null>(null);
  useEffect(() => () => balancesAbort.current?.abort(), []);
  const [downloadingReport, setDownloadingReport] = useState<'payroll' | 'insurance' | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const month = payrollMonth(search, currentMonth());
  const setMonth = (next: string) => {
    const params = new URLSearchParams(search);
    params.set('month', next);
    navigate(`/payroll?${params}`);
  };
  const selectedMonth = useRef(month);
  selectedMonth.current = month;
  const refreshEmployee = useRefreshEmployeePayroll();
  const [refreshingIds, setRefreshingIds] = useState<number[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [refreshFailures, setRefreshFailures] = useState<Record<number, string>>({});
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [refreshingAdvanceEmployeeId, setRefreshingAdvanceEmployeeId] = useState<number | null>(null);
  const [advanceApprovalDate, setAdvanceApprovalDate] = useState(today());
  const [advanceDates, setAdvanceDates] = useState<Record<number, string>>({});
  const [advanceAmounts, setAdvanceAmounts] = useState<Record<number, string>>({});
  const [advanceEmployeeFilter, setAdvanceEmployeeFilter] = useState<AdvanceEmployeeFilter>('all');
  const [advanceShiftFilter, setAdvanceShiftFilter] = useState('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month }, { query: { queryKey: getGetPayrollAdvanceQueryKey({ month }), enabled: showAdvance } });
  const advanceShifts = useListShifts();
  const filterPeriod = showAdvance ? advanceQuery.data : query.data;
  const advanceStartMonth = filterPeriod?.periodStart.slice(0, 7) ?? month;
  const advanceEndMonth = (showAdvance ? advanceQuery.data?.advancePeriodEnd : query.data?.periodEnd)?.slice(0, 7) ?? month;
  const needsShiftPlans = advanceShiftFilter !== 'all';
  const advanceStartPlans = useListShiftPlans({ month: advanceStartMonth }, {
    query: { queryKey: getListShiftPlansQueryKey({ month: advanceStartMonth }), enabled: needsShiftPlans },
  });
  const advanceEndPlans = useListShiftPlans({ month: advanceEndMonth }, {
    query: { queryKey: getListShiftPlansQueryKey({ month: advanceEndMonth }), enabled: needsShiftPlans && advanceEndMonth !== advanceStartMonth },
  });
  const advanceShiftLoading = needsShiftPlans && (advanceStartPlans.isLoading
    || (advanceEndMonth !== advanceStartMonth && advanceEndPlans.isLoading));
  const advanceShiftError = needsShiftPlans && (advanceStartPlans.isError
    || (advanceEndMonth !== advanceStartMonth && advanceEndPlans.isError));
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
  const canClose = role === 'admin' && !showAdvance;
  useEffect(() => {
    if (closed) { setSelectedLine(null); setRefreshingAdvanceEmployeeId(null); setAdvanceAmounts({}); setAdvanceDates({}); }
  }, [closed]);
  const applyClosure = async (summary: PayrollSummary) => {
    await qc.cancelQueries({ queryKey: getGetPayrollQueryKey({ month: summary.month }) });
    qc.setQueryData(getGetPayrollQueryKey({ month: summary.month }), summary);
    qc.invalidateQueries({ queryKey: getListAttendanceClosuresQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month: summary.month }) });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const closureMessage = (error: unknown) => error instanceof Error ? error.message : 'Үйлдэл амжилтгүй боллоо.';
  const closeMonth = () => {
    if (!canClose) return;
    if (!window.confirm(`${mongolianMonthLabel(month)}-ийг хаах уу?\n\nЦалинтай хамт тухайн хугацааны ирц, ээлжийн төлөвлөгөө түгжигдэнэ. Сарын үлдэгдэл (авлага/өглөг), цалингийн мөр болон урьдчилгааг засах боломжгүй болно. Зөвхөн админ сарыг дахин нээнэ.`)) return;
    const target = month;
    setClosureError(null);
    closePayroll.mutate({ month: target }, { onSuccess: applyClosure, onError: (e) => { if (selectedMonth.current === target) setClosureError(closureMessage(e)); } });
  };
  const reopenMonth = () => {
    if (!canClose) return;
    if (!window.confirm(`${mongolianMonthLabel(month)}-ийг дахин нээх үү?\n\nАнхааруулга: хойно хаагдсан сарууд байвал эхлээд тэдгээрийг дахин нээсэн байх шаардлагатай.`)) return;
    const target = month;
    setClosureError(null);
    reopenPayroll.mutate({ month: target }, { onSuccess: applyClosure, onError: (e) => { if (selectedMonth.current === target) setClosureError(closureMessage(e)); } });
  };
  useEffect(() => {
    setSelectedLine(null);
    setRefreshingAdvanceEmployeeId(null);
    setClosureError(null);
    setReportError(null);
    setAdvanceAmounts({});
    setAdvanceDates({});
    setAttendanceError(null);
    setRefreshFailures({});
    setRefreshNotice(null);
  }, [month, section]);
  const partial = !closed && (query.data?.lines ?? []).some((line) => line.calculationReady === false || line.attendanceNeedsRefresh || line.openingBalanceReviewRequired);
  const matches = (name: string, remaining: number, ready = true) =>
    name.toLocaleLowerCase('mn').includes(employeeSearch.trim().toLocaleLowerCase('mn'))
    && (statusFilter === 'all' || (ready && (statusFilter === 'paid' ? remaining <= 1 : remaining > 1)));
  const advancePaid = (line: NonNullable<typeof advanceQuery.data>['lines'][number]) =>
    line.paidAmount ?? (line.paid ? Math.max(0, line.advanceAmount - (line.receivableDeduction ?? 0)) : 0);
  const advanceRemaining = (line: NonNullable<typeof advanceQuery.data>['lines'][number]) =>
    line.remainingBalance ?? Math.max(0, line.advanceAmount - (line.receivableDeduction ?? 0) - advancePaid(line));
  const filteredAdvanceLines = filterPayrollAdvanceLines(advanceQuery.data?.lines ?? [], advanceEmployeeFilter,
    advanceShiftFilter, [...(advanceStartPlans.data ?? []),
      ...(advanceEndMonth !== advanceStartMonth ? advanceEndPlans.data ?? [] : [])],
    advanceQuery.data?.periodStart, advanceQuery.data?.advancePeriodEnd).filter(line => matches(line.employeeName, advanceRemaining(line)));
  const filteredFinalLines = filterPayrollAdvanceLines(query.data?.lines ?? [], advanceEmployeeFilter,
    advanceShiftFilter, [...(advanceStartPlans.data ?? []), ...(advanceEndMonth !== advanceStartMonth ? advanceEndPlans.data ?? [] : [])],
    query.data?.periodStart, query.data?.periodEnd).filter(line => matches(line.employeeName, payrollRemaining(line), line.calculationReady !== false));
  const refreshOne = async (employeeId: number, resetDraft = true): Promise<boolean> => {
    if (closed) return false;
    const requestedMonth = month;
    setRefreshingIds((ids) => [...ids, employeeId]);
    setRefreshFailures((f) => { const next = { ...f }; delete next[employeeId]; return next; });
    try {
      const result = await refreshEmployee.mutateAsync({ month: requestedMonth, employeeId });
      qc.setQueryData(getGetPayrollQueryKey({ month: requestedMonth }), result.payroll);
      await qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month: requestedMonth }) });
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
  const pullableLines = (query.data?.lines ?? []).filter((line) => !line.openingBalanceReviewRequired);
  const refreshableLines = pullableLines.filter(needsRefresh);
  const reviewBlockedCount = (query.data?.lines ?? []).filter((line) => line.openingBalanceReviewRequired).length;
  const refreshLines = async (targetLines: PayrollLine[]) => {
    if (closed || bulkRunning || refreshingIds.length > 0 || !targetLines.length) return;
    const targetMonth = month;
    const ids = targetLines.map((line) => line.employeeId);
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
  const downloadReport = async (kind: 'payroll' | 'insurance') => {
    setDownloadingReport(kind);
    setReportError(null);
    const targetMonth = month;
    try {
      const download = kind === 'payroll' ? downloadPayrollWorkbook : downloadSocialInsuranceReport;
      const workbook = await download({ month: targetMonth }, { responseType: 'blob' });
      const url = URL.createObjectURL(workbook);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind === 'payroll' ? 'Payroll' : 'NDSH'}-${targetMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (selectedMonth.current === targetMonth) setReportError(error instanceof Error ? error.message : 'Excel тайлан татаж чадсангүй.');
    } finally {
      setDownloadingReport(null);
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
  const activePeriod = query.data;
  const headerPeriodEnd = showAdvance ? activePeriod?.advancePeriodEnd : activePeriod?.periodEnd;
  const paymentDay = showAdvance ? activePeriod?.advancePaymentDate : activePeriod?.finalPaymentDate;
  return <div className="page-enter">
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold tracking-tight">{showAdvance ? 'Урьдчилгаа цалин' : 'Сүүл цалин'}</h1>
      {query.data && <><span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary" data-testid={closed ? 'status-payroll-closed' : 'status-payroll-open'}>{closed ? 'ХААЛТТАЙ' : 'НЭЭЛТТЭЙ'}</span><span className="font-mono text-xs text-muted-foreground">{activePeriod?.periodStart} — {headerPeriodEnd} · {paymentDay}</span></>}
      {showAdvance && advanceQuery.data?.approved && <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary" data-testid="status-advance-approved">Батлагдсан · {advanceQuery.data.approvalDate ? dateLabel(advanceQuery.data.approvalDate) : ''}</span>}
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 xl:flex-nowrap" data-testid="payroll-toolbar">
      <div className="shrink-0"><MonthNavigator month={month} onChange={setMonth} prefix="payroll" ariaLabel="Цалингийн сар сонгох" /></div>
      {canEditPayroll && <details className="relative shrink-0"><summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-border" aria-label="Ирц шинэчлэх сонголт"><RefreshCw className="size-4" /></summary><div className="absolute left-0 top-11 z-30 grid w-64 gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
        <Button onClick={() => void refreshLines(pullableLines)} variant="outline" disabled={bulkRunning || refreshingIds.length > 0 || closed || query.isFetching || query.isError || pullableLines.length === 0} data-testid="button-pull-payroll-attendance">{bulkRunning ? 'Шинэчилж байна...' : 'Цаг татах'}</Button>
        <Button onClick={() => void refreshLines(refreshableLines)} variant="outline" disabled={bulkRunning || refreshingIds.length > 0 || closed || refreshableLines.length === 0} data-testid="button-refresh-changed-payroll">{'Өөрчлөгдсөнийг шинэчлэх (' + refreshableLines.length + ')'}</Button>
      </div></details>}
      {showAdvance && canEditPayroll && <details className="relative shrink-0"><summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-border" aria-label="Урьдчилгаа батлах сонголт" title="Урьдчилгаа батлах сонголт"><Check className="size-4" /></summary><div className="absolute left-0 top-11 z-30 grid w-64 gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
        {advanceQuery.data?.approved ? <Button size="sm" variant="outline" onClick={revertApproval} disabled={revertAdvanceApproval.isPending || closed} data-testid="button-revert-payroll-advance">Батлалт устгах хүсэлт</Button> : <><input aria-label="Батлах огноо" type="date" value={advanceApprovalDate} onChange={e => setAdvanceApprovalDate(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-xs" data-testid="input-payroll-advance-approval-date" /><Button size="sm" onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading || advanceQuery.isError || closed} data-testid="button-approve-payroll-advance">Урьдчилгаа батлах</Button></>}
      </div></details>}
      {canClose && query.data && !query.isError && <Button size="icon" title={closed ? 'Сар нээх' : 'Сар хаах'} aria-label={closed ? 'Сар нээх' : 'Сар хаах'} onClick={closed ? reopenMonth : closeMonth} disabled={closePayroll.isPending || reopenPayroll.isPending} data-testid={closed ? 'button-reopen-payroll-month' : 'button-close-payroll-month'}><LockKeyhole className="size-4" /></Button>}
      {(role === 'admin' || role === 'accountant') && <details className="relative shrink-0"><summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-border" aria-label="Цалингийн тайлан экспортлох"><Download className="size-4" /></summary><div className="absolute left-0 top-11 z-30 grid w-64 gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
        <Button onClick={() => void downloadReport('payroll')} variant="outline" disabled={downloadingReport !== null || query.isFetching || query.isError} data-testid="button-download-payroll-workbook">Цалингийн хүснэгт · Excel</Button>
        <Button onClick={() => void downloadReport('insurance')} variant="outline" disabled={downloadingReport !== null || query.isFetching || query.isError} data-testid="button-download-insurance-report">НДШ тайлан · Excel</Button>
      </div></details>}
      {canEditPayroll && <Button size="icon" variant="outline" onClick={() => setShowScheduleSettings(true)} title="Цалингийн хуваарь" aria-label="Цалингийн хуваарь" data-testid="button-payroll-schedule-settings"><CalendarDays className="size-4" /></Button>}
      {canEditPayroll && <PayrollOpeningBalances compact month={month} role={role} closed={closed} openingBalanceMonth={query.data?.openingBalanceMonth} reviewRequiredCount={reviewBlockedCount} legacyAvailable={!query.data?.openingBalanceMonth} />}
      <label className="relative min-w-28 flex-1"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input aria-label="Ажилтан хайх" placeholder="Ажилтан хайх" value={employeeSearch} onChange={e => setEmployeeSearch(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs" /></label>
      <select aria-label="Ажилтны төрөл" value={advanceEmployeeFilter} onChange={e => setAdvanceEmployeeFilter(e.target.value as AdvanceEmployeeFilter)} className="h-9 w-28 shrink-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-payroll-advance-employee-filter"><option value="all">Бүх ажилтан</option><option value="shift">Ээлжийн</option><option value="office">Оффис</option></select>
      <select aria-label="Цалинг ээлжээр шүүх" value={advanceShiftFilter} onChange={e => setAdvanceShiftFilter(e.target.value)} disabled={advanceShifts.isLoading || advanceShifts.isError} className="h-9 w-24 shrink-0 rounded-lg border border-input bg-background px-2 text-xs" data-testid="select-payroll-advance-shift-filter"><option value="all">Бүх ээлж</option>{(advanceShifts.data ?? []).map(shift => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select>
      <select aria-label="Төлөвөөр шүүх" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 w-28 shrink-0 rounded-lg border border-input bg-background px-2 text-xs"><option value="all">Бүх төлөв</option><option value="pending">Үлдэгдэлтэй</option><option value="paid">Бүрэн олгосон</option></select>
    </div>
    {closureError && <p role="alert" className="mb-4 text-sm text-destructive" data-testid="payroll-closure-error">{closureError}</p>}
    {advanceShifts.isError && <button onClick={() => void advanceShifts.refetch()} className="mb-3 text-xs text-destructive">Ээлж ачаалсангүй. Дахин оролдох</button>}
    {!query.data?.openingBalanceMonth && ((query.isError && query.error instanceof Error && query.error.message.includes('өмнөх сарын')) || attendanceError?.includes('өмнөх сарын')) && <div className="mb-4 rounded-xl border border-border bg-card p-4" data-testid="payroll-balances-required">
      {(role === 'admin' || role === 'accountant') && <Button onClick={prepareBalances} disabled={preparingBalances || closed} data-testid="button-prepare-payroll-balances">Өмнөх үлдэгдэл шинэчлэх</Button>}
      {balanceProgress && <p role="status">{balanceProgress}</p>}{balanceError && <p role="alert">{balanceError}</p>}
    </div>}
    {refreshNotice && <p role="status" className="mb-3 text-sm text-primary">{refreshNotice}</p>}
    {Object.keys(refreshFailures).length > 0 && <ul role="alert" className="mb-3 text-sm text-destructive">{Object.entries(refreshFailures).map(([id, message]) => <li key={id}>{query.data?.lines.find(line => line.employeeId === Number(id))?.employeeName}: {message}</li>)}</ul>}
    {attendanceError && <p role="alert" className="mb-3 text-sm text-destructive">{attendanceError}</p>}
    {reportError && <p role="alert" className="mb-3 text-sm text-destructive" data-testid="error-insurance-report">{reportError}</p>}
    {query.isError && query.error instanceof Error && <p role="alert" className="mb-3 text-sm text-destructive">{query.error.message}</p>}
    {query.isLoading ? <LoadingBlock className="h-48" /> : query.isError ? <ErrorBlock onRetry={() => void query.refetch()} /> : showAdvance ? <>
      {advanceQuery.isLoading || advanceShiftLoading ? <LoadingBlock className="h-48" /> : advanceQuery.isError || advanceShiftError ? <ErrorBlock onRetry={() => { void advanceQuery.refetch(); void advanceStartPlans.refetch(); void advanceEndPlans.refetch(); }} /> : <PayrollRegister key={'advance-' + month} advance lines={filteredAdvanceLines} renderRow={(line, expanded, toggle) => {
        const id = line.employeeId;
        const selectedDate = advanceDates[id] ?? line.paymentDate ?? advanceQuery.data?.approvalDate ?? today();
        const cashClosed = closedCashDates.has(selectedDate) || Boolean(line.paymentDate && closedCashDates.has(line.paymentDate));
        const installments = Boolean(line.payments) || (line.advanceAmount > 0 && (line.receivableDeduction ?? 0) >= line.advanceAmount);
        const paid = advancePaid(line);
        const remainder = advanceRemaining(line);
        const details = <div className="grid gap-5 lg:grid-cols-3"><div><PayrollDetail label="Дансны дугаар" value={line.bankAccountNumber || 'Бүртгээгүй'} testId={'value-advance-bank-account-' + id} /><PayrollDetail label="Үндсэн цалин" value={money(line.baseSalary)} /><PayrollDetail label="Ажилласан хоног" value={line.daysWorked} /><PayrollDetail label="Өдрийн цалин" value={money(line.dailySalary)} /><PayrollDetail label="Нийт олгох цалин" value={money(line.totalSalary)} /></div><div className="space-y-3"><AdvancePaymentHistory line={line} month={month} closed={closed || !canEditPayroll} />{advanceQuery.data?.approved && <AdvanceReceivableDeduction line={line} month={month} closed={closed} readOnly={!canEditPayroll} />}</div><div className="space-y-3">{canEditPayroll && <><label className="block text-xs">Олгох урьдчилгаа<input aria-label={line.employeeName + ' урьдчилгааны дүн'} type="number" min="0" step="1000" value={advanceAmounts[id] ?? String(line.advanceAmount)} disabled={closed || installments || Boolean(advanceQuery.data?.approved && (line.paid || cashClosed))} onChange={e => setAdvanceAmounts(amounts => ({ ...amounts, [id]: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 font-mono" data-testid={'input-advance-amount-' + id} /></label><input aria-label={line.employeeName + ' олгох огноо'} type="date" value={selectedDate} disabled={closed || installments || Boolean(advanceQuery.data?.approved && line.paid)} onChange={e => setAdvanceDates(dates => ({ ...dates, [id]: e.target.value }))} className="h-9 rounded-lg border border-input bg-background px-2 text-xs" data-testid={'input-advance-payment-date-' + id} /><Button size="sm" variant="outline" disabled={closed || Boolean(advanceQuery.data?.approved) || advanceQuery.isFetching || refreshingAdvanceEmployeeId === id} onClick={() => void refreshAdvanceEmployee(id)} data-testid={'button-refresh-advance-employee-' + id}>Шинэчлэх</Button></>}</div></div>;
        return { details, cells: <><PayrollEmployee name={line.employeeName} role={line.employeeType === 'office' ? 'Оффис' : 'Ээлжийн'} expanded={expanded} onToggle={toggle} /><PayrollValue>{money(Number(advanceAmounts[id] ?? line.advanceAmount))}</PayrollValue><PayrollValue>{money(line.receivableDeduction ?? 0)}</PayrollValue><PayrollValue primary>{money(Math.max(0, Number(advanceAmounts[id] ?? line.advanceAmount) - (line.receivableDeduction ?? 0)))}</PayrollValue><PayrollValue>{money(paid)}</PayrollValue><PayrollValue primary>{remainingLabel(remainder)}</PayrollValue><td className="px-4 py-3.5 text-right">{canEditPayroll && <Button size="sm" variant={line.paid ? 'outline' : 'default'} disabled={!advanceQuery.data?.approved || updateAdvancePayment.isPending || cashClosed || closed || installments} onClick={() => setAdvancePaid(id, !line.paid, line.advanceAmount, line.paymentDate)} data-testid={'button-advance-paid-' + id}>{line.paid ? 'Олгосон' : paid > 0 ? 'Хэсэгчлэн олгосон' : 'Шилжүүлэх'}</Button>}</td></> };
      }} />}
      {revertAdvanceApproval.isError && <p role="alert" className="text-sm text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </> : advanceShiftLoading ? <LoadingBlock className="h-48" /> : advanceShiftError ? <ErrorBlock onRetry={() => { void advanceStartPlans.refetch(); void advanceEndPlans.refetch(); }} /> : <PayrollRegister key={'final-' + month} lines={filteredFinalLines} summary={partial && <span className="text-[10px] text-orange-800" data-testid="badge-payroll-partial">Дутуу / төсөөлөл</span>} renderRow={(line, expanded, toggle) => {
      const id = line.employeeId;
      const cashClosed = Boolean((line.paymentDate && closedCashDates.has(line.paymentDate)) || (line.secondPaymentDate && closedCashDates.has(line.secondPaymentDate)) || (line.additionalPayments ?? []).some(payment => closedCashDates.has(payment.date)));
      const remainder = payrollRemaining(line);
      const details = <div className="grid gap-5 lg:grid-cols-3"><div><PayrollDetail label="Ажилласан" value={line.daysWorked + ' өдөр'} /><PayrollDetail label="НДШ бодох цалин" value={cm(line, line.socialInsuranceSalary)} testId={'value-payroll-insurance-salary-' + id} /><PayrollDetail label="НДШ" value={cm(line, line.socialInsurance)} /><PayrollDetail label="ХХОАТ" value={cm(line, line.incomeTax)} /><PayrollDetail label="Хөнгөлөлт" value={cm(line, line.taxRelief)} /></div><div><PayrollDetail label="Урьдчилгаа цалин" value={cm(line, line.advanceAmount)} /><PayrollDetail label="Бусад суутгал" value={cm(line, line.manualDeduction)} /><PayrollDetail label="Цалингийн авлага" value={cm(line, Math.max(0, -line.carryoverAmount))} testId={'value-payroll-receivable-' + id} /><PayrollDetail label="Цалингийн өглөг" value={cm(line, Math.max(0, line.carryoverAmount))} testId={'value-payroll-payable-' + id} /></div><div><PayrollDetail label="Дансны дугаар" value={line.bankAccountNumber || 'Бүртгээгүй'} /><PayrollDetail label="1-р гүйлгээ" value={line.paymentDate ? line.paymentDate + ' · ' + money(line.paidAmount - (line.secondPaidAmount ?? 0) - (line.additionalPayments ?? []).reduce((sum, p) => sum + p.amount, 0)) : '—'} /><PayrollDetail label="2-р гүйлгээ" value={line.secondPaymentDate ? line.secondPaymentDate + ' · ' + money(line.secondPaidAmount) : '—'} />{(line.additionalPayments ?? []).map(payment => <PayrollDetail key={payment.sequence} label={payment.sequence + '-р гүйлгээ'} value={payment.date + ' · ' + money(payment.amount)} />)}</div></div>;
      return { details, cells: <><PayrollEmployee name={line.employeeName} role={line.role} expanded={expanded} onToggle={toggle}>{line.calculationReady === false && <span className="text-[11px] text-orange-800" data-testid={'status-payroll-uncomputed-' + id}>Тооцоолоогүй</span>}{line.openingBalanceReviewRequired && <p className="text-[11px] text-orange-800" data-testid={'status-payroll-baseline-review-' + id}>Эхний үлдэгдэл хянагдаагүй</p>}{needsRefresh(line) && canEditPayroll && !line.openingBalanceReviewRequired && <Button size="sm" variant="outline" disabled={closed || bulkRunning || refreshingIds.includes(id)} onClick={() => void refreshOne(id)} data-testid={'button-refresh-payroll-employee-' + id}>Шинэчлэх</Button>}</PayrollEmployee><PayrollValue>{cm(line, line.gross)}</PayrollValue><PayrollValue>{cm(line, line.deductions)}</PayrollValue><PayrollValue primary>{cm(line, Math.max(0, line.gross - line.deductions))}</PayrollValue><PayrollValue>{cm(line, line.paidAmount)}</PayrollValue><PayrollValue primary testId={'value-payroll-remaining-' + id}>{line.calculationReady === false ? '—' : remainingLabel(remainder)}</PayrollValue><td className="px-4 py-3.5 text-right">{canEditPayroll && <Button size="sm" disabled={closed || cashClosed} onClick={() => setSelectedLine(line)} aria-label={line.employeeName + ' цалингийн мэдээлэл оруулах'} data-testid={'button-payroll-adjustment-' + id}>Олголт</Button>}</td></> };
    }} />}
    {selectedLine && !closed && canEditPayroll && <PayrollAdjustmentModal line={selectedLine} month={month} onClose={() => setSelectedLine(null)} />}
    {showScheduleSettings && canEditPayroll && <PayrollScheduleSettingsModal onClose={() => setShowScheduleSettings(false)} />}
  </div>;
}
