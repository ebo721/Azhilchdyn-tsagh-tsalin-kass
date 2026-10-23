import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLinkBankPayroll, useListBankPayrollTargets, getListBankPayrollTargetsQueryKey, useListBankAdvanceTargets, getListBankAdvanceTargetsQueryKey, type BankTransaction, type BankPayrollTarget } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { money } from '@/lib/app-shared';

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function BankPayrollLinkPanel({ bank, onLinked }: { bank: BankTransaction; onLinked: (remainingBalance: number) => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(bank.transactionAt.slice(0, 7));
  const [paymentKind, setPaymentKind] = useState<'salary' | 'advance'>('salary');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const link = useLinkBankPayroll();
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const salaryTargets = useListBankPayrollTargets(bank.id, month, { query: { queryKey: getListBankPayrollTargetsQueryKey(bank.id, month), enabled: valid && paymentKind === 'salary' } });
  const advanceTargets = useListBankAdvanceTargets(bank.id, month, { query: { queryKey: getListBankAdvanceTargetsQueryKey(bank.id, month), enabled: valid && paymentKind === 'advance' } });
  const targets = paymentKind === 'advance' ? advanceTargets : salaryTargets;
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (targets.data ?? []).filter((t) => t.month === month && (!q || t.employeeName.toLowerCase().includes(q)));
  }, [targets.data, search, month]);
  const target: BankPayrollTarget | undefined = selectedId === null ? undefined : (targets.data ?? []).find((t) => t.employeeId === selectedId && t.month === month);
  const reuse = Boolean(target?.existingCashId);
  const added = target ? (reuse ? 0 : bank.amount) : 0;
  const after = target ? r2(Math.max(0, target.remainingBalance - added)) : 0;
  const excessive = Boolean(target && !reuse && bank.amount > target.remainingBalance + 0.004);
  const canSave = Boolean(target && confirmed && !excessive && !link.isPending && !success);

  const changeMonth = (m: string) => { setMonth(m); setSelectedId(null); setConfirmed(false); setError(''); setSuccess(''); };
  const refresh = () => {
    const re = /bank-transactions|payroll|cash|dashboard|journal/;
    return qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && re.test(q.queryKey[0] as string) });
  };
  const save = () => {
    if (!target || !canSave) return;
    setError('');
    link.mutate({ id: bank.id, data: { employeeId: target.employeeId, month, ...(paymentKind === 'advance' ? { paymentKind } : {}) } }, {
      onSuccess: async (r) => {
        setSuccess(`${r.reusedPayment ? 'Бүртгэлтэй төлбөртэй холбогдлоо.' : `${money(bank.amount)} цалинд нэмэгдлээ.`} Үлдэгдэл: ${money(r.remainingBalance)}${r.remainingBalance <= 0 ? ' (хаагдлаа)' : ''}`);
        await refresh();
        closeTimer.current = setTimeout(() => onLinked(r.remainingBalance), 1200);
      },
      onError: (e) => setError(errText(e, 'Цалинтай холбоход алдаа гарлаа.')),
    });
  };

  return <section onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }} className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4" aria-labelledby="bank-payroll-title" data-testid="section-bank-payroll-link">
    <div><h3 id="bank-payroll-title" className="text-sm font-bold">Хадгалсан цалинтай шууд холбох</h3>
      <p className="mt-1 text-xs text-muted-foreground">{paymentKind === 'advance' ? 'Батлагдсан урьдчилгааг хэсэгчлэн олгоно. Сүүл цалингаас зөвхөн бодитоор олгосон нийлбэрийг суутгана.' : 'Банкны дүн цалингийн төлбөрт нэмэгдэж, үлдсэн хэсэг цалингийн өр хэвээр үлдэнэ. Дараагийн банкны гүйлгээгээр үлдэгдлийг төлнө.'}</p></div>
    <label className="block space-y-1 text-xs font-semibold">Төлөлтийн төрөл<select value={paymentKind} onChange={e => { setPaymentKind(e.target.value as 'salary' | 'advance'); setSelectedId(null); setConfirmed(false); setError(''); setSuccess(''); }} disabled={link.isPending || Boolean(success)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="select-bank-payroll-kind"><option value="salary">Сүүл цалин</option><option value="advance">Урьдчилгаа цалин</option></select></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-xs font-semibold">Банкны дүн<input readOnly value={money(bank.amount)} className="h-10 w-full rounded-lg border border-input bg-muted px-3 font-mono text-sm" data-testid="input-bank-payroll-amount" /></label>
      <label className="space-y-1 text-xs font-semibold">Банкны огноо<input readOnly value={bank.transactionAt.slice(0, 10)} className="h-10 w-full rounded-lg border border-input bg-muted px-3 font-mono text-sm" data-testid="input-bank-payroll-date" /></label>
      <label className="space-y-1 text-xs font-semibold">Цалингийн сар<input type="month" value={month} onChange={(e) => changeMonth(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-bank-payroll-month" /></label>
      <label className="space-y-1 text-xs font-semibold">Ажилтан хайх<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Нэр" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-bank-payroll-search" /></label>
    </div>
    {!valid ? <p className="text-sm font-semibold text-destructive" role="alert" data-testid="error-bank-payroll-month">Сарыг зөв сонгоно уу.</p>
      : targets.isLoading ? <div className="h-20 animate-pulse rounded-xl bg-muted" data-testid="loading-bank-payroll-targets" />
      : targets.isError ? <div role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="error-bank-payroll-targets"><p className="font-semibold text-destructive">{errText(targets.error, 'Цалингийн жагсаалт уншихад алдаа гарлаа.')}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => targets.refetch()} data-testid="button-bank-payroll-retry">Дахин оролдох</Button></div>
      : !list.length ? <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground" data-testid="empty-bank-payroll-targets">Энэ сард холбох хадгалсан цалин олдсонгүй.</p>
      : <ul className="max-h-56 space-y-2 overflow-y-auto" data-testid="list-bank-payroll-targets">{list.map((t) => {
        const sel = t.employeeId === selectedId;
        return <li key={t.employeeId}><button type="button" onClick={() => { setSelectedId(t.employeeId); setConfirmed(false); setError(''); }} aria-pressed={sel} className={cn('w-full rounded-xl border px-3 py-2 text-left text-sm', sel ? 'border-primary bg-primary/10' : 'border-border bg-background')} data-testid={`button-bank-payroll-target-${t.employeeId}`}>
          <span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-semibold">{t.employeeName}</span><span className="shrink-0 font-mono text-xs font-bold text-orange-800">Өр: {money(t.remainingBalance)}</span></span>
          <span className="mt-1 block text-xs text-muted-foreground">Олгох {money(t.payable)} · Төлсөн {money(t.paidAmount)}{t.existingCashId ? ' · Бүртгэлтэй төлбөр' : ''}</span></button></li>;
      })}</ul>}
    {target && <div className="space-y-2 rounded-xl border border-border bg-background p-3 text-sm" data-testid="panel-bank-payroll-preview">
      <p className="font-semibold">{target.employeeName} · {month}</p>
      <p className="text-xs" data-testid="text-bank-payroll-mode">{reuse ? 'Өмнө бүртгэсэн төлбөртэй холбоно. Нэмэлт төлсөн дүн нэмэгдэхгүй.' : `Банкны ${money(bank.amount)} хадгалсан цалингийн төлөгдсөн дүнд нэмэгдэнэ.`}</p>
      <div className="grid grid-cols-2 gap-2 font-mono text-xs"><div className="rounded-lg bg-secondary/40 p-2"><p className="font-sans text-muted-foreground">Өмнөх өр</p><p className="font-bold" data-testid="text-bank-payroll-before">{money(target.remainingBalance)}</p></div>
        <div className={cn('rounded-lg p-2', after > 0 ? 'bg-orange-50 text-orange-900' : 'bg-emerald-50 text-emerald-900')}><p className="font-sans">Дараах өр</p><p className="font-bold" data-testid="text-bank-payroll-after">{money(after)}</p><p className="font-sans text-[10px] font-bold">{after > 0 ? 'Цалингийн өр үлдэнэ' : 'Хаагдана'}</p></div></div>
      {excessive && <p className="text-sm font-semibold text-destructive" role="alert" data-testid="error-bank-payroll-excess">Банкны дүн цалингийн үлдэгдлээс ({money(target.remainingBalance)}) их байна.</p>}
      <label className="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" data-testid="checkbox-bank-payroll-confirm" />Энэ банкны гүйлгээг {target.employeeName}-н {month} сарын {paymentKind === 'advance' ? 'урьдчилгаатай' : 'сүүл цалинтай'} холбохыг баталгаажуулна.</label>
    </div>}
    {error && <p className="text-sm font-semibold text-destructive" role="alert" data-testid="error-bank-payroll-save">{error}</p>}
    {success && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm font-semibold text-emerald-800" role="status" data-testid="text-bank-payroll-success">{success}</p>}
    <Button type="button" className="w-full" disabled={!canSave} onClick={save} data-testid="button-bank-payroll-link">{link.isPending ? 'Холбож байна...' : 'Цалинтай холбох'}</Button>
  </section>;
}
