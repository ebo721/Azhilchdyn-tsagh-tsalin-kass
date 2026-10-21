import { useState } from 'react';
import { Link } from 'wouter';
import { Activity, Banknote, PackageOpen, Receipt, TrendingUp, Wrench } from 'lucide-react';
import { useGetDashboard } from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, StatCard } from '@/components/ui-primitives';
import { MonthNavigator } from '@/components/MonthNavigator';
import { currentMonth, dateLabel, money, mongolianMonthLabel } from '@/lib/app-shared';

export function Dashboard() {
  const [month, setMonth] = useState(currentMonth);
  const query = useGetDashboard({ month });
  const data = query.data && query.data.month === month ? query.data : undefined;
  const label = mongolianMonthLabel(month);
  const status = data?.payrollStatus;
  const payrollLink = `/payroll?month=${month}`;
  const statusText: Record<string, string> = { saved: 'Хадгалсан бодолт', stale: 'Шинэчлэх шаардлагатай', closed: 'Сар хаагдсан', missing: 'Бодоогүй' };
  return (
    <div className="page-enter">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">Сонгосон сарын үзүүлэлт</p>
        <MonthNavigator month={month} onChange={setMonth} prefix="dashboard" ariaLabel="Статистикийн сар сонгох" />
      </div>
      {query.isLoading || (query.isFetching && !data && !query.isError) ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="status-dashboard-loading">{[0, 1, 2, 3, 4, 5].map((i) => <LoadingBlock key={i} className="h-36" />)}</div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : !data ? <EmptyState title="Мэдээлэл алга" detail={`${label}-д харуулах мэдээлэл олдсонгүй.`} icon={Activity} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label={`${label} борлуулалт`} value={money(data.salesIncome)} meta="Орлогын сараар оноосон кассын орлого" icon={TrendingUp} tone="gold" valueTestId="value-dashboard-sales" />
            <StatCard label={`${label} нийт цалин`} value={data.payrollGross === null ? 'Тооцоогүй' : money(data.payrollGross)} meta="Урьдчилгаа, суутгалын өмнөх нийт" icon={Banknote} tone="blue" valueTestId="value-dashboard-payroll" />
            <StatCard label={`${label} бараа материал`} value={money(data.inventoryPurchaseTotal)} meta="Баримтын огноогоор, төлөгдөөгүйг оруулан" icon={PackageOpen} tone="teal" valueTestId="value-dashboard-inventory" />
            <StatCard label={`${label} хангамж`} value={money(data.supplyPurchaseTotal)} meta="Баримтын огноогоор, төлөгдөөгүйг оруулан" icon={Receipt} tone="orange" valueTestId="value-dashboard-supply" />
            <StatCard label={`${label} үйл ажиллагааны зардал`} value={money(data.operatingExpenseTotal)} meta="Баримтын огноогоор, төлөгдөөгүйг оруулан" icon={Wrench} tone="gold" valueTestId="value-dashboard-operating" />
          </div>
          <section className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="panel-dashboard-payroll">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">Цалингийн задаргаа</h2>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold" data-testid="status-dashboard-payroll">{statusText[status ?? 'missing']}</span>
            </div>
            <div className="mt-4"><p className="text-xs text-muted-foreground">Оффисын gross</p><p className="font-mono text-lg font-bold" data-testid="value-dashboard-office-payroll">{data.officePayrollGross === null ? 'Тооцоогүй' : money(data.officePayrollGross)}</p></div>
            {status === 'missing' && <p className="mt-4 text-sm" data-testid="text-dashboard-payroll-missing">Энэ сарын цалин тооцоогүй байна (тэг биш). <Link href={payrollLink} className="font-semibold text-primary underline" data-testid="link-dashboard-payroll">Цалин хуудас руу очих</Link></p>}
            {status === 'stale' && <p className="mt-4 text-sm" data-testid="text-dashboard-payroll-stale">Хадгалсан дүнг харуулж байна. Ирц өөрчлөгдсөн тул <Link href={payrollLink} className="font-semibold text-primary underline">Цалин хуудаснаас</Link> цагийг өөрөө татна уу.</p>}
            {status === 'closed' && <p className="mt-4 text-sm" data-testid="text-dashboard-payroll-closed">Сар хаагдсан, дүн түгжигдсэн.</p>}
            {data.payrollPulledAt && status !== 'missing' && <p className="mt-1 text-xs text-muted-foreground">Ирц татсан: {dateLabel(data.payrollPulledAt)}</p>}
            {data.payrollGross !== null && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ээлжээр (ажилласан өдрийн харьцаагаар)</h3>
                {data.payrollByShift.length ? <div className="mt-2 divide-y divide-border">{data.payrollByShift.map((row) => <div className="flex items-center justify-between gap-3 py-2 text-sm" key={row.shiftId ?? 'unassigned'} data-testid={`row-dashboard-shift-${row.shiftId ?? 'unassigned'}`}><span>{row.shiftId === null ? `${row.shiftName} (хуваарьгүй)` : row.shiftName}</span><span className="font-mono font-semibold">{money(row.gross)}</span></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Ээлжийн цалин алга.</p>}
                <p className="mt-2 text-xs text-muted-foreground">Олон ээлжид ажилласан хүний gross ажилласан өдрийн тоогоор хуваагдана. Ээлжид оноогдоогүй өдөр нэрлэсэн бүлэгт орно. Хадгалсан дүнг энд дахин бодохгүй.</p>
              </div>
            )}
          </section>
          <p className="mt-3 text-xs text-muted-foreground">Худалдан авалтад төлөгдөөгүй баримт болон барааны дэлгэрэнгүй бүртгэл хүлээгдэж буй банкны худалдан авалтыг оруулсан. Эхний үлдэгдэл орохгүй.</p>
          <p className="mt-2 text-xs text-muted-foreground">Тухайн сард ажиллаж байсан ажилтан: {data.employeeCount}</p>
          <div className="mt-6">
            <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-recent-activity">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{label}-ийн үйлдэл</h2><Activity className="size-4 text-muted-foreground" /></div>
              {data.recentActivity.length ? <div className="divide-y divide-border">{data.recentActivity.map((item) => <div className="flex gap-3 px-4 py-4 transition-colors hover:bg-secondary/45 sm:gap-4 sm:px-5" key={item.id} data-testid={`row-activity-${item.id}`}><div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Activity className="size-4" /></div><div className="min-w-0 flex-1"><div className="sm:flex sm:items-start sm:justify-between sm:gap-4"><p className="text-sm font-semibold">{item.title}</p><time className="mt-1 block shrink-0 font-mono text-[10px] text-muted-foreground sm:mt-0">{dateLabel(item.createdAt)}</time></div><p className="mt-2 break-words text-sm font-medium leading-relaxed text-foreground/80 sm:mt-1 sm:truncate sm:text-xs sm:font-normal sm:text-muted-foreground">{item.detail}</p></div></div>)}</div> : <EmptyState title="Энэ сард үйлдэл алга" detail="Сонгосон сарын шинэ бүртгэл энд харагдана." icon={Activity} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
