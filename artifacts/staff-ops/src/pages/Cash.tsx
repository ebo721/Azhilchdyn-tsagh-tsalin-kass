import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Link } from 'wouter';
import {
  Activity,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  BookOpen,
  BriefcaseBusiness,
  Copy,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  EyeOff,
  LayoutDashboard,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  PackageOpen,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  CashTransactionType,
  getGetCashSummaryQueryKey,
  getGetDashboardQueryKey,
  getGetAuthSessionQueryKey,
  getGetPayrollAdvanceQueryKey,
  getGetPayrollQueryKey,
  getGetPayrollScheduleQueryKey,
  getListCashTransactionsQueryKey,
  getListBankTransactionsQueryKey,
  getListBankAccountsQueryKey,
  getListBankTransactionCashSuggestionsQueryKey,
  getListBankTransactionJournalReviewQueryKey,
  getListCashClosuresQueryKey,
  getListEmployeesQueryKey,
  getListEmployeeSalaryHistoryQueryKey,
  getListInventoryPurchasesQueryKey,
  getListInventoryItemsQueryKey,
  getListInventoryPurchasePaymentBankSuggestionsQueryKey,
  getListInventorySuppliersQueryKey,
  getListInventoryIssuesQueryKey,
  getListFixedAssetsQueryKey,
  getListDeletionRequestsQueryKey,
  getListUsersQueryKey,
  getListChartOfAccountsQueryKey,
  getListUnclearTransactionsQueryKey,
  useCreateCashTransaction,
  useUpdateCashTransaction,
  useDeleteCashTransaction,
  useCloseCashDay,
  useCreateEmployee,
  useDeleteAttendance,
  useDeleteEmployee,
  useDeleteShift,
  useGetCashSummary,
  useGetAuthSession,
  useGetDashboard,
  useGetHourBalance,
  useGetPayroll,
  useGetPayrollSchedule,
  useUpdatePayrollSchedule,
  useGetPayrollAdvance,
  useListCashTransactions,
  useListBankTransactions,
  useListBankAccounts,
  useListBankTransactionJournalReview,
  useCreateBankAccount,
  useUpdateBankTransactionAccount,
  useListCashClosures,
  useListEmployees,
  useListEmployeeSalaryHistory,
  useListInventoryPurchases,
  useListInventoryPurchasePaymentBankSuggestions,
  useListInventorySuppliers,
  useUpdateInventorySupplier,
  useCreateInventoryPurchase,
  useListInventoryItems,
  useUpdateInventoryItem,
  useUpdateInventoryPurchase,
  useConfirmInventoryPurchasePayment,
  useCancelInventoryPurchasePayment,
  useDeleteInventoryPurchase,
  useReclassifyInventoryPurchaseAsExpense,
  useListInventoryIssues,
  useCreateInventoryIssue,
  useUpdateInventoryIssue,
  useDeleteInventoryIssue,
  useListFixedAssets,
  useCreateFixedAsset,
  useUpdateFixedAsset,
  useDeleteFixedAsset,
  useCreateDeletionRequest,
  useListDeletionRequests,
  useApproveDeletionRequest,
  useCancelDeletionRequest,
  useListShifts,
  useListUsers,
  useListChartOfAccounts,
  useCreateChartOfAccount,
  useUpdateChartOfAccount,
  useDeleteChartOfAccount,
  useListUnclearTransactions,
  getListOperatingExpensesQueryKey,
  getListOperatingExpensePaymentBankSuggestionsQueryKey,
  useListOperatingExpenses,
  useCreateOperatingExpense,
  useUpdateOperatingExpense,
  useListOperatingExpensePaymentBankSuggestions,
  useConfirmOperatingExpensePayment,
  useCancelOperatingExpensePayment,
  useLoginHrManager,
  useLogoutHrManager,
  useRevertPayrollAdvanceApproval,
  useUpsertPayrollAdjustment,
  useApprovePayrollAdvance,
  useUpdateEmployee,
  useUpdateEmployeeSalaryHistory,
  useUpdatePayrollAdvancePayment,
  useUpdateUser,
  useDeleteUser,
  useImportKapitronBankTransactions,
  useLinkBankTransactionToCash,
  useListBankTransactionCashSuggestions,
  useTransferBankTransactionToCash,
  useMarkTransactionUnclear,
  type BankTransactionImportResult,
  type Employee,
  type EmployeeSalaryHistory,
  type CashTransaction,
  type InventoryPurchase,
  type InventoryPurchaseBankSuggestion,
  type InventorySupplier,
  type InventoryItem,
  type InventoryIssue,
  type FixedAsset,
  type PayrollLine,
  type PayrollScheduleInput,
  type User,
  type ChartOfAccount,
  type ChartOfAccountInput,
  type BankTransaction,
  type BankAccount,
  type CashTransactionSuggestion,
  type UnclearTransaction,
  type OperatingExpense,
  type OperatingExpenseBankSuggestion,
} from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading, StatCard } from '@/components/ui-primitives';
import { currentMonth, dateLabel, money, shiftMonth, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
type CashForm = { type: 'income' | 'expense'; category: string; description: string; amount: string; date: string; incomeMonth: string };
const CASH_EXPENSE_CATEGORIES = ['Цалин', 'Хүнсний бараа материал', 'Хангамжийн материал', 'Эд хөрөнгө', 'Үйл ажиллагааны зардал'] as const;

export function AccountLabel({ code, name, className }: { code: string | null; name: string | null; className?: string }) {
  return <p className={cn('text-xs font-medium text-muted-foreground', className)} data-testid="linked-chart-account">
    {code && name ? <>Данс: <span className="font-mono font-bold text-foreground">{code}</span> — <span className="text-foreground">{name}</span></> : 'Данс: Оноогоогүй'}
  </p>;
}

export function CashDayCloseControls() {
  const [date, setDate] = useState(today());
  const closures = useListCashClosures();
  const closeDay = useCloseCashDay();
  const qc = useQueryClient();
  const closed = closures.data?.some((closure) => closure.date === date) ?? false;
  const close = () => {
    if (closed || !window.confirm(`${date} өдрийн кассыг өндөрлөх үү? Өндөрлөсний дараа тухайн өдрийн гүйлгээг засах боломжгүй.`)) return;
    closeDay.mutate({ data: { date } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListCashClosuresQueryKey() }),
    });
  };
  return <div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><input type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} className="h-10 bg-transparent px-3 text-sm outline-none" data-testid="input-cash-close-date" /><Button className="rounded-l-none" variant={closed ? 'outline' : 'default'} disabled={closed || closeDay.isPending || closures.isLoading} onClick={close} data-testid="button-close-cash-day">{closed ? 'Өндөрлөсөн' : closeDay.isPending ? 'Өндөрлөж байна...' : 'Өдөр өндөрлөх'}</Button></div>;
}

