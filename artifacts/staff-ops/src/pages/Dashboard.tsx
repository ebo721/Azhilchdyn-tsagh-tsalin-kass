import { Activity, Banknote, PackageOpen, TrendingUp, UsersRound } from 'lucide-react';
import { useGetDashboard } from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, StatCard } from '@/components/ui-primitives';
import { currentMonth, dateLabel, money, shiftMonth } from '@/lib/app-shared';

export function Dashboard() {
  const query = useGetDashboard();
  const data = query.data;
  const [previousYear, previousMonthNumber] = shiftMonth(currentMonth(), -1).split('-');
  const previousMonthLabel = `${previousYear} оны ${Number(previousMonthNumber)}-р сарын`;
  return (
    <div className="page-enter">
      {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /><LoadingBlock className="h-36" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={`${previousMonthLabel} борлуулалт`} value={money(data?.previousMonthSalesIncome)} meta="Борлуулалтын нийт орлого" icon={TrendingUp} tone="gold" />
            <StatCard label={`${previousMonthLabel} цалин`} value={money(data?.previousMonthPayrollExpense)} meta="Бодитоор олгосон нийт зардал" icon={Banknote} tone="blue" />
            <StatCard label={`${previousMonthLabel} материал`} value={money(data?.previousMonthInventoryExpense)} meta="Худалдан авсан нийт зардал" icon={PackageOpen} tone="teal" />
            <StatCard label="Нийт ажилтан" value={`${data?.employeeCount ?? 0}`} meta="Бүртгэлтэй ажилтан" icon={UsersRound} tone="orange" />
          </div>
          <div className="mt-6">
            <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-recent-activity">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Сүүлд хийгдсэн үйлдэл</h2><Activity className="size-4 text-muted-foreground" /></div>
              {data?.recentActivity?.length ? <div className="divide-y divide-border">{data.recentActivity.map((item) => <div className="flex gap-3 px-4 py-4 transition-colors hover:bg-secondary/45 sm:gap-4 sm:px-5" key={item.id} data-testid={`row-activity-${item.id}`}><div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Activity className="size-4" /></div><div className="min-w-0 flex-1"><div className="sm:flex sm:items-start sm:justify-between sm:gap-4"><p className="text-sm font-semibold">{item.title}</p><time className="mt-1 block shrink-0 font-mono text-[10px] text-muted-foreground sm:mt-0">{dateLabel(item.createdAt)}</time></div><p className="mt-2 break-words text-sm font-medium leading-relaxed text-foreground/80 sm:mt-1 sm:truncate sm:text-xs sm:font-normal sm:text-muted-foreground">{item.detail}</p></div></div>)}</div> : <EmptyState title="Одоогоор үйлдэл алга" detail="Касс, бараа материал эсвэл эд хөрөнгийн шинэ бүртгэл энд харагдана." icon={Activity} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}