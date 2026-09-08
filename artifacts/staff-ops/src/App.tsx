import { type ReactNode, useEffect, useMemo, useState } from 'react';
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
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
  Copy,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  LayoutDashboard,
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
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  CashTransactionType,
  EmployeeEmployeeType,
  EmployeeStatus,
  getGetCashSummaryQueryKey,
  getGetDashboardQueryKey,
  getGetHourBalanceQueryKey,
  getGetAuthSessionQueryKey,
  getGetPayrollAdvanceQueryKey,
  getGetPayrollQueryKey,
  getListAttendanceQueryKey,
  getListShiftPlansQueryKey,
  getListShiftsQueryKey,
  getListCashTransactionsQueryKey,
  getListCashClosuresQueryKey,
  getListEmployeesQueryKey,
  getListInventoryPurchasesQueryKey,
  getListInventorySuppliersQueryKey,
  getListInventoryIssuesQueryKey,
  getListFixedAssetsQueryKey,
  getListDeletionRequestsQueryKey,
  getListUsersQueryKey,
  useCopyPreviousShiftPlans,
  useCreateCashTransaction,
  useUpdateCashTransaction,
  useDeleteCashTransaction,
  useCloseCashDay,
  useCreateShift,
  useCreateEmployee,
  useDeleteAttendance,
  useDeleteEmployee,
  useDeleteShift,
  useGetCashSummary,
  useGetAuthSession,
  useGetDashboard,
  useGetHourBalance,
  useGetPayroll,
  useGetPayrollAdvance,
  useListAttendance,
  useListCashTransactions,
  useListCashClosures,
  useListEmployees,
  useListInventoryPurchases,
  useListInventorySuppliers,
  useCreateInventoryPurchase,
  useListInventoryItems,
  useUpdateInventoryItem,
  useUpdateInventoryPurchase,
  useDeleteInventoryPurchase,
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
  useListShiftPlans,
  useListShifts,
  useListUsers,
  useLoginHrManager,
  useLogoutHrManager,
  useRevertPayrollAdvanceApproval,
  useUpsertAttendance,
  useUpsertShiftPlan,
  useUpsertPayrollAdjustment,
  useApprovePayrollAdvance,
  useUpdateEmployee,
  useUpdatePayrollAdvancePayment,
  useUpdateShift,
  useUpdateUser,
  useDeleteUser,
  type Employee,
  type CashTransaction,
  type InventoryPurchase,
  type InventorySupplier,
  type InventoryItem,
  type InventoryIssue,
  type FixedAsset,
  type PayrollLine,
  type Shift,
  type User,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function useQueueDeletion() {
  const mutation = useCreateDeletionRequest();
  const qc = useQueryClient();
  const request = (targetPath: string, label: string) => {
    mutation.mutate({ data: { targetPath, label } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах хүсэлт админы зөвшөөрөл хүлээж байна.');
      },
    });
  };
  return { request, isPending: mutation.isPending, isError: mutation.isError };
}

const money = (value = 0) => `${new Intl.NumberFormat('mn-MN').format(value)} ₮`;
const dateLabel = (value: string) => {
  const calendarDate = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) {
    const [year, month, day] = value.split('-').map(Number);
    return `${year} оны ${month}-р сарын ${day}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()} оны ${date.getMonth() + 1}-р сарын ${date.getDate()}`;
};
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const calendarDays = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
};
const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const mongolianWeekdayLabel = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return ['Ням', 'Да', 'Мя', 'Лха', 'Пү', 'Ба', 'Бя'][new Date(year, month - 1, day).getDay()];
};

const nav = [
  { href: '/', label: 'Статистик', icon: LayoutDashboard },
  { href: '/employees', label: 'Ажилчид', icon: UsersRound },
  { href: '/attendance', label: 'Ирц', icon: Clock3 },
  { href: '/hour-balance', label: 'Цагийн баланс', icon: Timer },
  { href: '/payroll', label: 'Цалин', icon: Banknote },
  { href: '/cash', label: 'Касс', icon: WalletCards },
  { href: '/inventory', label: 'Бараа материал', icon: PackageOpen },
  { href: '/fixed-assets', label: 'Эд хөрөнгө', icon: BriefcaseBusiness },
  { href: '/deletion-requests', label: 'Устгах хүсэлт', icon: ShieldCheck },
  { href: '/users', label: 'Хэрэглэгчийн тохиргоо', icon: UserRound },
];

function LoadingBlock({ className = '' }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-foreground/8', className)} data-testid="loading-skeleton" />;
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center" data-testid="status-error">
      <p className="text-sm font-semibold text-destructive">Мэдээлэл татахад алдаа гарлаа.</p>
      <p className="mt-1 text-xs text-muted-foreground">Холболтоо шалгаад дахин оролдоно уу.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="button-retry">Дахин оролдох</Button>
    </div>
  );
}

