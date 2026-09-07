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
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  LayoutDashboard,
  Menu,
  Pencil,
  Plus,
  Receipt,
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
  getGetPayrollAdvanceQueryKey,
  getGetPayrollQueryKey,
  getListAttendanceQueryKey,
  getListCashTransactionsQueryKey,
  getListEmployeesQueryKey,
  useCreateCashTransaction,
  useCreateEmployee,
  useDeleteEmployee,
  useGetCashSummary,
  useGetDashboard,
  useGetHourBalance,
  useGetPayroll,
  useGetPayrollAdvance,
  useListAttendance,
  useListCashTransactions,
  useListEmployees,
  useUpsertAttendance,
  useUpsertPayrollAdjustment,
  useApprovePayrollAdvance,
  useUpdateEmployee,
  type Employee,
  type PayrollLine,
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
const calendarDateLabel = (value: string) =>
  new Intl.DateTimeFormat('mn-MN', { weekday: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));

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

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p>
        <h1 className="font-sans text-3xl font-bold tracking-[-.04em] text-foreground sm:text-[2.25rem]" data-testid="heading-page">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p>
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

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = nav.find((item) => item.href === location)?.label ?? 'Тойм';
  return (
    <div className="min-h-[100dvh] bg-background app-grid">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')} data-testid="navigation-sidebar">
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
            <span><span className="block text-sm font-bold tracking-tight">АЖЛЫН ӨДӨР</span><span className="block font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">ops desk · 01</span></span>
          </Link>
          <button className="grid size-8 place-items-center rounded-lg hover:bg-sidebar-accent lg:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation"><X className="size-4" /></button>
        </div>
        <div className="mt-10 px-3 font-mono text-[9px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/40">Ажлын самбар</div>
        <nav className="mt-3 space-y-1" data-testid="navigation-main">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')} data-testid={`link-nav-${label}`}>
              <Icon className="size-[17px]" /><span>{label}</span>{location === href && <ChevronRight className="ml-auto size-4 opacity-60" />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/40 p-4">
          <div className="mb-3 flex items-center gap-2 text-sidebar-primary"><span className="size-2 rounded-full bg-sidebar-primary" /><span className="font-mono text-[10px] font-bold uppercase tracking-wider">Өнөөдрийн хэмнэл</span></div>
          <p className="text-xs leading-relaxed text-sidebar-foreground/65">Хамгийн чухал тоонууд нэг дэлгэцэнд. Өдөртөө итгэлтэй шийдвэр гаргаарай.</p>
        </div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Цэс хаах" data-testid="button-navigation-overlay" />}
      <main className="min-h-[100dvh] lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8" data-testid="top-header">
          <div className="flex items-center gap-3"><button className="grid size-9 place-items-center rounded-xl border border-border bg-card lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-navigation"><Menu className="size-4" /></button><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Өнөөдөр</p><p className="text-sm font-semibold">{active}</p></div></div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />Систем хэвийн</span><div className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground" data-testid="avatar-owner">ЭБ</div></div>
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

type EmployeeForm = { name: string; role: string; phone: string; employeeType: 'shift' | 'office'; baseSalary: string; socialInsuranceSalary: string; status?: 'active' | 'inactive' };

function EmployeeModal({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const isEdit = !!employee;
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const qc = useQueryClient();
  const form = useForm<EmployeeForm>({ defaultValues: { name: employee?.name ?? '', role: employee?.role ?? '', phone: employee?.phone ?? '', employeeType: employee?.employeeType ?? 'office', baseSalary: String(employee?.baseSalary ?? ''), socialInsuranceSalary: String(employee?.socialInsuranceSalary ?? ''), status: employee?.status ?? 'active' } });
  const submit = (values: EmployeeForm) => {
    const data = { name: values.name, role: values.role, phone: values.phone, employeeType: values.employeeType, baseSalary: Number(values.baseSalary), socialInsuranceSalary: Number(values.socialInsuranceSalary), ...(isEdit ? { status: values.status } : {}) };
    const done = () => { qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() }); onClose(); };
    if (isEdit && employee) update.mutate({ id: employee.id, data }, { onSuccess: done }); else create.mutate({ data }, { onSuccess: done });
  };
  const pending = create.isPending || update.isPending;
  return <Modal title={isEdit ? 'Ажилтны мэдээлэл засах' : 'Шинэ ажилтан бүртгэх'} detail="Ажилтны төрлөөс хамаарч өдрийн эсвэл сарын цалинг оруулна." onClose={onClose}><Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-employee"><div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Нэр<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" {...form.register('name', { required: 'Нэр оруулна уу' })} data-testid="input-employee-name" />{form.formState.errors.name && <span className="text-[11px] text-destructive">{form.formState.errors.name.message}</span>}</label><label className="space-y-2 text-xs font-semibold">Албан тушаал<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" {...form.register('role', { required: 'Албан тушаал оруулна уу' })} data-testid="input-employee-role" /></label><label className="space-y-2 text-xs font-semibold">Утас<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" {...form.register('phone')} data-testid="input-employee-phone" /></label><label className="space-y-2 text-xs font-semibold">Ажилтны төрөл<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('employeeType')} data-testid="select-employee-type"><option value="office">Оффис ажилтан</option><option value="shift">Ээлжийн ажилтан</option></select></label><label className="space-y-2 text-xs font-semibold">{form.watch('employeeType') === 'shift' ? 'Өдрийн цалин' : 'Сарын цалин'}<input type="number" min="0" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('baseSalary', { required: true, min: 0 })} data-testid="input-employee-salary" /></label><label className="space-y-2 text-xs font-semibold">НДШ тооцох цалин<input type="number" min="0" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('socialInsuranceSalary', { required: true, min: 0 })} data-testid="input-employee-social-insurance-salary" /></label>{isEdit && <label className="space-y-2 text-xs font-semibold">Төлөв<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('status')} data-testid="select-employee-status"><option value="active">Идэвхтэй</option><option value="inactive">Идэвхгүй</option></select></label>}</div><div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-employee">Болих</Button><Button type="submit" disabled={pending} data-testid="button-save-employee">{pending ? 'Хадгалж байна...' : isEdit ? 'Өөрчлөлт хадгалах' : 'Ажилтан нэмэх'}</Button></div></form></Form></Modal>;
}

