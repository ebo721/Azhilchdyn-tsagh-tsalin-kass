import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  getGetDashboardQueryKey,
  getGetPayrollAdvanceQueryKey,
  getGetPayrollOpeningBalancesQueryKey,
  getGetPayrollPayablesQueryKey,
  getGetPayrollQueryKey,
  getListJournalReceivablesQueryKey,
  useConfirmPayrollOpeningBalances,
  useGetPayrollOpeningBalances,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { money } from '@/lib/app-shared';

const monthRe = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
export const priorMonth = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const index = Number(match[1]) * 12 + Number(match[2]) - 2;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const errorStatus = (error: unknown) => (error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 0);
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Үйлдэл амжилтгүй боллоо.');
const fieldCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';

function OpeningDialog({ payrollMonth, knownConfirmedMonth, canConfirm, onClose, onConfirmed }: { payrollMonth: string; knownConfirmedMonth?: string | null; canConfirm: boolean; onClose: () => void; onConfirmed: (message: string) => void }) {
  const qc = useQueryClient();
  const [baselineMonth, setBaselineMonth] = useState(() => knownConfirmedMonth || priorMonth(payrollMonth));
  const validMonth = monthRe.test(baselineMonth);
  const queryKey = getGetPayrollOpeningBalancesQueryKey({ month: baselineMonth });
  const query = useGetPayrollOpeningBalances({ month: baselineMonth }, { query: { queryKey, enabled: validMonth, gcTime: 0, staleTime: 0, refetchOnMount: 'always' } });
  const confirm = useConfirmPayrollOpeningBalances();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [dirty, setDirty] = useState(false);
  const base = useRef<{ month: string; revision: number; sourceRevision: number } | null>(null);
  const [conflict, setConflict] = useState(false);
  const data = query.data && query.data.month === baselineMonth ? query.data : undefined;

  const adopt = () => {
    if (!data) return;
    base.current = { month: data.month, revision: data.revision, sourceRevision: data.sourceRevision };
    setAmounts(Object.fromEntries(data.lines.map((l) => [l.employeeId, l.balanceAmount === null ? '' : String(l.balanceAmount)])));
    setNote(data.note ?? '');
    setVerified(false);
    setDirty(false);
    setConflict(false);
    confirm.reset();
  };
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;
  useEffect(() => {
    if (data && !query.isFetching && base.current?.month !== data.month) adoptRef.current();
  }, [data, query.isFetching]);

  const confirmedMonth = data?.confirmedMonth ?? query.data?.confirmedMonth ?? knownConfirmedMonth ?? null;
  const locked = Boolean(confirmedMonth);
  useEffect(() => {
    if (confirmedMonth && confirmedMonth !== baselineMonth) {
      base.current = null;
      setAmounts({});
      setDirty(false);
      setBaselineMonth(confirmedMonth);
    }
  }, [confirmedMonth, baselineMonth]);

  const stale = Boolean(data && base.current && base.current.month === data.month && (base.current.revision !== data.revision || base.current.sourceRevision !== data.sourceRevision));
  useEffect(() => {
    if (stale && !dirty && !query.isFetching) adoptRef.current();
  }, [stale, dirty, query.isFetching]);

  const changeMonth = (value: string) => {
    if (locked) return;
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлт устах болно. Сар солих уу?')) return;
    base.current = null;
    setAmounts({});
    setDirty(false);
    setBaselineMonth(value);
  };
  const reload = async () => {
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлтийг устгаад шинэ урьдчилсан харагдацыг авах уу?')) return;
    const result = await query.refetch();
    if (result.data) {
      base.current = { month: result.data.month, revision: result.data.revision, sourceRevision: result.data.sourceRevision };
      setAmounts(Object.fromEntries(result.data.lines.map((l) => [l.employeeId, l.balanceAmount === null ? '' : String(l.balanceAmount)])));
      setNote(result.data.note ?? '');
      setVerified(false);
      setDirty(false);
      setConflict(false);
      confirm.reset();
    }
  };

  const parsed = useMemo(() => (data?.lines ?? []).map((l) => {
    const raw = (amounts[l.employeeId] ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    return { line: l, value: value !== null && Number.isFinite(value) ? value : null, invalid: raw !== '' && !Number.isFinite(Number(raw)) };
  }), [data, amounts]);
  const missing = parsed.filter((p) => p.value === null).length;
  const payable = parsed.reduce((t, p) => t + (p.value !== null && p.value > 0 ? p.value : 0), 0);
  const receivable = parsed.reduce((t, p) => t + (p.value !== null && p.value < 0 ? -p.value : 0), 0);
  const reviewSet = new Set(data?.reviewEmployeeIds ?? []);
  const reviewNames = (data?.lines ?? []).filter((l) => reviewSet.has(l.employeeId)).map((l) => l.employeeName);
  const noteOk = note.trim().length >= 3;
  const canSubmit = canConfirm && Boolean(data) && !stale && missing === 0 && noteOk && verified && !confirm.isPending && !conflict;

  const submit = () => {
    if (!data || !base.current || !canSubmit) return;
    const target = baselineMonth;
    confirm.mutate({
      data: {
        month: target,
        revision: base.current.revision,
        sourceRevision: base.current.sourceRevision,
        note: note.trim(),
        verified: true,
        lines: parsed.map((p) => ({ employeeId: p.line.employeeId, balanceAmount: p.value as number })),
      },
    }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPayrollOpeningBalancesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPayrollPayablesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        void qc.invalidateQueries({ queryKey: getListJournalReceivablesQueryKey({ status: 'all' }) });
        onConfirmed(`${target} сарын эхний үлдэгдэл баталгаажлаа.`);
        onClose();
      },
      onError: (error) => {
        if (errorStatus(error) === 409) {
          setConflict(true);
          void qc.invalidateQueries({ queryKey: getGetPayrollOpeningBalancesQueryKey() });
        }
      },
    });
  };

  return <Modal wide title="Цалингийн эхний үлдэгдэл" detail="Эерэг дүн: компани ажилтанд өглөгтэй. Сөрөг дүн: ажилтнаас авлагатай (суутгана)." onClose={onClose}>
    <div className="space-y-5" data-testid="dialog-opening-balances">
      <label className="block max-w-xs space-y-1 text-xs font-semibold">Үлдэгдлийн сар
        <input type="month" value={baselineMonth} onChange={(e) => changeMonth(e.target.value)} disabled={locked} aria-describedby="opening-month-lock" className={fieldCls + ' disabled:cursor-not-allowed disabled:opacity-70'} data-testid="input-opening-month" />
      </label>
      {locked && <p id="opening-month-lock" className="text-xs text-muted-foreground" data-testid="text-opening-month-locked">Эхний үлдэгдлийн сар анх баталгаажсаны дараа өөрчлөгдөхгүй (аудитын хамгаалалт). Зөвхөн {confirmedMonth} сарыг шалгаж дахин баталгаажуулах боломжтой.</p>}
      {!validMonth && <p role="alert" className="text-sm text-destructive">Сарыг зөв сонгоно уу.</p>}
      {validMonth && query.isLoading && <LoadingBlock className="h-40" />}
      {validMonth && query.isError && <div role="alert" data-testid="error-opening-query"><p className="mb-2 text-sm text-destructive">{errorText(query.error)}</p><ErrorBlock onRetry={() => query.refetch()} /></div>}
      {data && <>
        <div className="grid gap-3 rounded-xl border border-border bg-secondary/40 p-4 text-xs sm:grid-cols-2" data-testid="opening-meta">
          <p>Баталгаажсан сар: <strong>{data.confirmedMonth ?? 'Баталгаажаагүй'}</strong></p>
          <p>Баталгаажуулсан: <strong>{data.confirmedAt ? new Date(data.confirmedAt).toLocaleString('mn-MN') : '—'}{data.confirmedBy !== null ? ` · хэрэглэгч #${data.confirmedBy}` : ''}</strong></p>
          <p>Хувилбар: <strong className="font-mono">{data.revision}</strong> · Эх хувилбар: <strong className="font-mono">{data.sourceRevision}</strong></p>
          {data.note && <p className="sm:col-span-2">Өмнөх шалтгаан: <strong>{data.note}</strong></p>}
        </div>
        {reviewNames.length > 0 && <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="opening-review-list"><strong>Хянах шаардлагатай ажилтан ({reviewNames.length}):</strong> {reviewNames.join(', ')}</div>}
        {(stale || conflict) && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="opening-stale">
          Өгөгдөл өөр хэрэглэгчээр өөрчлөгдсөн. Таны оруулсан утга хадгалагдаагүй бөгөөд дарагдаагүй. Шинэ урьдчилсан харагдацыг авсны дараа дахин шалгаж баталгаажуулна уу.
          <div className="mt-2"><Button size="sm" variant="outline" onClick={() => void reload()} data-testid="button-opening-reload">Шинэ харагдац авах (миний засварыг устгана)</Button></div>
        </div>}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="max-h-[40dvh] overflow-auto">
            <table className="w-full text-left"><thead className="sticky top-0 bg-secondary text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Ажилтан</th><th className="px-3 py-2 text-right">Гарын үсэгтэй дүн (₮)</th></tr></thead>
              <tbody className="divide-y divide-border">{parsed.map(({ line, value, invalid }) => <tr key={line.employeeId} data-testid={`row-opening-${line.employeeId}`}>
                <td className="px-3 py-2 text-sm"><span className="font-semibold">{line.employeeName}</span>{reviewSet.has(line.employeeId) && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Хянах</span>}{line.balanceAmount === null && <span className="ml-2 text-[10px] text-muted-foreground">Тодорхойгүй</span>}</td>
                <td className="px-3 py-2 text-right"><input type="number" step="0.01" inputMode="decimal" placeholder="0 гэж оруулах" aria-label={`${line.employeeName} эхний үлдэгдэл`} aria-invalid={invalid || value === null} value={amounts[line.employeeId] ?? ''} disabled={!canConfirm || confirm.isPending}
                  onChange={(e) => { setAmounts((a) => ({ ...a, [line.employeeId]: e.target.value })); setDirty(true); }}
                  className="h-9 w-36 rounded-lg border border-input bg-background px-2 text-right font-mono text-sm outline-none focus:border-primary aria-[invalid=true]:border-destructive/60" data-testid={`input-opening-${line.employeeId}`} /></td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" data-testid="opening-totals">
          <div className="rounded-xl border border-border p-3"><p className="text-[11px] text-muted-foreground">Нийт цалингийн өглөг (+)</p><p className="font-mono text-base font-bold text-orange-800" data-testid="value-opening-payable">{money(payable)}</p></div>
          <div className="rounded-xl border border-border p-3"><p className="text-[11px] text-muted-foreground">Нийт цалингийн авлага (−)</p><p className="font-mono text-base font-bold text-sky-700" data-testid="value-opening-receivable">{money(receivable)}</p></div>
        </div>
        {missing > 0 && <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="opening-missing">{missing} ажилтны дүн оруулаагүй. Хоосон утгыг 0 гэж тооцохгүй; тэг бол 0 гэж бичнэ.</p>}
        {canConfirm ? <>
          <label className="block space-y-1 text-xs font-semibold">Баталгаажуулах шалтгаан (3-2000 тэмдэгт)
            <textarea value={note} maxLength={2000} rows={3} onChange={(e) => { setNote(e.target.value); setDirty(true); }} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:border-primary" data-testid="input-opening-note" />
          </label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-1 size-4" data-testid="checkbox-opening-verified" /><span>Гарын үсэгтэй дүнг (эерэг = өглөг, сөрөг = авлага) шалгаж баталгаажуулж байна.</span></label>
        </> : <p className="rounded-xl border border-border bg-secondary/40 p-3 text-xs text-muted-foreground" data-testid="opening-readonly">Зөвхөн нягтлан бодогч урьдчилан харна. Баталгаажуулалтыг зөвхөн админ хийнэ.</p>}
        {confirm.isError && <p role="alert" className="whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-opening-confirm">{errorText(confirm.error)}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} data-testid="button-opening-cancel">Хаах</Button>
          {canConfirm && <Button onClick={submit} disabled={!canSubmit} data-testid="button-opening-confirm">{confirm.isPending ? 'Баталгаажуулж байна...' : 'Эхний үлдэгдэл баталгаажуулах'}</Button>}
        </div>
      </>}
    </div>
  </Modal>;
}

export function PayrollOpeningBalances({ month, role, closed, openingBalanceMonth, reviewRequiredCount, legacyAvailable }: { month: string; role?: string | null; closed: boolean; openingBalanceMonth?: string | null; reviewRequiredCount: number; legacyAvailable: boolean }) {
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const canPreview = role === 'admin' || role === 'accountant';
  useEffect(() => { setSuccess(null); setOpen(false); }, [month]);
  if (!canPreview && !openingBalanceMonth && reviewRequiredCount === 0) return null;
  return <section className="mb-5 rounded-xl border border-border bg-card p-4" aria-labelledby="opening-heading" data-testid="panel-opening-balances">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 id="opening-heading" className="flex items-center gap-2 text-sm font-bold"><Landmark className="size-4" />Цалингийн эхний үлдэгдэл</h2>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="text-opening-status">
          {openingBalanceMonth ? `Баталгаажсан эхлэл сар: ${openingBalanceMonth}.` : 'Эхний үлдэгдэл баталгаажаагүй байна.'}
          {reviewRequiredCount > 0 && ` ${reviewRequiredCount} ажилтны үлдэгдэл хянагдах хүртэл тооцоо хийгдэхгүй.`}
        </p>
      </div>
      {canPreview && <Button variant={reviewRequiredCount > 0 ? 'default' : 'outline'} onClick={() => setOpen(true)} data-testid="button-open-opening-balances">{role === 'admin' ? 'Үлдэгдэл хянаж баталгаажуулах' : 'Үлдэгдэл урьдчилан харах'}</Button>}
    </div>
    {reviewRequiredCount > 0 && <p className="mt-2 text-xs" data-testid="text-opening-review-hint">Хянах шаардлагатай мөрүүдэд татах үйлдэл идэвхгүй. Админ эхний үлдэгдлийг баталгаажуулна уу.{role !== 'admin' && ' Та админд хандана уу.'}</p>}
    {success && <p role="status" className="mt-2 text-sm font-medium text-primary" data-testid="text-opening-success">{success}</p>}
    {legacyAvailable && !closed && <p className="mt-2 text-[11px] text-muted-foreground">Эхний үлдэгдэл байхгүй үед доорх нарийвчилсан сонголтоор өмнөх үлдэгдлийг гараар бэлтгэж болно.</p>}
    {open && <OpeningDialog payrollMonth={month} knownConfirmedMonth={openingBalanceMonth} canConfirm={role === 'admin' && !closed} onClose={() => setOpen(false)} onConfirmed={setSuccess} />}
  </section>;
}
