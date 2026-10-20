import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading } from '@/components/ui-primitives';
import { CalendarDays, ChevronRight, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import {
  getGetCashSummaryQueryKey, getListBankTransactionsQueryKey, getListCashTransactionsQueryKey,
  getListChartOfAccountsQueryKey, getListOperatingExpensePaymentBankSuggestionsQueryKey, getListOperatingExpensesQueryKey,
  useCancelOperatingExpensePayment, useConfirmOperatingExpensePayment, useCreateOperatingExpense, useGetAuthSession,
  useListChartOfAccounts, useListOperatingExpensePaymentBankSuggestions, useListOperatingExpenses, useUpdateOperatingExpense,
  type OperatingExpense,
} from '@workspace/api-client-react';
import { currentMonth, money, mongolianMonthLabel, shiftMonth, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { ExpenseAccountingBadge, ExpenseAccountingSummary, type AccountingFilter } from '@/components/ExpenseAccountingStatus';

function OperatingExpenseModal({ expense, onClose }: { expense?: OperatingExpense; onClose: () => void }) {
  const isEdit = !!expense;
  const create = useCreateOperatingExpense();
  const update = useUpdateOperatingExpense();
  const qc = useQueryClient();
  const accounts = useListChartOfAccounts();
  const form = useForm({
    defaultValues: {
      description: expense?.description ?? '',
      accountId: expense ? String(expense.accountId) : '',
      date: expense?.date ?? today(),
      amount: String(expense?.amount ?? ''),
    },
  });

  const submit = (values: { description: string; accountId: string; date: string; amount: string }) => {
    const data = { description: values.description, accountId: Number(values.accountId), date: values.date, amount: Number(values.amount) };
    const done = () => { qc.invalidateQueries({ queryKey: getListOperatingExpensesQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); onClose(); };
    if (isEdit && expense) update.mutate({ id: expense.id, data }, { onSuccess: done, onError: (e) => window.alert(e instanceof Error ? e.message : 'Алдаа гарлаа.') });
    else create.mutate({ data }, { onSuccess: done, onError: (e) => window.alert(e instanceof Error ? e.message : 'Алдаа гарлаа.') });
  };

  return (
    <Modal title={isEdit ? 'Зардал засах' : 'Зардал бүртгэх'} detail="Үйл ажиллагааны зардлын мэдээлэл." onClose={onClose}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <label className="block space-y-1.5 text-xs font-semibold">Утга<input className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} data-testid="input-expense-description" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs font-semibold">Зардлын данс<select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('accountId', { required: true })} data-testid="select-expense-account"><option value="">Данс сонгоно уу</option>{accounts.data?.filter((account) => account.type === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
            <label className="block space-y-1.5 text-xs font-semibold">Огноо<input type="date" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-expense-date" /></label>
            <label className="block space-y-1.5 text-xs font-semibold">Дүн<input type="number" min="0" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('amount', { required: true })} data-testid="input-expense-amount" /></label>
          </div>
          <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save-expense">{create.isPending || update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
        </form>
      </Form>
    </Modal>
  );
}

function OperatingExpensePaymentModal({ expense, onClose }: { expense: OperatingExpense; onClose: () => void }) {
  const confirm = useConfirmOperatingExpensePayment();
  const suggestions = useListOperatingExpensePaymentBankSuggestions(expense.id, { query: { queryKey: getListOperatingExpensePaymentBankSuggestionsQueryKey(expense.id) } });
  const qc = useQueryClient();
  const form = useForm({ defaultValues: { date: today(), amount: String(expense.amount), bankTransactionId: 'none' } });
  const selectedBankTransactionId = form.watch('bankTransactionId');

  useEffect(() => {
    if (selectedBankTransactionId !== 'none' && suggestions.data) {
      const suggestion = suggestions.data.find((s) => String(s.id) === selectedBankTransactionId);
      if (suggestion) {
        form.setValue('date', suggestion.transactionAt.slice(0, 10));
        form.setValue('amount', String(suggestion.amount));
      }
    }
  }, [selectedBankTransactionId, suggestions.data, form]);

  const submit = (values: { date: string; amount: string; bankTransactionId: string }) => {
    const data = { date: values.date, amount: Number(values.amount), ...(values.bankTransactionId !== 'none' ? { bankTransactionId: Number(values.bankTransactionId) } : {}) };
    confirm.mutate({ id: expense.id, data }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListOperatingExpensesQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() }); onClose(); },
      onError: (e) => window.alert(e instanceof Error ? e.message : 'Алдаа гарлаа.')
    });
  };

  return (
    <Modal title="Төлбөр төлөх" detail={`"${expense.description}" зардлын төлбөрийг кассаас гаргах.`} onClose={onClose}>
      {suggestions.isLoading ? <div className="space-y-3"><LoadingBlock className="h-14" /></div> : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
            {suggestions.data && suggestions.data.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Төлбөртэй таарч болох банкны гүйлгээнүүд:</p>
                <div className="space-y-2">
                  <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-secondary/50', selectedBankTransactionId === 'none' ? 'border-primary bg-primary/5' : 'border-border')}>
                    <input type="radio" value="none" {...form.register('bankTransactionId')} className="size-4 accent-primary" />
                    <span className="text-sm font-medium">Банкны гүйлгээ сонгохгүй (Касснаас бэлнээр эсвэл дараа холбоно)</span>
                  </label>
                  {suggestions.data.map((s) => (
                    <label key={s.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-secondary/50', selectedBankTransactionId === String(s.id) ? 'border-primary bg-primary/5' : 'border-border')} data-testid={`radio-expense-bank-suggestion-${s.id}`}>
                      <input type="radio" value={String(s.id)} {...form.register('bankTransactionId')} className="size-4 accent-primary" />
                      <div className="flex-1"><div className="flex justify-between"><span className="text-sm font-bold">{money(s.amount)}</span><span className="font-mono text-xs text-muted-foreground">{s.transactionAt.slice(0, 10)}</span></div><p className="mt-1 text-xs text-muted-foreground">{s.description}</p></div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 text-xs font-semibold">Төлбөр хийсэн огноо<input type="date" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50" disabled={selectedBankTransactionId !== 'none'} {...form.register('date', { required: true })} data-testid="input-expense-payment-date" /></label>
              <label className="block space-y-1.5 text-xs font-semibold">Төлсөн дүн<input type="number" min="0" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50" disabled={selectedBankTransactionId !== 'none'} {...form.register('amount', { required: true })} data-testid="input-expense-payment-amount" /></label>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={confirm.isPending} data-testid="button-confirm-expense-payment">{confirm.isPending ? 'Төлж байна...' : 'Төлсөн болгох'}</Button></div>
          </form>
        </Form>
      )}
    </Modal>
  );
}

export function OperatingExpenses() {
  const query = useListOperatingExpenses({ query: { queryKey: getListOperatingExpensesQueryKey(), refetchOnMount: 'always', refetchInterval: 60_000 } });
  const accounts = useListChartOfAccounts();
  const session = useGetAuthSession();
  const isViewer = session.data?.authenticated && session.data.role === 'viewer';
  const qc = useQueryClient();
  const deletion = useQueueDeletion();
  const cancelPayment = useCancelOperatingExpensePayment();
  const [editing, setEditing] = useState<OperatingExpense | 'new' | null>(null);
  const [paying, setPaying] = useState<OperatingExpense | null>(null);
  const [filterAccountId, setFilterAccountId] = useState('all');
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [filterAccounting, setFilterAccounting] = useState<AccountingFilter>('all');
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((account) => [account.id, account])), [accounts.data]);
  const accountExpenses = (query.data ?? [])
    .filter(expense => expense.date.startsWith(`${filterMonth}-`)
      && (filterAccountId === 'all' || String(expense.accountId) === filterAccountId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const filteredExpenses = accountExpenses.filter(expense => filterAccounting === 'all' || expense.accountingStatus === filterAccounting);

  const remove = (expense: OperatingExpense) => {
    if (window.confirm(`"${expense.description}" зардлыг устгах уу?`)) deletion.request(`/operating-expenses/${expense.id}`, `Зардал: ${expense.description}`);
  };

  const onCancelPayment = (expense: OperatingExpense) => {
    if (window.confirm('Энэ зардлын төлбөрийг цуцлах уу? Касс болон банкны холболт сална.')) {
      cancelPayment.mutate({ id: expense.id }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListOperatingExpensesQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() }); },
        onError: (e) => window.alert(e instanceof Error ? e.message : 'Цуцлахад алдаа гарлаа.')
      });
    }
  };

  return (
    <div className="page-enter space-y-6">
      <PageHeading title="Үйл ажиллагааны зардал" detail="Байгууллагын тогтмол болон бусад үйл ажиллагааны зардлын бүртгэл." action={!isViewer && <Button onClick={() => setEditing('new')} disabled={!accounts.data?.some((account) => account.type === 'expense')} data-testid="button-add-expense"><Plus className="mr-2 size-4" />Зардал нэмэх</Button>} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <span className="block text-xs font-semibold">Сар</span>
          <div className="flex w-fit items-center overflow-hidden rounded-lg border border-input bg-background">
            <button type="button" onClick={() => setFilterMonth(value => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-expense-previous-month"><ChevronRight className="size-4 rotate-180" /></button>
            <div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(filterMonth)}</span><input type="month" value={filterMonth} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setFilterMonth(event.target.value); }} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Үйл ажиллагааны зардлын сар сонгох" data-testid="input-expense-filter-month" /></label></div>
            <button type="button" onClick={() => setFilterMonth(value => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-expense-next-month"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        {!query.isLoading && !query.isError && query.data?.length ? <label className="w-full space-y-1 text-xs font-semibold sm:w-auto">Зардлын данс<select value={filterAccountId} onChange={(event) => setFilterAccountId(event.target.value)} className="block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary sm:min-w-64" data-testid="select-operating-expense-category"><option value="all">Бүх данс</option>{(accounts.data ?? []).filter((account) => account.type === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label> : null}
      </div>
      {!query.isLoading && !query.isError && query.data?.length ? <ExpenseAccountingSummary expenses={accountExpenses} selected={filterAccounting} onChange={setFilterAccounting} /> : null}
      {query.isLoading ? <div className="space-y-4"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : query.data?.length ? (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm" data-testid="table-expenses">
            <thead className="border-b border-border bg-secondary/50 text-xs text-muted-foreground">
              <tr><th className="px-5 py-3 font-semibold">Огноо</th><th className="px-5 py-3 font-semibold">Утга</th><th className="px-5 py-3 font-semibold">Ангилал</th><th className="px-5 py-3 text-right font-semibold">Дүн</th><th className="px-5 py-3 text-center font-semibold">Төлбөр</th><th className="px-5 py-3 text-center font-semibold">Бичилт</th>{!isViewer && <th className="px-5 py-3 text-right font-semibold">Үйлдэл</th>}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredExpenses.map((ex) => (
                <tr key={ex.id} className="transition-colors hover:bg-secondary/20" data-testid={`row-expense-${ex.id}`}>
                  <td className="px-5 py-3 font-mono text-xs">{ex.date}</td>
                  <td className="px-5 py-3 font-medium">{ex.description}</td>
                  <td className="px-5 py-3 text-xs">{accountById.get(ex.accountId) ? `${accountById.get(ex.accountId)!.code} — ${accountById.get(ex.accountId)!.name}` : ex.category}</td>
                  <td className="px-5 py-3 text-right font-mono font-bold text-destructive">{money(ex.amount)}</td>
                  <td className="px-5 py-3 text-center">
                    {ex.paymentDate ? (
                      <span className="inline-flex flex-col items-center gap-1"><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary" data-testid={`status-paid-expense-${ex.id}`}>Төлөгдсөн</span><span className="font-mono text-[10px] text-muted-foreground">{ex.paymentDate}</span></span>
                    ) : (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive" data-testid={`status-unpaid-expense-${ex.id}`}>Төлөгдөөгүй</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center"><ExpenseAccountingBadge status={ex.accountingStatus} /></td>
                  {!isViewer && <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {!ex.paymentDate ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setPaying(ex)} data-testid={`button-pay-expense-${ex.id}`}>Төлөх</Button>
                          <Button variant="outline" size="icon" onClick={() => setEditing(ex)} data-testid={`button-edit-expense-${ex.id}`}><Pencil className="size-4" /></Button>
                          <Button variant="outline" size="icon" onClick={() => remove(ex)} disabled={deletion.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-expense-${ex.id}`}><Trash2 className="size-4" /></Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => onCancelPayment(ex)} disabled={cancelPayment.isPending} className="text-destructive hover:text-destructive" data-testid={`button-cancel-payment-expense-${ex.id}`}>Цуцлах</Button>
                      )}
                    </div>
                  </td>}
                </tr>
              ))}
              {!filteredExpenses.length && <tr><td colSpan={isViewer ? 6 : 7} className="px-5 py-10 text-center text-sm text-muted-foreground">Сонгосон сар, данс болон бичилтийн төлөвт тохирох зардал алга.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Зардал бүртгэгдээгүй байна" detail="Шинээр үйл ажиллагааны зардал нэмж бүртгэнэ үү." icon={Receipt} />}
      {editing && <OperatingExpenseModal expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {paying && <OperatingExpensePaymentModal expense={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}