import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListBankTransactionJournalReviewQueryKey, getListBankTransactionsQueryKey,
  getListJournalReceivablesQueryKey, getListJournalPayablesQueryKey,
  useGetAuthSession, useListChartOfAccounts, useListEmployees, useListJournalSuppliers, usePostBankTransactionJournal,
  useListJournalReceivables, useListJournalPayables,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Modal } from '@/components/ui-primitives';
import { dateLabel } from '@/lib/app-shared';

export type BankArApRow = {
  id: number; type: 'income' | 'expense'; amount: number; description: string;
  counterparty?: string | null; date?: string; transactionAt?: string;
};

const exactMoney = (value: number) => `${new Intl.NumberFormat('mn-MN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} ₮`;

const cls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';

export function useBankDebtAccess() {
  const session = useGetAuthSession();
  return session.data?.role === 'admin' || session.data?.role === 'accountant';
}

export function BankArApOpenButton({ row, onOpen, disabled, mode = 'create' }: { row: BankArApRow; onOpen: () => void; disabled?: boolean; mode?: 'create' | 'settle' }) {
  const allowed = useBankDebtAccess();
  if (!allowed) return null;
  if (mode === 'settle') {
    const label = row.type === 'income' ? 'Авлагаас хасах' : 'Өглөгөөс хасах';
    return (
      <Button type="button" size="sm" variant="outline" onClick={onOpen} disabled={disabled}
        aria-label={`${row.description} ${label}`} data-testid={`settle-bank-debt-${row.id}`}>{label}</Button>
    );
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={onOpen} disabled={disabled}
      aria-label={`${row.description} шинэ ${row.type === 'expense' ? 'авлага' : 'өглөг'} үүсгэх`}
      data-testid={`button-create-bank-debt-${row.id}`}>
      {row.type === 'expense' ? 'Шинэ авлага үүсгэх' : 'Шинэ өглөг үүсгэх'}
    </Button>
  );
}

function message(error: unknown): string {
  const e = error as { data?: { error?: string } | null; message?: string } | null;
  const detail = typeof e?.data?.error === 'string' ? e.data.error : '';
  const hint = /1500|1510|1800|худалдан авалтын баримт|эд хөрөнгийн|эд хөрөнгө/i.test(detail)
    ? ' Банкны гүйлгээний жагсаалт дээр дансыг зориудаар өөрчилж ангилсны дараа дахин оролдоно уу; систем данс автоматаар солихгүй.' : '';
  return `Бүртгэх боломжгүй байна.${detail ? ` ${detail}` : ''}${hint} Сонгосон утгууд хэвээр байна, дахин оролдож болно.`;
}

function useAfterPosted(row: BankArApRow, onClose: () => void, onSaved?: () => void) {
  const qc = useQueryClient();
  return () => {
    qc.setQueryData<{ id: number }[] | undefined>(getListBankTransactionJournalReviewQueryKey(), (cur) => cur?.filter((r) => r.id !== row.id));
    void qc.invalidateQueries({ queryKey: getListBankTransactionJournalReviewQueryKey() });
    void qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
    void qc.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] as string).startsWith('/api/journal') });
    onSaved?.();
    onClose();
  };
}

function FixedBankFacts({ row }: { row: BankArApRow }) {
  const when = row.date ?? row.transactionAt ?? '';
  return (
    <dl className="grid gap-3 rounded-xl border border-border bg-secondary/35 p-3 text-xs sm:grid-cols-3" data-testid="section-bank-ar-ap-fixed">
      <div><dt className="text-muted-foreground">Банкны огноо</dt><dd className="font-mono font-semibold" data-testid="text-bank-ar-ap-date">{when ? dateLabel(when.slice(0, 10)) : '-'}</dd></div>
      <div><dt className="text-muted-foreground">Дүн</dt><dd className="font-mono font-semibold" data-testid="text-bank-ar-ap-amount">{exactMoney(row.amount)}</dd></div>
      <div className="sm:col-span-3"><dt className="text-muted-foreground">Гүйлгээний утга</dt><dd className="break-words font-semibold" data-testid="text-bank-ar-ap-description">{row.description}{row.counterparty ? ` - ${row.counterparty}` : ''}</dd></div>
    </dl>
  );
}

const cents = (v: number) => Math.round(v * 100);

type Debt = { id: number; partyType: string; partyLabel: string; date?: string; description: string; balance: number };