function EmptyState({ title, detail, icon: Icon = Search }: { title: string; detail: string; icon?: typeof Search }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border-t border-border p-8 text-center" data-testid="status-empty">
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatCard({ label, value, meta, icon: Icon, tone = 'teal' }: { label: string; value: string; meta: string; icon: typeof Activity; tone?: 'teal' | 'gold' | 'blue' | 'orange' }) {
  const colors = { teal: 'bg-primary/10 text-primary', gold: 'bg-accent/25 text-foreground', blue: 'bg-sky-100 text-sky-800', orange: 'bg-orange-100 text-orange-800' };
  return (
    <div className="group rounded-2xl border border-border/80 bg-card p-5 shadow-[0_1px_0_hsl(var(--foreground)/.03)] transition-transform duration-200 hover:-translate-y-0.5" data-testid={`card-stat-${label}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span>
        <span className={cn('grid size-9 place-items-center rounded-xl', colors[tone])}><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-5 font-mono text-[clamp(1.35rem,2.8vw,2rem)] font-bold tracking-tight text-foreground" data-testid={`value-stat-${label}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const styles: Record<string, string> = {
    active: 'bg-primary/10 text-primary',
    inactive: 'bg-muted text-muted-foreground',
    present: 'bg-primary/10 text-primary',
    late: 'bg-accent/35 text-foreground',
    leave: 'bg-sky-100 text-sky-800',
    absent: 'bg-destructive/10 text-destructive',
  };
  const labels: Record<string, string> = { active: 'Идэвхтэй', inactive: 'Идэвхгүй', present: 'Ирсэн', late: 'Хоцорсон', leave: 'Чөлөөтэй', absent: 'Ирээгүй' };
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', styles[value] ?? 'bg-muted text-muted-foreground')} data-testid={`status-pill-${value}`}>{labels[value] ?? value}</span>;
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p>}
        <h1 className="font-sans text-3xl font-bold tracking-[-.04em] text-foreground sm:text-[2.25rem]" data-testid="heading-page">{title}</h1>
        {detail && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">{title === 'Касс' && <CashDayCloseControls />}{action}</div>
    </div>
  );
}

function Modal({ title, detail, onClose, children, wide = false, fullScreen = false }: { title: string; detail: string; onClose: () => void; children: ReactNode; wide?: boolean; fullScreen?: boolean }) {
  return (
    <div className={cn('fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/35 backdrop-blur-[2px] sm:p-4', fullScreen ? 'p-0' : 'p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]')} role="dialog" aria-modal="true" data-testid="modal">
      <div className={cn('w-full overflow-y-auto border border-border bg-card p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7', fullScreen ? 'h-[100dvh] max-h-none rounded-none pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:max-h-[calc(100dvh-2rem)] sm:pt-7' : 'max-h-[calc(100dvh-1.5rem)] rounded-2xl', wide ? 'sm:max-w-5xl' : 'sm:max-w-xl')}>
        <div className="sticky top-0 z-10 -mx-2 mb-6 flex items-start justify-between gap-4 bg-card px-2 pb-3">
          <div><p className="text-lg font-bold tracking-tight">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Цонх хаах" data-testid="button-close-modal"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AppShell({ children, role, onLogout }: { children: ReactNode; role: 'admin' | 'hr' | 'accountant' | 'warehouse' | 'viewer'; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = role === 'hr'
    ? nav.filter((item) => ['/employees', '/attendance', '/hour-balance'].includes(item.href))
    : role === 'accountant'
      ? nav.filter((item) => ['/hour-balance', '/payroll'].includes(item.href))
      : role === 'warehouse'
        ? nav.filter((item) => ['/inventory', '/fixed-assets'].includes(item.href))
        : nav;
  const active = visibleNav.find((item) => item.href === location)?.label ?? 'Статистик';
  return (
    <div className="min-h-[100dvh] bg-background app-grid">
      {role !== 'viewer' && <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')} data-testid="navigation-sidebar">
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
            <span className="text-sm font-bold tracking-tight">САМАСАА</span>
          </Link>
          <button className="grid size-8 place-items-center rounded-lg hover:bg-sidebar-accent lg:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation"><X className="size-4" /></button>
        </div>
        <nav className="mt-10 space-y-1" data-testid="navigation-main">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')} data-testid={`link-nav-${label}`}>
              <Icon className="size-[17px]" /><span>{label}</span>{location === href && <ChevronRight className="ml-auto size-4 opacity-60" />}
            </Link>
          ))}
        </nav>
      </aside>}
      {role !== 'viewer' && mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Цэс хаах" data-testid="button-navigation-overlay" />}
      <main className={cn('min-h-[100dvh]', role !== 'viewer' && 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8" data-testid="top-header">
          <div className="flex items-center gap-3">{role !== 'viewer' && <button className="grid size-9 place-items-center rounded-xl border border-border bg-card lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-navigation"><Menu className="size-4" /></button>}<p className="text-sm font-semibold">{active}</p></div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />{role === 'hr' ? 'Хүний нөөцийн менежер' : role === 'accountant' ? 'Нягтлан' : role === 'warehouse' ? 'Нярав' : role === 'viewer' ? 'Статистик харах эрх' : 'Ерөнхий админ'}</span><button onClick={onLogout} className="grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Системээс гарах" data-testid="button-logout"><LogOut className="size-4" /></button><div className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground" data-testid="avatar-owner">{role === 'hr' ? 'HR' : role === 'accountant' ? 'НТ' : role === 'warehouse' ? 'НЯ' : role === 'viewer' ? 'СТ' : 'АД'}</div></div>
        </header>
        <div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div>
      </main>
    </div>
  );
}

function Dashboard() {
  const query = useGetDashboard();
  const data = query.data;
  return (
    <div className="page-enter">
      {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Өмнөх сарын борлуулалт" value={money(data?.previousMonthSalesIncome)} meta="Борлуулалтын нийт орлого" icon={TrendingUp} tone="gold" />
            <StatCard label="Өмнөх сарын цалин" value={money(data?.previousMonthPayrollExpense)} meta="Бодитоор олгосон нийт зардал" icon={Banknote} tone="blue" />
            <StatCard label="Өмнөх сарын материал" value={money(data?.previousMonthInventoryExpense)} meta="Худалдан авсан нийт зардал" icon={PackageOpen} tone="teal" />
            <StatCard label="Нийт ажилтан" value={`${data?.employeeCount ?? 0}`} meta="Бүртгэлтэй ажилтан" icon={UsersRound} tone="orange" />
          </div>
          <div className="mt-6">
            <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-recent-activity">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Live log</p><h2 className="mt-1 text-base font-bold">Сүүлийн хөдөлгөөн</h2></div><Activity className="size-4 text-muted-foreground" /></div>
              {data?.recentActivity?.length ? <div className="divide-y divide-border">{data.recentActivity.map((item) => <div className="flex gap-3 px-4 py-4 transition-colors hover:bg-secondary/45 sm:gap-4 sm:px-5" key={item.id} data-testid={`row-activity-${item.id}`}><div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Activity className="size-4" /></div><div className="min-w-0 flex-1"><div className="sm:flex sm:items-start sm:justify-between sm:gap-4"><p className="text-sm font-semibold">{item.title}</p><time className="mt-1 block shrink-0 font-mono text-[10px] text-muted-foreground sm:mt-0">{dateLabel(item.createdAt)}</time></div><p className="mt-2 break-words text-sm font-medium leading-relaxed text-foreground/80 sm:mt-1 sm:truncate sm:text-xs sm:font-normal sm:text-muted-foreground">{item.detail}</p></div></div>)}</div> : <EmptyState title="Одоогоор хөдөлгөөн алга" detail="Касс, бараа материал эсвэл эд хөрөнгийн шинэ бүртгэл энд харагдана." icon={Activity} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

type EmployeeForm = { name: string; role: string; phone: string; employeeType: 'shift' | 'office'; baseSalary: string; socialInsuranceSalary: string; payrollTaxExempt: boolean; monthlyExpectedWorkDays: string; status?: 'active' | 'inactive' };

function EmployeeModal({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const isEdit = !!employee;
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const qc = useQueryClient();
  const form = useForm<EmployeeForm>({ defaultValues: { name: employee?.name ?? '', role: employee?.role ?? '', phone: employee?.phone ?? '', employeeType: employee?.employeeType ?? 'office', baseSalary: String(employee?.baseSalary ?? ''), socialInsuranceSalary: String(employee?.socialInsuranceSalary ?? ''), payrollTaxExempt: employee?.payrollTaxExempt ?? false, monthlyExpectedWorkDays: String(employee?.monthlyExpectedWorkDays ?? 0), status: employee?.status ?? 'active' } });
  const submit = (values: EmployeeForm) => {
    const data = { name: values.name, role: values.role, phone: values.phone, employeeType: values.employeeType, baseSalary: Number(values.baseSalary), socialInsuranceSalary: values.payrollTaxExempt ? 0 : Number(values.socialInsuranceSalary), payrollTaxExempt: values.payrollTaxExempt, monthlyExpectedWorkDays: values.employeeType === 'shift' ? Number(values.monthlyExpectedWorkDays) : 0, ...(isEdit ? { status: values.status } : {}) };
    const done = () => { qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() }); onClose(); };
    if (isEdit && employee) update.mutate({ id: employee.id, data }, { onSuccess: done }); else create.mutate({ data }, { onSuccess: done });
  };
  const pending = create.isPending || update.isPending;
  const employeeType = form.watch('employeeType');
  const payrollTaxExempt = form.watch('payrollTaxExempt');
  return <Modal title={isEdit ? 'Ажилтны мэдээлэл засах' : 'Шинэ ажилтан бүртгэх'} detail="Ажилтны төрлөөс хамаарч өдрийн эсвэл сарын цалинг оруулна." onClose={onClose}>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-employee">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-xs font-semibold">Нэр<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" {...form.register('name', { required: 'Нэр оруулна уу' })} data-testid="input-employee-name" />{form.formState.errors.name && <span className="text-[11px] text-destructive">{form.formState.errors.name.message}</span>}</label>
        <label className="space-y-2 text-xs font-semibold">Албан тушаал<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('role', { required: 'Албан тушаал оруулна уу' })} data-testid="input-employee-role" /></label>
        <label className="space-y-2 text-xs font-semibold">Утас<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('phone')} data-testid="input-employee-phone" /></label>
        <label className="space-y-2 text-xs font-semibold">Ажилтны төрөл<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('employeeType')} data-testid="select-employee-type"><option value="office">Оффис ажилтан</option><option value="shift">Ээлжийн ажилтан</option></select></label>
        <label className="space-y-2 text-xs font-semibold">{employeeType === 'shift' ? 'Өдрийн цалин' : 'Сарын цалин'}<input type="number" min="0" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('baseSalary', { required: true, min: 0 })} data-testid="input-employee-salary" /></label>
        <label className="space-y-2 text-xs font-semibold">НДШ тооцох цалин<input type="number" min="0" disabled={payrollTaxExempt} className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:border-primary" {...form.register('socialInsuranceSalary', { required: !payrollTaxExempt, min: 0 })} data-testid="input-employee-social-insurance-salary" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="size-4 accent-primary" {...form.register('payrollTaxExempt')} data-testid="checkbox-employee-payroll-tax-exempt" /><span><span className="block">НДШ, ХХОАТ төлөхгүй</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Цалин бодоход НДШ, ХХОАТ болон татварын хөнгөлөлт 0 байна.</span></span></label>
        {employeeType === 'shift' ? <label className="space-y-2 text-xs font-semibold">Сард ажиллах ёстой өдөр<input type="number" min="0" max="31" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('monthlyExpectedWorkDays', { required: true, min: 0, max: 31 })} data-testid="input-employee-expected-work-days" /><span className="text-[11px] font-normal text-muted-foreground">Цагийн балансад ашиглах ээлжийн сарын төлөвлөгөө.</span></label> : <div className="rounded-xl border border-border bg-secondary/35 p-3 text-xs text-muted-foreground">Ажиллах ёстой өдрийг тухайн сарын Даваа–Баасан гарагаар автоматаар тооцно.</div>}
        {isEdit && <label className="space-y-2 text-xs font-semibold">Төлөв<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('status')} data-testid="select-employee-status"><option value="active">Идэвхтэй</option><option value="inactive">Идэвхгүй</option></select></label>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-employee">Болих</Button><Button type="submit" disabled={pending} data-testid="button-save-employee">{pending ? 'Хадгалж байна...' : isEdit ? 'Өөрчлөлт хадгалах' : 'Ажилтан нэмэх'}</Button></div>
    </form></Form>
  </Modal>;
}

function Employees() {
  const query = useListEmployees();
  const session = useGetAuthSession();
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; employee?: Employee }>({ open: false });
  const [search, setSearch] = useState('');
  const employees = useMemo(() => (query.data ?? []).filter((e) => `${e.name} ${e.role} ${e.phone}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const del = (employee: Employee) => { if (window.confirm(`${employee.name}-г устгах хүсэлт гаргах уу?`)) deletion.request(`/employees/${employee.id}`, `${employee.name} ажилтны бүртгэл`); };
  return <div className="page-enter"><div className="mb-6 flex justify-end"><Button onClick={() => setModal({ open: true })} data-testid="button-add-employee"><Plus className="size-4" />Ажилтан нэмэх</Button></div><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold">Бүх ажилтан <span className="ml-1 font-mono text-xs text-muted-foreground">{query.data?.length ?? 0}</span></p><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Нэрээр хайх" data-testid="input-search-employees" /></div></div>{query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : employees.length === 0 ? <EmptyState title="Ажилтан олдсонгүй" detail={search ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Эхний ажилтнаа бүртгэж эхлээрэй.'} icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Ажилтан</th><th className="px-5 py-3 font-bold">Утас</th><th className="px-5 py-3 font-bold">Ажилтны төрөл</th><th className="px-5 py-3 font-bold">Цалин</th><th className="px-5 py-3 font-bold">НДШ-ийн цалин</th><th className="px-5 py-3 font-bold">Төлөв</th><th className="px-5 py-3 text-right font-bold">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{employees.map((employee) => <tr className="group transition-colors hover:bg-secondary/35" key={employee.id} data-testid={`row-employee-${employee.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/30 text-xs font-bold text-foreground">{employee.name.slice(0, 1)}</span><div><p className="text-sm font-semibold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.role}</p></div></div></td><td className="px-5 py-4 text-sm text-muted-foreground">{employee.phone || '—'}</td><td className="px-5 py-4 text-sm">{employee.employeeType === EmployeeEmployeeType.office ? 'Оффис' : 'Ээлжийн'}</td><td className="px-5 py-4"><p className="font-mono text-sm">{money(employee.baseSalary)}</p><p className="text-[10px] text-muted-foreground">{employee.employeeType === EmployeeEmployeeType.office ? 'сарын' : 'өдрийн'}</p></td><td className="px-5 py-4 font-mono text-sm">{money(employee.socialInsuranceSalary)}</td><td className="px-5 py-4"><StatusPill value={employee.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setModal({ open: true, employee })} aria-label={`${employee.name} засах`} data-testid={`button-edit-employee-${employee.id}`}><Pencil className="size-4" /></button><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => del(employee)} aria-label={`${employee.name} устгах хүсэлт`} data-testid={`button-delete-employee-${employee.id}`}><Trash2 className="size-4" /></button></div></td></tr>)}</tbody></table></div>}</section>{modal.open && <EmployeeModal employee={modal.employee} onClose={() => setModal({ open: false })} />}</div>;
}