function Employees() {
  const query = useListEmployees();
  const remove = useDeleteEmployee();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; employee?: Employee }>({ open: false });
  const [search, setSearch] = useState('');
  const employees = useMemo(() => (query.data ?? []).filter((e) => `${e.name} ${e.role} ${e.phone}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const del = (employee: Employee) => { if (window.confirm(`${employee.name}-г устгах уу?`)) remove.mutate({ id: employee.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); } }); };
  return <div className="page-enter"><PageHeading eyebrow="Хүний нөөц / directory" title="Ажилчид" detail="Ээлжийн болон оффис ажилтны цалин, НДШ-ийн суурийг нэг дор удирдана." action={<Button onClick={() => setModal({ open: true })} data-testid="button-add-employee"><Plus className="size-4" />Ажилтан нэмэх</Button>} /><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">Бүх ажилтан <span className="ml-1 font-mono text-xs text-muted-foreground">{query.data?.length ?? 0}</span></p><p className="mt-1 text-xs text-muted-foreground">Идэвхтэй ажилтны мэдээлэл шинэчлэгдэнэ.</p></div><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Нэрээр хайх" data-testid="input-search-employees" /></div></div>{query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : employees.length === 0 ? <EmptyState title="Ажилтан олдсонгүй" detail={search ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Эхний ажилтнаа бүртгэж эхлээрэй.'} icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Ажилтан</th><th className="px-5 py-3 font-bold">Утас</th><th className="px-5 py-3 font-bold">Ажилтны төрөл</th><th className="px-5 py-3 font-bold">Цалин</th><th className="px-5 py-3 font-bold">НДШ-ийн цалин</th><th className="px-5 py-3 font-bold">Төлөв</th><th className="px-5 py-3 text-right font-bold">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{employees.map((employee) => <tr className="group transition-colors hover:bg-secondary/35" key={employee.id} data-testid={`row-employee-${employee.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/30 text-xs font-bold text-foreground">{employee.name.slice(0, 1)}</span><div><p className="text-sm font-semibold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.role}</p></div></div></td><td className="px-5 py-4 text-sm text-muted-foreground">{employee.phone || '—'}</td><td className="px-5 py-4 text-sm">{employee.employeeType === EmployeeEmployeeType.office ? 'Оффис' : 'Ээлжийн'}</td><td className="px-5 py-4"><p className="font-mono text-sm">{money(employee.baseSalary)}</p><p className="text-[10px] text-muted-foreground">{employee.employeeType === EmployeeEmployeeType.office ? 'сарын' : 'өдрийн'}</p></td><td className="px-5 py-4 font-mono text-sm">{money(employee.socialInsuranceSalary)}</td><td className="px-5 py-4"><StatusPill value={employee.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setModal({ open: true, employee })} aria-label={`${employee.name} засах`} data-testid={`button-edit-employee-${employee.id}`}><Pencil className="size-4" /></button><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => del(employee)} aria-label={`${employee.name} устгах`} data-testid={`button-delete-employee-${employee.id}`}><Trash2 className="size-4" /></button></div></td></tr>)}</tbody></table></div>}</section>{modal.open && <EmployeeModal employee={modal.employee} onClose={() => setModal({ open: false })} />}</div>;
}

function AttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const days = useMemo(() => calendarDays(month), [month]);
  const query = useListAttendance({});
  const employees = useListEmployees();
  const upsert = useUpsertAttendance();
  const qc = useQueryClient();
  const attendanceMap = useMemo(() => new Map((query.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [query.data]);
  const activeEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active);
  const monthRows = activeEmployees.flatMap((employee) => days.map((day) => attendanceMap.get(`${employee.id}-${day}`))).filter(Boolean);
  const counts = monthRows.reduce((acc, row) => {
    if (!row) return acc;
    if (row.status === 'leave') acc.leave += 1;
    else if (Number(row.hours) === 12) acc.twelve += 1;
    else if (Number(row.hours) === 8) acc.eight += 1;
    return acc;
  }, { eight: 0, twelve: 0, leave: 0 });
  const setAttendance = (employeeId: number, date: string, value: string) => {
    if (!value) return;
    const isLeave = value === 'leave';
    const hours = isLeave ? 0 : Number(value);
    upsert.mutate({ data: { employeeId, date, status: isLeave ? 'leave' : 'present', hours } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
        qc.invalidateQueries({ queryKey: getGetHourBalanceQueryKey({ month: date.slice(0, 7) }) });
      },
    });
  };
  return <div className="page-enter">
    <PageHeading eyebrow="Сарын бүртгэл / attendance" title="Ирцийн календарь" detail="Сарын 1-нээс сүүлийн өдөр хүртэл ажилтан бүрийн цагийг сонгож бүртгэнэ." action={<div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-attendance-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-attendance-month" /></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} disabled={month >= currentMonth()} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label="Дараагийн сар" data-testid="button-attendance-next-month"><ChevronRight className="size-4" /></button></div>} />
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs"><span className="font-mono font-bold">{days[0]}</span><span className="mx-2 text-muted-foreground">—</span><span className="font-mono font-bold">{days[days.length - 1]}</span></div>
      {[['eight', '8 цаг'], ['twelve', '12 цаг'], ['leave', 'Чөлөө']].map(([key, label]) => <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs" key={key}><span className={cn('size-2.5 rounded-full', key === 'eight' ? 'bg-primary' : key === 'twelve' ? 'bg-accent' : 'bg-sky-300')} /><span className="font-mono font-bold">{counts[key as keyof typeof counts]}</span><span className="text-muted-foreground">{label}</span></div>)}
      <div className="ml-auto text-xs text-muted-foreground">Нүд бүрээс 8, 12 эсвэл Ч сонгоно</div>
    </div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="attendance-calendar">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Full month view</p><h2 className="mt-1 text-base font-bold">{month.replace('-', ' оны ')} сарын ирц</h2></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{days.length} хоног</span></div>
      {query.isLoading || employees.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError || employees.isError ? <ErrorBlock onRetry={() => { query.refetch(); employees.refetch(); }} /> : !activeEmployees.length ? <EmptyState title="Идэвхтэй ажилтан алга" detail="Эхлээд ажилтны бүртгэлээс ажилтан нэмнэ үү." icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full table-fixed text-left" style={{ minWidth: `${208 + days.length * 44}px` }}><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="sticky left-0 z-10 w-52 border-r border-border bg-secondary/95 px-5 py-3">Ажилтан</th>{days.map((day) => <th className={cn('w-11 px-1 py-3 text-center', day === today() && 'bg-accent/35 text-foreground')} key={day}><div className="text-[9px] uppercase">{calendarDateLabel(day).split(' ')[0]}</div><div className="mt-1 font-mono text-[11px]">{day.slice(8)}</div></th>)}</tr></thead><tbody className="divide-y divide-border">{activeEmployees.map((employee) => <tr key={employee.id} data-testid={`row-attendance-calendar-${employee.id}`}><td className="sticky left-0 z-10 border-r border-border bg-card px-5 py-3"><p className="truncate text-sm font-semibold">{employee.name}</p><p className="truncate text-[11px] text-muted-foreground">{employee.role}</p></td>{days.map((day) => { const row = attendanceMap.get(`${employee.id}-${day}`); const value = row?.status === 'leave' ? 'leave' : Number(row?.hours) === 12 ? '12' : Number(row?.hours) === 8 ? '8' : ''; return <td className={cn('border-l border-border/60 p-1 text-center', day === today() && 'bg-accent/10')} key={day}><select value={value} disabled={upsert.isPending} onChange={(event) => setAttendance(employee.id, day, event.target.value)} className={cn('mx-auto h-8 w-10 appearance-none rounded-lg border-0 text-center font-mono text-[10px] font-bold outline-none transition-colors focus:ring-2 focus:ring-primary/30', value === '8' ? 'bg-primary text-primary-foreground' : value === '12' ? 'bg-accent text-foreground' : value === 'leave' ? 'bg-sky-100 text-sky-800' : 'bg-secondary/60 text-muted-foreground/50')} aria-label={`${employee.name} ${day} цагийн сонголт`} data-testid={`select-attendance-${employee.id}-${day}`}><option value="" disabled>—</option><option value="8">8</option><option value="12">12</option><option value="leave">Ч</option></select></td>; })}</tr>)}</tbody></table></div>}
    </section>
    <p className="mt-3 text-xs text-muted-foreground">8: найман цаг · 12: арван хоёр цаг · Ч: чөлөөтэй өдөр</p>
  </div>;
}

function HourBalance() {
  const [month, setMonth] = useState(currentMonth());
  const query = useGetHourBalance({ month });
  const totals = (query.data ?? []).reduce((acc, row) => ({
    hours: acc.hours + row.totalHours,
    workDays: acc.workDays + row.workDays,
    eightHourDays: acc.eightHourDays + row.eightHourDays,
    twelveHourDays: acc.twelveHourDays + row.twelveHourDays,
  }), { hours: 0, workDays: 0, eightHourDays: 0, twelveHourDays: 0 });
  return <div className="page-enter">
    <PageHeading
      eyebrow="Сарын нийлбэр / hour balance"
      title="Цагийн баланс"
      detail="Ажилтан бүрийн сонгосон сарын нийт ажилласан цаг болон ээлжийн задаргааг харна."
      action={<div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-hour-balance-month" /></div>}
    />
    {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Нийт цаг" value={`${totals.hours} цаг`} meta={`${query.data?.length ?? 0} ажилтны нийлбэр`} icon={Timer} />
        <StatCard label="Ажилласан өдөр" value={`${totals.workDays} өдөр`} meta="Бүх ажилтны нийлбэр" icon={CalendarDays} tone="gold" />
        <StatCard label="8 цагийн ээлж" value={`${totals.eightHourDays}`} meta="Сонгосон сарын тоо" icon={Clock3} tone="blue" />
        <StatCard label="12 цагийн ээлж" value={`${totals.twelveHourDays}`} meta="Сонгосон сарын тоо" icon={Clock3} tone="orange" />
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card" data-testid="hour-balance-list">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Monthly register</p><h2 className="mt-1 text-base font-bold">{month.replace('-', ' оны ')} сарын цагийн жагсаалт</h2></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} ажилтан</span></div>
        {!query.data?.length ? <EmptyState title="Цагийн баланс хоосон" detail="Ажилтан болон ирцийн бүртгэл нэмэгдсэний дараа энд сарын нийлбэр гарна." icon={Timer} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-center">8 цаг</th><th className="px-5 py-3 text-center">12 цаг</th><th className="px-5 py-3 text-center">Чөлөө</th><th className="px-5 py-3 text-center">Ажилласан өдөр</th><th className="px-5 py-3 text-right">Нийт цаг</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((row) => <tr key={row.employeeId} className="transition-colors hover:bg-secondary/35" data-testid={`row-hour-balance-${row.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{row.employeeName}</p><p className="text-xs text-muted-foreground">{row.role}</p></td><td className="px-5 py-4 text-center font-mono text-sm">{row.eightHourDays}</td><td className="px-5 py-4 text-center font-mono text-sm">{row.twelveHourDays}</td><td className="px-5 py-4 text-center font-mono text-sm">{row.leaveDays}</td><td className="px-5 py-4 text-center font-mono text-sm">{row.workDays}</td><td className="px-5 py-4 text-right"><span className="inline-flex min-w-24 justify-center rounded-xl bg-primary px-3 py-2 font-mono text-sm font-bold text-primary-foreground" data-testid={`value-hour-balance-${row.employeeId}`}>{row.totalHours} цаг</span></td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}

type PayrollAdjustmentForm = {
  taxRelief: string;
  manualDeduction: string;
  paidAmount: string;
};

function PayrollAdjustmentModal({ line, month, onClose }: { line: PayrollLine; month: string; onClose: () => void }) {
  const save = useUpsertPayrollAdjustment();
  const qc = useQueryClient();
  const form = useForm<PayrollAdjustmentForm>({
    defaultValues: {
      taxRelief: String(line.taxRelief),
      manualDeduction: String(line.manualDeduction),
      paidAmount: String(line.paidAmount),
    },
  });
  const submit = (values: PayrollAdjustmentForm) => {
    save.mutate({
      data: {
        employeeId: line.employeeId,
        month,
        taxRelief: Number(values.taxRelief),
        manualDeduction: Number(values.manualDeduction),
        paidAmount: Number(values.paidAmount),
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
      <div className="rounded-xl border border-accent/50 bg-accent/15 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Урьдчилгаа цалин · 50%</span><strong className="font-mono text-sm">{money(line.advanceAmount)}</strong></div><p className="mt-1 text-[11px] text-muted-foreground">{line.employeeType === 'shift' ? 'Ажилласан хоног × өдрийн цалингаас 50%-иар автоматаар тооцно.' : 'Сарын үндсэн цалингаас 50%-иар автоматаар тооцно.'}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-xs font-semibold">ХХОАТ хөнгөлөлт<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('taxRelief', { required: true, min: 0 })} data-testid="input-payroll-tax-relief" /></label>
        <label className="space-y-2 text-xs font-semibold">Гараар оруулах суутгал<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('manualDeduction', { required: true, min: 0 })} data-testid="input-payroll-manual-deduction" /></label>
        <label className="space-y-2 text-xs font-semibold">Гүйлгээ хийсэн дүн<input type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('paidAmount', { required: true, min: 0 })} data-testid="input-payroll-paid-amount" /></label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">ХХОАТ хөнгөлөлт нь тооцсон ХХОАТ-аас хасагдана. Автоматаар бодсон 50%-ийн урьдчилгаа болон гараар оруулсан суутгал нь олгох цалингаас хасагдана.</p>
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={save.isPending} data-testid="button-save-payroll-adjustment">{save.isPending ? 'Хадгалж байна...' : 'Тохируулга хадгалах'}</Button></div>
    </form></Form>
  </Modal>;
}

function Payroll() {
  const [month, setMonth] = useState(currentMonth());
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const query = useGetPayroll({ month });
  const advanceQuery = useGetPayrollAdvance({ month });
  const qc = useQueryClient();
  const approveAdvance = useApprovePayrollAdvance();
  const totalAdvance = query.data?.lines.reduce((sum, line) => sum + line.advanceAmount, 0) ?? 0;
  const approve = () => {
    if (!window.confirm(`${month} сарын урьдчилгаа цалинг батлах уу? Баталсны дараа энэ жагсаалтын дүн өөрчлөгдөхгүй.`)) return;
    approveAdvance.mutate({ data: { month } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey({ month }) }),
    });
  };
  return <div className="page-enter">
    <PageHeading eyebrow="Сарын тооцоо / payroll" title="Цалингийн тойм" detail="Цалинг урьдчилгаа болон сүүл цалин гэж хоёр хуваана. Ээлжийн ажилтны цалинг ажилласан хоногоор тооцно." action={<div className="flex flex-wrap items-center justify-end gap-2"><Button onClick={() => setShowAdvance((value) => !value)} variant={showAdvance ? 'default' : 'outline'} data-testid="button-payroll-advance"><Coins className="size-4" />Урьдчилгаа цалин</Button><div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3"><CalendarDays className="size-4 text-primary" /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 bg-transparent text-sm outline-none" data-testid="input-payroll-month" /></div></div>} />
    {showAdvance && <section className="mb-6 overflow-hidden rounded-2xl border border-accent/60 bg-card shadow-sm" data-testid="section-payroll-advance">
      <div className="flex flex-col justify-between gap-4 border-b border-border bg-accent/10 px-5 py-4 sm:flex-row sm:items-center">
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Advance payroll</p><h2 className="mt-1 text-lg font-bold">{month.replace('-', ' оны ')} сарын урьдчилгаа цалин</h2><p className="mt-1 text-xs text-muted-foreground">Ээлжийн ажилтны дүнг сарын 1–15-нд ажилласан хоног × өдрийн цалингаас 50%-иар тооцно.</p></div>
        {advanceQuery.data?.approved ? <div className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="status-advance-approved"><Check className="mr-2 inline size-4" />Батлагдсан · {advanceQuery.data.approvedAt ? dateLabel(advanceQuery.data.approvedAt) : ''}</div> : <Button onClick={approve} disabled={approveAdvance.isPending || advanceQuery.isLoading} data-testid="button-approve-payroll-advance"><Check className="size-4" />{approveAdvance.isPending ? 'Баталж байна...' : 'Урьдчилгаа батлах'}</Button>}
      </div>
      {advanceQuery.isLoading ? <div className="p-5"><LoadingBlock className="h-36" /></div> : advanceQuery.isError ? <div className="p-5"><ErrorBlock onRetry={() => advanceQuery.refetch()} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-right">Үндсэн цалин</th><th className="px-5 py-3 text-right">Ажилласан хоног</th><th className="px-5 py-3 text-right">Өдрийн цалин</th><th className="px-5 py-3 text-right">Нийт олгох цалин</th><th className="px-5 py-3 text-right">Олгох урьдчилгаа</th></tr></thead>
          <tbody className="divide-y divide-border">{advanceQuery.data?.lines.map((line) => <tr key={line.employeeId}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.employeeType === 'shift' ? 'Ээлжийн ажилтан' : 'Оффис ажилтан'}</p></td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'office' ? money(line.baseSalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.daysWorked}</td><td className="px-5 py-4 text-right font-mono text-sm">{line.employeeType === 'shift' ? money(line.dailySalary) : '—'}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.totalSalary)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(line.advanceAmount)}</td></tr>)}</tbody>
          <tfoot className="border-t-2 border-border bg-secondary/35"><tr><td colSpan={5} className="px-5 py-4 text-right text-sm font-bold">Нийт олгох урьдчилгаа</td><td className="px-5 py-4 text-right font-mono text-base font-bold text-primary" data-testid="value-total-payroll-advance">{money(advanceQuery.data?.totalAmount)}</td></tr></tfoot>
        </table>
      </div>}
    </section>}
    {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><LoadingBlock className="h-28" /><LoadingBlock className="h-28" /><LoadingBlock className="h-28" /><LoadingBlock className="h-28" /><LoadingBlock className="h-28" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Нийт брутто" value={money(query.data?.totalGross)} meta="Суутгалын өмнө" icon={Banknote} />
        <StatCard label="НДШ 11.5%" value={money(query.data?.totalSocialInsurance)} meta="НДШ тооцох цалингаас" icon={Receipt} tone="blue" />
        <StatCard label="ХХОАТ 10%" value={money(query.data?.totalIncomeTax)} meta="Татвар ногдох орлогоос" icon={ArrowDownLeft} tone="orange" />
        <StatCard label="Урьдчилгаа цалин" value={money(totalAdvance)} meta="Тооцсон цалингийн 50%" icon={Coins} />
        <StatCard label="Сүүл цалин" value={money(query.data?.totalNet)} meta={`Нийт суутгал ${money(query.data?.totalDeductions)}`} icon={Coins} tone="gold" />
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Payroll register</p><h2 className="mt-1 text-base font-bold">{month.replace('-', ' оны ')} сарын задаргаа</h2></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.lines?.length ?? 0} мөр</span></div>
        {!query.data?.lines?.length ? <EmptyState title="Энэ сард цалин тооцоолоогүй" detail="Ирцийн бүртгэл нэмэгдсэний дараа энд ажилтны мөрүүд гарна." icon={Banknote} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1740px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3">Ажилласан</th><th className="px-5 py-3 text-right">Брутто</th><th className="px-5 py-3 text-right">НДШ</th><th className="px-5 py-3 text-right">ХХОАТ</th><th className="px-5 py-3 text-right">Хөнгөлөлт</th><th className="px-5 py-3 text-right">Урьдчилгаа цалин</th><th className="px-5 py-3 text-right">Бусад суутгал</th><th className="px-5 py-3 text-right">Сүүл цалин</th><th className="px-5 py-3 text-right">Гүйлгээ</th><th className="px-5 py-3 text-right">Дутуу</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.lines.map((line) => <tr key={line.employeeId} className="hover:bg-secondary/35" data-testid={`row-payroll-${line.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{line.employeeName}</p><p className="text-xs text-muted-foreground">{line.role}</p></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{line.daysWorked} өдөр · {line.hours}ц</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.gross)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.socialInsurance)}</td><td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground">{money(line.incomeTax)}</td><td className="px-5 py-4 text-right font-mono text-sm text-sky-700">{money(line.taxRelief)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.advanceAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.manualDeduction)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(line.payable)}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(line.paidAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-orange-800" data-testid={`value-payroll-remaining-${line.employeeId}`}>{money(line.remainingAmount)}</td><td className="px-5 py-4 text-right"><Button size="sm" variant="outline" onClick={() => setSelectedLine(line)} data-testid={`button-payroll-adjustment-${line.employeeId}`}><Pencil className="size-3.5" />Оруулах</Button></td></tr>)}</tbody></table></div>}
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

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/" component={Dashboard} /><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;