export function CashLegacy() {
  const summary = useGetCashSummary();
  const list = useListCashTransactions();
  const create = useCreateCashTransaction();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today(), incomeMonth: currentMonth() } });
  const submit = (v: CashForm) => create.mutate({ data: { type: v.type, category: v.category, description: v.description, amount: Number(v.amount), date: v.date, incomeMonth: v.type === 'income' ? v.incomeMonth : null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); form.reset({ type: 'income', category: '', description: '', amount: '', date: today(), incomeMonth: currentMonth() }); setOpen(false); } });
  return <div className="page-enter"><PageHeading eyebrow="Бэлэн мөнгө / cash desk" title="Касс" detail="Орлого, зарлага, үлдэгдлийн хөдөлгөөнийг өдөр тутамд цэгцтэй хөтөлнө." action={<Button onClick={() => setOpen(true)} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button>} />{summary.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : summary.isError ? <ErrorBlock onRetry={() => summary.refetch()} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Кассын үлдэгдэл" value={money(summary.data?.balance)} meta="Бүх хугацааны цэвэр дүн" icon={WalletCards} tone="gold" /><StatCard label="Нийт орлого" value={money(summary.data?.income)} meta="Бүх орсон мөнгө" icon={ArrowDownLeft} /><StatCard label="Нийт зарлага" value={money(summary.data?.expense)} meta="Бүх гарсан мөнгө" icon={ArrowUpRight} tone="orange" /><StatCard label="Өнөөдрийн цэвэр" value={money((summary.data?.todayIncome ?? 0) - (summary.data?.todayExpense ?? 0))} meta={`Орлого ${money(summary.data?.todayIncome)}`} icon={CalendarDays} tone="blue" /></div>}<section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Cash ledger</p><h2 className="mt-1 text-base font-bold">Сүүлийн гүйлгээ</h2></div>{list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Гүйлгээний түүх хоосон" detail="Эхний орлого эсвэл зарлагаа оруулаарай." icon={WalletCards} /> : <div className="divide-y divide-border">{list.data.map((row) => <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}><span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{row.description}</p>{(row.bankVerifiedAt || row.bankTransactionId) && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Банкны хуулгаар баталгаажсан</span>}</div><p className="mt-0.5 text-xs text-muted-foreground">{row.category} · {dateLabel(row.date)}</p></div><p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p></div>)}</div>}</section>{open && <Modal title="Кассын гүйлгээ" detail="Гүйлгээний төрлийг зөв сонгож, дүнг бүхэл тоогоор оруулна." onClose={() => setOpen(false)}><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash"><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')} data-testid="button-cash-income">Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')} data-testid="button-cash-expense">Зарлага</button></div><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Ангилал<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder="Жишээ: Борлуулалт" data-testid="input-cash-category" /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} data-testid="input-cash-amount" /></label></div><label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} placeholder="Гүйлгээний утга" data-testid="input-cash-description" /></label><label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-cash-date" /></label>{form.watch('type') === 'income' && <label className="block space-y-2 text-xs font-semibold">Хамаарах сар<input type="month" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('incomeMonth', { required: true })} /></label>}<div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-cash">Болих</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-cash">{create.isPending ? 'Хадгалж байна...' : 'Гүйлгээ хадгалах'}</Button></div></form></Form></Modal>}</div>;
}

