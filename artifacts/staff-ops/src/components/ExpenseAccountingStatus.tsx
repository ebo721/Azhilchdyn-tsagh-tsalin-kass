import type { OperatingExpense } from '@workspace/api-client-react';
import { money } from '@/lib/app-shared';
import { Button } from '@/components/ui/button';

export type AccountingFilter = OperatingExpense['accountingStatus'] | 'all';
const statuses = {
  missing_both: { label: 'Касс, журналгүй', tone: 'bg-red-50 text-red-800 border-red-200' },
  missing_journal: { label: 'Касстай, журналгүй', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  missing_cash: { label: 'Журналтай, кассгүй', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  complete: { label: 'Бүрэн бичигдсэн', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
} satisfies Record<OperatingExpense['accountingStatus'], { label: string; tone: string }>;

export function ExpenseAccountingBadge({ status }: { status: OperatingExpense['accountingStatus'] }) {
  const value = statuses[status];
  if (!value) return <span className="text-xs text-muted-foreground">Бичилтийн төлөв ирээгүй</span>;
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${value.tone}`}
    title="Зөвхөн баталгаажсан журналын бичилтийг тооцно. Төлбөрийн төлөвөөс тусдаа."
    data-testid={`accounting-badge-${status}`}>{value.label}</span>;
}

export function ExpenseAccountingSummary({ expenses, selected, onChange }: {
  expenses: OperatingExpense[];
  selected: AccountingFilter;
  onChange: (value: AccountingFilter) => void;
}) {
  return <section aria-label="Бичилтийн төлөвөөр шүүх" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">Бичилтийн төлөв</h2>
        <p className="text-xs text-muted-foreground">Төлөгдсөн эсэхээс тусдаа, касс болон баталгаажсан журналын бодит бичилтээр ялгав.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange('all')} aria-pressed={selected === 'all'}
        data-testid="filter-accounting-all">Бүгд ({expenses.length})</Button>
    </div>
    {expenses.some(expense => !statuses[expense.accountingStatus]) && <p role="alert" className="text-sm text-destructive">Зарим зардлын бичилтийн төлөв серверээс ирээгүй байна. Төлвийг таамаглаж харуулаагүй.</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {(Object.keys(statuses) as OperatingExpense['accountingStatus'][]).map(status => {
        const rows = expenses.filter(expense => expense.accountingStatus === status);
        return <button key={status} type="button" onClick={() => onChange(status)}
          aria-pressed={selected === status} data-testid={`filter-accounting-${status}`}
          className={`rounded-xl border bg-card p-3 text-left transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected === status ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
          <span className={`inline-block rounded-md px-2 py-1 text-[11px] font-semibold ${statuses[status].tone}`}>{statuses[status].label}</span>
          <span className="mt-2 block text-xl font-bold" data-testid={`count-accounting-${status}`}>{rows.length} зардал</span>
          <span className="block text-xs font-medium text-muted-foreground">{money(rows.reduce((sum, row) => sum + row.amount, 0))}</span>
        </button>;
      })}
    </div>
  </section>;
}