type ShiftForm = { name: string; startTime: string; endTime: string };

function ShiftSettingsModal({ onClose }: { onClose: () => void }) {
  const shifts = useListShifts();
  const create = useCreateShift();
  const update = useUpdateShift();
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Shift | null>(null);
  const form = useForm<ShiftForm>({ defaultValues: { name: '', startTime: '09:00', endTime: '18:00' } });
  const reset = () => { setEditing(null); form.reset({ name: '', startTime: '09:00', endTime: '18:00' }); };
  const submit = (data: ShiftForm) => {
    const done = () => { qc.invalidateQueries({ queryKey: getListShiftsQueryKey() }); reset(); };
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const edit = (shift: Shift) => {
    setEditing(shift);
    form.reset({ name: shift.name, startTime: shift.startTime, endTime: shift.endTime });
  };
  const del = (shift: Shift) => {
    if (!window.confirm(`${shift.name} ээлжийг устгах хүсэлт гаргах уу?`)) return;
    deletion.request(`/attendance/shifts/${shift.id}`, `${shift.name} ээлж`);
  };
  return <Modal title="Ээлжийн тохиргоо" detail="Ээлжийн нэр болон өдөр бүрийн эхлэх, тарах цагийг удирдана." onClose={onClose}>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
        <label className="space-y-1.5 text-xs font-semibold">Ээлжийн нэр<Input {...form.register('name', { required: true })} placeholder="Өдрийн ээлж" data-testid="input-shift-name" /></label>
        <label className="space-y-1.5 text-xs font-semibold">Эхлэх цаг<Input type="time" {...form.register('startTime', { required: true })} data-testid="input-shift-start" /></label>
        <label className="space-y-1.5 text-xs font-semibold">Тарах цаг<Input type="time" {...form.register('endTime', { required: true })} data-testid="input-shift-end" /></label>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={editing ? reset : onClose}>{editing ? 'Болих' : 'Хаах'}</Button><Button type="submit" disabled={create.isPending || update.isPending}>{editing ? 'Өөрчлөх' : 'Ээлж нэмэх'}</Button></div>
    </form></Form>
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Бүртгэлтэй ээлжүүд</p>
      {shifts.isLoading ? <LoadingBlock className="h-20" /> : !shifts.data?.length ? <div className="rounded-xl bg-secondary/50 p-4 text-center text-xs text-muted-foreground">Ээлж бүртгээгүй байна.</div> : <div className="space-y-2">{shifts.data.map((shift) => <div key={shift.id} className="flex items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{shift.name}</p><p className="font-mono text-xs text-muted-foreground">{shift.startTime} — {shift.endTime}</p></div><button type="button" onClick={() => edit(shift)} className="grid size-8 place-items-center rounded-lg hover:bg-secondary" aria-label={`${shift.name} засах`}><Pencil className="size-4" /></button><button type="button" onClick={() => del(shift)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`${shift.name} устгах`}><Trash2 className="size-4" /></button></div>)}</div>}
      {deletion.isError && <p className="mt-2 text-xs text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </div>
  </Modal>;
}

function AttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const days = useMemo(() => calendarDays(month), [month]);
  const query = useListAttendance({ month });
  const employees = useListEmployees();
  const shifts = useListShifts();
  const plans = useListShiftPlans({ month });
  const upsert = useUpsertAttendance();
  const deletion = useQueueDeletion();
  const clearAttendance = deletion;
  const upsertPlan = useUpsertShiftPlan();
  const copyPreviousPlans = useCopyPreviousShiftPlans();
  const qc = useQueryClient();
  const attendanceMap = useMemo(() => new Map((query.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [query.data]);
  const planMap = useMemo(() => new Map((plans.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [plans.data]);
  const officeEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active && employee.employeeType === EmployeeEmployeeType.office);
  const shiftEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active && employee.employeeType === EmployeeEmployeeType.shift);
  const activeEmployees = [...officeEmployees, ...shiftEmployees];
  const setAttendance = (employeeId: number, date: string, value: string) => {
    const refreshAttendance = () => {
      qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
      qc.invalidateQueries({ queryKey: getGetHourBalanceQueryKey({ month: date.slice(0, 7) }) });
    };
    if (!value) {
      const employeeName = activeEmployees.find((employee) => employee.id === employeeId)?.name ?? `#${employeeId}`;
      if (window.confirm(`${employeeName} ажилтны ${dateLabel(date)}-ны ирцийг устгах хүсэлт гаргах уу?`)) {
        deletion.request(`/attendance?employeeId=${employeeId}&date=${date}`, `${employeeName} · ${dateLabel(date)}-ны ирц`);
      }
      return;
    }
    const isLeave = value === 'leave';
    const hours = isLeave ? 0 : 8;
    upsert.mutate({ data: { employeeId, date, status: isLeave ? 'leave' : 'present', hours } }, {
      onSuccess: refreshAttendance,
    });
  };
  const setPlan = (employeeId: number, date: string, value: string) => {
    upsertPlan.mutate({ data: { employeeId, date, shiftId: value ? Number(value) : null } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListShiftPlansQueryKey({ month }) }),
    });
  };
  const copyPreviousMonth = () => {
    const sourceMonth = window.prompt('Аль сараас ээлжийн төлөвлөгөө хуулах вэ? (Жишээ: 2026-08)', shiftMonth(month, -1));
    if (!sourceMonth) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(sourceMonth)) {
      window.alert('Сарыг YYYY-MM хэлбэрээр зөв оруулна уу.');
      return;
    }
    if (sourceMonth === month) {
      window.alert('Эх сар болон зорилтот сар ижил байж болохгүй.');
      return;
    }
    if (!window.confirm(`${sourceMonth} сарын ээлжийн төлөвлөгөөг ${month} сар руу хуулах уу?`)) return;
    const hasExistingPlans = Boolean(plans.data?.length);
    const overwrite = hasExistingPlans
      ? window.confirm(`${month} сард аль хэдийн төлөвлөсөн ээлж байна. Давхардсан өдрүүдийг дарж бичих үү?\n\n“Цуцлах” сонговол одоо байгаа ээлжүүдийг хэвээр үлдээн, зөвхөн хоосон өдрүүдийг хуулна.`)
      : false;
    copyPreviousPlans.mutate({ data: { sourceMonth, month, overwrite } }, {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListShiftPlansQueryKey({ month }) });
        window.alert(`${result.sourceMonth} сараас ${result.copied} ээлж хууллаа.${result.overwritten ? ` ${result.overwritten} ээлжийг дарж бичлээ.` : ''}${result.skipped ? ` ${result.skipped} давхардлыг алгаслаа.` : ''}${result.unavailableDates ? ` Шинэ сард байхгүй ${result.unavailableDates} өдрийг алгаслаа.` : ''}`);
      },
    });
  };
  return <div className="page-enter">
    <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="outline" onClick={copyPreviousMonth} disabled={copyPreviousPlans.isPending || plans.isLoading} data-testid="button-copy-previous-shift-plans"><Copy className="size-4" />{copyPreviousPlans.isPending ? 'Хуулж байна...' : 'Ээлж хуулах'}</Button><Button variant="outline" onClick={() => setSettingsOpen(true)} data-testid="button-shift-settings"><Clock3 className="size-4" />Ээлжийн тохиргоо</Button><div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-attendance-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-attendance-month" /></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-attendance-next-month"><ChevronRight className="size-4" /></button></div></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="attendance-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын ирц</h2><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-bold">Оффис {officeEmployees.length}</span><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary">Ээлжийн {shiftEmployees.length}</span><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{days.length} хоног</span></div></div>
      {query.isLoading || employees.isLoading || shifts.isLoading || plans.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError || employees.isError || shifts.isError || plans.isError ? <ErrorBlock onRetry={() => { query.refetch(); employees.refetch(); shifts.refetch(); plans.refetch(); }} /> : !activeEmployees.length ? <EmptyState title="Идэвхтэй ажилтан алга" detail="Эхлээд ажилтны бүртгэлээс ажилтан нэмнэ үү." icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full table-fixed text-left" style={{ minWidth: `${208 + days.length * 84}px` }}><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="sticky left-0 z-10 w-52 border-r border-border bg-secondary/95 px-5 py-3">Ажилтан</th>{days.map((day) => <th className={cn('w-[84px] px-1 py-3 text-center', day === today() && 'bg-accent/35 text-foreground')} key={day}><div className="font-mono text-[11px]">{day.slice(8)}</div><div className="mt-1 text-[9px] uppercase">{mongolianWeekdayLabel(day)}</div></th>)}</tr></thead><tbody className="divide-y divide-border">{activeEmployees.map((employee) => <tr key={employee.id} data-testid={`row-attendance-calendar-${employee.id}`}><td className="sticky left-0 z-10 border-r border-border bg-card px-5 py-3"><p className="truncate text-sm font-semibold">{employee.name}</p><p className="truncate text-[11px] text-muted-foreground">{employee.role}</p><p className="mt-1 text-[10px] font-medium text-primary">{employee.employeeType === EmployeeEmployeeType.shift ? 'Ээлжийн' : 'Оффис'}</p></td>{days.map((day) => { const row = attendanceMap.get(`${employee.id}-${day}`); const plan = planMap.get(`${employee.id}-${day}`); const value = row?.status === 'leave' ? 'leave' : row ? 'worked' : ''; const isShiftEmployee = employee.employeeType === EmployeeEmployeeType.shift; return <td className={cn('border-l border-border/60 p-1 text-center', day === today() && 'bg-accent/10')} key={day}>{isShiftEmployee && <select value={plan?.shiftId ?? ''} disabled={upsertPlan.isPending} onChange={(event) => setPlan(employee.id, day, event.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-1 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-primary/30" aria-label={`${employee.name} ${day} ээлж`} data-testid={`select-shift-plan-${employee.id}-${day}`}><option value="">Ээлжгүй</option>{shifts.data?.map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}</select>}<select value={value} disabled={upsert.isPending || clearAttendance.isPending} onChange={(event) => setAttendance(employee.id, day, event.target.value)} className={cn(isShiftEmployee && 'mt-1', 'h-7 w-full rounded-md border-0 text-center font-mono text-[10px] font-bold outline-none transition-colors focus:ring-2 focus:ring-primary/30', value === 'worked' ? 'bg-primary text-primary-foreground' : value === 'leave' ? 'bg-sky-100 text-sky-800' : 'bg-secondary/60 text-muted-foreground/60')} aria-label={`${employee.name} ${day} ирц`} data-testid={`select-attendance-${employee.id}-${day}`}><option value="">Ирц</option><option value="worked">Ажилласан</option><option value="leave">Чөлөө</option></select></td>; })}</tr>)}</tbody></table></div>}
    </section>
    {settingsOpen && <ShiftSettingsModal onClose={() => setSettingsOpen(false)} />}
  </div>;
}