export function Cash() {
  const session = useGetAuthSession();
  const list = useListCashTransactions();
  const closures = useListCashClosures();
  const create = useCreateCashTransaction();
  const update = useUpdateCashTransaction();
  const deletion = useQueueDeletion();
  const remove = deletion;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CashTransaction | null>(null);
  const [open, setOpen] = useState(false);
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today() } });
  const closedDates = new Set(closures.data?.map((closure) => closure.date) ?? []);
  const cashCategories = CASH_EXPENSE_CATEGORIES;
  const filteredTransactions = (list.data ?? []).filter((row) =>
    (row.type === CashTransactionType.income ? row.incomeMonth === filterMonth : row.date.startsWith(filterMonth))
    && (filterType === 'all' || row.type === filterType)
    && (filterCategory === 'all' || row.category.trim() === filterCategory)
  );
  const filteredIncome = filteredTransactions
    .filter((row) => row.type === CashTransactionType.income)
    .reduce((total, row) => total + Number(row.amount), 0);
  const filteredExpense = filteredTransactions
    .filter((row) => row.type === CashTransactionType.expense)
    .reduce((total, row) => total + Number(row.amount), 0);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const startCreate = () => {
    setEditing(null);
    form.reset({ type: 'income', category: '', description: '', amount: '', date: today(), incomeMonth: currentMonth() });
    setOpen(true);
  };
  const startEdit = (row: CashTransaction) => {
    setEditing(row);
    form.reset({ type: row.type, category: row.type === CashTransactionType.expense ? (row.subcategory ?? 'Бусад') : row.category, description: row.description, amount: String(row.amount), date: row.date, incomeMonth: row.incomeMonth ?? row.date.slice(0, 7) });
    setOpen(true);
  };
  const submit = (values: CashForm) => {
    const options = { onSuccess: () => { refresh(); setOpen(false); setEditing(null); } };
    const data = { type: values.type, category: values.category, description: values.description, amount: Number(values.amount), date: values.date, incomeMonth: values.type === 'income' ? values.incomeMonth : null };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const deleteRow = (row: CashTransaction) => {
    if (!window.confirm(`${row.description} гүйлгээг устгах уу?`)) return;
    deletion.request(`/cash/transactions/${row.id}`, `${row.description} кассын гүйлгээ`);
  };
  return <div className="page-enter">
    <div className="mb-7 flex flex-wrap items-center justify-end gap-2"><CashDayCloseControls /><Button onClick={startCreate} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col justify-between gap-4 border-b border-border px-5 py-4 lg:flex-row lg:items-end">
        <div><h2 className="text-base font-bold">Кассын гүйлгээ</h2><p className="mt-1 text-xs text-muted-foreground">Сар, орлого зарлага болон ангиллаар шүүж харах</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><span className="block text-xs font-semibold">Сар</span><div className="flex items-center overflow-hidden rounded-lg border border-input bg-background"><button type="button" onClick={() => setFilterMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-cash-filter-previous-month"><ChevronRight className="size-4 rotate-180" /></button><label className="relative flex h-10 min-w-32 cursor-pointer items-center justify-center px-3 text-sm font-medium"><span>{mongolianMonthLabel(filterMonth)}</span><input type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Кассын сар сонгох" data-testid="input-cash-filter-month" /></label><button type="button" onClick={() => setFilterMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-cash-filter-next-month"><ChevronRight className="size-4" /></button></div></div>
          <label className="space-y-1 text-xs font-semibold">Төрөл<select value={filterType} onChange={(event) => setFilterType(event.target.value as 'all' | 'income' | 'expense')} className="block h-10 min-w-36 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-cash-filter-type"><option value="all">Бүгд</option><option value="income">Орлого</option><option value="expense">Зарлага</option></select></label>
          <label className="space-y-1 text-xs font-semibold">Ангилал<select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} className="block h-10 min-w-44 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-cash-filter-category"><option value="all">Бүх ангилал</option>{cashCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        </div>
      </div>
      {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !filteredTransactions.length ? <EmptyState title="Шүүлтэд тохирох гүйлгээ алга" detail="Өөр сар эсвэл гүйлгээний төрөл сонгоно уу." icon={WalletCards} /> : <div className="divide-y divide-border">{filteredTransactions.map((row) => {
        const closed = closedDates.has(row.date);
        return <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{row.description}</p><span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800">{row.category}</span>{(row.bankVerifiedAt || row.bankTransactionId) && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Банкны хуулгаар баталгаажсан</span>}</div><p className="mt-0.5 text-xs text-muted-foreground">{dateLabel(row.date)}{row.type === CashTransactionType.income && row.incomeMonth ? ` · ${mongolianMonthLabel(row.incomeMonth)}-ийн орлого` : ''}{closed ? ' · Өндөрлөсөн' : ''}</p><AccountLabel code={row.accountCode} name={row.accountName} className="mt-1" /></div>
          {(session.data?.role === 'admin' || row.editable) && <div className="flex gap-1">{session.data?.role === 'admin' && <Button size="icon" variant="ghost" disabled={closed} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : 'Засах'} onClick={() => startEdit(row)} data-testid={`button-edit-cash-${row.id}`}><Pencil className="size-4" /></Button>}{row.editable && <Button size="icon" variant="ghost" disabled={closed || deletion.isPending} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : 'Устгах хүсэлт'} onClick={() => deleteRow(row)} data-testid={`button-delete-cash-${row.id}`}><Trash2 className="size-4" /></Button>}</div>}
          <p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p>
        </div>;
      })}</div>}
      {!list.isLoading && !list.isError && <div className="grid gap-px border-t-2 border-border bg-border sm:grid-cols-3" data-testid="cash-filter-totals">
        <div className="bg-primary/5 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт орлого</p><p className="mt-1 font-mono text-base font-bold text-primary" data-testid="value-filtered-cash-income">{money(filteredIncome)}</p></div>
        <div className="bg-orange-50 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт зарлага</p><p className="mt-1 font-mono text-base font-bold text-orange-800" data-testid="value-filtered-cash-expense">{money(filteredExpense)}</p></div>
        <div className="bg-secondary/40 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Цэвэр дүн</p><p className={cn('mt-1 font-mono text-base font-bold', filteredIncome - filteredExpense >= 0 ? 'text-primary' : 'text-orange-800')} data-testid="value-filtered-cash-net">{money(filteredIncome - filteredExpense)}</p></div>
      </div>}
    </section>
    {open && <Modal title={editing ? 'Кассын гүйлгээ засах' : 'Кассын гүйлгээ'} detail="Гүйлгээний төрөл, дүн болон огноог оруулна." onClose={() => setOpen(false)}>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash">
        {editing && <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={editing.accountCode} name={editing.accountName} /></div>}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')}>Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')}>Зарлага</button></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">{form.watch('type') === 'expense' ? 'Үйл ажиллагааны зардлын дэд ангилал' : 'Ангилал'}<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder={form.watch('type') === 'expense' ? 'Жишээ: Түрээс' : 'Жишээ: Борлуулалт'} /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} /></label>
        <label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} /></label>
        {form.watch('type') === 'income' && <label className="block space-y-2 text-xs font-semibold">Хамаарах сар<input type="month" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('incomeMonth', { required: true })} data-testid="input-cash-income-month" /></label>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}

