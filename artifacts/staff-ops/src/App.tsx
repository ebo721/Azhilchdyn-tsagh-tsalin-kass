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
  useUpdateBankCashTransactionIncomeMonth,
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
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading, StatCard, StatusPill } from '@/components/ui-primitives';
import { AppShell } from '@/components/AppShell';
import { HourBalance } from '@/pages/HourBalance';
import { Dashboard } from '@/pages/Dashboard';
import { Employees } from '@/pages/Employees';
import { AttendancePage } from '@/pages/Attendance';
import { Payroll } from '@/pages/Payroll';

const queryClient = new QueryClient();

export function useQueueDeletion() {
  const mutation = useCreateDeletionRequest();
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const [directPending, setDirectPending] = useState(false);
  const [directError, setDirectError] = useState(false);
  const request = async (targetPath: string, label: string) => {
    if (session.data?.role === 'admin') {
      setDirectPending(true);
      setDirectError(false);
      try {
        const response = await fetch(`/api${targetPath}`, { method: 'DELETE', credentials: 'include' });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Устгах боломжгүй байна.');
        }
        await qc.invalidateQueries();
        window.alert(`${label} устгагдлаа.`);
      } catch (error) {
        setDirectError(true);
        window.alert(error instanceof Error ? error.message : 'Устгах боломжгүй байна.');
      } finally {
        setDirectPending(false);
      }
      return;
    }
    mutation.mutate({ data: { targetPath, label } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах хүсэлт админы зөвшөөрөл хүлээж байна.');
      },
    });
  };
  return { request, isAdmin: session.data?.role === 'admin', isPending: mutation.isPending || directPending, isError: mutation.isError || directError };
}

export const money = (value = 0) => `${new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 0 }).format(value)} ₮`;
export const dateLabel = (value: string) => {
  const calendarDate = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) {
    const [year, month, day] = value.split('-').map(Number);
    return `${year} оны ${month}-р сарын ${day}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()} оны ${date.getMonth() + 1}-р сарын ${date.getDate()}`;
};
const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => new Date().toISOString().slice(0, 7);
export const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const mongolianWeekdayLabel = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return ['Ням', 'Да', 'Мя', 'Лха', 'Пү', 'Ба', 'Бя'][new Date(year, month - 1, day).getDay()];
};

export const nav = [
  { href: '/', label: 'Статистик', icon: LayoutDashboard },
  { href: '/employees', label: 'Ажилчид', icon: UsersRound },
  { href: '/attendance', label: 'Ирц', icon: Clock3 },
  { href: '/hour-balance', label: 'Цагийн баланс', icon: Timer },
  { href: '/payroll', label: 'Цалин', icon: Banknote },
  { href: '/cash', label: 'Касс', icon: WalletCards },
  { href: '/bank-transactions', label: 'Банкны гүйлгээ', icon: Landmark },
  { href: '/operating-expenses', label: 'Үйл ажиллагааны зардал', icon: Receipt },
  { href: '/inventory', label: 'Бараа материал', icon: PackageOpen },
  { href: '/fixed-assets', label: 'Эд хөрөнгө', icon: BriefcaseBusiness },
  { href: '/deletion-requests', label: 'Устгах хүсэлт', icon: ShieldCheck },
  { href: '/users', label: 'Хэрэглэгчийн тохиргоо', icon: UserRound },
];
type CashForm = { type: 'income' | 'expense'; category: string; description: string; amount: string; date: string; incomeMonth: string };
const CASH_EXPENSE_CATEGORIES = ['Цалин', 'Хүнсний бараа материал', 'Хангамжийн материал', 'Эд хөрөнгө', 'Үйл ажиллагааны зардал'] as const;

function AccountLabel({ code, name, className }: { code: string | null; name: string | null; className?: string }) {
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

function CashLegacy() {
  const summary = useGetCashSummary();
  const list = useListCashTransactions();
  const create = useCreateCashTransaction();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today(), incomeMonth: currentMonth() } });
  const submit = (v: CashForm) => create.mutate({ data: { type: v.type, category: v.category, description: v.description, amount: Number(v.amount), date: v.date, incomeMonth: v.type === 'income' ? v.incomeMonth : null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); form.reset({ type: 'income', category: '', description: '', amount: '', date: today(), incomeMonth: currentMonth() }); setOpen(false); } });
  return <div className="page-enter"><PageHeading eyebrow="Бэлэн мөнгө / cash desk" title="Касс" detail="Орлого, зарлага, үлдэгдлийн хөдөлгөөнийг өдөр тутамд цэгцтэй хөтөлнө." action={<Button onClick={() => setOpen(true)} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button>} />{summary.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : summary.isError ? <ErrorBlock onRetry={() => summary.refetch()} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Кассын үлдэгдэл" value={money(summary.data?.balance)} meta="Бүх хугацааны цэвэр дүн" icon={WalletCards} tone="gold" /><StatCard label="Нийт орлого" value={money(summary.data?.income)} meta="Бүх орсон мөнгө" icon={ArrowDownLeft} /><StatCard label="Нийт зарлага" value={money(summary.data?.expense)} meta="Бүх гарсан мөнгө" icon={ArrowUpRight} tone="orange" /><StatCard label="Өнөөдрийн цэвэр" value={money((summary.data?.todayIncome ?? 0) - (summary.data?.todayExpense ?? 0))} meta={`Орлого ${money(summary.data?.todayIncome)}`} icon={CalendarDays} tone="blue" /></div>}<section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Cash ledger</p><h2 className="mt-1 text-base font-bold">Сүүлийн гүйлгээ</h2></div>{list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Гүйлгээний түүх хоосон" detail="Эхний орлого эсвэл зарлагаа оруулаарай." icon={WalletCards} /> : <div className="divide-y divide-border">{list.data.map((row) => <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}><span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{row.description}</p>{(row.bankVerifiedAt || row.bankTransactionId) && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Банкны хуулгаар баталгаажсан</span>}</div><p className="mt-0.5 text-xs text-muted-foreground">{row.category} · {dateLabel(row.date)}</p></div><p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p></div>)}</div>}</section>{open && <Modal title="Кассын гүйлгээ" detail="Гүйлгээний төрлийг зөв сонгож, дүнг бүхэл тоогоор оруулна." onClose={() => setOpen(false)}><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash"><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')} data-testid="button-cash-income">Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')} data-testid="button-cash-expense">Зарлага</button></div><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Ангилал<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder="Жишээ: Борлуулалт" data-testid="input-cash-category" /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} data-testid="input-cash-amount" /></label></div><label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} placeholder="Гүйлгээний утга" data-testid="input-cash-description" /></label><label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-cash-date" /></label>{form.watch('type') === 'income' && <label className="block space-y-2 text-xs font-semibold">Хамаарах сар<input type="month" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('incomeMonth', { required: true })} /></label>}<div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-cash">Болих</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-cash">{create.isPending ? 'Хадгалж байна...' : 'Гүйлгээ хадгалах'}</Button></div></form></Form></Modal>}</div>;
}

function Cash() {
  const list = useListCashTransactions();
  const closures = useListCashClosures();
  const create = useCreateCashTransaction();
  const update = useUpdateCashTransaction();
  const updateBankIncomeMonth = useUpdateBankCashTransactionIncomeMonth();
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
    if (editing?.transactionKind === 'bank_transaction') {
      updateBankIncomeMonth.mutate({ id: editing.id, data: { incomeMonth: values.incomeMonth } }, options);
      return;
    }
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
          {(row.editable || (row.transactionKind === 'bank_transaction' && row.type === CashTransactionType.income)) && <div className="flex gap-1"><Button size="icon" variant="ghost" disabled={closed} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : row.editable ? 'Засах' : 'Хамаарах сар засах'} onClick={() => startEdit(row)} data-testid={`button-edit-cash-${row.id}`}><Pencil className="size-4" /></Button>{row.editable && <Button size="icon" variant="ghost" disabled={closed || deletion.isPending} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : 'Устгах хүсэлт'} onClick={() => deleteRow(row)} data-testid={`button-delete-cash-${row.id}`}><Trash2 className="size-4" /></Button>}</div>}
          <p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p>
        </div>;
      })}</div>}
      {!list.isLoading && !list.isError && <div className="grid gap-px border-t-2 border-border bg-border sm:grid-cols-3" data-testid="cash-filter-totals">
        <div className="bg-primary/5 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт орлого</p><p className="mt-1 font-mono text-base font-bold text-primary" data-testid="value-filtered-cash-income">{money(filteredIncome)}</p></div>
        <div className="bg-orange-50 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт зарлага</p><p className="mt-1 font-mono text-base font-bold text-orange-800" data-testid="value-filtered-cash-expense">{money(filteredExpense)}</p></div>
        <div className="bg-secondary/40 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Цэвэр дүн</p><p className={cn('mt-1 font-mono text-base font-bold', filteredIncome - filteredExpense >= 0 ? 'text-primary' : 'text-orange-800')} data-testid="value-filtered-cash-net">{money(filteredIncome - filteredExpense)}</p></div>
      </div>}
    </section>
    {open && <Modal title={editing?.transactionKind === 'bank_transaction' ? 'Орлогын хамаарах сар засах' : editing ? 'Кассын гүйлгээ засах' : 'Кассын гүйлгээ'} detail={editing?.transactionKind === 'bank_transaction' ? 'Банкны автомат мэдээлэл өөрчлөгдөхгүй.' : 'Гүйлгээний төрөл, дүн болон огноог оруулна.'} onClose={() => setOpen(false)}>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash">
        {editing && <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={editing.accountCode} name={editing.accountName} /></div>}
        {editing?.transactionKind !== 'bank_transaction' && <><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')}>Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')}>Зарлага</button></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">{form.watch('type') === 'expense' ? 'Үйл ажиллагааны зардлын дэд ангилал' : 'Ангилал'}<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder={form.watch('type') === 'expense' ? 'Жишээ: Түрээс' : 'Жишээ: Борлуулалт'} /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} /></label>
        <label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} /></label></>}
        {form.watch('type') === 'income' && <label className="block space-y-2 text-xs font-semibold">Хамаарах сар<input type="month" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('incomeMonth', { required: true })} data-testid="input-cash-income-month" /></label>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending || updateBankIncomeMonth.isPending}>{create.isPending || update.isPending || updateBankIncomeMonth.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}

