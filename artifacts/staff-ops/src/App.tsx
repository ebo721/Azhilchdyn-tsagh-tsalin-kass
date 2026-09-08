import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Timer,
  Trash2,
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
  getListEmployeesQueryKey,
  useCopyPreviousShiftPlans,
  useCreateCashTransaction,
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
  useListEmployees,
  useListShiftPlans,
  useListShifts,
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
  type Employee,
  type PayrollLine,
  type Shift,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const money = (value = 0) => `${new Intl.NumberFormat('mn-MN').format(value)} ₮`;
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('mn-MN', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
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
  { href: '/', label: 'Тойм', icon: LayoutDashboard },
  { href: '/employees', label: 'Ажилчид', icon: UsersRound },
  { href: '/attendance', label: 'Ирц', icon: Clock3 },
  { href: '/hour-balance', label: 'Цагийн баланс', icon: Timer },
  { href: '/payroll', label: 'Цалин', icon: Banknote },
  { href: '/cash', label: 'Касс', icon: WalletCards },
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
      {action}
    </div>
  );
}

function Modal({ title, detail, onClose, children }: { title: string; detail: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" data-testid="modal">
      <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-lg font-bold tracking-tight">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Цонх хаах" data-testid="button-close-modal"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AppShell({ children, role, onLogout }: { children: ReactNode; role: 'admin' | 'hr' | 'accountant'; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = role === 'hr'
    ? nav.filter((item) => ['/employees', '/attendance', '/hour-balance'].includes(item.href))
    : role === 'accountant'
      ? nav.filter((item) => ['/hour-balance', '/payroll'].includes(item.href))
      : nav;
  const active = visibleNav.find((item) => item.href === location)?.label ?? 'Тойм';
  return (
    <div className="min-h-[100dvh] bg-background app-grid">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')} data-testid="navigation-sidebar">
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
            <span className="text-sm font-bold tracking-tight">АЖЛЫН ӨДӨР</span>
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
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Цэс хаах" data-testid="button-navigation-overlay" />}
      <main className="min-h-[100dvh] lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8" data-testid="top-header">
          <div className="flex items-center gap-3"><button className="grid size-9 place-items-center rounded-xl border border-border bg-card lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-navigation"><Menu className="size-4" /></button><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Өнөөдөр</p><p className="text-sm font-semibold">{active}</p></div></div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />{role === 'hr' ? 'Хүний нөөцийн менежер' : role === 'accountant' ? 'Нягтлан' : 'Ерөнхий админ'}</span><button onClick={onLogout} className="grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Системээс гарах" data-testid="button-logout"><LogOut className="size-4" /></button><div className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground" data-testid="avatar-owner">{role === 'hr' ? 'HR' : role === 'accountant' ? 'НТ' : 'АД'}</div></div>
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
      <PageHeading eyebrow="Өглөөний товчоо / 09:42" title="Өдрийн зураглал" detail="Таны бизнесийн өнөөдрийн гол хөдөлгөөн эндээс эхэлнэ." action={<Link href="/attendance" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-dashboard-attendance"><Clock3 className="size-4" />Ирц бүртгэх</Link>} />
      {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Нийт ажилтан" value={`${data?.employeeCount ?? 0}`} meta="Бүртгэлтэй ажилтан" icon={UsersRound} />
            <StatCard label="Өнөөдөр ирсэн" value={`${data?.presentToday ?? 0} хүн`} meta="Ирцийн бүртгэлээс" icon={Check} tone="gold" />
            <StatCard label="Энэ сарын цалин" value={money(data?.monthlyPayroll)} meta="Тооцоолсон нийт дүн" icon={Banknote} tone="blue" />
            <StatCard label="Кассын үлдэгдэл" value={money(data?.cashBalance)} meta="Одоогийн бэлэн мөнгө" icon={WalletCards} tone="orange" />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
            <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-recent-activity">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Live log</p><h2 className="mt-1 text-base font-bold">Сүүлийн хөдөлгөөн</h2></div><Activity className="size-4 text-muted-foreground" /></div>
              {data?.recentActivity?.length ? <div className="divide-y divide-border">{data.recentActivity.map((item) => <div className="flex gap-4 px-5 py-4 transition-colors hover:bg-secondary/45" key={item.id} data-testid={`row-activity-${item.id}`}><div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Activity className="size-4" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p></div><time className="shrink-0 font-mono text-[10px] text-muted-foreground">{dateLabel(item.createdAt)}</time></div>)}</div> : <EmptyState title="Одоогоор хөдөлгөөн алга" detail="Ирц, цалин эсвэл кассын шинэ бүртгэл энд харагдана." icon={Activity} />}
            </section>
            <section className="rounded-2xl bg-primary p-6 text-primary-foreground" data-testid="panel-quick-actions">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-accent">Quick actions</p><h2 className="mt-3 max-w-xs text-2xl font-bold leading-tight tracking-[-.03em]">Өдрийн ажлыг замбараатай эхлүүл.</h2>
              <div className="mt-7 space-y-2">{[{ href: '/employees', label: 'Ажилтан нэмэх', icon: UserRound }, { href: '/payroll', label: 'Цалингийн тойм харах', icon: Receipt }, { href: '/cash', label: 'Кассын гүйлгээ оруулах', icon: Coins }].map(({ href, label, icon: Icon }) => <Link href={href} key={href} className="flex items-center gap-3 rounded-xl border border-primary-foreground/15 bg-primary-foreground/8 px-3 py-3 text-sm font-semibold transition-colors hover:bg-primary-foreground/15" data-testid={`link-quick-${label}`}><Icon className="size-4 text-accent" />{label}<ChevronRight className="ml-auto size-4 opacity-60" /></Link>)}</div>
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
  const remove = useDeleteEmployee();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; employee?: Employee }>({ open: false });
  const [search, setSearch] = useState('');
  const employees = useMemo(() => (query.data ?? []).filter((e) => `${e.name} ${e.role} ${e.phone}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const del = (employee: Employee) => { if (window.confirm(`${employee.name}-г устгах уу?`)) remove.mutate({ id: employee.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }, onError: () => window.alert('Ирц бүртгэгдсэн эсвэл цалин олгосон ажилтанг устгах боломжгүй.') }); };
  return <div className="page-enter"><div className="mb-6 flex justify-end"><Button onClick={() => setModal({ open: true })} data-testid="button-add-employee"><Plus className="size-4" />Ажилтан нэмэх</Button></div><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">Бүх ажилтан <span className="ml-1 font-mono text-xs text-muted-foreground">{query.data?.length ?? 0}</span></p><p className="mt-1 text-xs text-muted-foreground">Идэвхтэй ажилтны мэдээлэл шинэчлэгдэнэ.</p></div><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Нэрээр хайх" data-testid="input-search-employees" /></div></div>{query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : employees.length === 0 ? <EmptyState title="Ажилтан олдсонгүй" detail={search ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Эхний ажилтнаа бүртгэж эхлээрэй.'} icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Ажилтан</th><th className="px-5 py-3 font-bold">Утас</th><th className="px-5 py-3 font-bold">Ажилтны төрөл</th><th className="px-5 py-3 font-bold">Цалин</th><th className="px-5 py-3 font-bold">НДШ-ийн цалин</th><th className="px-5 py-3 font-bold">Төлөв</th><th className="px-5 py-3 text-right font-bold">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{employees.map((employee) => <tr className="group transition-colors hover:bg-secondary/35" key={employee.id} data-testid={`row-employee-${employee.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/30 text-xs font-bold text-foreground">{employee.name.slice(0, 1)}</span><div><p className="text-sm font-semibold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.role}</p></div></div></td><td className="px-5 py-4 text-sm text-muted-foreground">{employee.phone || '—'}</td><td className="px-5 py-4 text-sm">{employee.employeeType === EmployeeEmployeeType.office ? 'Оффис' : 'Ээлжийн'}</td><td className="px-5 py-4"><p className="font-mono text-sm">{money(employee.baseSalary)}</p><p className="text-[10px] text-muted-foreground">{employee.employeeType === EmployeeEmployeeType.office ? 'сарын' : 'өдрийн'}</p></td><td className="px-5 py-4 font-mono text-sm">{money(employee.socialInsuranceSalary)}</td><td className="px-5 py-4"><StatusPill value={employee.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setModal({ open: true, employee })} aria-label={`${employee.name} засах`} data-testid={`button-edit-employee-${employee.id}`}><Pencil className="size-4" /></button>{session.data?.role === 'admin' && <button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => del(employee)} aria-label={`${employee.name} устгах`} data-testid={`button-delete-employee-${employee.id}`}><Trash2 className="size-4" /></button>}</div></td></tr>)}</tbody></table></div>}</section>{modal.open && <EmployeeModal employee={modal.employee} onClose={() => setModal({ open: false })} />}</div>;
}

type ShiftForm = { name: string; startTime: string; endTime: string };

function ShiftSettingsModal({ onClose }: { onClose: () => void }) {
  const shifts = useListShifts();
  const create = useCreateShift();
  const update = useUpdateShift();
  const remove = useDeleteShift();
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
    if (!window.confirm(`${shift.name} ээлжийг устгах уу?`)) return;
    remove.mutate({ id: shift.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListShiftsQueryKey() }) });
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
      {remove.isError && <p className="mt-2 text-xs text-destructive">Төлөвлөгөөнд ашигласан ээлжийг устгах боломжгүй.</p>}
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
  const clearAttendance = useDeleteAttendance();
  const upsertPlan = useUpsertShiftPlan();
  const copyPreviousPlans = useCopyPreviousShiftPlans();
  const qc = useQueryClient();
  const attendanceMap = useMemo(() => new Map((query.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [query.data]);
  const planMap = useMemo(() => new Map((plans.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [plans.data]);
  const activeEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active);
  const setAttendance = (employeeId: number, date: string, value: string) => {
    const refreshAttendance = () => {
      qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
      qc.invalidateQueries({ queryKey: getGetHourBalanceQueryKey({ month: date.slice(0, 7) }) });
    };
    if (!value) {
      clearAttendance.mutate({ params: { employeeId, date } }, { onSuccess: refreshAttendance });
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
    const sourceMonth = shiftMonth(month, -1);
    if (!window.confirm(`${sourceMonth} сарын ээлжийн төлөвлөгөөг ${month} сар руу хуулах уу?`)) return;
    const hasExistingPlans = Boolean(plans.data?.length);
    const overwrite = hasExistingPlans
      ? window.confirm(`${month} сард аль хэдийн төлөвлөсөн ээлж байна. Давхардсан өдрүүдийг дарж бичих үү?\n\n“Цуцлах” сонговол одоо байгаа ээлжүүдийг хэвээр үлдээн, зөвхөн хоосон өдрүүдийг хуулна.`)
      : false;
    copyPreviousPlans.mutate({ data: { month, overwrite } }, {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListShiftPlansQueryKey({ month }) });
        window.alert(`${result.sourceMonth} сараас ${result.copied} ээлж хууллаа.${result.overwritten ? ` ${result.overwritten} ээлжийг дарж бичлээ.` : ''}${result.skipped ? ` ${result.skipped} давхардлыг алгаслаа.` : ''}${result.unavailableDates ? ` Шинэ сард байхгүй ${result.unavailableDates} өдрийг алгаслаа.` : ''}`);
      },
    });
  };
  return <div className="page-enter">
    <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="outline" onClick={copyPreviousMonth} disabled={copyPreviousPlans.isPending || plans.isLoading} data-testid="button-copy-previous-shift-plans"><Copy className="size-4" />{copyPreviousPlans.isPending ? 'Хуулж байна...' : 'Өмнөх сараас хуулах'}</Button><Button variant="outline" onClick={() => setSettingsOpen(true)} data-testid="button-shift-settings"><Clock3 className="size-4" />Ээлжийн тохиргоо</Button><div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-attendance-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-attendance-month" /></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-attendance-next-month"><ChevronRight className="size-4" /></button></div></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="attendance-calendar">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Full month view</p><h2 className="mt-1 text-base font-bold">{month.replace('-', ' оны ')} сарын ирц</h2></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{days.length} хоног</span></div>
      {query.isLoading || employees.isLoading || shifts.isLoading || plans.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError || employees.isError || shifts.isError || plans.isError ? <ErrorBlock onRetry={() => { query.refetch(); employees.refetch(); shifts.refetch(); plans.refetch(); }} /> : !activeEmployees.length ? <EmptyState title="Идэвхтэй ажилтан алга" detail="Эхлээд ажилтны бүртгэлээс ажилтан нэмнэ үү." icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full table-fixed text-left" style={{ minWidth: `${208 + days.length * 84}px` }}><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="sticky left-0 z-10 w-52 border-r border-border bg-secondary/95 px-5 py-3">Ажилтан</th>{days.map((day) => <th className={cn('w-[84px] px-1 py-3 text-center', day === today() && 'bg-accent/35 text-foreground')} key={day}><div className="font-mono text-[11px]">{day.slice(8)}</div><div className="mt-1 text-[9px] uppercase">{mongolianWeekdayLabel(day)}</div></th>)}</tr></thead><tbody className="divide-y divide-border">{activeEmployees.map((employee) => <tr key={employee.id} data-testid={`row-attendance-calendar-${employee.id}`}><td className="sticky left-0 z-10 border-r border-border bg-card px-5 py-3"><p className="truncate text-sm font-semibold">{employee.name}</p><p className="truncate text-[11px] text-muted-foreground">{employee.role}</p><p className="mt-1 text-[10px] font-medium text-primary">{employee.employeeType === EmployeeEmployeeType.shift ? 'Ээлжийн' : 'Оффис'}</p></td>{days.map((day) => { const row = attendanceMap.get(`${employee.id}-${day}`); const plan = planMap.get(`${employee.id}-${day}`); const value = row?.status === 'leave' ? 'leave' : row ? 'worked' : ''; const isShiftEmployee = employee.employeeType === EmployeeEmployeeType.shift; return <td className={cn('border-l border-border/60 p-1 text-center', day === today() && 'bg-accent/10')} key={day}>{isShiftEmployee && <select value={plan?.shiftId ?? ''} disabled={upsertPlan.isPending} onChange={(event) => setPlan(employee.id, day, event.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-1 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-primary/30" aria-label={`${employee.name} ${day} ээлж`} data-testid={`select-shift-plan-${employee.id}-${day}`}><option value="">Ээлжгүй</option>{shifts.data?.map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}</select>}<select value={value} disabled={upsert.isPending || clearAttendance.isPending} onChange={(event) => setAttendance(employee.id, day, event.target.value)} className={cn(isShiftEmployee && 'mt-1', 'h-7 w-full rounded-md border-0 text-center font-mono text-[10px] font-bold outline-none transition-colors focus:ring-2 focus:ring-primary/30', value === 'worked' ? 'bg-primary text-primary-foreground' : value === 'leave' ? 'bg-sky-100 text-sky-800' : 'bg-secondary/60 text-muted-foreground/60')} aria-label={`${employee.name} ${day} ирц`} data-testid={`select-attendance-${employee.id}-${day}`}><option value="">Ирц</option><option value="worked">Ажилласан</option><option value="leave">Чөлөө</option></select></td>; })}</tr>)}</tbody></table></div>}
    </section>
    <p className="mt-3 text-xs text-muted-foreground">Ээлжийн төлөвлөгөө нь бодит ирцээс тусдаа хадгалагдана. Цалин зөвхөн доод мөрийн бодит ирцээр бодогдоно.</p>
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
};

