import { useState } from 'react';
import { CalendarDays, ChevronRight, Timer } from 'lucide-react';
import { useGetHourBalance } from '@workspace/api-client-react';
import { ErrorBlock, EmptyState, LoadingBlock, PageHeading } from '@/components/ui-primitives';

const currentMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};

export function HourBalance() {
  const [month, setMonth] = useState(currentMonth());
  const query = useGetHourBalance({ month });
  return <div className="page-enter">
    <PageHeading
      title="Цагийн баланс"
      action={<div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-hour-balance-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(month)}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Цагийн балансын сар сонгох" data-testid="input-hour-balance-month" /></label></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-hour-balance-next-month"><ChevronRight className="size-4" /></button></div>}
    />
    {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /><LoadingBlock className="h-32" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : <><section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card" data-testid="hour-balance-list">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын цагийн жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} ажилтан</span></div>
      {!query.data?.length ? <EmptyState title="Цагийн баланс хоосон" detail="Ажилтан болон ирцийн бүртгэл нэмэгдсэний дараа энд сарын нийлбэр гарна." icon={Timer} /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Ажилтан</th><th className="px-5 py-3 text-center">Ажиллах ёстой өдөр</th><th className="px-5 py-3 text-center">Ажилласан өдөр</th><th className="px-5 py-3 text-center">Чөлөө</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((row) => <tr key={row.employeeId} className="transition-colors hover:bg-secondary/35" data-testid={`row-hour-balance-${row.employeeId}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{row.employeeName}</p><p className="text-xs text-muted-foreground">{row.role}</p></td><td className="px-5 py-4 text-center font-mono text-sm font-semibold text-primary">{row.expectedWorkDays}</td><td className="px-5 py-4 text-center font-mono text-sm font-semibold">{row.workDays}</td><td className="px-5 py-4 text-center font-mono text-sm">{row.leaveDays}</td></tr>)}</tbody></table></div>}
    </section></>}
  </div>;
}