function BankDebtSettleForm({ row, onClose, onSaved }: { row: BankArApRow; onClose: () => void; onSaved?: () => void }) {
  const income = row.type === 'income';
  const code = income ? '1200' : '2000';
  const allowed = useBankDebtAccess();
  const post = usePostBankTransactionJournal();
  const accounts = useListChartOfAccounts();
  const rp = { status: 'open' as const };
  const recv = useListJournalReceivables(rp, { query: { queryKey: getListJournalReceivablesQueryKey(rp), enabled: income, refetchOnMount: 'always', staleTime: 0 } });
  const pay = useListJournalPayables(rp, { query: { queryKey: getListJournalPayablesQueryKey(rp), enabled: !income, refetchOnMount: 'always', staleTime: 0 } });
  const done = useAfterPosted(row, onClose, onSaved);
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [touched, setTouched] = useState(false);
  const debtQuery = income ? recv : pay;
  const account = accounts.data?.find((a) => a.code === code && a.isActive);
  const bankDate = (row.date ?? row.transactionAt ?? '').slice(0, 10);
  const debts: Debt[] = useMemo(() => income
    ? (recv.data ?? []).map((r) => ({ id: r.id, partyType: r.partyType, partyLabel: r.partyLabel, date: r.date, description: r.description ?? '', balance: r.openAmount }))
    : (pay.data ?? []).map((r) => ({ id: r.id, partyType: r.partyType, partyLabel: r.partyLabel, date: r.date, description: r.description, balance: r.remainingBalance })),
  [income, recv.data, pay.data]);
  const q = search.trim().toLocaleLowerCase('mn-MN');
  const options = debts.filter((d) => !q || String(d.id) === targetId || `${d.partyLabel} ${d.description} ${d.date ?? ''}`.toLocaleLowerCase('mn-MN').includes(q));
  const selected = debts.find((d) => String(d.id) === targetId);
  const typeLabel = (t: string) => (t === 'employee' ? 'Ажилтан' : 'Нийлүүлэгч');
  const early = (d: Debt) => Boolean(d.date && bankDate && bankDate < d.date);
  const over = (d: Debt) => cents(row.amount) > cents(d.balance);
  const loading = accounts.isLoading || debtQuery.isLoading || debtQuery.isFetching;
  const loadFailed = accounts.isError || debtQuery.isError;
  const targetGone = Boolean(targetId) && !selected && !loading;
  const problem = !selected ? (targetGone ? 'Сонгосон өр олдсонгүй эсвэл хаагдсан байна. Жагсаалтаас дахин сонгоно уу.' : 'Хасах өрөө сонгоно уу.')
    : early(selected) ? 'Банкны огноо сонгосон өрийн огнооноос өмнө байна.'
    : over(selected) ? `Банкны дүн (${exactMoney(row.amount)}) өрийн үлдэгдэл (${exactMoney(selected.balance)})-ээс их байна. Нэг гүйлгээг зөвхөн нэг өрөнд бүтнээр хэрэглэнэ.` : '';
  const after = selected ? (cents(selected.balance) - cents(row.amount)) / 100 : null;
  const missingAccount = !loading && !loadFailed && !account;
  const pending = post.isPending;

  const submit = () => {
    setTouched(true);
    if (pending || problem || !account || !allowed || !selected) return;
    const allocation = income ? { kind: 'settle' as const, receivableId: selected.id } : { kind: 'settle' as const, payableId: selected.id };
    post.mutate({ id: row.id, data: { accountId: account.id, allocation } }, { onSuccess: done, onError: () => { void debtQuery.refetch(); } });
  };
  const retry = () => { void accounts.refetch(); void debtQuery.refetch(); };

  return (
    <Modal title={income ? 'Банкны орлогоор авлагаас хасах' : 'Банкны зарлагаар өглөгөөс хасах'}
      detail="Одоо байгаа өрөөс хэсэгчлэн эсвэл бүтнээр хасна. Шинэ өр, зардал, кассын мөр, цалингийн суутгал үүсгэхгүй."
      onClose={() => { if (!pending) onClose(); }}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-bank-settlement">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="text-bank-settlement-notice">
          Журнал: {income ? 'Дебет 1010 Банк, Кредит 1200 Авлага' : 'Дебет 2000 Өглөг, Кредит 1010 Банк'}. Банкны бүх дүн сонгосон нэг өрөнд хэрэглэгдэнэ.
        </div>
        <FixedBankFacts row={row} />
        {loading ? <LoadingBlock className="h-32" /> : loadFailed ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert" data-testid="status-bank-settlement-load-error">
            <span>Данс эсвэл өрийн жагсаалтыг ачаалж чадсангүй.</span>
            <button type="button" className="font-bold underline" onClick={retry} data-testid="button-retry-bank-settlement">Дахин оролдох</button>
          </div>
        ) : missingAccount ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert" data-testid="status-bank-settlement-missing-account">
            Идэвхтэй {code} данс дансны төлөвлөгөөнд олдсонгүй. Данс идэвхжүүлсний дараа дахин оролдоно уу.
          </p>
        ) : debts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground" data-testid="text-bank-settlement-empty">
            Хасах боломжтой нээлттэй {income ? 'авлага' : 'өглөг'} олдсонгүй.
          </p>
        ) : (
          <div className="space-y-1.5 text-xs font-semibold">
            <label htmlFor="bank-settlement-search">{income ? 'Хасах авлага' : 'Хасах өглөг'}</label>
            <Input id="bank-settlement-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Нэр, утга, огноогоор хайх" disabled={pending} data-testid="input-bank-settlement-search" />
            <select aria-label="Өр сонгох" value={selected ? targetId : ''} onChange={(e) => setTargetId(e.target.value)} disabled={pending} className={cls} data-testid="select-bank-settlement-target">
              <option value="">Өр сонгоно уу</option>
              {options.map((d) => (
                <option key={d.id} value={d.id} disabled={early(d)}>
                  {d.partyLabel} ({typeLabel(d.partyType)}) | {d.date ? dateLabel(d.date) : 'огноогүй'} | {d.description || 'утгагүй'} | үлдэгдэл {exactMoney(d.balance)}{early(d) ? ' | банкны огноо өрөөс өмнө' : over(d) ? ' | банкны дүн үлдэгдлээс их' : ''}
                </option>
              ))}
            </select>
            {options.length === 0 && <span className="block font-normal text-muted-foreground" data-testid="text-bank-settlement-no-match">Хайлтад тохирох өр олдсонгүй.</span>}
            {selected && (
              <div className="rounded-lg border border-border bg-secondary/35 px-3 py-2 font-normal" data-testid="text-bank-settlement-balance">
                <p>Одоогийн үлдэгдэл: <span className="font-mono font-semibold">{exactMoney(selected.balance)}</span></p>
                <p>Төлөлтийн дараах үлдэгдэл: <span className="font-mono font-semibold">{after !== null && after >= 0 ? exactMoney(after) : '-'}</span>{after === 0 ? ' (бүрэн хасагдана)' : ''}</p>
              </div>
            )}
            {(touched || (selected && problem)) && problem && <span className="block text-xs text-destructive" role="alert" data-testid="text-bank-settlement-error">{problem}</span>}
          </div>
        )}
        {post.isError && <p className="text-xs font-semibold text-destructive" role="alert" data-testid="text-bank-settlement-server-error">{message(post.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending} data-testid="button-cancel-bank-settlement">Болих</Button>
          <Button type="submit" disabled={pending || loading || loadFailed || !account || !allowed || !selected || Boolean(problem)} data-testid="button-submit-bank-settlement">
            {pending ? 'Бүртгэж байна...' : post.isError ? 'Дахин оролдох' : income ? 'Авлагаас хасах' : 'Өглөгөөс хасах'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BankArApForm({ row, onClose, onSaved, mode = 'create' }: { row: BankArApRow; onClose: () => void; onSaved?: () => void; mode?: 'create' | 'settle' }) {
  if (mode === 'settle') return <BankDebtSettleForm row={row} onClose={onClose} onSaved={onSaved} />;
  return <BankArApCreateForm row={row} onClose={onClose} onSaved={onSaved} />;
}

function BankArApCreateForm({ row, onClose, onSaved }: { row: BankArApRow; onClose: () => void; onSaved?: () => void }) {
  const receivable = row.type === 'expense';
  const code = receivable ? '1200' : '2000';
  const allowed = useBankDebtAccess();
  const post = usePostBankTransactionJournal();
  const done = useAfterPosted(row, onClose, onSaved);
  const employees = useListEmployees();
  const suppliers = useListJournalSuppliers();
  const accounts = useListChartOfAccounts();
  const [partyType, setPartyType] = useState<'employee' | 'supplier'>('employee');
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [touched, setTouched] = useState(false);

  const account = accounts.data?.find((a) => a.code === code && a.isActive);
  const q = search.trim().toLocaleLowerCase('mn-MN');
  const empOptions = useMemo(() => (employees.data ?? [])
    .filter((e) => e.status === 'active' && (!q || e.name.toLocaleLowerCase('mn-MN').includes(q) || String(e.id) === employeeId))
    .sort((a, b) => a.name.localeCompare(b.name, 'mn')), [employees.data, q, employeeId]);
  const supOptions = useMemo(() => [...(suppliers.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'mn')), [suppliers.data]);

  const loading = accounts.isLoading || (partyType === 'employee' ? employees.isLoading : suppliers.isLoading);
  const loadFailed = accounts.isError || (partyType === 'employee' ? employees.isError : suppliers.isError);
  const missingAccount = !loading && !loadFailed && !account;
  const partyError = partyType === 'employee' ? (!employeeId ? 'Ажилтан сонгоно уу.' : '') : (!supplierId ? 'Нийлүүлэгч сонгоно уу.' : '');
  const pending = post.isPending;

  const submit = () => {
    setTouched(true);
    if (pending || partyError || !account || !allowed) return;
    const allocation = partyType === 'employee'
      ? { kind: 'create' as const, partyType: 'employee' as const, employeeId: Number(employeeId) }
      : { kind: 'create' as const, partyType: 'supplier' as const, supplierId: Number(supplierId) };
    post.mutate({ id: row.id, data: { accountId: account.id, allocation } }, {
      onSuccess: done,
      });
  };

  const retry = () => { void accounts.refetch(); void employees.refetch(); void suppliers.refetch(); };

  return (
    <Modal title={receivable ? 'Банкнаас шинэ авлага үүсгэх' : 'Банкнаас шинэ өглөг үүсгэх'}
      detail="Энэ нь ШИНЭ өр үүсгэнэ. Одоо байгаа өрийн төлөлт биш."
      onClose={() => { if (!pending) onClose(); }}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-bank-ar-ap">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="text-bank-ar-ap-new-notice">
          Шинэ {receivable ? 'авлага' : 'өглөг'}: журналд {receivable ? 'Дебет 1200 Авлага' : 'Кредит 2000 Өглөг'} бичигдэнэ. Одоо байгаа {receivable ? 'авлагын төлөлт' : 'өглөгийн төлбөр'} хаахыг энд хийхгүй.
        </div>
        <FixedBankFacts row={row} />
        {loading ? <LoadingBlock className="h-32" /> : loadFailed ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert" data-testid="status-bank-ar-ap-load-error">
            <span>Данс, ажилтан эсвэл нийлүүлэгчийн жагсаалтыг ачаалж чадсангүй.</span>
            <button type="button" className="font-bold underline" onClick={retry} data-testid="button-retry-bank-ar-ap">Дахин оролдох</button>
          </div>
        ) : missingAccount ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert" data-testid="status-bank-ar-ap-missing-account">
            Идэвхтэй {code} данс дансны төлөвлөгөөнд олдсонгүй. Данс идэвхжүүлсний дараа дахин оролдоно уу.
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Талын төрөл" className="grid grid-cols-2 gap-2">
              {(['employee', 'supplier'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={partyType === t} disabled={pending} onClick={() => setPartyType(t)}
                  className={`h-10 rounded-lg border text-sm font-semibold ${partyType === t ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background'}`}
                  data-testid={`button-bank-ar-ap-party-${t}`}>{t === 'employee' ? 'Ажилтан' : 'Нийлүүлэгч'}</button>
              ))}
            </div>
            {partyType === 'employee' ? (
              <div className="space-y-1.5 text-xs font-semibold">
                <label htmlFor="bank-ar-ap-employee-search">Ажилтан</label>
                <Input id="bank-ar-ap-employee-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ажилтны нэрээр хайх" disabled={pending} data-testid="input-bank-ar-ap-employee-search" />
                <select aria-label="Ажилтан сонгох" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={pending} className={cls} data-testid="select-bank-ar-ap-employee">
                  <option value="">Ажилтан сонгоно уу</option>
                  {empOptions.map((e) => <option key={e.id} value={e.id}>{e.name} - {e.role}</option>)}
                </select>
                {empOptions.length === 0 && <span className="block font-normal text-muted-foreground" data-testid="text-bank-ar-ap-employee-empty">Идэвхтэй ажилтан олдсонгүй.</span>}
              </div>
            ) : (
              <label className="block space-y-1.5 text-xs font-semibold">Нийлүүлэгч
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={pending} className={cls} data-testid="select-bank-ar-ap-supplier">
                  <option value="">Нийлүүлэгч сонгоно уу</option>
                  {supOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {supOptions.length === 0 && <span className="block font-normal text-muted-foreground" data-testid="text-bank-ar-ap-supplier-empty">Нийлүүлэгч олдсонгүй.</span>}
              </label>
            )}
            {touched && partyError && <span className="block text-xs text-destructive" data-testid="text-bank-ar-ap-party-error">{partyError}</span>}
          </>
        )}
        {post.isError && <p className="text-xs font-semibold text-destructive" role="alert" data-testid="text-bank-ar-ap-error">{message(post.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending} data-testid="button-cancel-bank-ar-ap">Болих</Button>
          <Button type="submit" disabled={pending || loading || loadFailed || !account || !allowed} data-testid="button-submit-bank-ar-ap">
            {pending ? 'Бүртгэж байна...' : post.isError ? 'Дахин оролдох' : receivable ? 'Шинэ авлага үүсгэх' : 'Шинэ өглөг үүсгэх'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
