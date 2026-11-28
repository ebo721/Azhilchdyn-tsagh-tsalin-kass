import { Fragment, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PayrollRegister<T extends { employeeId: number; employeeName: string }>({ lines, advance = false, summary, renderRow }: {
  lines: T[];
  advance?: boolean;
  summary?: ReactNode;
  renderRow: (line: T, expanded: boolean, toggle: () => void) => { cells: ReactNode; details: ReactNode };
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={advance ? 'section-payroll-advance' : 'payroll-table'}>
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3"><h2 className="text-sm font-bold">Ажилтан</h2><span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px]">{lines.length}</span>{summary}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left">
      <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr>
        <th className="px-5 py-3">Ажилтан</th><th className="px-3 py-3 text-right">{advance ? 'Баталсан' : 'Нийт цалин'}</th><th className="px-3 py-3 text-right">{advance ? 'Авлага суутгал' : 'Суутгал'}</th><th className="px-3 py-3 text-right">{advance ? 'Шилжүүлэх' : 'Олговол зохих'}</th><th className="px-3 py-3 text-right">Олгосон</th><th className="px-3 py-3 text-right">Үлдэгдэл</th><th className="px-4 py-3 text-right">Үйлдэл</th>
      </tr></thead>
      <tbody>{lines.map(line => {
        const expanded = expandedId === line.employeeId;
        const row = renderRow(line, expanded, () => setExpandedId(expanded ? null : line.employeeId));
        return <Fragment key={line.employeeId}><tr className="border-t border-border/70 hover:bg-secondary/30" data-testid={`row-${advance ? 'advance' : 'payroll'}-${line.employeeId}`}>{row.cells}</tr>{expanded && <tr className="border-t border-border bg-secondary/25" data-testid={`details-${advance ? 'advance' : 'payroll'}-${line.employeeId}`}><td colSpan={7} className="p-5">{row.details}</td></tr>}</Fragment>;
      })}
      {lines.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="empty-payroll-filter">Тохирох ажилтан алга.</td></tr>}
      </tbody>
    </table></div>
  </section>;
}

export function PayrollEmployee({ name, role, expanded, onToggle, children }: { name: string; role: string; expanded: boolean; onToggle: () => void; children?: ReactNode }) {
  return <td className="px-5 py-3.5"><button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 text-left">
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-[11px] font-bold text-primary">{name.split(' ').slice(0, 2).map(n => n[0]).join('')}</span>
    <span><span className="block text-[13px] font-bold">{name}</span><span className="block text-[11px] text-muted-foreground">{role}</span></span><ChevronRight className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground', expanded && 'rotate-90')} />
  </button>{children}</td>;
}

export function PayrollValue({ children, primary, testId }: { children: ReactNode; primary?: boolean; testId?: string }) {
  return <td className={cn('px-3 py-3.5 text-right font-mono text-xs', primary && 'font-bold text-primary')} data-testid={testId}>{children}</td>;
}

export function PayrollDetail({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="break-all text-right font-mono font-semibold" data-testid={testId}>{value}</span></div>;
}
