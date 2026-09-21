import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { CalendarDays, Banknote, Check, ChevronRight, Coins, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { getGetDashboardQueryKey, getGetPayrollAdvanceQueryKey, getGetPayrollQueryKey, getGetPayrollScheduleQueryKey, getListJournalReceivablesQueryKey, useApprovePayrollAdvance, useGetAuthSession, useGetPayroll, useGetPayrollAdvance, useGetPayrollSchedule, useListCashClosures, useListJournalReceivables, useUpdatePayrollAdvancePayment, useUpdatePayrollSchedule, useUpsertPayrollAdjustment, type PayrollLine, type PayrollScheduleInput } from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { dateLabel, currentMonth, money, shiftMonth, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';

const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
type PayrollAdjustmentForm = {
  manualDeduction: string;
  receivableId: string;
  paidAmount: string;
  paymentDate: string;
  secondPaidAmount: string;
  secondPaymentDate: string;
};

function PayrollAdjustmentModal({ line, month, onClose }: { line: PayrollLine; month: string; onClose: () => void }) {
  const save = useUpsertPayrollAdjustment();
  const deletion = useQueueDeletion();
  const receivables = useListJournalReceivables({ status: 'all' });
  const qc = useQueryClient();
  const form = useForm<PayrollAdjustmentForm>({
    defaultValues: {
      manualDeduction: String(line.manualDeduction),
      receivableId: line.receivableId === null ? '' : String(line.receivableId),
      paidAmount: String(line.paidAmount),
      paymentDate: line.paymentDate ?? today(),
      secondPaidAmount: String(line.secondPaidAmount),
      secondPaymentDate: line.secondPaymentDate ?? today(),
    },
  });
  const submit = (values: PayrollAdjustmentForm) => {
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
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        qc.invalidateQueries({ queryKey: getListJournalReceivablesQueryKey({ status: 'all' }) });
        onClose();
      },
    });
  };
  const employeeReceivables = (receivables.data ?? []).filter((receivable) =>
    receivable.partyType === 'employee'
    && receivable.partyId === line.employeeId
    && (receivable.status === 'open' || receivable.id === line.receivableId)
  );
  const removePayment = (sequence: 1 | 2) => {
    if (!window.confirm(`${line.employeeName}-ийн ${sequence}-р цалингийн гүйлгээг устгах уу?`)) return;
    deletion.request(
      `/payroll-adjustments/${month}/${line.employeeId}/transactions/${sequence}`,
      `${line.employeeName} · ${month} · ${sequence}-р цалингийн гүйлгээ`,
    );
    onClose();
  };
  return <Modal title={`${line.employeeName} · Цалингийн тохируулга`} detail={`${month.replace('-', ' оны ')} сарын урьдчилгаа, хөнгөлөлт, суутгал болон шилжүүлсэн дүнг оруулна.`} onClose={onClose}>
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
        <label className="space-y-2 text-xs font-semibold">Гараар оруулах суутгал<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('manualDeduction', { required: true, min: 0 })} data-testid="input-payroll-manual-deduction" /></label>
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
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">1-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('paymentDate')} data-testid="input-payroll-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.paidAmount <= 0 || deletion.isPending} onClick={() => removePayment(1)} aria-label="1-р гүйлгээг устгах" title="1-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-1"><Trash2 className="size-4" /></Button></div>
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('secondPaidAmount', { required: true, min: 0 })} data-testid="input-payroll-second-paid-amount" /></label><label className="space-y-2 text-xs font-semibold">2-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('secondPaymentDate')} data-testid="input-payroll-second-payment-date" /></label><Button type="button" size="icon" variant="outline" className="size-10 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={line.secondPaidAmount <= 0 || deletion.isPending} onClick={() => removePayment(2)} aria-label="2-р гүйлгээг устгах" title="2-р гүйлгээг устгах" data-testid="button-delete-payroll-payment-2"><Trash2 className="size-4" /></Button></div>
      </div>
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
  const [month, setMonth] = useState(currentMonth());
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [refreshingAdvanceEmployeeId, setRefreshingAdvanceEmployeeId] = useState<number | null>(null);
  const [advanceApprovalDate, setAdvanceApprovalDate] = useState(today());
  const [advanceDates, setAdvanceDates] = useState<Record<number, string>>({});
  const [advanceAmounts, setAdvanceAmounts] = useState<Record<number, string>>({});
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month });
  const cashClosures = useListCashClosures();
  const closedCashDates = new Set(cashClosures.data?.map((closure) => closure.date) ?? []);
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const approveAdvance = useApprovePayrollAdvance();
  const deletion = useQueueDeletion();
  const revertAdvanceApproval = deletion;
  const updateAdvancePayment = useUpdatePayrollAdvancePayment();
  useEffect(() => {
    setAdvanceAmounts({});
    setAdvanceDates({});
  }, [month]);
  const payrollTotals = (query.data?.lines ?? []).reduce(
    (totals, line) => ({
      gross: totals.gross + Number(line.gross),
      advanceAmount: totals.advanceAmount + Number(line.advanceAmount),
      payable: totals.payable + Math.max(0, Number(line.gross) - Number(line.deductions)),
      paidAmount: totals.paidAmount + Number(line.paidAmount),
    }),
    { gross: 0, advanceAmount: 0, payable: 0, paidAmount: 0 },
  );
  const displayedAdvanceTotal = (advanceQuery.data?.lines ?? []).reduce((total, line) => {
    const amount = Number(advanceAmounts[line.employeeId] ?? line.advanceAmount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const pullLatestAttendance = async () => {
    await query.refetch();
    if (showAdvance && !advanceQuery.data?.approved) {
      setAdvanceAmounts({});
      setAdvanceDates({});
      await advanceQuery.refetch();
    }
  };
  const refreshAdvanceEmployee = async (employeeId: number) => {
    setRefreshingAdvanceEmployeeId(employeeId);
    setAdvanceAmounts((amounts) => {
      const next = { ...amounts };
      delete next[employeeId];
      return next;
    });
    try {
      await advanceQuery.refetch();
    } finally {
      setRefreshingAdvanceEmployeeId(null);
    }
  };
  const approve = () => {
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
  const revertApproval = () => {
    if (!window.confirm(`${month} сарын урьдчилгаа цалингийн батлалтыг устгах уу?`)) return;
    deletion.request(`/payroll-advance/approval?month=${month}`, `${month} сарын урьдчилгаа цалингийн батлалт`);
  };
  const setAdvancePaid = (employeeId: number, paid: boolean, existingAmount: number, existingDate?: string | null) => {
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
      <Button onClick={() => setShowScheduleSettings(true)} variant="outline" data-testid="button-payroll-schedule-settings"><CalendarDays className="size-4" />Цалингийн хуваарь</Button>
      <Button onClick={pullLatestAttendance} variant="outline" disabled={query.isFetching || advanceQuery.isFetching} data-testid="button-pull-payroll-attendance"><RefreshCw className={cn('size-4', (query.isFetching || advanceQuery.isFetching) && 'animate-spin')} />{query.isFetching || advanceQuery.isFetching ? 'Татаж байна...' : 'Цаг татах'}</Button>
      <Button onClick={() => setShowAdvance((value) => !value)} variant={showAdvance ? 'default' : 'outline'} data-testid="button-payroll-advance"><Coins className="size-4" />Урьдчилгаа цалин</Button>
      <div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-payroll-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(month)}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Цалингийн сар сонгох" data-testid="input-payroll-month" /></label></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-payroll-next-month"><ChevronRight className="size-4" /></button></div>
    </div>

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
        {advanceQuery.data?.approved ? <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="status-advance-approved"><Check className="mr-2 inline size-4" />Батлагдсан · {advanceQuery.data.approvalDate ? dateLabel(advanceQuery.data.approvalDate) : ''}</div><Button variant="outline" onClick={revertApproval} disabled={revertAdvanceApproval.isPending} data-testid="button-revert-payroll-advance">{revertAdvanceApproval.isPending ? 'Хүсэлт илгээж байна...' : 'Батлалт устгах хүсэлт'}</Button></div> : <div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-xs font-semibold">Батлах огноо<input type="date" value={advanceApprovalDate} onChange={(event) => setAdvanceApprovalDate(event.target.value)} className="block h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-payroll-advance-approval-date" /></label><Button onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading} data-testid="button-approve-payroll-advance"><Check className="size-4" />{approveAdvance.isPending ? 'Баталж байна...' : 'Урьдчилгаа батлах'}</Button></div>}
      </div>
      {advanceQuery.isLoading ? <div className="p-5"><LoadingBlock className="h-36" /></div> : advanceQuery.isError ? <div className="p-5"><ErrorBlock onRetry={() => advanceQuery.refetch()} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">Ажилласан хоног</th><th className="px-5 py-3 text-right">Өдрийн цалин</th><th className="px-5 py-3 text-right">Нийт олгох цалин</th><th className="px-5 py-3 text-right">Олгох урьдчилгаа</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead>
          <tbody className="divide-y divide-border">{advanceQuery.data?.lines.map((line) => { const selectedDate = advanceDates[line.employeeId] ?? line.paymentDate ?? advanceQuery.data?.approvalDate ?? today(); const cashClosed = closedCashDates.has(selectedDate) || Boolean(line.paymentDate && closedCashDates.has(line.paymentDate)); const isRefreshing = refreshingAdvanceEmployeeId === line.employeeId; return <tr key={line.employeeId}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.employeeType === 'shift' ? 'Ээлжийн ажилтан' : 'Оффис ажилтан'}</p></td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'office' ? money(line.baseSalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.daysWorked}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'shift' ? money(line.dailySalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.totalSalary)}</td><td className="px-5 py-4 text-right"><input type="number" min="0" step="1000" value={advanceAmounts[line.employeeId] ?? String(line.advanceAmount)} disabled={Boolean(advanceQuery.data?.approved && (line.paid || cashClosed))} onChange={(event) => setAdvanceAmounts((amounts) => ({ ...amounts, [line.employeeId]: event.target.value }))} className="h-8 w-32 rounded-lg border border-input bg-background px-2 text-right font-mono text-sm font-bold text-primary outline-none focus:border-primary" data-testid={`input-advance-amount-${line.employeeId}`} /></td><td className="px-5 py-4 text-center"><input type="date" value={selectedDate} disabled={!advanceQuery.data?.approved || line.paid} onChange={(event) => setAdvanceDates((dates) => ({ ...dates, [line.employeeId]: event.target.value }))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary" data-testid={`input-advance-payment-date-${line.employeeId}`} /></td><td className="px-5 py-4 text-center">{advanceQuery.data?.approved ? <Button size="sm" variant={line.paid ? 'default' : 'outline'} disabled={updateAdvancePayment.isPending || cashClosed} onClick={() => setAdvancePaid(line.employeeId, !line.paid, line.advanceAmount, line.paymentDate)} title={cashClosed ? 'Энэ өдрийн касс өндөрлөсөн' : undefined} data-testid={`button-advance-paid-${line.employeeId}`}>{line.paid ? <><Check className="size-3.5" />Олгосон</> : 'Олгоогүй'}</Button> : <span className="text-xs text-muted-foreground">Батлаагүй</span>}</td><td className="px-5 py-4 text-right"><Button size="sm" variant="outline" disabled={Boolean(advanceQuery.data?.approved) || advanceQuery.isFetching} onClick={() => refreshAdvanceEmployee(line.employeeId)} title={advanceQuery.data?.approved ? 'Батлагдсан урьдчилгааны мэдээлэл өөрчлөгдөхгүй' : 'Цалин болон ажилласан хоногийн мэдээллийг шинэчлэх'} data-testid={`button-refresh-advance-employee-${line.employeeId}`}><RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />{isRefreshing ? 'Шинэчилж байна...' : 'Шинэчлэх'}</Button></td></tr>; })}</tbody>
          <tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={5} className="px-5 py-4 text-right text-sm font-bold">Нийт олгох урьдчилгаа</td><td className="px-5 py-4 text-right font-mono text-base font-bold text-primary" data-testid="value-total-payroll-advance">{money(displayedAdvanceTotal)}</td><td colSpan={3} /></tr></tfoot>
        </table>
      </div>}
      {revertAdvanceApproval.isError && <p className="border-t border-border bg-destructive/5 px-5 py-3 text-xs font-medium text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </section>}
    {query.isLoading ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="payroll-table">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын задаргаа</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.lines?.length ?? 0} мөр</span></div>
        {!query.data?.lines?.length ? <EmptyState title="Энэ сард цалин тооцоолоогүй" detail="Ирцийн бүртгэл нэмэгдсэний дараа энд ажилтны мөрүүд гарна." icon={Banknote} /> : <div className="overflow-x-auto"><table className="w-full min-w-[2240px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3">Ажилласан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">НДШ</th><th className="px-5 py-3 text-right">ХХОАТ</th><th className="px-5 py-3 text-right">Хөнгөлөлт</th><th className="px-5 py-3 text-right">Урьдчилгаа цалин</th><th className="px-5 py-3 text-right">Бусад суутгал</th><th className="px-5 py-3 text-right">Гарт олгох</th><th className="px-5 py-3 text-right">Олгосон дүн</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Цалингийн авлага</th><th className="px-5 py-3 text-right">Цалингийн өглөг</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.lines.map((line) => { const cashClosed = Boolean((line.paymentDate && closedCashDates.has(line.paymentDate)) || (line.secondPaymentDate && closedCashDates.has(line.secondPaymentDate))); const currentDifference = Math.max(0, line.gross - line.deductions) - line.paidAmount - Math.max(0, -line.carryoverAmount) + Math.max(0, line.carryoverAmount); return <tr key={line.employeeId} className="hover:bg-secondary/35" data-testid={`row-payroll-${line.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.role}</p></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{line.daysWorked} өдөр</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.gross)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.socialInsurance)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.incomeTax)}</td><td className="px-5 py-4 text-right font-mono text-sm text-sky-700">{money(line.taxRelief)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.advanceAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.manualDeduction)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(Math.max(0, line.gross - line.deductions))}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.paidAmount)}</td><td className="px-5 py-4 text-center font-mono text-xs text-muted-foreground">{line.paymentDate ?? '—'}</td><td className="px-5 py-4 text-center"><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', line.paidAmount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} data-testid={`status-payroll-paid-${line.employeeId}`}>{line.paidAmount > 0 ? 'Олгосон' : 'Олгоогүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-sky-700" data-testid={`value-payroll-receivable-${line.employeeId}`}>{money(Math.max(0, -line.carryoverAmount))}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-orange-800" data-testid={`value-payroll-payable-${line.employeeId}`}>{money(Math.max(0, line.carryoverAmount))}</td><td className={cn('px-5 py-4 text-right font-mono text-sm font-bold', currentDifference < -1 ? 'text-sky-700' : currentDifference > 1 ? 'text-orange-800' : 'text-muted-foreground')} data-testid={`value-payroll-remaining-${line.employeeId}`}>{Math.abs(currentDifference) <= 1 ? money(0) : currentDifference > 0 ? money(currentDifference) : `(${money(Math.abs(currentDifference))})`}</td><td className="px-5 py-4 text-right"><Button size="icon" variant="outline" disabled={cashClosed} title={cashClosed ? 'Гүйлгээний өдрийн касс өндөрлөсөн' : undefined} onClick={() => setSelectedLine(line)} aria-label={`${line.employeeName} цалингийн мэдээлэл оруулах`} data-testid={`button-payroll-adjustment-${line.employeeId}`}><Pencil className="size-3.5" /></Button></td></tr>; })}</tbody><tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={2} className="px-5 py-4 text-right text-sm font-bold">Нийт</td><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-gross">{money(payrollTotals.gross)}</td><td colSpan={3} /><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-advance">{money(payrollTotals.advanceAmount)}</td><td /><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary" data-testid="value-payroll-total-payable">{money(payrollTotals.payable)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold" data-testid="value-payroll-total-paid">{money(payrollTotals.paidAmount)}</td><td colSpan={6} /></tr></tfoot></table></div>}
      </section>
    </>}
    {selectedLine && <PayrollAdjustmentModal line={selectedLine} month={month} onClose={() => setSelectedLine(null)} />}
    {showScheduleSettings && <PayrollScheduleSettingsModal onClose={() => setShowScheduleSettings(false)} />}
  </div>;
}
