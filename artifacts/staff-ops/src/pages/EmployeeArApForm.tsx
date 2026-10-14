import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListJournalPayablesQueryKey, getListJournalReceivablesQueryKey,
  useCreateEmployeePayable, useCreateEmployeeReceivable, useListChartOfAccounts, useListEmployees,
  type JournalPayable, type JournalReceivable,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Modal } from '@/components/ui-primitives';

export type ArApKind = 'receivables' | 'payables';
export type SavedArAp = JournalReceivable | JournalPayable;

const cls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';
const labelCls = 'block space-y-1.5 text-xs font-semibold';

function serverMessage(error: unknown): string {
  const e = error as { data?: { error?: string } | null } | null;
  const detail = typeof e?.data?.error === 'string' ? e.data.error : '';
  return `Хадгалах боломжгүй байна.${detail ? ` ${detail}` : ''} Оруулсан утгууд хэвээр байна, дахин оролдож болно.`;
}

export function EmployeeArApForm({ kind, onClose, onSaved }: { kind: ArApKind; onClose: () => void; onSaved: (row: SavedArAp) => void }) {
  const receivable = kind === 'receivables';
  const qc = useQueryClient();
  const createReceivable = useCreateEmployeeReceivable();
  const createPayable = useCreateEmployeePayable();
  const employees = useListEmployees();
  const accounts = useListChartOfAccounts();
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [counterId, setCounterId] = useState('');
  const [touched, setTouched] = useState(false);

  const active = createReceivable.isPending || createPayable.isPending;
  const failed = receivable ? createReceivable.isError : createPayable.isError;
  const serverError = receivable ? createReceivable.error : createPayable.error;

  const q = search.trim().toLocaleLowerCase('mn-MN');
  const options = useMemo(() => (employees.data ?? [])
    .filter((e) => e.status === 'active' && (!q || e.name.toLocaleLowerCase('mn-MN').includes(q) || String(e.id) === employeeId))
    .sort((a, b) => a.name.localeCompare(b.name, 'mn')), [employees.data, q, employeeId]);
  const counters = useMemo(() => (accounts.data ?? [])
    .filter((a) => a.isActive && a.code !== '1200' && a.code !== '2000')
    .sort((a, b) => a.code.localeCompare(b.code)), [accounts.data]);

  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) >= 0.01 && Number(amount) <= 999999999999.99;
  const errors = {
    employee: !employeeId ? 'Ажилтан сонгоно уу.' : '',
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Огноо сонгоно уу.' : '',
    amount: !amount.trim() ? 'Дүн оруулна уу.' : amountOk ? '' : 'Дүн 0-ээс их, хамгийн ихдээ 2 орны бутархайтай, 999,999,999,999.99-аас хэтрэхгүй байх ёстой.',
    description: !description.trim() ? 'Тайлбар заавал бөглөнө.' : description.length > 500 ? 'Тайлбар 500 тэмдэгтээс хэтрэхгүй.' : '',
    counter: !counterId ? 'Харьцсан дансаа сонгоно уу.' : '',
  };
  const valid = Object.values(errors).every((v) => !v);
  const loadFailed = employees.isError || accounts.isError;
  const loading = employees.isLoading || accounts.isLoading;

  const done = (row: SavedArAp) => {
    const key = kind === 'receivables' ? getListJournalReceivablesQueryKey({ status: 'all' }) : getListJournalPayablesQueryKey({ status: 'all' });
    qc.setQueryData<SavedArAp[]>(key, (cur) => cur ? [row, ...cur.filter((r) => r.id !== row.id)] : cur);
    void qc.invalidateQueries({ queryKey: [kind === 'receivables' ? '/api/journal/receivables' : '/api/journal/payables'] });
    void qc.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] as string).startsWith('/api/journal') });
    onSaved(row);
  };

  const save = () => {
    setTouched(true);
    if (!valid || active) return;
    const data = { employeeId: Number(employeeId), date, amount: Number(Number(amount).toFixed(2)), description: description.trim(), counterAccountId: Number(counterId) };
    if (receivable) createReceivable.mutate({ data }, { onSuccess: done });
    else createPayable.mutate({ data }, { onSuccess: done });
  };

  const err = (m: string) => touched && m ? <span className="block font-normal text-destructive">{m}</span> : null;
  const debit = receivable ? '1200 Авлага' : 'Сонгосон данс';
  const credit = receivable ? 'Сонгосон данс' : '2000 Өглөг';

  return (
    <Modal
      title={receivable ? 'Ажилтны авлага бүртгэх' : 'Ажилтны өглөг бүртгэх'}
      detail="Ажилтан тус бүрээр тусад нь бүртгэнэ. Журналын бичилт автоматаар үүснэ."
      onClose={() => { if (!active) onClose(); }}
    >
      <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        {loading ? <LoadingBlock className="h-40" /> : loadFailed ? (
          <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-ar-ap-form-load-error">
            <span>Ажилтан, дансны жагсаалтыг ачаалж чадсангүй.</span>
            <button type="button" className="font-bold underline" onClick={() => { void employees.refetch(); void accounts.refetch(); }} data-testid="button-retry-ar-ap-form">Дахин оролдох</button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5 text-xs font-semibold">
              <label htmlFor="ar-ap-employee-search">Ажилтан</label>
              <Input id="ar-ap-employee-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ажилтны нэрээр хайх" disabled={active} data-testid="input-ar-ap-employee-search" />
              <select aria-label="Ажилтан сонгох" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={active} className={cls} data-testid="select-ar-ap-employee">
                <option value="">Ажилтан сонгоно уу</option>
                {options.map((e) => <option key={e.id} value={e.id}>{e.name} - {e.role}</option>)}
              </select>
              {options.length === 0 && <span className="block font-normal text-muted-foreground" data-testid="text-ar-ap-employee-empty">Идэвхтэй ажилтан олдсонгүй.</span>}
              {err(errors.employee)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>Огноо<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={active} data-testid="input-ar-ap-date" />{err(errors.date)}</label>
              <label className={labelCls}>Дүн (₮)<Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={active} data-testid="input-ar-ap-amount" />{err(errors.amount)}</label>
            </div>
            <label className={labelCls}>Тайлбар<Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} disabled={active} data-testid="input-ar-ap-description" />{err(errors.description)}</label>
            <label className={labelCls}>Харьцсан данс
              <select value={counterId} onChange={(e) => setCounterId(e.target.value)} disabled={active} className={cls} data-testid="select-ar-ap-counter-account">
                <option value="">Данс сонгоно уу</option>
                {counters.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select>
              {err(errors.counter)}
            </label>
            <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground" data-testid="text-ar-ap-posting-note">
              Журнал: Дебет {debit}, Кредит {credit}. Энэ нь цалин, кассын төлбөр, банкны тулгалтыг өөрчлөхгүй.
            </p>
          </>
        )}
        {failed && <p className="text-xs font-semibold text-destructive" role="alert" data-testid="text-ar-ap-form-error">{serverMessage(serverError)}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={active} data-testid="button-cancel-employee-balance">Болих</Button>
          <Button type="submit" disabled={active || loading || loadFailed} data-testid="button-save-employee-balance">
            {active ? 'Хадгалж байна...' : failed ? 'Дахин оролдох' : 'Хадгалах'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
