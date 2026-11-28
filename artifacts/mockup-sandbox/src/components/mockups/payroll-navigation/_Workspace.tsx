import { useMemo, useState } from 'react';
import {
  Banknote, BriefcaseBusiness, CalendarClock, CalendarDays, Check, ChevronDown,
  ChevronRight, Clock3, Download, Filter, LockKeyhole, Menu,
  Search, Settings2, ShieldCheck, SlidersHorizontal, WalletCards, X,
} from 'lucide-react';
import { demoEmployees, demoPeriod } from './_fixtures';
import { MonthNavigator } from './_MonthNavigator';
import './_group.css';
import './_proposal.css';

type Mode = 'advance' | 'final';
type Person = (typeof demoEmployees)[number];

const formatMoney = (amount: number) => `${new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 0 }).format(amount)} ₮`;
const monthText = (month: string) => {
  const [year, m] = month.split('-');
  return `${year} оны ${Number(m)} сар`;
};
const periodDates = (month: string, mode: Mode) => {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const fmt = (d: number) => `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${year}`;
  return mode === 'advance'
    ? `${fmt(1)} — ${fmt(Math.min(demoPeriod.advanceCutoffDay, lastDay))}`
    : `${fmt(1)} — ${fmt(lastDay)}`;
};

export function Workspace({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [month, setMonth] = useState(demoPeriod.month);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [attendanceSynced, setAttendanceSynced] = useState(false);
  const [closed, setClosed] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [payrollExpanded, setPayrollExpanded] = useState(true);
  const [paidOverrides, setPaidOverrides] = useState<Record<string, number>>({});
  const [localInstallments, setLocalInstallments] = useState<Record<string, number[]>>({});

  const rows = useMemo(() => demoEmployees.map((person) => {
    const paid = paidOverrides[`${mode}-${person.id}`] ?? (mode === 'advance' ? person.advancePaid : person.finalPaid);
    const amount = mode === 'advance' ? person.advance - person.advanceDeduction : person.gross - person.deductions;
    return { person, paid, amount, remaining: Math.max(0, amount - paid) };
  }).filter(({ person, remaining }) => {
    const matchesSearch = `${person.name} ${person.job}`.toLocaleLowerCase('mn').includes(search.trim().toLocaleLowerCase('mn'));
    const matchesFilter = filter === 'all' || (filter === 'pending' ? remaining > 0 : remaining === 0);
    return matchesSearch && matchesFilter;
  }), [mode, paidOverrides, search, filter]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    setExpandedId(null);
    setSearch('');
    setFilter('all');
  };
  const exportExample = () => {
    const header = mode === 'advance'
      ? ['Ажилтан', 'Баталсан', 'Авлага суутгал', 'Шилжүүлэх', 'Олгосон', 'Үлдэгдэл']
      : ['Ажилтан', 'Нийт цалин', 'Суутгал', 'Олговол зохих', 'Олгосон', 'Үлдэгдэл'];
    const csvRows = rows.map(({ person, paid, amount, remaining }) => [
      person.name,
      mode === 'advance' ? person.advance : person.gross,
      mode === 'advance' ? person.advanceDeduction : person.deductions,
      amount,
      paid,
      remaining,
    ]);
    const csv = [header, ...csvRows].map((line) => line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `samasaa-${mode}-${month}-demo.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice('Жишээ тайлан татагдлаа. Бодит мэдээлэл биш.');
  };
  const approvePayment = (person: Person) => {
    if (closed) { showNotice('Сар хаагдсан тул өөрчлөлт хийх боломжгүй.'); return; }
    const current = paidOverrides[`${mode}-${person.id}`] ?? (mode === 'advance' ? person.advancePaid : person.finalPaid);
    const due = mode === 'advance'
      ? person.advance - person.advanceDeduction - current
      : person.gross - person.deductions - current;
    if (due <= 0) { showNotice('Энэ ажилтны үлдэгдэлгүй байна.'); return; }
    const installment = Math.min(due, Math.round(due * .55 / 1000) * 1000 || due);
    setPaidOverrides((old) => ({ ...old, [`${mode}-${person.id}`]: current + installment }));
    const installmentKey = `${mode}-${person.id}`;
    setLocalInstallments((old) => ({ ...old, [installmentKey]: [...(old[installmentKey] ?? []), installment] }));
    showNotice(`${person.name} · ${formatMoney(installment)}-ийн жишээ гүйлгээ бүртгэв. Бодит хадгалалт хийгдээгүй.`);
  };
  const confirmClose = () => {
    if (mode === 'advance') return;
    const accepted = window.confirm(`${monthText(month)}-ийг жишээ горимд ${closed ? 'дахин нээх' : 'хаах'} уу?\n\nЗөвхөн админ сарын хаалт удирдана. Үйлдвэрлэлийн үед цалин, тухайн үеийн ирцийн бүртгэл хамт түгжигдэнэ.\n\nЭнэ бол DEMO — бодит хадгалалт хийгдэхгүй.`);
    if (!accepted) return;
    setClosed((value) => !value);
    showNotice('Зөвхөн дэлгэц дээрх жишээ төлөв өөрчлөгдлөө. Бодит хадгалалт хийгдээгүй.');
  };

  const title = mode === 'advance' ? 'Урьдчилгаа цалин' : 'Сүүл цалин';
  return (
    <div className="payroll-proposal min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`} data-testid="navigation-sidebar">
        <div className="flex items-center gap-3 px-2">
          <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
          <span className="text-sm font-bold tracking-tight">САМАСАА</span>
          <button onClick={() => setMobileNav(false)} className="ml-auto grid size-8 place-items-center rounded-lg hover:bg-sidebar-accent lg:hidden" aria-label="Цэс хаах"><X className="size-4" /></button>
        </div>
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto" aria-label="Үндсэн цэс">
          <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-sidebar-foreground/60"><CalendarDays className="size-[17px]" />Ирц</div>
          <div className="rounded-xl bg-sidebar-accent/65 p-2">
            <button type="button" onClick={() => setPayrollExpanded((value) => !value)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-semibold text-sidebar-accent-foreground" aria-expanded={payrollExpanded} aria-controls="payroll-submenu">
              <Banknote className="size-[17px] text-sidebar-primary" /><span>Цалин</span><ChevronDown className="ml-auto size-4" />
            </button>
            {payrollExpanded && <div id="payroll-submenu" className="ml-[19px] mt-1 space-y-1 border-l border-sidebar-border pl-3">
              <button type="button" onClick={() => switchMode('advance')} data-active={mode === 'advance'} className={`nav-child flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${mode === 'advance' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}><span>Урьдчилгаа цалин</span>{mode === 'advance' && <ChevronRight className="size-3.5" />}</button>
              <button type="button" onClick={() => switchMode('final')} data-active={mode === 'final'} className={`nav-child flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${mode === 'final' ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}><span>Сүүл цалин</span>{mode === 'final' && <ChevronRight className="size-3.5" />}</button>
            </div>}
          </div>
          <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-sidebar-foreground/60"><WalletCards className="size-[17px]" />Касс</div>
        </nav>
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-sidebar-primary" />Ерөнхий админ</div>
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Цэс хаах" />}

      <main className="min-h-[100dvh] lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between border-b border-border/75 bg-background/90 px-4 backdrop-blur-md sm:px-7">
          <div className="flex items-center gap-3">
            <button className="grid size-9 place-items-center rounded-xl border border-border bg-card lg:hidden" onClick={() => setMobileNav(true)} aria-label="Цэс нээх"><Menu className="size-4" /></button>
            <span className="text-sm font-semibold">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />Ерөнхий админ</span>
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">АД</span>
          </div>
        </header>
        <div className="mx-auto max-w-[1480px] px-4 pb-10 pt-5 sm:px-7 sm:pt-7">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm">
            <h1 className="text-xl font-bold tracking-[-.035em] sm:text-2xl" data-testid="heading-page">{title}</h1>
            <span className="rounded-md bg-accent/35 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-foreground/70">DEMO</span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${closed ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{closed ? 'ХААЛТТАЙ' : 'НЭЭЛТТЭЙ'}</span>
            <span className="text-muted-foreground"><span className="font-mono text-foreground/80">{periodDates(month, mode)}</span><span className="mx-1.5 text-border">·</span>Олгох өдөр {mode === 'advance' ? demoPeriod.advancePayDay : demoPeriod.finalPayDay}{mode === 'final' ? ' · дараа сарын' : ''}</span>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 xl:flex-nowrap" data-testid="payroll-toolbar">
            <MonthNavigator month={month} onChange={(next) => { setMonth(next); setExpandedId(null); setPaidOverrides({}); setLocalInstallments({}); setClosed(false); setAttendanceSynced(false); }} prefix="proposal-payroll" ariaLabel="Цалингийн сар сонгох" />
            <button type="button" disabled={closed} onClick={() => { setAttendanceSynced(true); showNotice('Ирц шинэчиллээ. Демо горим.'); }} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"><Clock3 className="size-3.5" />{attendanceSynced ? 'Ирц шинэчилсэн' : 'Ирц шинэчлэх'}</button>
            {mode === 'final' && <button type="button" onClick={confirmClose} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"><LockKeyhole className="size-3.5" />{closed ? 'Сар нээх' : 'Сар хаах'}</button>}
            <button type="button" onClick={exportExample} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-secondary" aria-label="Жишээ экспорт"><Download className="size-3.5" /><span className="hidden 2xl:inline">Экспорт</span></button>
            <button type="button" onClick={() => showNotice('Цалингийн хуваарь: урьдчилгаа 20, сүүл цалин дараа сарын 5.')} className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Цалингийн тохиргоо"><CalendarClock className="size-4" /></button>
            <label className="relative min-w-[130px] flex-1 xl:min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ажилтан хайх" className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-primary" aria-label="Ажилтан хайх" />
            </label>
            <label className="relative shrink-0">
              <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-9 w-[120px] appearance-none rounded-lg border border-input bg-background py-0 pl-8 pr-7 text-xs font-semibold outline-none focus:border-primary" aria-label="Төлөвөөр шүүх">
                <option value="all">Бүх төлөв</option><option value="pending">Үлдэгдэлтэй</option><option value="paid">Бүрэн олгосон</option>
              </select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </label>
          </div>

          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_8px_hsl(var(--foreground)/.025)]" data-testid="payroll-table">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-sm font-bold">Ажилтан</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">{rows.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] border-collapse text-left">
                <thead>
                  <tr className="bg-secondary/50 text-[10px] font-bold uppercase tracking-[.09em] text-muted-foreground">
                    <th className="px-5 py-3.5">Ажилтан</th>
                    <th className="px-3 py-3.5 text-right">{mode === 'advance' ? 'Баталсан' : 'Нийт цалин'}</th>
                    <th className="px-3 py-3.5 text-right">{mode === 'advance' ? 'Авлага суутгал' : 'Суутгал'}</th>
                    <th className="px-3 py-3.5 text-right">{mode === 'advance' ? 'Шилжүүлэх' : 'Олговол зохих'}</th>
                    <th className="px-3 py-3.5 text-right">Олгосон</th>
                    <th className="px-3 py-3.5 text-right">Үлдэгдэл</th>
                    <th className="px-4 py-3.5 text-right">Үйлдэл</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ person, paid, amount, remaining }) => {
                    const isExpanded = expandedId === person.id;
                    const deduction = mode === 'advance' ? person.advanceDeduction : person.deductions;
                    const fullAmount = mode === 'advance' ? person.advance : person.gross;
                    return <PayrollPersonRow key={person.id} person={person} mode={mode} paid={paid} amount={amount} remaining={remaining} deduction={deduction} fullAmount={fullAmount} addedInstallments={localInstallments[`${mode}-${person.id}`] ?? []} expanded={isExpanded} onToggle={() => setExpandedId(isExpanded ? null : person.id)} onPay={() => approvePayment(person)} disabled={closed} />;
                  })}
                  {rows.length === 0 && <tr><td colSpan={7} className="px-6 py-14 text-center"><div className="mx-auto grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><SlidersHorizontal className="size-4" /></div><p className="mt-3 text-sm font-semibold">Тохирох ажилтан олдсонгүй</p><p className="mt-1 text-xs text-muted-foreground">Хайлтын үг эсвэл төлөвийн шүүлтээ өөрчилнө үү.</p></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
      {notice && <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-primary/20 bg-card px-4 py-3 text-xs font-semibold text-foreground shadow-lg">{notice}</div>}
    </div>
  );
}

function PayrollPersonRow({ person, mode, paid, amount, remaining, deduction, fullAmount, addedInstallments, expanded, onToggle, onPay, disabled }: {
  person: Person; mode: Mode; paid: number; amount: number; remaining: number; deduction: number; fullAmount: number; addedInstallments: number[]; expanded: boolean; onToggle: () => void; onPay: () => void; disabled: boolean;
}) {
  const fullyPaid = remaining === 0;
  const paidPercent = Math.min(100, amount > 0 ? Math.round((paid / amount) * 100) : 100);
  const originalPaid = mode === 'advance' ? person.advancePaid : person.finalPaid;
  const paymentHistory = [
    ...(originalPaid > 0 ? [{ sequence: 1, date: mode === 'advance' ? '20.11.2026' : '05.12.2026', amount: originalPaid }] : []),
    ...addedInstallments.map((installment, index) => ({ sequence: (originalPaid > 0 ? 2 : 1) + index, date: mode === 'advance' ? '24.11.2026' : '08.12.2026', amount: installment })),
  ];
  return <>
    <tr className="payroll-row border-t border-border/70">
      <td className="px-5 py-3.5">
        <button type="button" onClick={onToggle} className="group flex w-full items-center gap-3 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-[11px] font-bold text-primary">{person.name.split(' ').slice(0, 2).map((s) => s.replace('.', '')[0]).join('')}</span>
          <span className="min-w-0"><span className="block text-[13px] font-bold text-foreground group-hover:text-primary">{person.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{person.job}</span></span>
          <ChevronRight className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      </td>
      <td className="px-3 py-3.5 text-right font-mono text-[12px] text-foreground/85">{formatMoney(fullAmount)}</td>
      <td className="px-3 py-3.5 text-right font-mono text-[12px] text-muted-foreground">{formatMoney(deduction)}</td>
      <td className="px-3 py-3.5 text-right font-mono text-[12px] font-bold text-primary">{formatMoney(amount)}</td>
      <td className="px-3 py-3.5 text-right"><span className="block font-mono text-[12px]">{formatMoney(paid)}</span><span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${paidPercent}%` }} /></span></td>
      <td className="px-3 py-3.5 text-right"><span className="font-mono text-[12px] font-semibold">{formatMoney(remaining)}</span><span className={`mt-1 block text-[10px] font-semibold ${fullyPaid ? 'text-primary' : 'text-muted-foreground'}`}>{fullyPaid ? 'Бүрэн олгосон' : 'Үлдэгдэлтэй'}</span></td>
      <td className="px-4 py-3.5 text-right">
        <button type="button" onClick={onPay} disabled={disabled || fullyPaid} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-colors ${fullyPaid ? 'cursor-default bg-primary/10 text-primary' : disabled ? 'cursor-not-allowed bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>
          {fullyPaid ? <><Check className="size-3" />Олгосон</> : <><Banknote className="size-3" />{mode === 'advance' ? 'Шилжүүлэх' : 'Олголт'}</>}
        </button>
      </td>
    </tr>
    {expanded && <tr className="details-row border-t border-border/60 bg-secondary/25"><td colSpan={7} className="px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.15fr]">
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">{mode === 'advance' ? 'Урьдчилгааны задаргаа' : 'Цалингийн тооцоо'}</h3>
          <DetailLine label={mode === 'advance' ? 'Баталсан урьдчилгаа' : 'Нийт цалин'} value={formatMoney(fullAmount)} />
          <DetailLine label={mode === 'advance' ? 'Авлагын суутгал' : 'Нийт суутгал'} value={`− ${formatMoney(deduction)}`} />
          <DetailLine label={mode === 'advance' ? 'Шилжүүлэх дүн' : 'Олговол зохих'} value={formatMoney(amount)} strong />
          {mode === 'final' && <p className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">ХХОАТ: {formatMoney(Math.max(0, person.deductions - person.advance - Math.round(person.gross * .115)))} · НДШ: {formatMoney(Math.round(person.gross * .115))} · Урьдчилгаа: {formatMoney(person.advance)} · Жишээ тооцоо.</p>}
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Төлбөрийн явц</h3>
          <DetailLine label="Олгосон дүн" value={formatMoney(paid)} />
          <DetailLine label="Үлдэгдэл" value={formatMoney(remaining)} strong />
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground"><CalendarDays className="size-3.5" />{paid ? (mode === 'advance' ? '20.11.2026' : '05.12.2026') : 'Гүйлгээ хийгдээгүй'} · {paid > 0 ? 'Жишээ гүйлгээ' : 'Төлбөр хүлээгдэж байна'}</div>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Авлага ба шилжүүлгийн түүх</h3>
          <DetailLine label="Цалингийн авлага / өглөг" value="0 ₮" />
          <DetailLine label="Гүйлгээний түүх" value={paymentHistory.length > 0 ? `${paymentHistory.length} жишээ гүйлгээ` : 'Бүртгэлгүй'} />
          {paymentHistory.length > 0 && <div className="mt-1 space-y-1 border-t border-border pt-2">{paymentHistory.map((item) => <div key={item.sequence} className="flex items-center justify-between gap-3 text-[10px]"><span className="text-muted-foreground">{item.sequence}-р гүйлгээ · {item.date}</span><span className="font-mono font-semibold">{formatMoney(item.amount)}</span></div>)}</div>}
        </div>
      </div>
    </td></tr>}
  </>;
}

function DetailLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-2 py-1.5 text-xs ${strong ? 'mt-1 border-t border-border pt-2 font-bold' : ''}`}><span className="text-muted-foreground">{label}</span><span className="font-mono text-foreground">{value}</span></div>;
}