function bankDateTimeLabel(value: string) {
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

function BankTransactions() {
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
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skippedDuplicate: number; skippedZero: number } | null>(null);
  const [selectedBank, setSelectedBank] = useState<BankTransaction | null>(null);
  const [category, setCategory] = useState('');
  const [incomeMonth, setIncomeMonth] = useState(currentMonth());
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const suggestions = useListBankTransactionCashSuggestions(selectedBank?.id ?? 0, { query: { queryKey: getListBankTransactionCashSuggestionsQueryKey(selectedBank?.id ?? 0), enabled: Boolean(selectedBank) } });
  const canManage = session.data?.role === 'admin' || session.data?.role === 'accountant';
  const filteredBankTransactions = list.data?.filter((transaction) => transaction.transactionAt.slice(0, 7) === filterMonth) ?? [];
  useEffect(() => {
    if (selectedAccountId === null && bankAccounts.data?.length) setSelectedAccountId(bankAccounts.data[0].id);
  }, [bankAccounts.data, selectedAccountId]);
  const categories = useMemo(() => [...new Set((cashTransactions.data ?? [])
    .map((transaction) => transaction.type === CashTransactionType.expense ? transaction.subcategory : transaction.category)
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim()))].sort((a, b) => a.localeCompare(b, 'mn')), [cashTransactions.data]);
  const refreshBankTransactions = () => qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
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
    <PageHeading eyebrow="Kapitron / bank statement" title="Банкны гүйлгээ" detail="Банкны гүйлгээг ижил төстэй кассын мөртэй холбох эсвэл шинээр касст үүсгэнэ." action={canManage ? <><Button variant="outline" onClick={() => setAccountSettingsOpen(true)} data-testid="button-bank-account-settings"><Landmark className="size-4" />Дансны тохиргоо</Button><select value={selectedAccountId ?? ''} onChange={(event) => setSelectedAccountId(Number(event.target.value) || null)} className="h-10 min-w-56 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" aria-label="Хуулга уншуулах банкны данс" data-testid="select-bank-account"><option value="">Данс сонгох</option>{bankAccounts.data?.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountNumber}</option>)}</select><input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importFile} className="sr-only" aria-label="Kapitron банкны хуулга сонгох" data-testid="input-bank-transactions-import" /><Button onClick={() => fileInput.current?.click()} disabled={importStatement.isPending || !selectedAccountId} data-testid="button-import-bank-transactions"><Upload className="size-4" />{importStatement.isPending ? 'Хуулга уншиж байна...' : 'Капитрон банкны хуулга уншуулах'}</Button></> : undefined} />
    {importResult && <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-foreground" role="status" data-testid="bank-import-result"><span><strong>{importResult.imported}</strong> гүйлгээ импортлогдлоо</span><span><strong>{importResult.skippedDuplicate}</strong> давхардал алгасагдлаа</span><span><strong>{importResult.skippedZero}</strong> тэг дүн алгасагдлаа</span></div>}
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

type FixedAssetForm = { name: string; unitPrice: string; quantity: string; date: string; purchased: boolean };

function FixedAssets() {
  const list = useListFixedAssets();
  const create = useCreateFixedAsset();
  const update = useUpdateFixedAsset();
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const form = useForm<FixedAssetForm>({ defaultValues: { name: '', unitPrice: '', quantity: '1', date: today(), purchased: false } });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListFixedAssetsQueryKey() });
    qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
  };
  const startCreate = () => {
    setEditing(null);
    form.reset({ name: '', unitPrice: '', quantity: '1', date: today(), purchased: false });
    setOpen(true);
  };
  const startEdit = (asset: FixedAsset) => {
    setEditing(asset);
    form.reset({
      name: asset.name,
      unitPrice: String(asset.unitPrice),
      quantity: String(asset.quantity),
      date: asset.date,
      purchased: asset.purchased,
    });
    setOpen(true);
  };
  const submit = (values: FixedAssetForm) => {
    const data = {
      name: values.name,
      unitPrice: Number(values.unitPrice),
      quantity: Number(values.quantity),
      date: values.date,
      purchased: values.purchased,
    };
    const mutation = editing ? update : create;
    mutation.mutate({
      ...(editing ? { id: editing.id } : {}),
      data,
    } as never, {
      onSuccess: () => {
        refresh();
        form.reset({ name: '', unitPrice: '', quantity: '1', date: today(), purchased: false });
        setEditing(null);
        setOpen(false);
      },
    });
  };
  const deleteAsset = (asset: FixedAsset) => {
    if (!window.confirm(`"${asset.name}" хөрөнгийг устгах уу?${asset.purchased ? ' Холбоотой кассын зарлага мөн устна.' : ''}`)) return;
    deletion.request(`/fixed-assets/${asset.id}`, `${asset.name} эд хөрөнгө`);
  };
  return <div className="page-enter">
    <div className="mb-7 flex justify-end"><Button onClick={startCreate} data-testid="button-add-fixed-asset"><Plus className="size-4" />Шинээр нэмэх</Button></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Тоног төхөөрөмж, хөрөнгийн жагсаалт</h2></div>
      {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Эд хөрөнгө бүртгэгдээгүй" detail="Тоног төхөөрөмж эсвэл хөрөнгөө шинээр нэмнэ үү." icon={BriefcaseBusiness} /> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Нэр</th><th className="px-5 py-3 text-right">Үнэ</th><th className="px-5 py-3 text-right">Тоо ширхэг</th><th className="px-5 py-3 text-right">Нийт дүн</th><th className="px-5 py-3">Төлөв</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((asset: FixedAsset) => <tr key={asset.id} data-testid={`row-fixed-asset-${asset.id}`}><td className="px-5 py-4 text-sm font-semibold">{dateLabel(asset.date)}</td><td className="px-5 py-4 text-sm font-semibold">{asset.name}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(asset.unitPrice)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{asset.quantity}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{money(asset.totalAmount)}</td><td className="px-5 py-4"><span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', asset.purchased ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{asset.purchased ? 'Худалдан авсан' : 'Бүртгэсэн'}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => startEdit(asset)} data-testid={`button-edit-fixed-asset-${asset.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteAsset(asset)} data-testid={`button-delete-fixed-asset-${asset.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>}
    </section>
    {open && <Modal title={editing ? 'Эд хөрөнгө засах' : 'Эд хөрөнгө шинээр нэмэх'} detail="Тоног төхөөрөмж, хөрөнгийн мэдээллийг бүртгэнэ." onClose={() => setOpen(false)}>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-fixed-asset">
        <label className="block space-y-2 text-xs font-semibold">Нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('name', { required: true })} data-testid="input-fixed-asset-name" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Үнэ<input type="number" min="0" step="0.01" className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('unitPrice', { required: true, min: 0 })} data-testid="input-fixed-asset-price" /></label><label className="space-y-2 text-xs font-semibold">Тоо ширхэг<input type="number" min="1" step="1" className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('quantity', { required: true, min: 1 })} data-testid="input-fixed-asset-quantity" /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-fixed-asset-date" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 p-4 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" {...form.register('purchased')} data-testid="checkbox-fixed-asset-purchased" /><span>Худалдан авсан</span></label>
        {(create.isError || update.isError) && <p className="text-xs font-semibold text-destructive">Мэдээлэл буруу эсвэл сонгосон өдрийн касс өндөрлөсөн байна.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save-fixed-asset">{create.isPending || update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}

const inventoryUnits = ['ширхэг', 'кг', 'грамм', 'литр', 'мл', 'метр', 'багц', 'хайрцаг'] as const;
const inventoryMaterialTypes = [
  { value: 'food', label: 'Хүнсний бараа материал' },
  { value: 'supply', label: 'Хангамжийн материал' },
] as const;
type InventoryMaterialType = typeof inventoryMaterialTypes[number]['value'];
const inventoryIssuePurposes = ['Түлш', 'УБ гал тогоо', 'Бусад'] as const;
const inventoryPurchasesPerPage = 20;
type InventoryForm = {
  materialType: InventoryMaterialType;
  supplierName: string;
  hasReceipt: boolean;
  date: string;
  items: Array<{ inventoryItemId?: number; name: string; category: string; unit: typeof inventoryUnits[number]; quantity: string; unitPrice: string }>;
};

function Inventory() {
  const purchasesQuery = useListInventoryPurchases();
  const suppliers = useListInventorySuppliers();
  const updateSupplier = useUpdateInventorySupplier();
  const catalog = useListInventoryItems();
  const updateCatalogItem = useUpdateInventoryItem();
  const issues = useListInventoryIssues();
  const create = useCreateInventoryPurchase();
  const update = useUpdateInventoryPurchase();
  const reclassify = useReclassifyInventoryPurchaseAsExpense();
  const chartOfAccounts = useListChartOfAccounts();
  const confirmPurchasePayment = useConfirmInventoryPurchasePayment();
  const cancelPurchasePayment = useCancelInventoryPurchasePayment();
  const deletion = useQueueDeletion();
  const remove = deletion;
  const removeIssue = deletion;
  const createIssue = useCreateInventoryIssue();
  const updateIssue = useUpdateInventoryIssue();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryPurchase | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<InventoryPurchase | null>(null);
  const [paymentPurchase, setPaymentPurchase] = useState<InventoryPurchase | null>(null);
  const [selectedPaymentBank, setSelectedPaymentBank] = useState<InventoryPurchaseBankSuggestion | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<InventorySupplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<InventorySupplier | null>(null);
  const [stockSearch, setStockSearch] = useState('');
  const [materialTypeTab, setMaterialTypeTab] = useState<InventoryMaterialType>('food');
  const [inventoryTab, setInventoryTab] = useState<'stock' | 'purchases' | 'suppliers' | 'issues'>('stock');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [categoryItem, setCategoryItem] = useState<InventoryItem | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<InventoryIssue | null>(null);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseMonth, setPurchaseMonth] = useState(currentMonth());
  const [reclassifyPurchase, setReclassifyPurchase] = useState<InventoryPurchase | null>(null);
  const form = useForm<InventoryForm>({
    defaultValues: { materialType: 'food', supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] },
  });
  const rows = useFieldArray({ control: form.control, name: 'items' });
  const issueForm = useForm<{ inventoryItemId: string; date: string; quantity: string; purpose: string }>({
    defaultValues: { inventoryItemId: '', date: today(), quantity: '', purpose: '' },
  });
  const categoryForm = useForm<{ name: string; category: string }>({ defaultValues: { name: '', category: '' } });
  const reclassifyForm = useForm<{ accountId: string }>({ defaultValues: { accountId: '' } });
  const supplierForm = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const paymentForm = useForm<{ date: string; amount: string }>({ defaultValues: { date: today(), amount: '' } });
  const paymentBankSuggestions = useListInventoryPurchasePaymentBankSuggestions(paymentPurchase?.id ?? 0, {
    query: {
      queryKey: getListInventoryPurchasePaymentBankSuggestionsQueryKey(paymentPurchase?.id ?? 0),
      enabled: Boolean(paymentPurchase),
    },
  });
  const watchedItems = form.watch('items');
  const grandTotal = watchedItems.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const filteredPurchases = purchasesQuery.data?.filter((purchase) =>
    purchase.materialType === materialTypeTab && purchase.date.startsWith(purchaseMonth)
  ) ?? [];
  const filteredPurchaseTotal = filteredPurchases.reduce((total, purchase) => total + purchase.totalAmount, 0);
  const filteredPurchaseAccounts = [...new Map(filteredPurchases
    .filter((purchase) => purchase.accountCode && purchase.accountName)
    .map((purchase) => [purchase.accountId, { code: purchase.accountCode, name: purchase.accountName }])).values()];
  const purchasePageCount = Math.max(1, Math.ceil(filteredPurchases.length / inventoryPurchasesPerPage));
  const paginatedPurchases = filteredPurchases.slice(
    (purchasePage - 1) * inventoryPurchasesPerPage,
    purchasePage * inventoryPurchasesPerPage,
  );
  const query = useMemo(() => {
    if (!purchasesQuery.data) return purchasesQuery;
    const data = new Proxy(filteredPurchases, {
      get(target, property, receiver) {
        if (property === 'map') return paginatedPurchases.map.bind(paginatedPurchases);
        return Reflect.get(target, property, receiver);
      },
    });
    return { ...purchasesQuery, data };
  }, [filteredPurchases, paginatedPurchases, purchasesQuery]);
  useEffect(() => {
    if (purchasePage > purchasePageCount) setPurchasePage(purchasePageCount);
  }, [purchasePage, purchasePageCount]);
  useEffect(() => setPurchasePage(1), [materialTypeTab, purchaseMonth]);
  const openForm = () => {
    setEditing(null);
    form.reset({ materialType: materialTypeTab, supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] });
    setOpen(true);
  };
  const editPurchase = (purchase: InventoryPurchase) => {
    setEditing(purchase);
    form.reset({
      materialType: purchase.materialType,
      supplierName: purchase.supplierName,
      hasReceipt: purchase.hasReceipt,
      date: purchase.date,
      items: purchase.items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit as typeof inventoryUnits[number],
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })),
    });
    setOpen(true);
  };
  const submit = (values: InventoryForm) => {
    const data = {
      materialType: values.materialType,
      supplierName: values.supplierName,
      hasReceipt: values.hasReceipt,
      date: values.date,
      items: values.items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        catalog.refetch();
        setOpen(false);
        setEditing(null);
      },
    };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const editCategory = (item: InventoryItem) => {
    setCategoryItem(item);
    categoryForm.reset({ name: item.name, category: item.category });
  };
  const submitCategory = (values: { name: string; category: string }) => {
    if (!categoryItem) return;
    updateCatalogItem.mutate({ id: categoryItem.id, data: values }, {
      onSuccess: () => {
        catalog.refetch();
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        setCategoryItem(null);
      },
    });
  };
  const filteredCatalog = catalog.data?.filter((item) => item.materialType === materialTypeTab && `${item.name} ${item.category}`.toLocaleLowerCase('mn-MN').includes(stockSearch.toLocaleLowerCase('mn-MN'))) ?? [];
  const selectedItemHistory = selectedItem
    ? query.data?.flatMap((purchase) => purchase.items
      .filter((item) => item.inventoryItemId === selectedItem.id)
      .map((item) => ({ ...item, purchaseId: purchase.id, date: purchase.date }))) ?? []
    : [];
  const deletePurchase = (purchase: InventoryPurchase) => {
    if (!window.confirm(`"${purchase.supplierName}" худалдан авалтыг устгах уу?`)) return;
    deletion.request(`/inventory/purchases/${purchase.id}`, `${purchase.supplierName} · ${money(purchase.totalAmount)}`);
  };
  const openReclassify = (purchase: InventoryPurchase) => {
    setReclassifyPurchase(purchase);
    reclassifyForm.reset({ accountId: '' });
  };
  const submitReclassify = (values: { accountId: string }) => {
    if (!reclassifyPurchase) return;
    reclassify.mutate({ id: reclassifyPurchase.id, data: { accountId: Number(values.accountId) } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getListOperatingExpensesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        setReclassifyPurchase(null);
      },
    });
  };
  const togglePurchasePayment = (purchase: InventoryPurchase, checked: boolean) => {
    if (checked) {
      setSelectedPaymentBank(null);
      setPaymentPurchase(purchase);
      paymentForm.reset({ date: today(), amount: String(purchase.totalAmount) });
      return;
    }
    if (!window.confirm(`"${purchase.supplierName}" худалдан авалтын төлбөрийг цуцлах уу? Кассын зарлага хамт устна.`)) return;
    cancelPurchasePayment.mutate({ id: purchase.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
      },
    });
  };
  const submitPurchasePayment = (values: { date: string; amount: string }) => {
    if (!paymentPurchase) return;
    confirmPurchasePayment.mutate({ id: paymentPurchase.id, data: {
      date: values.date,
      amount: Number(values.amount),
      bankTransactionId: selectedPaymentBank?.id ?? null,
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
        setPaymentPurchase(null);
        setSelectedPaymentBank(null);
      },
    });
  };
  const selectPaymentBank = (suggestion: InventoryPurchaseBankSuggestion) => {
    setSelectedPaymentBank(suggestion);
    paymentForm.setValue('date', suggestion.transactionAt.slice(0, 10), { shouldValidate: true });
    paymentForm.setValue('amount', String(suggestion.amount), { shouldValidate: true });
  };
  const openSupplierEdit = (supplier: InventorySupplier) => {
    setEditingSupplier(supplier);
    supplierForm.reset({ name: supplier.name });
  };
  const submitSupplier = (values: { name: string }) => {
    if (!editingSupplier) return;
    updateSupplier.mutate({ id: editingSupplier.id, data: values }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        setEditingSupplier(null);
      },
    });
  };
  const deleteSupplier = (supplier: InventorySupplier) => {
    if (!window.confirm(`"${supplier.name}" харилцагчийг сангаас устгах уу? Худалдан авалтын түүх устахгүй.`)) return;
    deletion.request(`/inventory/suppliers/${supplier.id}`, `${supplier.name} харилцагч`);
  };
  const selectedSupplierPurchases = selectedSupplier
    ? purchasesQuery.data?.filter((purchase) =>
      purchase.supplierName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('mn-MN')
      === selectedSupplier.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('mn-MN')) ?? []
    : [];
  const openIssueForm = () => {
    setEditingIssue(null);
    issueForm.reset({ inventoryItemId: '', date: today(), quantity: '', purpose: '' });
    setIssueOpen(true);
  };
  const editIssue = (issue: InventoryIssue) => {
    setEditingIssue(issue);
    issueForm.reset({
      inventoryItemId: String(issue.inventoryItemId),
      date: issue.date,
      quantity: String(issue.quantity),
      purpose: issue.purpose,
    });
    setIssueOpen(true);
  };
  const submitIssue = (values: { inventoryItemId: string; date: string; quantity: string; purpose: string }) => {
    const data = {
      inventoryItemId: Number(values.inventoryItemId),
      date: values.date,
      quantity: Number(values.quantity),
      purpose: values.purpose,
    };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryIssuesQueryKey() });
        catalog.refetch();
        setIssueOpen(false);
        setEditingIssue(null);
      },
    };
    if (editingIssue) updateIssue.mutate({ id: editingIssue.id, data }, options);
    else createIssue.mutate({ data }, options);
  };
  const deleteIssue = (issue: InventoryIssue) => {
    if (!window.confirm(`${issue.itemName} барааны ${issue.quantity} ${issue.unit} зарлагыг устгах уу?`)) return;
    deletion.request(`/inventory/issues/${issue.id}`, `${issue.itemName} · ${issue.quantity} ${issue.unit} зарлага`);
  };
  return <div className="page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl bg-secondary p-1"><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'stock' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('stock')} data-testid="tab-inventory-stock">Үлдэгдэл</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'purchases' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('purchases')} data-testid="tab-inventory-purchases">Худалдан авалт</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'suppliers' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('suppliers')} data-testid="tab-inventory-suppliers">Харилцагч</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'issues' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('issues')} data-testid="tab-inventory-issues">Зарлага</button></div>{inventoryTab === 'purchases' ? <Button onClick={openForm} data-testid="button-add-inventory-purchase"><Plus className="size-4" />Худалдан авалт бүртгэх</Button> : inventoryTab === 'issues' ? <Button onClick={openIssueForm} data-testid="button-add-inventory-issue"><Plus className="size-4" />Зарлага гаргах</Button> : null}</div>
    {(inventoryTab === 'stock' || inventoryTab === 'purchases') && <div className="mb-5 inline-flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Бараа материалын төрөл">{inventoryMaterialTypes.map((type) => <button key={type.value} role="tab" aria-selected={materialTypeTab === type.value} className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', materialTypeTab === type.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary')} onClick={() => setMaterialTypeTab(type.value)} data-testid={`tab-inventory-material-${type.value}`}>{type.label}</button>)}</div>}
    {inventoryTab === 'stock' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-base font-bold">Барааны үлдэгдэл</h2><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="pl-9" placeholder="Нэр эсвэл ангиллаар хайх" data-testid="input-search-inventory-stock" /></div></div>
      {catalog.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : catalog.isError ? <ErrorBlock onRetry={() => catalog.refetch()} /> : !filteredCatalog.length ? <EmptyState title="Бараа материал олдсонгүй" detail={stockSearch ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Худалдан авалт бүртгэхэд барааны үлдэгдэл автоматаар үүснэ.'} icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3">Ангилал</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Дүн</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{filteredCatalog.map((item) => <tr key={item.id} className="cursor-pointer transition-colors hover:bg-secondary/40" onClick={() => setSelectedItem(item)} data-testid={`row-inventory-stock-${item.id}`}><td className="px-5 py-3 text-sm font-semibold">{item.name}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{item.quantity}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(item.totalValue)}</td><td className="px-5 py-3 text-right"><Button size="icon" variant="ghost" title="Ангилал засах" onClick={(event) => { event.stopPropagation(); editCategory(item); }} data-testid={`button-edit-inventory-category-${item.id}`}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table></div>}
    </section>}
    {inventoryTab === 'purchases' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap gap-2 border-b border-border bg-secondary/25 px-5 py-3" data-testid="inventory-purchase-linked-accounts">{filteredPurchaseAccounts.length ? filteredPurchaseAccounts.map((account) => <div key={account.code} className="rounded-lg border border-border bg-card px-3 py-2"><AccountLabel code={account.code} name={account.name} /></div>) : <AccountLabel code={null} name={null} />}</div>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold">Худалдан авалтын жагсаалт</h2><p className="mt-1 text-xs text-muted-foreground">Сонгосон сарын нийт: <strong className="font-mono text-primary">{money(filteredPurchaseTotal)}</strong></p></div><div className="flex flex-wrap items-center gap-2"><div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setPurchaseMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-inventory-purchase-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(purchaseMonth)}</span><input type="month" value={purchaseMonth} onChange={(event) => setPurchaseMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Бараа материалын худалдан авалтын сар сонгох" data-testid="input-inventory-purchase-month" /></label></div><button type="button" onClick={() => setPurchaseMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-inventory-purchase-next-month"><ChevronRight className="size-4" /></button></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} бүртгэл</span></div></div>
      {query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : !query.data?.length ? <EmptyState title="Худалдан авалт олдсонгүй" detail="Сонгосон сар болон бараа материалын төрөлд тохирох худалдан авалт алга." icon={PackageOpen} /> : <>
        <div className="divide-y divide-border md:hidden">{query.data.map((purchase) => <article className="p-4" key={purchase.id} data-testid={`inventory-purchase-mobile-${purchase.id}`}><button className="w-full text-left" onClick={() => setSelectedPurchase(purchase)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(purchase.date)}</p></div><p className="shrink-0 font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</p></div></button><label className="mt-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={purchase.paid} onChange={(event) => togglePurchasePayment(purchase, event.target.checked)} disabled={confirmPurchasePayment.isPending || cancelPurchasePayment.isPending} data-testid={`checkbox-inventory-payment-${purchase.id}`} />Төлбөр төлсөн{purchase.paid && <span className="text-muted-foreground">· {dateLabel(purchase.paymentDate!)} · {money(purchase.paymentAmount ?? 0)}</span>}</label><div className="mt-3 flex items-center justify-between gap-2"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)}>Дэлгэрэнгүй</Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Үйл ажиллагааны зардал руу шилжүүлэх" onClick={() => openReclassify(purchase)}><ArrowRightLeft className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)}><Trash2 className="size-4" /></Button></>}</div></div></article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Баримт</th><th className="px-5 py-3 text-right">Үнийн дүн</th><th className="px-5 py-3">Төлбөр</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((purchase) => <tr key={purchase.id} data-testid={`inventory-purchase-${purchase.id}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{purchase.items.length} төрлийн бараа</p></td><td className="px-5 py-4 text-sm">{dateLabel(purchase.date)}</td><td className="px-5 py-4"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</td><td className="px-5 py-4"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={purchase.paid} onChange={(event) => togglePurchasePayment(purchase, event.target.checked)} disabled={confirmPurchasePayment.isPending || cancelPurchasePayment.isPending} data-testid={`checkbox-inventory-payment-${purchase.id}`} /><span>{purchase.paid ? 'Төлсөн' : 'Төлөөгүй'}</span></label>{purchase.paid && <p className="mt-1 text-[10px] text-muted-foreground">{dateLabel(purchase.paymentDate!)} · {money(purchase.paymentAmount ?? 0)}</p>}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)} data-testid={`button-view-inventory-${purchase.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)} data-testid={`button-edit-inventory-${purchase.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Үйл ажиллагааны зардал руу шилжүүлэх" onClick={() => openReclassify(purchase)} data-testid={`button-reclassify-inventory-${purchase.id}`}><ArrowRightLeft className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)} data-testid={`button-delete-inventory-${purchase.id}`}><Trash2 className="size-4" /></Button></>}</div></td></tr>)}</tbody><tfoot className="border-t-2 border-border bg-secondary/35"><tr><td className="px-5 py-3 text-sm font-bold" colSpan={3}>Сонгосон сарын нийт</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary" data-testid="value-inventory-purchase-total">{money(filteredPurchaseTotal)}</td><td colSpan={2} /></tr></tfoot></table></div>
      </>}
    </section>}
    {inventoryTab === 'purchases' && !query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 && <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">{query.data?.length ?? 0} баримтаас {(purchasePage - 1) * inventoryPurchasesPerPage + 1}–{Math.min(purchasePage * inventoryPurchasesPerPage, query.data?.length ?? 0)}-г харуулж байна</p>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button type="button" variant="outline" size="sm" disabled={purchasePage === 1} onClick={() => setPurchasePage((page) => Math.max(1, page - 1))} data-testid="button-inventory-purchases-previous">Өмнөх</Button>
        <span className="min-w-20 text-center font-mono text-xs font-bold">{purchasePage} / {purchasePageCount}</span>
        <Button type="button" variant="outline" size="sm" disabled={purchasePage === purchasePageCount} onClick={() => setPurchasePage((page) => Math.min(purchasePageCount, page + 1))} data-testid="button-inventory-purchases-next">Дараах</Button>
      </div>
    </div>}
    {inventoryTab === 'suppliers' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Харилцагчид</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{suppliers.data?.length ?? 0} харилцагч</span></div>
      {suppliers.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></div> : suppliers.isError ? <ErrorBlock onRetry={() => suppliers.refetch()} /> : !suppliers.data?.length ? <EmptyState title="Харилцагч бүртгэгдээгүй" detail="Худалдан авалт бүртгэхэд харилцагч автоматаар нэмэгдэнэ." icon={PackageOpen} /> : <>
        <div className="divide-y divide-border md:hidden">{suppliers.data.map((supplier: InventorySupplier) => <article key={supplier.id} className="p-4" data-testid={`inventory-supplier-mobile-${supplier.id}`}><h3 className="text-sm font-bold">{supplier.name}</h3><div className="mt-3 grid grid-cols-3 gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт худалдан авалт</p><p className="mt-1 font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Үлдэгдэл төлбөр</p><p className={cn('mt-1 font-mono text-sm font-bold', supplier.unpaidAmount > 0 ? 'text-orange-800' : 'text-muted-foreground')}>{money(supplier.unpaidAmount)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Баримт</p><p className="mt-1 font-mono text-sm font-bold">{supplier.purchaseCount}</p></div></div><div className="mt-3 flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedSupplier(supplier)} data-testid={`button-view-supplier-${supplier.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => openSupplierEdit(supplier)} data-testid={`button-edit-supplier-${supplier.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteSupplier(supplier)} data-testid={`button-delete-supplier-${supplier.id}`}><Trash2 className="size-4" /></Button></div></article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3 text-right">Нийт худалдан авалт</th><th className="px-5 py-3 text-right">Үлдэгдэл төлбөр</th><th className="px-5 py-3 text-right">Худалдан авалтын баримт</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{suppliers.data.map((supplier: InventorySupplier) => <tr key={supplier.id} data-testid={`inventory-supplier-${supplier.id}`}><td className="px-5 py-4 text-sm font-semibold">{supplier.name}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</td><td className={cn('px-5 py-4 text-right font-mono text-sm font-bold', supplier.unpaidAmount > 0 ? 'text-orange-800' : 'text-muted-foreground')}>{money(supplier.unpaidAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{supplier.purchaseCount}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedSupplier(supplier)} data-testid={`button-view-supplier-${supplier.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => openSupplierEdit(supplier)} data-testid={`button-edit-supplier-${supplier.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteSupplier(supplier)} data-testid={`button-delete-supplier-${supplier.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>
      </>}
    </section>}
    {editingSupplier && <Modal title="Харилцагчийн нэр засах" detail="Холбоотой худалдан авалт болон кассын тайлбар шинэ нэртэй хамт шинэчлэгдэнэ." onClose={() => setEditingSupplier(null)}>
      <Form {...supplierForm}><form onSubmit={supplierForm.handleSubmit(submitSupplier)} className="space-y-5" data-testid="form-inventory-supplier-edit"><label className="block space-y-2 text-xs font-semibold">Харилцагчийн нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...supplierForm.register('name', { required: true })} data-testid="input-inventory-supplier-edit-name" /></label>{updateSupplier.isError && <p className="text-xs font-semibold text-destructive">Нэрийг хадгалахад алдаа гарлаа. Ижил нэртэй харилцагч байгаа эсэхийг шалгана уу.</p>}<div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setEditingSupplier(null)}>Болих</Button><Button type="submit" disabled={updateSupplier.isPending}>{updateSupplier.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div></form></Form>
    </Modal>}
    {selectedSupplier && <Modal title={selectedSupplier.name} detail={`${selectedSupplierPurchases.length} худалдан авалт · ${money(selectedSupplierPurchases.reduce((total, purchase) => total + purchase.totalAmount, 0))}`} onClose={() => setSelectedSupplier(null)} wide>
      {!selectedSupplierPurchases.length ? <EmptyState title="Худалдан авалтын түүх алга" detail="Энэ харилцагчтай холбоотой худалдан авалт олдсонгүй." icon={PackageOpen} /> : <div className="max-h-[62vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Огноо</th><th className="px-3 py-2">Баримт</th><th className="px-3 py-2 text-right">Барааны төрөл</th><th className="px-3 py-2 text-right">Нийт дүн</th><th className="px-3 py-2 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{selectedSupplierPurchases.map((purchase) => <tr key={purchase.id}><td className="px-3 py-3 text-sm font-semibold">{dateLabel(purchase.date)}</td><td className="px-3 py-3 text-sm">{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</td><td className="px-3 py-3 text-right font-mono text-sm">{purchase.items.length}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => { setSelectedSupplier(null); setSelectedPurchase(purchase); }}>Худалдан авалт үзэх</Button></td></tr>)}</tbody></table></div></div>}
    </Modal>}
    {paymentPurchase && <Modal title="Худалдан авалтын төлбөр" detail={`${paymentPurchase.supplierName} · Нийт ${money(paymentPurchase.totalAmount)}`} onClose={() => { setPaymentPurchase(null); setSelectedPaymentBank(null); }}>
      <Form {...paymentForm}><form onSubmit={paymentForm.handleSubmit(submitPurchasePayment)} className="space-y-5" data-testid="form-inventory-payment">
        <section aria-labelledby="inventory-bank-suggestions-title">
          <div className="flex items-center justify-between gap-3"><div><h3 id="inventory-bank-suggestions-title" className="text-sm font-bold">Тохирох банкны гүйлгээ</h3><p className="mt-1 text-xs text-muted-foreground">Харилцагч, огноо, дүнгээр эрэмбэлсэн холбогдоогүй зарлагууд.</p></div>{selectedPaymentBank && <Button type="button" size="sm" variant="outline" onClick={() => setSelectedPaymentBank(null)}>Сонголт арилгах</Button>}</div>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1" data-testid="inventory-payment-bank-suggestions">
            {paymentBankSuggestions.isLoading ? <><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></> : paymentBankSuggestions.isError ? <ErrorBlock onRetry={() => paymentBankSuggestions.refetch()} /> : !paymentBankSuggestions.data?.length ? <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Тохирох банкны гүйлгээ олдсонгүй.</p> : paymentBankSuggestions.data.map((suggestion) => {
              const selected = selectedPaymentBank?.id === suggestion.id;
              return <button type="button" key={suggestion.id} onClick={() => selectPaymentBank(suggestion)} className={cn('w-full rounded-xl border p-3 text-left transition-colors', selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40')} data-testid={`button-select-inventory-bank-${suggestion.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{suggestion.description || 'Банкны гүйлгээ'}</p><p className="mt-1 text-xs text-muted-foreground">{bankDateTimeLabel(suggestion.transactionAt)} · Тохирц {suggestion.score.toFixed(2)}%</p></div><div className="shrink-0 text-right"><p className="font-mono text-sm font-bold text-orange-800">−{money(suggestion.amount)}</p>{selected && <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-primary"><Check className="size-3" />Сонгосон</span>}</div></div></button>;
            })}
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Төлсөн огноо<input type="date" readOnly={Boolean(selectedPaymentBank)} className={cn('h-10 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary', selectedPaymentBank ? 'bg-muted' : 'bg-background')} {...paymentForm.register('date', { required: true })} data-testid="input-inventory-payment-date" /></label><label className="space-y-2 text-xs font-semibold">Төлсөн дүн<input type="number" min="0.01" step="0.01" readOnly={Boolean(selectedPaymentBank)} className={cn('h-10 w-full rounded-lg border border-input px-3 font-mono text-sm outline-none focus:border-primary', selectedPaymentBank ? 'bg-muted' : 'bg-background')} {...paymentForm.register('amount', { required: true, min: 0.01 })} data-testid="input-inventory-payment-amount" /></label></div>
        {confirmPurchasePayment.isError && <p className="text-xs font-semibold text-destructive">Төлбөрийг батлах боломжгүй байна. Сонгосон банкны гүйлгээ өөр бүртгэлтэй холбогдсон эсэх болон огноо өндөрлөсөн эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => { setPaymentPurchase(null); setSelectedPaymentBank(null); }} data-testid="button-cancel-inventory-payment">Болих</Button><Button type="submit" disabled={confirmPurchasePayment.isPending} data-testid="button-confirm-inventory-payment">{confirmPurchasePayment.isPending ? 'Баталж байна...' : selectedPaymentBank ? 'Холбож батлах' : 'Банкгүйгээр батлах'}</Button></div>
      </form></Form>
    </Modal>}
    {selectedPurchase && <Modal title={selectedPurchase.supplierName} detail={`${dateLabel(selectedPurchase.date)} · ${selectedPurchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'} · ${money(selectedPurchase.totalAmount)}`} onClose={() => setSelectedPurchase(null)}>
      <div className="mb-4 rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={selectedPurchase.accountCode} name={selectedPurchase.accountName} /></div>
      <div className="max-h-[62vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Барааны нэр</th><th className="px-3 py-2">Ангилал</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт дүн</th></tr></thead><tbody className="divide-y divide-border">{selectedPurchase.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-sm font-semibold">{item.name}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{item.quantity}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(item.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(item.totalAmount)}</td></tr>)}</tbody></table></div></div>
    </Modal>}
    {inventoryTab === 'issues' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Зарлагын жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{issues.data?.length ?? 0} бүртгэл</span></div>
      {issues.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : issues.isError ? <ErrorBlock onRetry={() => issues.refetch()} /> : !issues.data?.length ? <EmptyState title="Зарлага бүртгэгдээгүй" detail="Бараа материалын зарлагыг энд бүртгэнэ." icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3 text-right">Тоо хэмжээ</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3 text-right">Өртөг</th><th className="px-5 py-3">Зориулалт</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{issues.data.map((issue) => <tr key={issue.id} data-testid={`row-inventory-issue-${issue.id}`}><td className="px-5 py-3 text-sm font-semibold">{dateLabel(issue.date)}</td><td className="px-5 py-3 text-sm font-semibold">{issue.itemName}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{issue.quantity}</td><td className="px-5 py-3 text-sm text-muted-foreground">{issue.unit}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(issue.totalCost)}</td><td className="px-5 py-3 text-sm">{issue.purpose}</td><td className="px-5 py-3"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => editIssue(issue)} data-testid={`button-edit-inventory-issue-${issue.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={removeIssue.isPending} onClick={() => deleteIssue(issue)} data-testid={`button-delete-inventory-issue-${issue.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>}
    </section>}
    {selectedItem && <Modal title={selectedItem.name} detail={`${selectedItem.category} · Үлдэгдэл ${selectedItem.quantity} ${selectedItem.unit}`} onClose={() => setSelectedItem(null)}>
      {!selectedItemHistory.length ? <EmptyState title="Худалдан авалтын түүх алга" detail="Энэ бараанд холбогдох худалдан авалт олдсонгүй." icon={PackageOpen} /> : <div className="max-h-[60vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Огноо</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт үнэ</th></tr></thead><tbody className="divide-y divide-border">{selectedItemHistory.map((line) => <tr key={`${line.purchaseId}-${line.id}`}><td className="px-3 py-3 text-sm font-semibold">{dateLabel(line.date)}</td><td className="px-3 py-3 text-right font-mono text-sm">{line.quantity}</td><td className="px-3 py-3 text-sm text-muted-foreground">{line.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(line.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(line.totalAmount)}</td></tr>)}</tbody></table></div></div>}
    </Modal>}
    {categoryItem && <Modal title="Бараа материал засах" detail={`${categoryItem.quantity} ${categoryItem.unit} үлдэгдэлтэй`} onClose={() => setCategoryItem(null)}>
      <Form {...categoryForm}><form onSubmit={categoryForm.handleSubmit(submitCategory)} className="space-y-5" data-testid="form-inventory-category">
        <label className="block space-y-2 text-xs font-semibold">Бараа материалын нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...categoryForm.register('name', { required: true })} data-testid="input-inventory-name-edit" /></label>
        <label className="block space-y-2 text-xs font-semibold">Ангилал<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...categoryForm.register('category', { required: true })} data-testid="input-inventory-category-edit" /></label>
        {updateCatalogItem.isError && <p className="text-xs font-semibold text-destructive">Мэдээллийг хадгалахад алдаа гарлаа. Ижил нэртэй бараа байгаа эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setCategoryItem(null)}>Болих</Button><Button type="submit" disabled={updateCatalogItem.isPending} data-testid="button-save-inventory-category">{updateCatalogItem.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
    {reclassifyPurchase && <Modal title="Үйл ажиллагааны зардал руу шилжүүлэх" detail={`${reclassifyPurchase.supplierName} · ${money(reclassifyPurchase.totalAmount)} — энэ худалдан авалт бараа материалаас хасагдаж, зардал болно.`} onClose={() => setReclassifyPurchase(null)}>
      <Form {...reclassifyForm}><form onSubmit={reclassifyForm.handleSubmit(submitReclassify)} className="space-y-5" data-testid="form-inventory-reclassify">
        <label className="block space-y-2 text-xs font-semibold">Зардлын данс<select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...reclassifyForm.register('accountId', { required: true })} data-testid="select-reclassify-account"><option value="">Данс сонгоно уу</option>{chartOfAccounts.data?.filter((account) => account.type === 'expense').map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
        {reclassify.isError && <p className="text-xs font-semibold text-destructive">Шилжүүлэхэд алдаа гарлаа. Барааны үлдэгдэл аль хэдийн зарлагдсан эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setReclassifyPurchase(null)}>Болих</Button><Button type="submit" disabled={reclassify.isPending} data-testid="button-save-reclassify">{reclassify.isPending ? 'Шилжүүлж байна...' : 'Шилжүүлэх'}</Button></div>
      </form></Form>
    </Modal>}
    {issueOpen && <Modal title={editingIssue ? 'Бараа материалын зарлага засах' : 'Бараа материалын зарлага'} detail="Үлдэгдлээс бараа сонгож, зарлагын мэдээллийг оруулна." onClose={() => setIssueOpen(false)}>
      <Form {...issueForm}><form onSubmit={issueForm.handleSubmit(submitIssue)} className="space-y-5">
        <label className="block space-y-2 text-xs font-semibold">Бараа материал<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('inventoryItemId', { required: true })} data-testid="select-inventory-issue-item"><option value="">Сонгох</option>{catalog.data?.map((item) => <option value={item.id} key={item.id} disabled={item.quantity <= 0}>{item.name} · {item.quantity} {item.unit}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('date', { required: true })} data-testid="input-inventory-issue-date" /></label><label className="space-y-2 text-xs font-semibold">Тоо хэмжээ<input type="number" min="0.001" step="0.001" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...issueForm.register('quantity', { required: true, min: 0.001 })} data-testid="input-inventory-issue-quantity" /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Зориулалт<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('purpose', { required: true })} data-testid="select-inventory-issue-purpose"><option value="">Сонгох</option>{editingIssue?.purpose && !inventoryIssuePurposes.includes(editingIssue.purpose as typeof inventoryIssuePurposes[number]) && <option value={editingIssue.purpose}>{editingIssue.purpose}</option>}{inventoryIssuePurposes.map((purpose) => <option value={purpose} key={purpose}>{purpose}</option>)}</select></label>
        {(createIssue.isError || updateIssue.isError) && <p className="text-xs font-semibold text-destructive">Үлдэгдэл хүрэлцэхгүй эсвэл мэдээлэл буруу байна.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setIssueOpen(false)}>Болих</Button><Button type="submit" disabled={createIssue.isPending || updateIssue.isPending} data-testid="button-save-inventory-issue">{createIssue.isPending || updateIssue.isPending ? 'Хадгалж байна...' : editingIssue ? 'Засварыг хадгалах' : 'Зарлага хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
    {open && <Modal wide fullScreen title={editing ? 'Худалдан авалт засах' : 'Бараа материалын худалдан авалт'} detail="Сангаас хайж сонгох эсвэл шинэ бараа бүртгэнэ." onClose={() => setOpen(false)}>
      {editing && <div className="mb-3 rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={editing.accountCode} name={editing.accountName} /></div>}
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-3">
        <label className="block space-y-2 text-xs font-semibold">Бараа материалын төрөл<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('materialType', { required: true })} data-testid="select-inventory-material-type">{inventoryMaterialTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Харилцагч<input list="inventory-supplier-options" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('supplierName', { required: true })} placeholder="Жишээ: Номин" data-testid="input-inventory-supplier-name" /></label><label className="space-y-2 text-xs font-semibold">Худалдан авалтын огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-inventory-purchase-date" /></label></div>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" {...form.register('hasReceipt')} data-testid="checkbox-inventory-has-receipt" /><span>Баримттай</span></label>
        <datalist id="inventory-supplier-options">{suppliers.data?.map((supplier) => <option value={supplier.name} key={supplier.id} />)}</datalist>
        <datalist id="inventory-catalog-options">{catalog.data?.filter((item) => item.materialType === form.watch('materialType')).map((item) => <option value={item.name} key={item.id}>{item.category} · {item.unit}</option>)}</datalist>
        <div className="space-y-3">{rows.fields.map((field, index) => {
          const item = watchedItems[index];
          const total = (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0);
          const selectCatalogItem = (name: string) => {
            const match = catalog.data?.find((candidate) => candidate.name.toLocaleLowerCase('mn-MN') === name.trim().toLocaleLowerCase('mn-MN'));
            form.setValue(`items.${index}.inventoryItemId`, match?.id);
            if (match) {
              form.setValue(`items.${index}.name`, match.name);
              form.setValue(`items.${index}.category`, match.category);
              form.setValue(`items.${index}.unit`, match.unit as typeof inventoryUnits[number]);
            }
          };
          return <div className="rounded-xl border border-border bg-secondary/20 p-3" key={field.id}>
            <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold">Бараа {index + 1}</span>{rows.fields.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => rows.remove(index)} aria-label={`${index + 1}-р барааг устгах`}><Trash2 className="size-4" /></Button>}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.35fr_1fr_.75fr_1fr]"><label className="space-y-1 text-xs font-semibold">Барааны нэр<input list="inventory-catalog-options" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.name`, { required: true, onChange: (event) => selectCatalogItem(event.target.value) })} placeholder="Сангаас хайх эсвэл шинээр бичих" data-testid={`input-inventory-name-${index}`} /></label><label className="space-y-1 text-xs font-semibold">Ангилал<input className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.category`, { required: true })} placeholder="Мах, Сүү, Ногоо..." data-testid={`input-inventory-category-${index}`} /></label><label className="space-y-1 text-xs font-semibold">Хэмжих нэгж<select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.unit`, { required: true })} data-testid={`select-inventory-unit-${index}`}>{inventoryUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label><label className="space-y-1 text-xs font-semibold">Тоо<input type="number" min="0.001" step="0.001" className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register(`items.${index}.quantity`, { required: true, min: 0.001 })} data-testid={`input-inventory-quantity-${index}`} /></label><label className="space-y-1 text-xs font-semibold sm:col-span-2 lg:col-span-1">Үнэ<input type="number" min="0" step="0.01" className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register(`items.${index}.unitPrice`, { required: true, min: 0 })} data-testid={`input-inventory-price-${index}`} /></label></div>
            <div className="mt-3 flex justify-end text-sm"><span className="text-muted-foreground">Нийт:&nbsp;</span><strong className="font-mono">{money(total)}</strong></div>
          </div>;
        })}</div>
        <Button type="button" variant="outline" className="w-full" onClick={() => rows.append({ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' })} data-testid="button-add-inventory-row"><Plus className="size-4" />Бараа нэмэх</Button>
        <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-3"><span className="text-sm font-bold">Нийт дүн</span><strong className="font-mono text-lg text-primary">{money(grandTotal)}</strong></div>
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save-inventory-purchase">{create.isPending || update.isPending ? 'Хадгалж байна...' : editing ? 'Засварыг хадгалах' : 'Бүртгэх'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}

function DeletionRequests() {
  const list = useListDeletionRequests();
  const approve = useApproveDeletionRequest();
  const cancel = useCancelDeletionRequest();
  const qc = useQueryClient();
  const approveRequest = (id: number, label: string) => {
    if (!window.confirm(`"${label}" устгах хүсэлтийг баталж, одоо устгах уу?`)) return;
    approve.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries();
        window.alert('Устгах үйлдэл амжилттай хийгдлээ.');
      },
      onError: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах боломжгүй байна. Тухайн бүртгэлийн нөхцөлийг шалгана уу.');
      },
    });
  };
  const cancelRequest = (id: number, label: string) => {
    if (!window.confirm(`"${label}" устгах хүсэлтийг цуцлах уу?`)) return;
    cancel.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах хүсэлтийг цуцаллаа.');
      },
    });
  };
  const statusMeta: Record<string, { label: string; className: string }> = {
    pending: { label: 'Хүлээгдэж байна', className: 'border-amber-200 bg-amber-50 text-amber-800' },
    executing: { label: 'Гүйцэтгэж байна', className: 'border-sky-200 bg-sky-50 text-sky-800' },
    completed: { label: 'Устгасан', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    failed: { label: 'Амжилтгүй', className: 'border-red-200 bg-red-50 text-red-800' },
    cancelled: { label: 'Цуцалсан', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  };
  return <div className="page-enter"><section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-base font-bold">Устгах хүсэлтүүд</h2><p className="mt-1 text-xs text-muted-foreground">Баталсны дараа л тухайн бүртгэл бодитоор устна.</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{list.data?.filter((item) => item.status === 'pending').length ?? 0} хүлээгдэж байна</span></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Устгах хүсэлт алга" detail="Устгах үйлдэл хийсэн үед хүсэлт энд харагдана." icon={ShieldCheck} /> : <div className="divide-y divide-border">{list.data.map((request) => { const meta = statusMeta[request.status] ?? statusMeta.pending; return <div key={request.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid={`row-deletion-request-${request.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{request.label}</p><p className="mt-1 text-xs text-muted-foreground">{request.requesterRole} эрхээс · {dateLabel(request.requestedAt)}</p>{request.error && <p className="mt-1 text-xs text-destructive">Устгах нөхцөл хангагдсангүй.</p>}</div><span className={cn('w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold', meta.className)}>{meta.label}</span>{request.status === 'pending' && <div className="flex gap-2"><Button variant="outline" onClick={() => cancelRequest(request.id, request.label)} disabled={cancel.isPending || approve.isPending} data-testid={`button-cancel-deletion-${request.id}`}><X className="size-4" />Цуцлах</Button><Button onClick={() => approveRequest(request.id, request.label)} disabled={approve.isPending || cancel.isPending} data-testid={`button-approve-deletion-${request.id}`}><Check className="size-4" />Баталж устгах</Button></div>}</div>; })}</div>}
  </section></div>;
}

const userRoleLabels: Record<string, string> = {
  admin: 'Админ',
  hr: 'Хүний нөөц (HR)',
  accountant: 'Нягтлан',
  warehouse: 'Агуулах',
  viewer: 'Харах эрхтэй',
};

function UserEditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const update = useUpdateUser();
  const qc = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const save = () => update.mutate({ id: user.id, data: { username, role, ...(newPassword ? { newPassword } : {}) } }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
      onClose();
    },
  });
  return <Modal title="Хэрэглэгч засах" detail="Шинэ нууц үгийг хоосон орхивол өөрчлөгдөхгүй." onClose={onClose}>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold">Нэвтрэх нэр<Input value={username} onChange={(event) => setUsername(event.target.value)} data-testid="input-user-username" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Эрх<select value={role} onChange={(event) => setRole(event.target.value as User['role'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role">{Object.entries(userRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="block space-y-1.5 text-xs font-semibold">Шинэ нууц үг<Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Хоосон бол өөрчлөхгүй" data-testid="input-user-new-password" /><span className="block font-normal text-muted-foreground">Хоосон орхивол нууц үг хэвээр үлдэнэ.</span></label>
      {update.isError && <p className="text-xs font-semibold text-destructive">Хадгалах боломжгүй байна. Нэр болон эрхийн нөхцөлийг шалгана уу.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button onClick={save} disabled={!username.trim() || update.isPending} data-testid="button-save-user">{update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
    </div>
  </Modal>;
}

function UnclearTransactionsSettings() {
  const list = useListUnclearTransactions();
  const sourceLabel = (row: UnclearTransaction) => row.source === 'bank' ? 'Банк' : 'Касс';
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-unclear-transactions">
    <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Тодорхойгүй гүйлгээ</h2><p className="mt-1 text-xs text-muted-foreground">Үндсэн банк болон кассын жагсаалтаас нуусан, database-д хадгалагдсан гүйлгээнүүд.</p></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Тодорхойгүй гүйлгээ алга" detail="Админ гүйлгээг тодорхойгүй болгосон үед энд харагдана." icon={EyeOff} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Эх үүсвэр</th><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Төрөл</th><th className="px-5 py-3">Утга</th><th className="px-5 py-3">Данс / ангилал</th><th className="px-5 py-3 text-right">Дүн</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((row) => <tr key={`${row.source}-${row.id}`} data-testid={`row-unclear-${row.source}-${row.id}`}><td className="px-5 py-4"><span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-bold">{sourceLabel(row)}</span></td><td className="whitespace-nowrap px-5 py-4 font-mono text-xs">{row.source === 'bank' ? bankDateTimeLabel(row.occurredAt) : dateLabel(row.occurredAt)}</td><td className="px-5 py-4 text-sm">{row.type === 'income' ? 'Орлого' : 'Зарлага'}</td><td className="max-w-80 px-5 py-4 text-sm font-medium">{row.description || '—'}</td><td className="px-5 py-4 text-sm text-muted-foreground">{row.account || row.category || '—'}</td><td className={cn('whitespace-nowrap px-5 py-4 text-right font-mono text-sm font-bold', row.type === 'income' ? 'text-primary' : 'text-orange-800')}>{row.type === 'income' ? '+' : '−'}{money(row.amount)}</td></tr>)}</tbody></table></div>}
  </section>;
}

const chartOfAccountTypeLabels: Record<ChartOfAccountInput['type'], string> = {
  asset: 'Хөрөнгө',
  liability: 'Өр төлбөр',
  equity: 'Эздийн өмч',
  revenue: 'Орлого',
  expense: 'Зардал',
};

function ChartOfAccountModal({ account, onClose }: { account?: ChartOfAccount; onClose: () => void }) {
  const create = useCreateChartOfAccount();
  const update = useUpdateChartOfAccount();
  const qc = useQueryClient();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<ChartOfAccountInput['type']>(account?.type ?? 'asset');
  const pending = create.isPending || update.isPending;
  const failed = create.isError || update.isError;
  const save = () => {
    const data = { code: code.trim(), name: name.trim(), type };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListChartOfAccountsQueryKey() });
        onClose();
      },
    };
    if (account) update.mutate({ id: account.id, data }, options);
    else create.mutate({ data }, options);
  };
  return <Modal title={account ? 'Данс засах' : 'Данс нэмэх'} detail="Дансны код зөвхөн тооноос бүрдэнэ." onClose={onClose}>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold">Дансны код<Input inputMode="numeric" pattern="[0-9]*" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="Жишээ: 1000" data-testid="input-chart-account-code" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Дансны нэр<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Жишээ: Бэлэн мөнгө" data-testid="input-chart-account-name" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Дансны төрөл<select value={type} onChange={(event) => setType(event.target.value as ChartOfAccountInput['type'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-chart-account-type">{Object.entries(chartOfAccountTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {failed && <p className="text-xs font-semibold text-destructive">Хадгалах боломжгүй байна. Дансны код давхардсан эсэхийг шалгана уу.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button onClick={save} disabled={!code.trim() || !name.trim() || pending} data-testid="button-save-chart-account">{pending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
    </div>
  </Modal>;
}

function ChartOfAccountsSettings() {
  const list = useListChartOfAccounts();
  const deletion = useDeleteChartOfAccount();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ChartOfAccount | 'new' | null>(null);
  const remove = (account: ChartOfAccount) => {
    if (!window.confirm(`${account.code} — ${account.name} дансыг устгах уу?`)) return;
    deletion.mutate({ id: account.id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListChartOfAccountsQueryKey() }),
      onError: () => window.alert('Дансыг устгах боломжгүй байна.'),
    });
  };
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-chart-of-accounts">
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold">Дансны төлөвлөгөө</h2><p className="mt-1 text-xs text-muted-foreground">Санхүүгийн тайлангийн дансны код, нэр болон төрлийг удирдана.</p></div><Button onClick={() => setEditing('new')} data-testid="button-add-chart-account"><Plus className="size-4" />Данс нэмэх</Button></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Данс бүртгэгдээгүй" detail="Эхний дансаа нэмнэ үү." icon={BookOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Код</th><th className="px-5 py-3">Дансны нэр</th><th className="px-5 py-3">Төрөл</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((account) => <tr key={account.id} data-testid={`row-chart-account-${account.id}`}><td className="px-5 py-4 font-mono text-sm font-bold text-primary">{account.code}</td><td className="px-5 py-4 text-sm font-semibold">{account.name}</td><td className="px-5 py-4"><span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-bold">{chartOfAccountTypeLabels[account.type]}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(account)} data-testid={`button-edit-chart-account-${account.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(account)} disabled={deletion.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-chart-account-${account.id}`}><Trash2 className="size-4" />Устгах</Button></div></td></tr>)}</tbody></table></div>}
    {editing && <ChartOfAccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </section>;
}

function UserSettings() {
  const users = useListUsers();
  const deletion = useDeleteUser();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [section, setSection] = useState<'users' | 'transactions' | 'chart-of-accounts'>('users');
  const remove = (user: User) => {
    if (!window.confirm(`${user.username} хэрэглэгчийг устгах уу?`)) return;
    deletion.mutate({ id: user.id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      onError: () => window.alert('Устгах боломжгүй байна. Өөрийн болон сүүлийн админы бүртгэлийг устгахгүй.'),
    });
  };
  return <div className="page-enter"><PageHeading eyebrow="Admin" title="Хэрэглэгчийн тохиргоо" detail="Хэрэглэгч, тусгай гүйлгээ болон дансны төлөвлөгөөг удирдана." />
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-card p-1"><Button variant={section === 'users' ? 'default' : 'ghost'} onClick={() => setSection('users')} data-testid="button-settings-users"><UsersRound className="size-4" />Хэрэглэгч</Button><Button variant={section === 'transactions' ? 'default' : 'ghost'} onClick={() => setSection('transactions')} data-testid="button-settings-transactions"><Receipt className="size-4" />Гүйлгээ</Button><Button variant={section === 'chart-of-accounts' ? 'default' : 'ghost'} onClick={() => setSection('chart-of-accounts')} data-testid="button-settings-chart-of-accounts"><BookOpen className="size-4" />Дансны төлөвлөгөө</Button></div>
    {section === 'transactions' ? <UnclearTransactionsSettings /> : section === 'chart-of-accounts' ? <ChartOfAccountsSettings /> : <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Бүх хэрэглэгч</h2><p className="mt-1 text-xs text-muted-foreground">Нууц үг хэзээ ч харагдахгүй.</p></div>
      {users.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : users.isError ? <ErrorBlock onRetry={() => users.refetch()} /> : <div className="divide-y divide-border">{users.data?.map((user) => <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" key={user.id} data-testid={`row-user-${user.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{user.username}</p><p className="mt-1 text-xs text-muted-foreground">{userRoleLabels[user.role] ?? user.role}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(user)} disabled={deletion.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-user-${user.id}`}><Trash2 className="size-4" />Устгах</Button></div></div>)}</div>}
    </section>}
    {editing && <UserEditModal user={editing} onClose={() => setEditing(null)} />}
  </div>;
}

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

function OperatingExpenses() {
  const query = useListOperatingExpenses();
  const accounts = useListChartOfAccounts();
  const session = useGetAuthSession();
  const isViewer = session.data?.authenticated && session.data.role === 'viewer';
  const qc = useQueryClient();
  const deletion = useQueueDeletion();
  const cancelPayment = useCancelOperatingExpensePayment();
  const [editing, setEditing] = useState<OperatingExpense | 'new' | null>(null);
  const [paying, setPaying] = useState<OperatingExpense | null>(null);
  const [filterAccountId, setFilterAccountId] = useState('all');
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((account) => [account.id, account])), [accounts.data]);
  const filteredExpenses = (query.data ?? []).filter((expense) => filterAccountId === 'all' || String(expense.accountId) === filterAccountId);

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
      {!query.isLoading && !query.isError && query.data?.length ? <div className="flex justify-end"><label className="space-y-1 text-xs font-semibold">Зардлын данс<select value={filterAccountId} onChange={(event) => setFilterAccountId(event.target.value)} className="block h-10 min-w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-operating-expense-category"><option value="all">Бүх данс</option>{(accounts.data ?? []).filter((account) => account.type === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label></div> : null}
      {query.isLoading ? <div className="space-y-4"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : query.data?.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm" data-testid="table-expenses">
            <thead className="border-b border-border bg-secondary/50 text-xs text-muted-foreground">
              <tr><th className="px-5 py-3 font-semibold">Огноо</th><th className="px-5 py-3 font-semibold">Утга</th><th className="px-5 py-3 font-semibold">Ангилал</th><th className="px-5 py-3 text-right font-semibold">Дүн</th><th className="px-5 py-3 text-center font-semibold">Төлөв</th>{!isViewer && <th className="px-5 py-3 text-right font-semibold">Үйлдэл</th>}</tr>
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
              {!filteredExpenses.length && <tr><td colSpan={isViewer ? 5 : 6} className="px-5 py-10 text-center text-sm text-muted-foreground">Сонгосон дэд ангилалд зардал алга.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Зардал бүртгэгдээгүй байна" detail="Шинээр үйл ажиллагааны зардал нэмж бүртгэнэ үү." icon={Receipt} />}
      {editing && <OperatingExpenseModal expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {paying && <OperatingExpensePaymentModal expense={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function HrLogin() {
  const login = useLoginHrManager();
  const qc = useQueryClient();
  const form = useForm<{ username: string; password: string }>({ defaultValues: { username: '', password: '' } });
  const submit = (values: { username: string; password: string }) => login.mutate({ data: values }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }) });
  return <div className="grid min-h-[100dvh] place-items-center bg-background app-grid p-5"><div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-xl"><div className="mb-6 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground"><LockKeyhole className="size-5" /></div><h1 className="text-2xl font-bold tracking-tight">Нэвтрэх</h1><p className="mt-2 text-sm text-muted-foreground">Өөрийн эрхийн мэдээллээр системд нэвтэрнэ.</p><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="mt-7 space-y-4"><label className="block space-y-2 text-xs font-semibold">Нэвтрэх нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" autoComplete="username" {...form.register('username', { required: true })} data-testid="input-login-username" /></label><label className="block space-y-2 text-xs font-semibold">Нууц үг<input type="password" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" autoComplete="current-password" {...form.register('password', { required: true })} data-testid="input-login-password" /></label>{login.isError && <p className="text-xs font-semibold text-destructive">Нэвтрэх нэр эсвэл нууц үг буруу байна.</p>}<Button type="submit" className="w-full" disabled={login.isPending} data-testid="button-login">{login.isPending ? 'Нэвтэрч байна...' : 'Нэвтрэх'}</Button></form></Form></div></div>;
}

function Router() {
  const [location] = useLocation();
  const [, navigate] = useLocation();
  const session = useGetAuthSession();
  const logout = useLogoutHrManager();
  const role = session.data?.authenticated && (session.data.role === 'hr' || session.data.role === 'admin' || session.data.role === 'accountant' || session.data.role === 'warehouse' || session.data.role === 'viewer') ? session.data.role : null;
  useEffect(() => {
    if (role === 'hr' && !['/employees', '/attendance', '/hour-balance'].includes(location)) navigate('/employees', { replace: true });
    if (role === 'accountant' && !['/employees', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/operating-expenses'].includes(location)) navigate('/hour-balance', { replace: true });
    if (role === 'warehouse' && !['/inventory', '/fixed-assets', '/operating-expenses'].includes(location)) navigate('/inventory', { replace: true });
    if (role === 'viewer' && !['/employees', '/attendance', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/operating-expenses', '/inventory', '/fixed-assets'].includes(location)) navigate('/employees', { replace: true });
  }, [location, navigate, role]);
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><LoadingBlock className="size-12" /></div>;
  if (!role) return <HrLogin />;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); navigate('/'); } });
  return <ErrorBoundary resetKey={location}><AppShell role={role} onLogout={signOut}>{role === 'admin' ? <Switch><Route path="/" component={Dashboard} /><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/deletion-requests" component={DeletionRequests} /><Route path="/users" component={UserSettings} /><Route component={NotFound} /></Switch> : role === 'hr' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route component={Employees} /></Switch> : role === 'accountant' ? <Switch><Route path="/employees" component={Employees} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route component={HourBalance} /></Switch> : role === 'viewer' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route component={Employees} /></Switch> : <Switch><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route component={Inventory} /></Switch>}</AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