function HourBalance() {
  const [month, setMonth] = useState(currentMonth());
  const query = useGetHourBalance({ month });
  return <div className="page-enter">
    <PageHeading
      title="Цагийн баланс"
      action={<div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-hour-balance-month" /></div>}
    />
    {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card" data-testid="hour-balance-list">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын цагийн жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} ажилтан</span></div>
        {!query.data?.length ? <EmptyState title="Цагийн баланс хоосон" detail="Ажилтан болон ирцийн бүртгэл нэмэгдсэний дараа энд сарын нийлбэр гарна." icon={Timer} /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-center">Ажиллах ёстой өдөр</th><th className="px-5 py-3 text-center">Ажилласан өдөр</th><th className="px-5 py-3 text-center">Чөлөө</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((row) => <tr key={row.employeeId} className="transition-colors hover:bg-secondary/35" data-testid={`row-hour-balance-${row.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{row.employeeName}</p><p className="text-xs text-muted-foreground">{row.role}</p></td><td className="px-5 py-4 text-center font-mono text-sm font-semibold text-primary">{row.expectedWorkDays}</td><td className="px-5 py-4 text-center font-mono text-sm font-semibold">{row.workDays}</td><td className="px-5 py-4 text-center font-mono text-sm">{row.leaveDays}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}

type PayrollAdjustmentForm = {
  manualDeduction: string;
  paidAmount: string;
  paymentDate: string;
  secondPaidAmount: string;
  secondPaymentDate: string;
};

function PayrollAdjustmentModal({ line, month, onClose }: { line: PayrollLine; month: string; onClose: () => void }) {
  const save = useUpsertPayrollAdjustment();
  const qc = useQueryClient();
  const form = useForm<PayrollAdjustmentForm>({
    defaultValues: {
      manualDeduction: String(line.manualDeduction),
      paidAmount: String(line.paidAmount),
      paymentDate: line.paymentDate ?? today(),
      secondPaidAmount: String(line.secondPaidAmount),
      secondPaymentDate: line.secondPaymentDate ?? today(),
    },
  });
  const submit = (values: PayrollAdjustmentForm) => {
    save.mutate({
      data: {
        employeeId: line.employeeId,
        month,
        manualDeduction: Number(values.manualDeduction),
        paidAmount: Number(values.paidAmount),
        paymentDate: Number(values.paidAmount) > 0 ? values.paymentDate : null,
        secondPaidAmount: Number(values.secondPaidAmount),
        secondPaymentDate: Number(values.secondPaidAmount) > 0 ? values.secondPaymentDate : null,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        onClose();
      },
    });
  };
  return <Modal title={`${line.employeeName} · Цалингийн тохируулга`} detail={`${month.replace('-', ' оны ')} сарын урьдчилгаа, хөнгөлөлт, суутгал болон шилжүүлсэн дүнг оруулна.`} onClose={onClose}>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-payroll-adjustment">
      <div className="rounded-xl border border-border bg-secondary/40 p-4 text-xs text-muted-foreground"><div className="flex justify-between"><span>Тооцсон сүүл цалин</span><strong className="font-mono text-foreground">{money(line.payable)}</strong></div><div className="mt-2 flex justify-between"><span>Одоогийн дутуу дүн</span><strong className="font-mono text-primary">{money(line.remainingAmount)}</strong></div></div>
      <div className="rounded-xl border border-accent/50 bg-accent/15 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{line.employeeType === 'shift' ? 'Урьдчилгаа цалин' : 'Урьдчилгаа цалин · 50%'}</span><strong className="font-mono text-sm">{money(line.advanceAmount)}</strong></div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-xs font-semibold"><span>ХХОАТ хөнгөлөлт</span><div className="mt-1 flex h-10 w-full items-center rounded-lg border border-input bg-secondary/40 px-3 font-mono text-sm">{money(line.taxRelief)}</div><p className="text-[11px] font-normal text-muted-foreground">НДШ тооцох цалингийн шатлалаар автоматаар тооцно.</p></div>
        <label className="space-y-2 text-xs font-semibold">Гараар оруулах суутгал<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('manualDeduction', { required: true, min: 0 })} data-testid="input-payroll-manual-deduction" /></label>
        <label className="space-y-2 text-xs font-semibold">1-р гүйлгээний дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label>
        <label className="space-y-2 text-xs font-semibold">1-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('paymentDate')} data-testid="input-payroll-payment-date" /></label>
        <label className="space-y-2 text-xs font-semibold">2-р гүйлгээний дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('secondPaidAmount', { required: true, min: 0 })} data-testid="input-payroll-second-paid-amount" /></label>
        <label className="space-y-2 text-xs font-semibold">2-р гүйлгээний огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('secondPaymentDate')} data-testid="input-payroll-second-payment-date" /></label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={save.isPending} data-testid="button-save-payroll-adjustment">{save.isPending ? 'Хадгалж байна...' : 'Тохируулга хадгалах'}</Button></div>
    </form></Form>
  </Modal>;
}

