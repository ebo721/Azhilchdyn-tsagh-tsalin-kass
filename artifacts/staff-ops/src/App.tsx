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
import { Cash, CashLegacy, CashDayCloseControls, AccountLabel, BankTransactions, bankDateTimeLabel } from '@/pages/Cash';
import { FixedAssets } from '@/pages/FixedAssets';
import { Inventory } from '@/pages/Inventory';

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