export function bankDateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    // The statement timestamp is a bank-local wall-clock value stored without
    // applying an offset. Format its UTC fields so the Excel clock stays exact.
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function BankTransactions() {
  const list = useListBankTransactions();
  const bankAccounts = useListBankAccounts();
  const chartAccounts = useListChartOfAccounts();
  const createBankAccount = useCreateBankAccount();
  const updateTransactionAccount = useUpdateBankTransactionAccount();
  const cashTransactions = useListCashTransactions();
  const importStatement = useImportKapitronBankTransactions();
  const transfer = useTransferBankTransactionToCash();
  const linkToCash = useLinkBankTransactionToCash();
  const deletion = useQueueDeletion();
  const markUnclear = useMarkTransactionUnclear();
  const session = useGetAuthSession();
  const canManage = session.data?.role === 'admin' || session.data?.role === 'accountant';
  const journalReview = useListBankTransactionJournalReview({
    query: {
      queryKey: getListBankTransactionJournalReviewQueryKey(),
      enabled: canManage,
      refetchOnMount: 'always',
    },
  });
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<BankTransactionImportResult | null>(null);
  const [selectedBank, setSelectedBank] = useState<BankTransaction | null>(null);
  const [category, setCategory] = useState('');
  const [incomeMonth, setIncomeMonth] = useState(currentMonth());
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const suggestions = useListBankTransactionCashSuggestions(selectedBank?.id ?? 0, { query: { queryKey: getListBankTransactionCashSuggestionsQueryKey(selectedBank?.id ?? 0), enabled: Boolean(selectedBank) } });
  const pendingJournalReviewCount = journalReview.data?.length ?? 0;
  const filteredBankTransactions = list.data?.filter((transaction) => transaction.transactionAt.slice(0, 7) === filterMonth) ?? [];
  useEffect(() => {
    if (selectedAccountId === null && bankAccounts.data?.length) setSelectedAccountId(bankAccounts.data[0].id);
  }, [bankAccounts.data, selectedAccountId]);
  const categories = useMemo(() => [...new Set((cashTransactions.data ?? [])
    .map((transaction) => transaction.type === CashTransactionType.expense ? transaction.subcategory : transaction.category)
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim()))].sort((a, b) => a.localeCompare(b, 'mn')), [cashTransactions.data]);
  const refreshBankTransactions = () => {
    qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getListBankTransactionJournalReviewQueryKey() });
  };
  const refreshAfterTransfer = () => {
    refreshBankTransactions();
    qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!selectedAccountId) {
      window.alert('Хуулга уншуулах банкны дансаа сонгоно уу.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      window.alert('Зөвхөн .xlsx өргөтгөлтэй Kapitron банкны хуулга сонгоно уу.');
      return;
    }
    setImportResult(null);
    importStatement.mutate({ data: file, params: { bankAccountId: selectedAccountId } }, {
      onSuccess: (result) => {
        setImportResult(result);
        refreshBankTransactions();
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Банкны хуулга уншихад алдаа гарлаа.'),
    });
  };
  const saveBankAccount = () => {
    const nextBankName = bankName.trim();
    const nextAccountNumber = accountNumber.trim();
    if (!nextBankName || !nextAccountNumber) return;
    createBankAccount.mutate({ data: { bankName: nextBankName, accountNumber: nextAccountNumber } }, {
      onSuccess: (created: BankAccount) => {
        qc.invalidateQueries({ queryKey: getListBankAccountsQueryKey() });
        setSelectedAccountId(created.id);
        setBankName('');
        setAccountNumber('');
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Банкны данс хадгалахад алдаа гарлаа.'),
    });
  };
  const openCashTransfer = (row: BankTransaction) => {
    setCategory('');
    setIncomeMonth(row.transactionAt.slice(0, 7));
    setSelectedBank(row);
  };
  const closeCashTransfer = () => {
    setCategory('');
    setIncomeMonth(currentMonth());
    setSelectedBank(null);
  };
  const createCashTransaction = () => {
    const trimmedCategory = category.trim();
    if (!selectedBank || !trimmedCategory) return;
    transfer.mutate({ id: selectedBank.id, data: { category: trimmedCategory, incomeMonth: selectedBank.type === 'income' ? incomeMonth : null } }, {
      onSuccess: () => {
        refreshAfterTransfer();
        closeCashTransfer();
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Кассын гүйлгээ үүсгэхэд алдаа гарлаа.'),
    });
  };
  const linkCashTransaction = (cashTransaction: CashTransactionSuggestion) => {
    if (!selectedBank) return;
    linkToCash.mutate({ id: selectedBank.id, data: { cashTransactionId: cashTransaction.id } }, {
      onSuccess: () => {
        refreshAfterTransfer();
        closeCashTransfer();
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Кассын гүйлгээтэй холбох үед алдаа гарлаа.'),
    });
  };
  const deleteRow = (row: BankTransaction) => {
    if (!window.confirm(`"${row.description || row.counterparty || 'Банкны гүйлгээ'}" гүйлгээг устгах уу?`)) return;
    void deletion.request(`/bank-transactions/${row.id}`, `${row.description || row.counterparty || 'Банкны'} гүйлгээ`).then(refreshBankTransactions);
  };
  const hideAsUnclear = (row: BankTransaction) => {
    if (!window.confirm(`"${row.description || row.counterparty || 'Банкны гүйлгээ'}" гүйлгээг тодорхойгүй болгож нуух уу?`)) return;
    markUnclear.mutate({ source: 'bank', id: row.id }, { onSuccess: refreshBankTransactions });
  };
  const assignTransactionAccount = (row: BankTransaction, value: string) => {
    updateTransactionAccount.mutate({
      id: row.id,
      data: { accountId: value ? Number(value) : null },
    }, {
      onSuccess: refreshBankTransactions,
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Данс онооход алдаа гарлаа.'),
    });
  };
  return <div className="page-enter">
    <PageHeading eyebrow="Kapitron / bank statement" title="Банкны гүйлгээ" detail="Банкны гүйлгээг ижил төстэй кассын мөртэй холбох эсвэл шинээр касст үүсгэнэ." action={canManage ? <>{pendingJournalReviewCount > 0 && <Link href="/bank-transactions/journal-review" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-pending-journal-review">Гүйлгээнүүдийг холбох ({pendingJournalReviewCount})</Link>}<Button variant="outline" onClick={() => setAccountSettingsOpen(true)} data-testid="button-bank-account-settings"><Landmark className="size-4" />Дансны тохиргоо</Button><select value={selectedAccountId ?? ''} onChange={(event) => setSelectedAccountId(Number(event.target.value) || null)} className="h-10 min-w-56 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" aria-label="Хуулга уншуулах банкны данс" data-testid="select-bank-account"><option value="">Данс сонгох</option>{bankAccounts.data?.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountNumber}</option>)}</select><input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importFile} className="sr-only" aria-label="Kapitron банкны хуулга сонгох" data-testid="input-bank-transactions-import" /><Button onClick={() => fileInput.current?.click()} disabled={importStatement.isPending || !selectedAccountId} data-testid="button-import-bank-transactions"><Upload className="size-4" />{importStatement.isPending ? 'Хуулга уншиж байна...' : 'Капитрон банкны хуулга уншуулах'}</Button></> : undefined} />
    {importResult && <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground" role="status" data-testid="bank-import-result">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span><strong>{importResult.totalRead}</strong> гүйлгээ уншсанаас: </span>
        <span><strong>{importResult.recognized}</strong> танигдсан, </span>
        <span><strong>{importResult.unrecognized}</strong> тодорхойгүй байна.</span>
      </div>
      <Link href="/bank-transactions/journal-review" className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-journal-review">
        Журналд шивэх
      </Link>
    </div>}
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-bank-transactions">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-base font-bold">Импортлосон банкны гүйлгээ</h2><p className="mt-1 text-xs text-muted-foreground">Банкны гүйлгээг ижил төстэй кассын мөртэй холбох эсвэл шинээр касст үүсгэж болно. Холбогдсон мөр жагсаалтаас алга болж, кассын мөр банкны хуулгаар баталгаажсан гэж тэмдэглэгдэнэ.</p></div><div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setFilterMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-bank-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(filterMonth)}</span><input type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Банкны гүйлгээний сар сонгох" data-testid="input-bank-filter-month" /></label></div><button type="button" onClick={() => setFilterMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-bank-next-month"><ChevronRight className="size-4" /></button></div></div>
      {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !filteredBankTransactions.length ? <EmptyState title="Сонгосон сард банкны гүйлгээ алга" detail="Өмнөх эсвэл дараагийн сар руу шилжих, эсвэл Kapitron банкны .xlsx хуулгыг уншуулна уу." icon={Landmark} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1360px] text-left" data-testid="table-bank-transactions"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Гүйлгээний огноо</th><th className="px-5 py-3">Төрөл</th><th className="px-5 py-3">Банк</th><th className="px-5 py-3">Өөрийн данс</th><th className="px-5 py-3">Харьцсан данс</th><th className="px-5 py-3">Гүйлгээний утга</th><th className="px-5 py-3">GL данс</th><th className="px-5 py-3 text-right">Дүн</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{filteredBankTransactions.map((row) => {
        const income = row.type === 'income';
        return <tr key={row.id} className="transition-colors hover:bg-secondary/35" data-testid={`row-bank-transaction-${row.id}`}><td className="whitespace-nowrap px-5 py-4 font-mono text-xs">{bankDateTimeLabel(row.transactionAt)}</td><td className="px-5 py-4"><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{income ? 'Орлого' : 'Зарлага'}</span></td><td className="px-5 py-4 text-sm font-semibold">{row.bankName || '—'}</td><td className="whitespace-nowrap px-5 py-4 font-mono text-xs">{row.bankAccountNumber || '—'}</td><td className="max-w-52 px-5 py-4 text-sm">{row.account || '—'}</td><td className="max-w-96 px-5 py-4 text-sm font-medium">{row.description || '—'}</td><td className="px-5 py-4"><AccountLabel code={row.accountCode} name={row.accountName} />{canManage && <select value={row.accountId ?? ''} onChange={(event) => assignTransactionAccount(row, event.target.value)} disabled={updateTransactionAccount.isPending || chartAccounts.isLoading} className="mt-2 h-9 min-w-60 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary" aria-label={`${row.description || 'Банкны гүйлгээний'} GL данс`} data-testid={`select-bank-transaction-account-${row.id}`}><option value="">Данс оноогоогүй</option>{chartAccounts.data?.map((account) => <option key={account.id} value={account.id}>Данс: {account.code} — {account.name}</option>)}</select>}</td><td className={cn('whitespace-nowrap px-5 py-4 text-right font-mono text-sm font-bold', income ? 'text-primary' : 'text-orange-800')}>{income ? '+' : '−'}{money(row.amount)}</td><td className="px-5 py-4"><div className="flex justify-end gap-1">{canManage && <><Button size="sm" variant="outline" disabled={transfer.isPending || linkToCash.isPending} onClick={() => openCashTransfer(row)} aria-label={`${row.description || 'Банкны гүйлгээг'} касс руу шилжүүлэх`} data-testid={`button-transfer-bank-transaction-${row.id}`}>Касс руу шилжүүлэх</Button>{session.data?.role === 'admin' && <Button size="icon" variant="ghost" disabled={markUnclear.isPending} onClick={() => hideAsUnclear(row)} aria-label={`${row.description || 'Банкны гүйлгээг'} тодорхойгүй болгох`} data-testid={`button-unclear-bank-${row.id}`}><EyeOff className="size-4" /></Button>}<Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteRow(row)} aria-label={`${row.description || 'Банкны гүйлгээг'} устгах`} data-testid={`button-delete-bank-transaction-${row.id}`}><Trash2 className="size-4" /></Button></>}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
    {accountSettingsOpen && <Modal title="Дансны тохиргоо" detail="Банкны нэр болон өөрийн дансны дугаарыг бүртгэнэ." onClose={() => setAccountSettingsOpen(false)}>
      <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Банкны нэр<Input value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Жишээ: Капитрон банк" data-testid="input-bank-name" /></label><label className="space-y-2 text-xs font-semibold">Дансны дугаар<Input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="Дансны дугаар" data-testid="input-bank-account-number" /></label></div><Button className="w-full" onClick={saveBankAccount} disabled={!bankName.trim() || !accountNumber.trim() || createBankAccount.isPending} data-testid="button-save-bank-account">{createBankAccount.isPending ? 'Хадгалж байна...' : 'Данс хадгалах'}</Button><div className="border-t border-border pt-4"><h3 className="mb-3 text-sm font-bold">Бүртгэлтэй данс</h3>{!bankAccounts.data?.length ? <p className="text-sm text-muted-foreground">Данс бүртгэгдээгүй байна.</p> : <div className="space-y-2">{bankAccounts.data.map((account) => <div key={account.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3"><span className="text-sm font-semibold">{account.bankName}</span><span className="font-mono text-xs text-muted-foreground">{account.accountNumber}</span></div>)}</div>}</div></div>
    </Modal>}
    {selectedBank && <Modal title="Касс руу баталгаажуулах" detail="Ижил төстэй кассын гүйлгээтэй холбох эсвэл шинээр касст үүсгэнэ." onClose={closeCashTransfer}>
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); createCashTransaction(); }} data-testid="form-bank-transfer-to-cash">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3 sm:col-span-2"><AccountLabel code={selectedBank.accountCode} name={selectedBank.accountName} /></div>
          <label className="space-y-2 text-xs font-semibold">Банкны огноо<input readOnly value={bankDateTimeLabel(selectedBank.transactionAt)} className="h-10 w-full rounded-lg border border-input bg-muted px-3 font-mono text-sm" aria-label="Банкны огноо" data-testid="input-bank-transfer-date" /></label>
          <label className="space-y-2 text-xs font-semibold">Төрөл<input readOnly value={selectedBank.type === 'income' ? 'Орлого' : 'Зарлага'} className="h-10 w-full rounded-lg border border-input bg-muted px-3 text-sm" aria-label="Банкны гүйлгээний төрөл" data-testid="input-bank-transfer-type" /></label>
          <label className="space-y-2 text-xs font-semibold sm:col-span-2">Гүйлгээний утга<input readOnly value={selectedBank.description} className="h-10 w-full rounded-lg border border-input bg-muted px-3 text-sm" aria-label="Банкны гүйлгээний утга" data-testid="input-bank-transfer-description" /></label>
          <label className="space-y-2 text-xs font-semibold">Дүн<input readOnly value={money(selectedBank.amount)} className="h-10 w-full rounded-lg border border-input bg-muted px-3 font-mono text-sm" aria-label="Банкны гүйлгээний дүн" data-testid="input-bank-transfer-amount" /></label>
        </div>
        <section aria-labelledby="cash-suggestions-title" data-testid="section-bank-cash-suggestions">
          <h3 id="cash-suggestions-title" className="text-sm font-bold">Ижил төстэй кассын гүйлгээ</h3>
          <p className="mt-1 text-xs text-muted-foreground">Огноо, төрөл, тайлбар, дүнгээр санал болгосон холбогдоогүй кассын мөрүүд.</p>
          <div className="mt-3 space-y-3">
            {suggestions.isLoading ? <><LoadingBlock className="h-24" /><LoadingBlock className="h-24" /></> : suggestions.isError ? <ErrorBlock onRetry={() => suggestions.refetch()} /> : !suggestions.data?.length ? <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground" data-testid="empty-bank-cash-suggestions">Холбох ижил төстэй кассын гүйлгээ олдсонгүй.</p> : suggestions.data.map((suggestion) => <article key={suggestion.id} className="rounded-xl border border-border bg-secondary/25 p-4" data-testid={`card-bank-cash-suggestion-${suggestion.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{suggestion.description}</p>{(suggestion.bankVerifiedAt || suggestion.bankTransactionId) && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Банкны хуулгаар баталгаажсан</span>}</div><p className="mt-1 text-xs text-muted-foreground">{dateLabel(suggestion.date)} · {suggestion.type === 'income' ? 'Орлого' : 'Зарлага'} · {suggestion.category}</p><p className="mt-1 text-xs text-muted-foreground">Тохирц: {suggestion.score.toFixed(2)}% ({suggestion.score >= 80 ? 'өндөр' : suggestion.score >= 50 ? 'дунд' : 'бага'})</p></div><div className="shrink-0 text-right"><p className={cn('font-mono text-sm font-bold', suggestion.type === 'income' ? 'text-primary' : 'text-orange-800')}>{suggestion.type === 'income' ? '+' : '−'}{money(suggestion.amount)}</p><Button type="button" size="sm" className="mt-2" disabled={transfer.isPending || linkToCash.isPending} onClick={() => linkCashTransaction(suggestion)} aria-label={`${suggestion.description} кассын гүйлгээтэй холбох`} data-testid={`button-link-bank-transaction-to-cash-${suggestion.id}`}>{linkToCash.isPending ? 'Холбож байна...' : 'Энэ гүйлгээтэй холбох'}</Button></div></div></article>)}
          </div>
        </section>
        <div className="flex items-center gap-3" aria-label="эсвэл"><div className="h-px flex-1 bg-border" /><span className="text-xs font-semibold text-muted-foreground">эсвэл</span><div className="h-px flex-1 bg-border" /></div>
        <section aria-labelledby="create-cash-title">
          <h3 id="create-cash-title" className="text-sm font-bold">Касст шинээр үүсгэх</h3>
          <label className="mt-3 block space-y-2 text-xs font-semibold">{selectedBank.type === 'expense' ? 'Үйл ажиллагааны зардлын дэд ангилал' : 'Ангилал'}<input value={category} onChange={(event) => setCategory(event.target.value)} list="cash-category-options" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" placeholder={selectedBank.type === 'expense' ? 'Жишээ: Түрээс' : 'Ангилал сонгох эсвэл шинээр бичих'} aria-label="Шинэ кассын гүйлгээний ангилал" data-testid="input-bank-transfer-category" required /></label>
          {selectedBank.type === 'income' && <label className="mt-3 block space-y-2 text-xs font-semibold">Хамаарах сар<input type="month" value={incomeMonth} onChange={(event) => setIncomeMonth(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-bank-transfer-income-month" required /></label>}
          <datalist id="cash-category-options">{[...new Set([...categories, 'Захирал'])].map((existingCategory) => <option key={existingCategory} value={existingCategory} />)}</datalist>
        </section>
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={closeCashTransfer} disabled={transfer.isPending || linkToCash.isPending} data-testid="button-cancel-bank-transfer">Болих</Button><Button type="submit" disabled={!category.trim() || (selectedBank.type === 'income' && !incomeMonth) || transfer.isPending || linkToCash.isPending} data-testid="button-confirm-bank-transfer">{transfer.isPending ? 'Үүсгэж байна...' : 'Касст шинээр үүсгэх'}</Button></div>
      </form>
    </Modal>}
  </div>;
}

