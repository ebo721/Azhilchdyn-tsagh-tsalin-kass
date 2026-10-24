import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Search } from 'lucide-react';
import { getGetPartyLedgerQueryKey, getListEmployeesQueryKey, getListJournalSuppliersQueryKey, useGetPartyLedger, useListEmployees, useListJournalSuppliers } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type PType = 'employee' | 'supplier';
type Submitted = { partyType: PType; partyId: number; from: string; to: string };
const dateOk = (v: string) => /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const conclusionText = { receivable: 'Авлагатай (1200)', payable: 'Өглөгтэй (2000)', balanced: 'Тэнцсэн' } as const;
const sourceText = (s: string) => ({
  bank_transaction: 'Банк', cash: 'Касс', payroll: 'Цалин', payroll_advance: 'Урьдчилгаа цалин',
  payroll_receivable: 'Цалингаас авлага суутгал', inventory_purchase: 'Худалдан авалт',
  inventory_purchase_group: 'Худалдан авалтын багц', employee_receivable: 'Ажилтны авлага',
  employee_payable: 'Ажилтны өглөг', receivable: 'Авлага', payable: 'Өглөг',
  reversal: 'Буцаалт', operating_expense: 'Зардал',
} as Record<string, string>)[s] ?? s;

export function PartyLedger() {
  const [partyType, setPartyType] = useState<PType>('employee');
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partyName, setPartyName] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const employees = useListEmployees({ query: { queryKey: getListEmployeesQueryKey(), enabled: partyType === 'employee', refetchOnMount: 'always' } });
  const suppliers = useListJournalSuppliers({ query: { queryKey: getListJournalSuppliersQueryKey(), enabled: partyType === 'supplier', refetchOnMount: 'always' } });
  const options = useMemo(() => {
    const list = partyType === 'employee'
      ? (employees.data ?? []).map((e) => ({ id: e.id, name: e.name }))
      : (suppliers.data ?? []).map((s) => ({ id: s.id, name: s.name }));
    const needle = q.trim().toLowerCase();
    return list.filter((o) => !needle || o.name.toLowerCase().includes(needle)).slice(0, 50);
  }, [partyType, employees.data, suppliers.data, q]);
  const optionsLoading = partyType === 'employee' ? employees.isLoading : suppliers.isLoading;
  const optionsError = partyType === 'employee' ? employees.isError : suppliers.isError;

  const params = submitted ?? { partyType: 'employee' as PType, partyId: 0, from: '', to: '' };
  const ledger = useGetPartyLedger(params, { query: { queryKey: getGetPartyLedgerQueryKey(params), enabled: !!submitted, retry: false } });

  const dirty = !!submitted && (submitted.partyType !== partyType || submitted.partyId !== partyId || submitted.from !== from || submitted.to !== to);
  const data = ledger.data;
  const fresh = !dirty && !!submitted && !!data && data.partyType === submitted.partyType && data.partyId === submitted.partyId && data.from === submitted.from && data.to === submitted.to;

  const search = () => {
    if (!partyId) return setFormError('Тал сонгоно уу.');
    if (!dateOk(from) || !dateOk(to)) return setFormError('Эхлэх, дуусах огноог YYYY-MM-DD хэлбэрээр зөв оруулна уу.');
    if (from > to) return setFormError('Эхлэх огноо дуусах огнооноос хойш байж болохгүй.');
    setFormError('');
    const next = { partyType, partyId, from, to };
    if (submitted && JSON.stringify(next) === JSON.stringify(submitted)) void ledger.refetch();
    else setSubmitted(next);
  };

  const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  return (
    <div className="space-y-4" data-testid="section-party-ledger">
      <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm md:grid-cols-[160px_1fr_150px_150px_auto] md:items-end">
        <div>
          <label htmlFor="pl-type" className="mb-1 block text-xs font-semibold text-muted-foreground">Төрөл</label>
          <select id="pl-type" className={field} value={partyType} data-testid="select-party-ledger-type"
            onChange={(e) => { setPartyType(e.target.value as PType); setPartyId(null); setPartyName(''); setQ(''); }}>
            <option value="employee">Ажилтан</option>
            <option value="supplier">Харилцагч</option>
          </select>
        </div>
        <div>
          <label htmlFor="pl-search" className="mb-1 block text-xs font-semibold text-muted-foreground">Тал {partyName && <span className="text-foreground">— {partyName}</span>}</label>
          <input id="pl-search" className={field} placeholder="Нэрээр хайх…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-party-ledger-search" />
          <div className="mt-1 max-h-36 overflow-y-auto rounded-md border bg-background" role="listbox" data-testid="list-party-ledger-options">
            {optionsLoading ? <p className="p-2 text-xs text-muted-foreground">Ачаалж байна…</p>
              : optionsError ? <p className="p-2 text-xs text-destructive">Жагсаалт ачаалж чадсангүй.</p>
              : options.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Олдсонгүй</p>
              : options.map((o) => (
                <button key={o.id} type="button" role="option" aria-selected={o.id === partyId}
                  onClick={() => { setPartyId(o.id); setPartyName(o.name); }}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${o.id === partyId ? 'bg-primary/10 font-semibold' : ''}`}
                  data-testid={`option-party-ledger-${o.id}`}>{o.name}</button>
              ))}
          </div>
        </div>
        <div>
          <label htmlFor="pl-from" className="mb-1 block text-xs font-semibold text-muted-foreground">Эхлэх</label>
          <input id="pl-from" type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-party-ledger-from" />
        </div>
        <div>
          <label htmlFor="pl-to" className="mb-1 block text-xs font-semibold text-muted-foreground">Дуусах</label>
          <input id="pl-to" type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-party-ledger-to" />
        </div>
        <Button onClick={search} disabled={ledger.isFetching} data-testid="button-party-ledger-search"><Search className="mr-2 size-4" />Хайх</Button>
      </div>
      {formError && <p className="text-sm font-semibold text-destructive" role="alert" data-testid="error-party-ledger-form">{formError}</p>}
      {dirty && <p className="text-xs text-muted-foreground" data-testid="status-party-ledger-stale">Шүүлтүүр өөрчлөгдсөн. Шинэ үр дүн авахын тулд «Хайх» дарна уу.</p>}

      {!submitted ? (
        <div className="rounded-xl border bg-card"><EmptyState title="Харилцагчийн гүйлгээ" detail="Тал болон хугацаа сонгоод «Хайх» дарна уу." icon={Search} /></div>
      ) : ledger.isFetching ? (
        <div className="rounded-xl border bg-card p-8" data-testid="loading-party-ledger"><LoadingBlock className="h-48" /></div>
      ) : ledger.isError ? (
        <div className="rounded-xl border bg-card p-8" data-testid="error-party-ledger"><ErrorBlock onRetry={() => { void ledger.refetch(); }} /></div>
      ) : !fresh || !data ? null : (
        <div className={`space-y-4 ${dirty ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([['opening', 'Эхний үлдэгдэл', data.openingBalance], ['debit', 'Нийт дебит', data.totalDebit], ['credit', 'Нийт кредит', data.totalCredit], ['closing', 'Эцсийн үлдэгдэл', data.closingBalance]] as const).map(([k, l, v]) => (
              <div key={k} className="rounded-xl border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">{l}</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums" data-testid={`text-party-ledger-${k}`}>{money.format(v)}</p>
              </div>
            ))}
          </div>
          <p className={`rounded-lg px-4 py-2 text-sm font-semibold ${data.conclusion === 'receivable'
            ? 'bg-emerald-50 text-emerald-800' : data.conclusion === 'payable'
              ? 'bg-amber-50 text-amber-900' : 'bg-muted text-muted-foreground'}`} data-testid="text-party-ledger-conclusion">
            {data.partyName}: {conclusionText[data.conclusion]} · {data.from} – {data.to}
          </p>
          {data.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="list-party-ledger-warnings">
              {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {data.lines.length === 0 ? <EmptyState title="Гүйлгээ олдсонгүй" detail="Сонгосон хугацаанд бүртгэл алга." icon={Search} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm" data-testid="table-party-ledger">
                  <thead className="border-b bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Огноо</th><th className="px-4 py-3">Эх үүсвэр</th><th className="px-4 py-3">Тайлбар</th>
                      <th className="px-4 py-3">Данс</th><th className="px-4 py-3 text-right">Дебит</th><th className="px-4 py-3 text-right">Кредит</th>
                      <th className="px-4 py-3 text-right">Үлдэгдэл</th><th className="px-4 py-3">Холбоос</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.lines.map((l) => (
                      <tr key={l.id} className={l.affectsBalance ? '' : 'bg-muted/30 text-muted-foreground'} data-testid={`row-party-ledger-${l.id}`}>
                        <td className="px-4 py-3 whitespace-nowrap">{l.date}</td>
                        <td className="px-4 py-3">{sourceText(l.sourceType)}{!l.affectsBalance && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Лавлагаа</span>}</td>
                        <td className="px-4 py-3">{l.description}</td>
                        <td className="px-4 py-3"><span className="font-mono">{l.accountCode}</span> {l.accountName}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{money.format(l.debit)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{money.format(l.credit)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{l.affectsBalance ? money.format(l.balance) : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link href={`/journal?entryId=${l.journalEntryId}`} className="text-primary underline" data-testid={`link-party-ledger-journal-${l.id}`}>Журнал №{l.journalEntryId}</Link>
                          {l.bankTransactionId != null && <Link href={`/bank-transactions?transactionId=${l.bankTransactionId}`} className="ml-3 text-primary underline" data-testid={`link-party-ledger-bank-${l.id}`}>Банк №{l.bankTransactionId}</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {data.unmatchedBankTransactions.length > 0 && (
            <div className="rounded-xl border bg-card p-4" data-testid="section-party-ledger-unmatched">
              <h3 className="mb-2 text-sm font-bold">Холбогдоогүй банкны гүйлгээ</h3>
              <ul className="divide-y text-sm">
                {data.unmatchedBankTransactions.map((b) => (
                  <li key={b.id} className="flex flex-wrap justify-between gap-2 py-2" data-testid={`row-party-ledger-unmatched-${b.id}`}>
                    <span>{b.date} · {b.type} · {b.description}</span>
                    <span className="font-mono tabular-nums">{money.format(b.amount)} <Link href={`/bank-transactions?transactionId=${b.id}`} className="ml-2 text-primary underline">Банк №{b.id}</Link></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.payroll && (
            <div className="rounded-xl border bg-card p-4" data-testid="section-party-ledger-payroll">
              <h3 className="text-sm font-bold">Цалингийн сарын хадгалсан мэдээлэл ({data.payroll.month})</h3>
              <p className="mt-1 text-xs text-muted-foreground">Энэ нь сарын хадгалсан цалингийн тооцоо бөгөөд дээрх өдрөөр таслагдсан журналын гүйлгээнээс тусдаа. Хоёр тооцооны огнооны хязгаар өөр.</p>
              {data.payroll.available ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-3">
                  {([['Эхний үлдэгдэл', data.payroll.openingBalance], ['Олгох', data.payroll.payable], ['Төлсөн', data.payroll.paidAmount], ['Урьдчилгаа', data.payroll.advanceAmount], ['Цалингийн үлдэгдэл', data.payroll.balanceAmount]] as const).map(([l, v]) => (
                    <div key={l}><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-mono tabular-nums">{v == null ? '—' : money.format(v)}</dd></div>
                  ))}
                  <div><dt className="text-xs text-muted-foreground">Зөрүү (журналын эцсийн + цалингийн үлдэгдэл; тэмдэг эсрэг)</dt><dd className="font-mono tabular-nums" data-testid="text-party-ledger-payroll-difference">{data.payroll.difference == null ? '—' : money.format(data.payroll.difference)}</dd></div>
                </dl>
              ) : <p className="mt-2 text-sm" data-testid="text-party-ledger-payroll-note">{data.payroll.note}</p>}
              {data.payroll.available && data.payroll.note && <p className="mt-2 text-xs text-muted-foreground">{data.payroll.note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