function PayrollAdjustmentModal({ line, month, onClose }: { line: PayrollLine; month: string; onClose: () => void }) {
  const save = useUpsertPayrollAdjustment();
  const qc = useQueryClient();
  const form = useForm<PayrollAdjustmentForm>({
    defaultValues: {
      manualDeduction: String(line.manualDeduction),
      paidAmount: String(line.paidAmount),
      paymentDate: line.paymentDate ?? today(),
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
      <div className="rounded-xl border border-accent/50 bg-accent/15 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{line.employeeType === 'shift' ? 'Урьдчилгаа цалин · 1–15-ны бүтэн цалин' : 'Урьдчилгаа цалин · 50%'}</span><strong className="font-mono text-sm">{money(line.advanceAmount)}</strong></div><p className="mt-1 text-[11px] text-muted-foreground">{line.employeeType === 'shift' ? 'Сарын 1–15-нд ажилласан хоног × өдрийн цалингаар бүтэн тооцно.' : 'Сарын үндсэн цалингаас 50%-иар автоматаар тооцно.'}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-xs font-semibold"><span>ХХОАТ хөнгөлөлт</span><div className="mt-1 flex h-10 w-full items-center rounded-lg border border-input bg-secondary/40 px-3 font-mono text-sm">{money(line.taxRelief)}</div><p className="text-[11px] font-normal text-muted-foreground">НДШ тооцох цалингийн шатлалаар автоматаар тооцно.</p></div>
        <label className="space-y-2 text-xs font-semibold">Гараар оруулах суутгал<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('manualDeduction', { required: true, min: 0 })} data-testid="input-payroll-manual-deduction" /></label>
        <label className="space-y-2 text-xs font-semibold">Гүйлгээ хийсэн дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label>
        <label className="space-y-2 text-xs font-semibold">Гүйлгээ хийсэн огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('paymentDate')} data-testid="input-payroll-payment-date" /><span className="text-[11px] font-normal text-muted-foreground">Олгосон дүн 0-ээс их үед кассын зарлагад бүртгэгдэнэ.</span></label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">ХХОАТ хөнгөлөлт нь тооцсон ХХОАТ-аас хасагдана. Оффис ажилтны 50%-ийн урьдчилгаа, ээлжийн ажилтны 1–15-ны бүтэн цалин болон гараар оруулсан суутгал нь сүүл цалингаас хасагдана.</p>
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={save.isPending} data-testid="button-save-payroll-adjustment">{save.isPending ? 'Хадгалж байна...' : 'Тохируулга хадгалах'}</Button></div>
    </form></Form>
  </Modal>;
}

function Payroll() {
  const [month, setMonth] = useState(currentMonth());
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [advanceDates, setAdvanceDates] = useState<Record<number, string>>({});
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month });
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const approveAdvance = useApprovePayrollAdvance();
  const revertAdvanceApproval = useRevertPayrollAdvanceApproval();
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
    if (!window.confirm(`${month} сарын урьдчилгаа цалингийн батлалтыг буцаах уу?`)) return;
    revertAdvanceApproval.mutate({ params: { month } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey({ month }) });
      },
    });
  };
  const setAdvancePaid = (employeeId: number, paid: boolean, existingDate?: string | null) => {
    const paymentDate = paid ? (advanceDates[employeeId] || existingDate || today()) : null;
    updateAdvancePayment.mutate({ data: { month, employeeId, paid, paymentDate } }, {
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
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Advance payroll</p><h2 className="mt-1 text-lg font-bold">{month.replace('-', ' оны ')} сарын урьдчилгаа цалин</h2><p className="mt-1 text-xs text-muted-foreground">Ээлжийн ажилтан сарын 1–15-нд ажилласан хоногийн бүтэн цалингаа, оффис ажилтан үндсэн цалингийн 50%-ийг авна.</p></div>
        {advanceQuery.data?.approved ? <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="status-advance-approved"><Check className="mr-2 inline size-4" />Батлагдсан · {advanceQuery.data.approvedAt ? dateLabel(advanceQuery.data.approvedAt) : ''}</div>{session.data?.role === 'admin' && <Button variant="outline" onClick={revertApproval} disabled={revertAdvanceApproval.isPending} data-testid="button-revert-payroll-advance">{revertAdvanceApproval.isPending ? 'Буцааж байна...' : 'Батлалт буцаах'}</Button>}</div> : <Button onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading} data-testid="button-approve-payroll-advance"><Check className="size-4" />{approveAdvance.isPending ? 'Баталж байна...' : 'Урьдчилгаа батлах'}</Button>}
      </div>
      {advanceQuery.isLoading ? <div className="p-5"><LoadingBlock className="h-36" /></div> : advanceQuery.isError ? <div className="p-5"><ErrorBlock onRetry={() => advanceQuery.refetch()} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">Ажилласан хоног</th><th className="px-5 py-3 text-right">Өдрийн цалин</th><th className="px-5 py-3 text-right">Нийт олгох цалин</th><th className="px-5 py-3 text-right">Олгох урьдчилгаа</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th></tr></thead>
          <tbody className="divide-y divide-border">{advanceQuery.data?.lines.map((line) => <tr key={line.employeeId}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.employeeType === 'shift' ? 'Ээлжийн ажилтан' : 'Оффис ажилтан'}</p></td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'office' ? money(line.baseSalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.daysWorked}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'shift' ? money(line.dailySalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.totalSalary)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(line.advanceAmount)}</td><td className="px-5 py-4 text-center"><input type="date" value={advanceDates[line.employeeId] ?? line.paymentDate ?? today()} disabled={!advanceQuery.data?.approved || line.paid} onChange={(event) => setAdvanceDates((dates) => ({ ...dates, [line.employeeId]: event.target.value }))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-primary" data-testid={`input-advance-payment-date-${line.employeeId}`} /></td><td className="px-5 py-4 text-center">{advanceQuery.data?.approved ? <Button size="sm" variant={line.paid ? 'default' : 'outline'} disabled={updateAdvancePayment.isPending} onClick={() => setAdvancePaid(line.employeeId, !line.paid, line.paymentDate)} data-testid={`button-advance-paid-${line.employeeId}`}>{line.paid ? <><Check className="size-3.5" />Олгосон</> : 'Олгоогүй'}</Button> : <span className="text-xs text-muted-foreground">Батлаагүй</span>}</td></tr>)}</tbody>
          <tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={5} className="px-5 py-4 text-right text-sm font-bold">Нийт олгох урьдчилгаа</td><td className="px-5 py-4 text-right font-mono text-base font-bold text-primary" data-testid="value-total-payroll-advance">{money(advanceQuery.data?.totalAmount)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>}
      {revertAdvanceApproval.isError && <p className="border-t border-border bg-destructive/5 px-5 py-3 text-xs font-medium text-destructive">Олгосон урьдчилгаа байвал эхлээд тухайн мөрийг “Олгоогүй” болгоно уу.</p>}
    </section>}
    {query.isLoading ? <div className="space-y-3 rounded-2xl border border-border bg-card p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Payroll register</p><h2 className="mt-1 text-base font-bold">{month.replace('-', ' оны ')} сарын задаргаа</h2></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.lines?.length ?? 0} мөр</span></div>
        {!query.data?.lines?.length ? <EmptyState title="Энэ сард цалин тооцоолоогүй" detail="Ирцийн бүртгэл нэмэгдсэний дараа энд ажилтны мөрүүд гарна." icon={Banknote} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1960px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3">Ажилласан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">НДШ</th><th className="px-5 py-3 text-right">ХХОАТ</th><th className="px-5 py-3 text-right">Хөнгөлөлт</th><th className="px-5 py-3 text-right">Урьдчилгаа цалин</th><th className="px-5 py-3 text-right">Бусад суутгал</th><th className="px-5 py-3 text-right">Сүүл цалин</th><th className="px-5 py-3 text-right">Олгосон дүн</th><th className="px-5 py-3 text-center">Гүйлгээний огноо</th><th className="px-5 py-3 text-center">Төлөв</th><th className="px-5 py-3 text-right">Дутуу</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.lines.map((line) => <tr key={line.employeeId} className="hover:bg-secondary/35" data-testid={`row-payroll-${line.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.role}</p></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{line.daysWorked} өдөр · {line.hours}ц</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.gross)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.socialInsurance)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.incomeTax)}</td><td className="px-5 py-4 text-right font-mono text-sm text-sky-700">{money(line.taxRelief)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.advanceAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.manualDeduction)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(line.payable)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.paidAmount)}</td><td className="px-5 py-4 text-center font-mono text-xs text-muted-foreground">{line.paymentDate ?? '—'}</td><td className="px-5 py-4 text-center"><span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', line.paidAmount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} data-testid={`status-payroll-paid-${line.employeeId}`}>{line.paidAmount > 0 ? 'Олгосон' : 'Олгоогүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-orange-800" data-testid={`value-payroll-remaining-${line.employeeId}`}>{money(line.remainingAmount)}</td><td className="px-5 py-4 text-right"><Button size="sm" variant="outline" onClick={() => setSelectedLine(line)} data-testid={`button-payroll-adjustment-${line.employeeId}`}><Pencil className="size-3.5" />Оруулах</Button></td></tr>)}</tbody></table></div>}
      </section>
    </>}
    {selectedLine && <PayrollAdjustmentModal line={selectedLine} month={month} onClose={() => setSelectedLine(null)} />}
  </div>;
}

type CashForm = { type: 'income' | 'expense'; category: string; description: string; amount: string; date: string };
function Cash() {
  const summary = useGetCashSummary();
  const list = useListCashTransactions();
  const create = useCreateCashTransaction();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<CashForm>({ defaultValues: { type: 'income', category: '', description: '', amount: '', date: today() } });
  const submit = (v: CashForm) => create.mutate({ data: { type: v.type, category: v.category, description: v.description, amount: Number(v.amount), date: v.date } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); form.reset({ type: 'income', category: '', description: '', amount: '', date: today() }); setOpen(false); } });
  return <div className="page-enter"><PageHeading eyebrow="Бэлэн мөнгө / cash desk" title="Касс" detail="Орлого, зарлага, үлдэгдлийн хөдөлгөөнийг өдөр тутамд цэгцтэй хөтөлнө." action={<Button onClick={() => setOpen(true)} data-testid="button-add-cash"><Plus className="size-4" />Гүйлгээ оруулах</Button>} />{summary.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : summary.isError ? <ErrorBlock onRetry={() => summary.refetch()} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Кассын үлдэгдэл" value={money(summary.data?.balance)} meta="Бүх хугацааны цэвэр дүн" icon={WalletCards} tone="gold" /><StatCard label="Нийт орлого" value={money(summary.data?.income)} meta="Бүх орсон мөнгө" icon={ArrowDownLeft} /><StatCard label="Нийт зарлага" value={money(summary.data?.expense)} meta="Бүх гарсан мөнгө" icon={ArrowUpRight} tone="orange" /><StatCard label="Өнөөдрийн цэвэр" value={money((summary.data?.todayIncome ?? 0) - (summary.data?.todayExpense ?? 0))} meta={`Орлого ${money(summary.data?.todayIncome)}`} icon={CalendarDays} tone="blue" /></div>}<section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Cash ledger</p><h2 className="mt-1 text-base font-bold">Сүүлийн гүйлгээ</h2></div>{list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Гүйлгээний түүх хоосон" detail="Эхний орлого эсвэл зарлагаа оруулаарай." icon={WalletCards} /> : <div className="divide-y divide-border">{list.data.map((row) => <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/35" key={row.id} data-testid={`row-cash-${row.id}`}><span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', row.type === CashTransactionType.income ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>{row.type === CashTransactionType.income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{row.description}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.category} · {dateLabel(row.date)}</p></div><p className={cn('font-mono text-sm font-bold', row.type === CashTransactionType.income ? 'text-primary' : 'text-orange-800')}>{row.type === CashTransactionType.income ? '+' : '−'}{money(row.amount)}</p></div>)}</div>}</section>{open && <Modal title="Кассын гүйлгээ" detail="Гүйлгээний төрлийг зөв сонгож, дүнг бүхэл тоогоор оруулна." onClose={() => setOpen(false)}><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-cash"><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1"><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'income' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'income')} data-testid="button-cash-income">Орлого</button><button type="button" className={cn('rounded-lg py-2.5 text-sm font-bold', form.watch('type') === 'expense' ? 'bg-card text-orange-800 shadow-sm' : 'text-muted-foreground')} onClick={() => form.setValue('type', 'expense')} data-testid="button-cash-expense">Зарлага</button></div><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Ангилал<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('category', { required: true })} placeholder="Жишээ: Борлуулалт" data-testid="input-cash-category" /></label><label className="space-y-2 text-xs font-semibold">Дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('amount', { required: true, min: 0 })} data-testid="input-cash-amount" /></label></div><label className="block space-y-2 text-xs font-semibold">Тайлбар<input className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('description', { required: true })} placeholder="Гүйлгээний утга" data-testid="input-cash-description" /></label><label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-cash-date" /></label><div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-cash">Болих</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-cash">{create.isPending ? 'Хадгалж байна...' : 'Гүйлгээ хадгалах'}</Button></div></form></Form></Modal>}</div>;
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
  const role = session.data?.authenticated && (session.data.role === 'hr' || session.data.role === 'admin' || session.data.role === 'accountant') ? session.data.role : null;
  useEffect(() => {
    if (role === 'hr' && !['/employees', '/attendance', '/hour-balance'].includes(location)) navigate('/employees', { replace: true });
    if (role === 'accountant' && !['/hour-balance', '/payroll'].includes(location)) navigate('/hour-balance', { replace: true });
  }, [location, navigate, role]);
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><LoadingBlock className="size-12" /></div>;
  if (!role) return <HrLogin />;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); navigate('/'); } });
  return <ErrorBoundary resetKey={location}><AppShell role={role} onLogout={signOut}>{role === 'admin' ? <Switch><Route path="/" component={Dashboard} /><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route component={NotFound} /></Switch> : role === 'hr' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route component={Employees} /></Switch> : <Switch><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route component={HourBalance} /></Switch>}</AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;