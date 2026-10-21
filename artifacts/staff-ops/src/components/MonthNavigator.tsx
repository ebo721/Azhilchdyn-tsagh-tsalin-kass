import { CalendarDays, ChevronRight } from 'lucide-react';
import { mongolianMonthLabel, shiftMonth } from '@/lib/app-shared';

export function MonthNavigator({ month, onChange, prefix, ariaLabel }: { month: string; onChange: (month: string) => void; prefix: string; ariaLabel: string }) {
  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-border bg-card">
      <button type="button" onClick={() => onChange(shiftMonth(month, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid={`button-${prefix}-previous-month`}><ChevronRight className="size-4 rotate-180" /></button>
      <div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(month)}</span><input type="month" min="0001-01" max="9999-12" value={month} onChange={(event) => { if (/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) onChange(event.target.value); }} className="absolute inset-0 cursor-pointer opacity-0" aria-label={ariaLabel} data-testid={`input-${prefix}-month`} /></label></div>
      <button type="button" onClick={() => onChange(shiftMonth(month, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid={`button-${prefix}-next-month`}><ChevronRight className="size-4" /></button>
    </div>
  );
}