function Payroll() {
  const [month, setMonth] = useState(currentMonth());
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [advanceDates, setAdvanceDates] = useState<Record<number, string>>({});
  const [advanceAmounts, setAdvanceAmounts] = useState<Record<number, string>>({});
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month });
  const cashClosures = useListCashClosures();
  const closedCashDates = new Set(cashClosures.data?.map((closure) => closure.date) ?? []);
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const approveAdvance = useApprovePayrollAdvance();
  const deletion = useQueueDeletion();
  const revertAdvanceApproval = deletion;
  const updateAdvancePayment = useUpdatePayrollAdvancePayment();
  const pullLatestAttendance = async () => {
    await query.refetch();
    if (showAdvance && !advanceQuery.data?.approved) await advanceQuery.refetch();
  };
  const approve = () => {
    if (!window.confirm(`${month} сарын урьдчилгаа цалинг батлах уу? Баталсны дараа энэ жагсаалтын дүн өөрчлөгдөхгүй.`)) return;
    approveAdvance.mutate({ data: { month } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) }),
    });
  };
  const revertApproval = () => {
    if (!window.confirm(`${month} сарын урьдчилгаа цалингийн батлалтыг устгах хүсэлт гаргах уу?`)) return;
    deletion.request(`/payroll-advance/approval?month=${month}`, `${month} сарын урьдчилгаа цалингийн батлалт`);
  };
  const setAdvancePaid = (employeeId: number, paid: boolean, existingAmount: number, existingDate?: string | null) => {
    const paymentDate = paid ? (advanceDates[employeeId] || existingDate || today()) : null;
    const advanceAmount = Number(advanceAmounts[employeeId] ?? existingAmount);
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      window.alert('Олгох урьдчилгааны дүнг зөв оруулна уу.');
      return;
    }
    updateAdvancePayment.mutate({ data: { month, employeeId, advanceAmount, paid, paymentDate } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) });
      },
    });
  };
  return <div className="page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-end gap-2"><Button onClick={pullLatestAttendance} variant="outline" disabled={query.isFetching || advanceQuery.isFetching} data-testid="button-pull-payroll-attendance"><RefreshCw className={cn('size-4', (query.isFetching || advanceQuery.isFetching) && 'animate-spin')} />{query.isFetching || advanceQuery.isFetching ? 'Татаж байна...' : 'Цаг татах'}</Button><Button onClick={() => setShowAdvance((value) => !value)} variant={showAdvance ? 'default' : 'outline'} data-testid="button-payroll-advance"><Coins className="size-4" />Урьдчилгаа цалин</Button><div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-payroll-month" /></div></div>
    {showAdvance && <section className="mb-6 overflow-hidden rounded-2xl border border-accent/60 bg-card shadow-sm" data-testid="section-payroll-advance">
      <div className="flex flex-col justify-between gap-4 border-b border-border bg-accent/10 px-5 py-4 sm:flex-row sm:items-center">
        <h2 className="text-lg font-bold">{month.replace('-', ' оны ')} сарын урьдчилгаа цалин</h2>
        {advanceQuery.data?.approved ? <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="status-advance-approved"><Check className="mr-2 inline size-4" />Батлагдсан · {advanceQuery.data.approvedAt ? dateLabel(advanceQuery.data.approvedAt) : ''}</div><Button variant="outline" onClick={revertApproval} disabled={revertAdvanceApproval.isPending} data-testid="button-revert-payroll-advance">{revertAdvanceApproval.isPending ? 'Хүсэлт илгээж байна...' : 'Батлалт устгах хүсэлт'}</Button></div> : <Button onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading} data-testid="button-approve-payroll-advance"><Check className="size-4" />{approveAdvance.isPending ? 'Баталж байна...' : 'Урьдчилгаа батлах'}</Button>}
      </div>
      {advanceQuery.isLoading ? <div className="p-5"><LoadingBlock className="h-36" /></div> : advanceQuery.isError ? <div className="p-5"><ErrorBlock onRetry={() => advanceQuery.refetch()} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">Ажилласан хоног</th><th className="px-5 py-3 text-right">Өдрийн цалин</th><th className="px-5 py-3 text-right">Нийт олгох цалин</th><th className="px-5 py-3 text-right">Олгох урьдчилгаа</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th></tr></thead>
          <tbody className="divide-y divide-border">{advanceQuery.data?.lines.map((line) => { const selectedDate = advanceDates[line.employeeId] ?? line.paymentDate ?? today(); const cashClosed = closedCashDates.has(selectedDate) || Boolean(line.paymentDate && closedCashDates.has(line.paymentDate)); return <tr key={line.employeeId}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.employeeType === 'shift' ? 'Ээлжийн ажилтан' : 'Оффис ажилтан'}</p></td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'office' ? money(line.baseSalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.daysWorked}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'shift' ? money(line.dailySalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.totalSalary)}</td><td className="px-5 py-4 text-right"><input type="number" min="0" step="1000" value={advanceAmounts[line.employeeId] ?? String(line.advanceAmount)} disabled={!advanceQuery.data?.approved || line.paid || cashClosed} onChange={(event) => setAdvanceAmounts((amounts) => ({ ...amounts, [line.employeeId]: event.target.value }))} className="h-8 w-32 rounded-lg border border-input bg-background px-2 text-right font-mono text-sm font-bold text-primary outline-none focus:border-primary" data-testid={`input-advance-amount-${line.employeeId}`} /></td><td className="px-5 py-4 text-center"><input type="date" value={selectedDate} disabled={!advanceQuery.data?.approved || line.paid} onChange={(event) => setAdvanceDates((dates) => ({ ...dates, [line.employeeId]: event.target.value }))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary" data-testid={`input-advance-payment-date-${line.employeeId}`} /></td><td className="px-5 py-4 text-center">{advanceQuery.data?.approved ? <Button size="sm" variant={line.paid ? 'default' : 'outline'} disabled={updateAdvancePayment.isPending || cashClosed} onClick={() => setAdvancePaid(line.employeeId, !line.paid, line.advanceAmount, line.paymentDate)} title={cashClosed ? 'Энэ өдрийн касс өндөрлөсөн' : undefined} data-testid={`button-advance-paid-${line.employeeId}`}>{line.paid ? <><Check className="size-3.5" />Олгосон</> : 'Олгоогүй'}</Button> : <span className="text-xs text-muted-foreground">Батлаагүй</span>}</td></tr>; })}</tbody>
          <tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={5} className="px-5 py-4 text-right text-sm font-bold">Нийт олгох урьдчилгаа</td><td className="px-5 py-4 text-right font-mono text-base font-bold text-primary" data-testid="value-total-payroll-advance">{money(advanceQuery.data?.totalAmount)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>}
      {revertAdvanceApproval.isError && <p className="border-t border-border bg-destructive/5 px-5 py-3 text-xs font-medium text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </section>}
    {query.isLoading ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын задаргаа</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.lines?.length ?? 0} мөр</span></div>
        {!query.data?.lines?.length ? <EmptyState title="Энэ сард цалин тооцоолоогүй" detail="Ирцийн бүртгэл нэмэгдсэний дараа энд ажилтны мөрүүд гарна." icon={Banknote} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1960px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3">Ажилласан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">НДШ</th><th className="px-5 py-3 text-right">ХХОАТ</th><th className="px-5 py-3 text-right">Хөнгөлөлт</th><th className="px-5 py-3 text-right">Урьдчилгаа цалин</th><th className="px-5 py-3 text-right">Бусад суутгал</th><th className="px-5 py-3 text-right">Сүүл цалин</th><th className="px-5 py-3 text-right">Олгосон дүн</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Дутуу</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.lines.map((line) => { const cashClosed = Boolean((line.paymentDate && closedCashDates.has(line.paymentDate)) || (line.secondPaymentDate && closedCashDates.has(line.secondPaymentDate))); return <tr key={line.employeeId} className="hover:bg-secondary/35" data-testid={`row-payroll-${line.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.role}</p></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{line.daysWorked} өдөр</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.gross)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.socialInsurance)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.incomeTax)}</td><td className="px-5 py-4 text-right font-mono text-sm text-sky-700">{money(line.taxRelief)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.advanceAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.manualDeduction)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(line.payable)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.paidAmount)}</td><td className="px-5 py-4 text-center font-mono text-xs text-muted-foreground">{line.paymentDate ?? '—'}</td><td className="px-5 py-4 text-center"><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', line.paidAmount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} data-testid={`status-payroll-paid-${line.employeeId}`}>{line.paidAmount > 0 ? 'Олгосон' : 'Олгоогүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-orange-800" data-testid={`value-payroll-remaining-${line.employeeId}`}>{money(line.remainingAmount)}</td><td className="px-5 py-4 text-right"><Button size="icon" variant="outline" disabled={cashClosed} title={cashClosed ? 'Гүйлгээний өдрийн касс өндөрлөсөн' : undefined} onClick={() => setSelectedLine(line)} aria-label={`${line.employeeName} цалингийн мэдээлэл оруулах`} data-testid={`button-payroll-adjustment-${line.employeeId}`}><Pencil className="size-3.5" /></Button></td></tr>; })}</tbody></table></div>}
      </section>
    </>}
    {selectedLine && <PayrollAdjustmentModal line={selectedLine} month={month} onClose={() => setSelectedLine(null)} />}
  </div>;
}

type CashForm = { type: 'income' | 'expense'; category: string; description: string; amount: string; date: string };

function CashDayCloseControls() {
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
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today() } });
  const submit = (v: CashForm) => create.mutate({ data: { type: v.type, category: v.category, description: v.description, amount: Number(v.amount), date: v.date } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); form.reset({ type: 'income', category: '', description: '', amount: '', date: today() }); setOpen(false); } });
  return <div className="page-enter"><PageHeading eyebrow="Бэлэн мөнгө / cash desk" title="Касс" detail="Орлого, зарлага, үлдэгдлийн хөдөлгөөнийг өдөр тутамд цэгцтэй хөтөлнө." action={<Button onClick={() => setOpen(true)} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button>} />{summary.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : summary.isError ? <ErrorBlock onRetry={() => summary.refetch()} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Кассын үлдэгдэл" value={money(summary.data?.balance)} meta="Бүх хугацааны цэвэр дүн" icon={WalletCards} tone="gold" /><StatCard label="Нийт орлого" value={money(summary.data?.income)} meta="Бүх орсон мөнгө" icon={ArrowDownLeft} /><StatCard label="Нийт зарлага" value={money(summary.data?.expense)} meta="Бүх гарсан мөнгө" icon={ArrowUpRight} tone="orange" /><StatCard label="Өнөөдрийн цэвэр" value={money((summary.data?.todayIncome ?? 0) - (summary.data?.todayExpense ?? 0))} meta={`Орлого ${money(summary.data?.todayIncome)}`} icon={CalendarDays} tone="blue" /></div>}<section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Cash ledger</p><h2 className="mt-1 text-base font-bold">Сүүлийн гүйлгээ</h2></div>{list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Гүйлгээний түүх хоосон" detail="Эхний орлого эсвэл зарлагаа оруулаарай." icon={WalletCards} /> : <div className="divide-y divide-border">{list.data.map((row) => <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}><span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{row.description}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.category} · {dateLabel(row.date)}</p></div><p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p></div>)}</div>}</section>{open && <Modal title="Кассын гүйлгээ" detail="Гүйлгээний төрлийг зөв сонгож, дүнг бүхэл тоогоор оруулна." onClose={() => setOpen(false)}><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash"><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')} data-testid="button-cash-income">Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')} data-testid="button-cash-expense">Зарлага</button></div><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Ангилал<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder="Жишээ: Борлуулалт" data-testid="input-cash-category" /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} data-testid="input-cash-amount" /></label></div><label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} placeholder="Гүйлгээний утга" data-testid="input-cash-description" /></label><label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-cash-date" /></label><div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-cash">Болих</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-cash">{create.isPending ? 'Хадгалж байна...' : 'Гүйлгээ хадгалах'}</Button></div></form></Form></Modal>}</div>;
}

const cashKindMeta = {
  manual: { label: 'Гараар бүртгэсэн', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  payroll: { label: 'Цалин', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  payroll_advance: { label: 'Цалин', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  inventory_purchase: { label: 'Бараа материал', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  fixed_asset_purchase: { label: 'Эд хөрөнгө', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
} as const;

function Cash() {
  const list = useListCashTransactions();
  const closures = useListCashClosures();
  const create = useCreateCashTransaction();
  const update = useUpdateCashTransaction();
  const deletion = useQueueDeletion();
  const remove = deletion;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CashTransaction | null>(null);
  const [open, setOpen] = useState(false);
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today() } });
  const closedDates = new Set(closures.data?.map((closure) => closure.date) ?? []);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const startCreate = () => {
    setEditing(null);
    form.reset({ type: 'income', category: '', description: '', amount: '', date: today() });
    setOpen(true);
  };
  const startEdit = (row: CashTransaction) => {
    setEditing(row);
    form.reset({ type: row.type, category: row.category, description: row.description, amount: String(row.amount), date: row.date });
    setOpen(true);
  };
  const submit = (values: CashForm) => {
    const data = { type: values.type, category: values.category, description: values.description, amount: Number(values.amount), date: values.date };
    const options = { onSuccess: () => { refresh(); setOpen(false); setEditing(null); } };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const deleteRow = (row: CashTransaction) => {
    if (!window.confirm(`${row.description} гүйлгээг устгах хүсэлт гаргах уу?`)) return;
    deletion.request(`/cash/transactions/${row.id}`, `${row.description} кассын гүйлгээ`);
  };
  return <div className="page-enter">
    <div className="mb-7 flex flex-wrap items-center justify-end gap-2"><CashDayCloseControls /><Button onClick={startCreate} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Сүүлийн гүйлгээ</h2></div>
      {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Гүйлгээний түүх хоосон" detail="Эхний орлого эсвэл зарлагаа оруулаарай." icon={WalletCards} /> : <div className="divide-y divide-border">{list.data.map((row) => {
        const closed = closedDates.has(row.date);
        const kind = cashKindMeta[row.transactionKind];
        return <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{row.description}</p><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', kind.className)}>{kind.label}</span></div><p className="mt-0.5 text-xs text-muted-foreground">{row.category} · {dateLabel(row.date)}{closed ? ' · Өндөрлөсөн' : ''}</p></div>
          {row.editable && <div className="flex gap-1"><Button size="icon" variant="ghost" disabled={closed} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : 'Засах'} onClick={() => startEdit(row)} data-testid={`button-edit-cash-${row.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={closed || deletion.isPending} title={closed ? 'Өндөрлөсөн өдрийн гүйлгээ' : 'Устгах хүсэлт'} onClick={() => deleteRow(row)} data-testid={`button-delete-cash-${row.id}`}><Trash2 className="size-4" /></Button></div>}
          <p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p>
        </div>;
      })}</div>}
    </section>
    {open && <Modal title={editing ? 'Кассын гүйлгээ засах' : 'Кассын гүйлгээ'} detail="Гүйлгээний төрөл, дүн болон огноог оруулна." onClose={() => setOpen(false)}>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')}>Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')}>Зарлага</button></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Ангилал<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} /></label>
        <label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} /></label>
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
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
    if (!window.confirm(`"${asset.name}" хөрөнгийг устгах хүсэлт гаргах уу?${asset.purchased ? ' Батлагдвал холбоотой кассын зарлага мөн устна.' : ''}`)) return;
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
const inventoryIssuePurposes = ['Түлш', 'УБ гал тогоо', 'Бусад'] as const;
const inventoryPurchasesPerPage = 20;
type InventoryForm = {
  supplierName: string;
  hasReceipt: boolean;
  date: string;
  items: Array<{ inventoryItemId?: number; name: string; category: string; unit: typeof inventoryUnits[number]; quantity: string; unitPrice: string }>;
};

function Inventory() {
  const purchasesQuery = useListInventoryPurchases();
  const suppliers = useListInventorySuppliers();
  const catalog = useListInventoryItems();
  const updateCatalogItem = useUpdateInventoryItem();
  const issues = useListInventoryIssues();
  const create = useCreateInventoryPurchase();
  const update = useUpdateInventoryPurchase();
  const deletion = useQueueDeletion();
  const remove = deletion;
  const removeIssue = deletion;
  const createIssue = useCreateInventoryIssue();
  const updateIssue = useUpdateInventoryIssue();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryPurchase | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<InventoryPurchase | null>(null);
  const [stockSearch, setStockSearch] = useState('');
  const [inventoryTab, setInventoryTab] = useState<'stock' | 'purchases' | 'suppliers' | 'issues'>('stock');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [categoryItem, setCategoryItem] = useState<InventoryItem | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<InventoryIssue | null>(null);
  const [purchasePage, setPurchasePage] = useState(1);
  const form = useForm<InventoryForm>({
    defaultValues: { supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] },
  });
  const rows = useFieldArray({ control: form.control, name: 'items' });
  const issueForm = useForm<{ inventoryItemId: string; date: string; quantity: string; purpose: string }>({
    defaultValues: { inventoryItemId: '', date: today(), quantity: '', purpose: '' },
  });
  const categoryForm = useForm<{ category: string }>({ defaultValues: { category: '' } });
  const watchedItems = form.watch('items');
  const grandTotal = watchedItems.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const purchasePageCount = Math.max(1, Math.ceil((purchasesQuery.data?.length ?? 0) / inventoryPurchasesPerPage));
  const paginatedPurchases = purchasesQuery.data?.slice(
    (purchasePage - 1) * inventoryPurchasesPerPage,
    purchasePage * inventoryPurchasesPerPage,
  ) ?? [];
  const query = useMemo(() => {
    if (!purchasesQuery.data) return purchasesQuery;
    const data = new Proxy(purchasesQuery.data, {
      get(target, property, receiver) {
        if (property === 'map') return paginatedPurchases.map.bind(paginatedPurchases);
        return Reflect.get(target, property, receiver);
      },
    });
    return { ...purchasesQuery, data };
  }, [paginatedPurchases, purchasesQuery]);
  useEffect(() => {
    if (purchasePage > purchasePageCount) setPurchasePage(purchasePageCount);
  }, [purchasePage, purchasePageCount]);
  const openForm = () => {
    setEditing(null);
    form.reset({ supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] });
    setOpen(true);
  };
  const editPurchase = (purchase: InventoryPurchase) => {
    setEditing(purchase);
    form.reset({
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
    categoryForm.reset({ category: item.category });
  };
  const submitCategory = (values: { category: string }) => {
    if (!categoryItem) return;
    updateCatalogItem.mutate({ id: categoryItem.id, data: { category: values.category } }, {
      onSuccess: () => {
        catalog.refetch();
        setCategoryItem(null);
      },
    });
  };
  const filteredCatalog = catalog.data?.filter((item) => `${item.name} ${item.category}`.toLocaleLowerCase('mn-MN').includes(stockSearch.toLocaleLowerCase('mn-MN'))) ?? [];
  const selectedItemHistory = selectedItem
    ? query.data?.flatMap((purchase) => purchase.items
      .filter((item) => item.inventoryItemId === selectedItem.id)
      .map((item) => ({ ...item, purchaseId: purchase.id, date: purchase.date }))) ?? []
    : [];
  const deletePurchase = (purchase: InventoryPurchase) => {
    if (!window.confirm(`"${purchase.supplierName}" худалдан авалтыг устгах хүсэлт гаргах уу?`)) return;
    deletion.request(`/inventory/purchases/${purchase.id}`, `${purchase.supplierName} · ${money(purchase.totalAmount)}`);
  };
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
    if (!window.confirm(`${issue.itemName} барааны ${issue.quantity} ${issue.unit} зарлагыг устгах хүсэлт гаргах уу?`)) return;
    deletion.request(`/inventory/issues/${issue.id}`, `${issue.itemName} · ${issue.quantity} ${issue.unit} зарлага`);
  };
  return <div className="page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl bg-secondary p-1"><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'stock' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('stock')} data-testid="tab-inventory-stock">Үлдэгдэл</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'purchases' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('purchases')} data-testid="tab-inventory-purchases">Худалдан авалт</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'suppliers' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('suppliers')} data-testid="tab-inventory-suppliers">Харилцагч</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'issues' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('issues')} data-testid="tab-inventory-issues">Зарлага</button></div>{inventoryTab === 'purchases' ? <Button onClick={openForm} data-testid="button-add-inventory-purchase"><Plus className="size-4" />Худалдан авалт бүртгэх</Button> : inventoryTab === 'issues' ? <Button onClick={openIssueForm} data-testid="button-add-inventory-issue"><Plus className="size-4" />Зарлага гаргах</Button> : null}</div>
    {inventoryTab === 'stock' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-base font-bold">Барааны үлдэгдэл</h2><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="pl-9" placeholder="Нэр эсвэл ангиллаар хайх" data-testid="input-search-inventory-stock" /></div></div>
      {catalog.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : catalog.isError ? <ErrorBlock onRetry={() => catalog.refetch()} /> : !filteredCatalog.length ? <EmptyState title="Бараа материал олдсонгүй" detail={stockSearch ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Худалдан авалт бүртгэхэд барааны үлдэгдэл автоматаар үүснэ.'} icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3">Ангилал</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{filteredCatalog.map((item) => <tr key={item.id} className="cursor-pointer transition-colors hover:bg-secondary/40" onClick={() => setSelectedItem(item)} data-testid={`row-inventory-stock-${item.id}`}><td className="px-5 py-3 text-sm font-semibold">{item.name}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{item.quantity}</td><td className="px-5 py-3 text-right"><Button size="icon" variant="ghost" title="Ангилал засах" onClick={(event) => { event.stopPropagation(); editCategory(item); }} data-testid={`button-edit-inventory-category-${item.id}`}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table></div>}
    </section>}
    {inventoryTab === 'purchases' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Худалдан авалтын жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} бүртгэл</span></div>
      {query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : !query.data?.length ? <EmptyState title="Худалдан авалт бүртгэгдээгүй" detail="Бараа материалын эхний худалдан авалтаа бүртгэнэ үү." icon={PackageOpen} /> : <><div className="divide-y divide-border md:hidden">{query.data.map((purchase) => <article className="p-4" key={purchase.id} data-testid={`inventory-purchase-mobile-${purchase.id}`}><button className="w-full text-left" onClick={() => setSelectedPurchase(purchase)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(purchase.date)}</p></div><p className="shrink-0 font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</p></div></button><div className="mt-3 flex items-center justify-between gap-2"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)}>Дэлгэрэнгүй</Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)}><Trash2 className="size-4" /></Button></>}</div></div></article>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[820px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Баримт</th><th className="px-5 py-3 text-right">Үнийн дүн</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((purchase) => <tr key={purchase.id} data-testid={`inventory-purchase-${purchase.id}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{purchase.items.length} төрлийн бараа</p></td><td className="px-5 py-4 text-sm">{dateLabel(purchase.date)}</td><td className="px-5 py-4"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)} data-testid={`button-view-inventory-${purchase.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)} data-testid={`button-edit-inventory-${purchase.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)} data-testid={`button-delete-inventory-${purchase.id}`}><Trash2 className="size-4" /></Button></>}</div></td></tr>)}</tbody></table></div></>}
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
      {suppliers.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></div> : suppliers.isError ? <ErrorBlock onRetry={() => suppliers.refetch()} /> : !suppliers.data?.length ? <EmptyState title="Харилцагч бүртгэгдээгүй" detail="Худалдан авалт бүртгэхэд харилцагч автоматаар нэмэгдэнэ." icon={PackageOpen} /> : <><div className="divide-y divide-border md:hidden">{suppliers.data.map((supplier: InventorySupplier) => <article key={supplier.id} className="p-4" data-testid={`inventory-supplier-mobile-${supplier.id}`}><h3 className="text-sm font-bold">{supplier.name}</h3><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт худалдан авалт</p><p className="mt-1 font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Худалдан авалтын баримт</p><p className="mt-1 font-mono text-sm font-bold">{supplier.purchaseCount}</p></div></div></article>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[600px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3 text-right">Нийт худалдан авалт</th><th className="px-5 py-3 text-right">Худалдан авалтын баримт</th></tr></thead><tbody className="divide-y divide-border">{suppliers.data.map((supplier: InventorySupplier) => <tr key={supplier.id} data-testid={`inventory-supplier-${supplier.id}`}><td className="px-5 py-4 text-sm font-semibold">{supplier.name}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{supplier.purchaseCount}</td></tr>)}</tbody></table></div></>}
    </section>}
    {selectedPurchase && <Modal title={selectedPurchase.supplierName} detail={`${dateLabel(selectedPurchase.date)} · ${selectedPurchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'} · ${money(selectedPurchase.totalAmount)}`} onClose={() => setSelectedPurchase(null)}>
      <div className="max-h-[62vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Барааны нэр</th><th className="px-3 py-2">Ангилал</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт дүн</th></tr></thead><tbody className="divide-y divide-border">{selectedPurchase.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-sm font-semibold">{item.name}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{item.quantity}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(item.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(item.totalAmount)}</td></tr>)}</tbody></table></div></div>
    </Modal>}
    {inventoryTab === 'issues' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Зарлагын жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{issues.data?.length ?? 0} бүртгэл</span></div>
      {issues.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : issues.isError ? <ErrorBlock onRetry={() => issues.refetch()} /> : !issues.data?.length ? <EmptyState title="Зарлага бүртгэгдээгүй" detail="Бараа материалын зарлагыг энд бүртгэнэ." icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3 text-right">Тоо хэмжээ</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3">Зориулалт</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{issues.data.map((issue) => <tr key={issue.id} data-testid={`row-inventory-issue-${issue.id}`}><td className="px-5 py-3 text-sm font-semibold">{dateLabel(issue.date)}</td><td className="px-5 py-3 text-sm font-semibold">{issue.itemName}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{issue.quantity}</td><td className="px-5 py-3 text-sm text-muted-foreground">{issue.unit}</td><td className="px-5 py-3 text-sm">{issue.purpose}</td><td className="px-5 py-3"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => editIssue(issue)} data-testid={`button-edit-inventory-issue-${issue.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={removeIssue.isPending} onClick={() => deleteIssue(issue)} data-testid={`button-delete-inventory-issue-${issue.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>}
    </section>}
    {selectedItem && <Modal title={selectedItem.name} detail={`${selectedItem.category} · Үлдэгдэл ${selectedItem.quantity} ${selectedItem.unit}`} onClose={() => setSelectedItem(null)}>
      {!selectedItemHistory.length ? <EmptyState title="Худалдан авалтын түүх алга" detail="Энэ бараанд холбогдох худалдан авалт олдсонгүй." icon={PackageOpen} /> : <div className="max-h-[60vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Огноо</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт үнэ</th></tr></thead><tbody className="divide-y divide-border">{selectedItemHistory.map((line) => <tr key={`${line.purchaseId}-${line.id}`}><td className="px-3 py-3 text-sm font-semibold">{dateLabel(line.date)}</td><td className="px-3 py-3 text-right font-mono text-sm">{line.quantity}</td><td className="px-3 py-3 text-sm text-muted-foreground">{line.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(line.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(line.totalAmount)}</td></tr>)}</tbody></table></div></div>}
    </Modal>}
    {categoryItem && <Modal title="Барааны ангилал засах" detail={categoryItem.name} onClose={() => setCategoryItem(null)}>
      <Form {...categoryForm}><form onSubmit={categoryForm.handleSubmit(submitCategory)} className="space-y-5" data-testid="form-inventory-category">
        <label className="block space-y-2 text-xs font-semibold">Ангилал<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...categoryForm.register('category', { required: true })} data-testid="input-inventory-category-edit" /></label>
        {updateCatalogItem.isError && <p className="text-xs font-semibold text-destructive">Ангиллыг хадгалахад алдаа гарлаа.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setCategoryItem(null)}>Болих</Button><Button type="submit" disabled={updateCatalogItem.isPending} data-testid="button-save-inventory-category">{updateCatalogItem.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
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
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Харилцагч<input list="inventory-supplier-options" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('supplierName', { required: true })} placeholder="Жишээ: Номин" data-testid="input-inventory-supplier-name" /></label><label className="space-y-2 text-xs font-semibold">Худалдан авалтын огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-inventory-purchase-date" /></label></div>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" {...form.register('hasReceipt')} data-testid="checkbox-inventory-has-receipt" /><span>Баримттай</span></label>
        <datalist id="inventory-supplier-options">{suppliers.data?.map((supplier) => <option value={supplier.name} key={supplier.id} />)}</datalist>
        <datalist id="inventory-catalog-options">{catalog.data?.map((item) => <option value={item.name} key={item.id}>{item.category} · {item.unit}</option>)}</datalist>
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

function UserSettings() {
  const users = useListUsers();
  const deletion = useDeleteUser();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const remove = (user: User) => {
    if (!window.confirm(`${user.username} хэрэглэгчийг устгах уу?`)) return;
    deletion.mutate({ id: user.id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      onError: () => window.alert('Устгах боломжгүй байна. Өөрийн болон сүүлийн админы бүртгэлийг устгахгүй.'),
    });
  };
  return <div className="page-enter"><PageHeading eyebrow="Admin" title="Хэрэглэгчийн тохиргоо" detail="Нэвтрэх нэр, эрх болон нууц үгийг удирдана." />
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Бүх хэрэглэгч</h2><p className="mt-1 text-xs text-muted-foreground">Нууц үг хэзээ ч харагдахгүй.</p></div>
      {users.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : users.isError ? <ErrorBlock onRetry={() => users.refetch()} /> : <div className="divide-y divide-border">{users.data?.map((user) => <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" key={user.id} data-testid={`row-user-${user.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{user.username}</p><p className="mt-1 text-xs text-muted-foreground">{userRoleLabels[user.role] ?? user.role}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(user)} disabled={deletion.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-user-${user.id}`}><Trash2 className="size-4" />Устгах</Button></div></div>)}</div>}
    </section>
    {editing && <UserEditModal user={editing} onClose={() => setEditing(null)} />}
  </div>;
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
    if (role === 'accountant' && !['/hour-balance', '/payroll'].includes(location)) navigate('/hour-balance', { replace: true });
    if (role === 'warehouse' && !['/inventory', '/fixed-assets'].includes(location)) navigate('/inventory', { replace: true });
    if (role === 'viewer' && location !== '/') navigate('/', { replace: true });
  }, [location, navigate, role]);
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><LoadingBlock className="size-12" /></div>;
  if (!role) return <HrLogin />;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); navigate('/'); } });
  return <ErrorBoundary resetKey={location}><AppShell role={role} onLogout={signOut}>{role === 'admin' ? <Switch><Route path="/" component={Dashboard} /><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/deletion-requests" component={DeletionRequests} /><Route path="/users" component={UserSettings} /><Route component={NotFound} /></Switch> : role === 'hr' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route component={Employees} /></Switch> : role === 'accountant' ? <Switch><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route component={HourBalance} /></Switch> : role === 'viewer' ? <Switch><Route path="/" component={Dashboard} /><Route component={Dashboard} /></Switch> : <Switch><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route component={Inventory} /></Switch>}</AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;