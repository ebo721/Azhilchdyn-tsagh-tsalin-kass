import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import type { PayrollPayables as PayrollPayablesData } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingBlock } from '@/components/ui-primitives';
import { mongolianMonthLabel } from '@/lib/app-shared';

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function payrollErrorMessage(error: unknown): string {
  const e = error as { data?: { error?: string } | null; message?: string } | null;
  return (typeof e?.data?.error === 'string' && e.data.error) || e?.message || 'Цалингийн өглөгийг татаж чадсангүй.';
}

type Props = {
  data?: PayrollPayablesData;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  partyFilter: string;
  canOpenPayroll: boolean;
  onRefresh: () => void;
};

export function PayrollPayables({ data, isLoading, isError, isFetching, error, partyFilter, canOpenPayroll, onRefresh }: Props) {
  const filterActive = !!partyFilter;
  const lines = (data?.lines ?? []).filter((l) => !partyFilter || partyFilter === `employee:${l.employeeId}`);
  const suppliersOnly = partyFilter.startsWith('supplier:') || (filterActive && !partyFilter.startsWith('employee:'));
  const shown = suppliersOnly ? [] : lines;
  const total = shown.reduce((s, l) => s + l.remainingBalance, 0);
  const stale = shown.filter((l) => l.attendanceNeedsRefresh).length;

  return (
    <section className="space-y-3 overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="payroll-payables-section" aria-labelledby="payroll-payables-title">
      <div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h2 id="payroll-payables-title" className="text-base font-bold">Цалингийн өглөг</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground" data-testid="text-payroll-payables-note">
            Хадгалсан цалингийн тооцооны төлөгдөөгүй үлдэгдэл. Энэ нь журналын өглөг биш бөгөөд шинэ журналын бичилт үүсгэхгүй, 2000 дансны үлдэгдэлд нэмэгдэхгүй. Зөвхөн харах.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching} data-testid="button-refresh-payroll-payables">
          <RefreshCw className={`mr-2 size-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Шинэчлэх
        </Button>
      </div>

      {isError && (
        <div className="mx-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert" data-testid="status-payroll-payables-error">
          <p className="font-semibold text-destructive">Цалингийн өглөгийг харуулж чадсангүй. Энэ нь тэг гэсэн үг биш.</p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="text-payroll-payables-error-message">{payrollErrorMessage(error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRefresh} data-testid="button-retry-payroll-payables">Дахин оролдох</Button>
        </div>
      )}

      {isLoading ? (
        <div className="p-4"><LoadingBlock className="h-24" /></div>
      ) : isError ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4">
            <div className="rounded-lg bg-secondary/60 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Нийт цалингийн өглөг</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums" data-testid="total-payroll-payables">{money.format(total)} ₮</p>
            </div>
            <div className="rounded-lg bg-secondary/60 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ажилтан</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums" data-testid="count-payroll-payables">{shown.length}</p>
            </div>
          </div>
          {stale > 0 && (
            <p className="mx-4 rounded-lg bg-accent/25 px-3 py-2 text-xs font-semibold" data-testid="status-payroll-payables-stale">
              {stale} ажилтны ирц цалин бодсоноос хойш өөрчлөгдсөн. Хадгалсан тооцооны дүнг харуулж байна; Цалин хуудсанд дахин бодож шалгана уу.
            </p>
          )}
          {shown.length === 0 ? (
            <EmptyState title={data?.hasSavedCalculation === false ? 'Хадгалсан цалингийн тооцоо алга' : 'Цалингийн өглөг алга'} detail={data?.hasSavedCalculation === false ? 'Цалингийн хэсэгт тооцоогоо хадгалсны дараа үлдэгдэл энд харагдана. Энэ нь төлөх өргүй гэсэн баталгаа биш.' : filterActive ? 'Сонгосон талд төлөгдөөгүй цалингийн үлдэгдэл алга.' : 'Хадгалсан цалингаас төлөгдөөгүй үлдэгдэл олдсонгүй.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-y bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3">Ажилтан</th>
                    <th scope="col" className="px-4 py-3">Сар</th>
                    <th scope="col" className="px-4 py-3 text-right">Үлдэгдэл</th>
                    <th scope="col" className="px-4 py-3">Төлөв</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((l) => (
                    <tr key={l.employeeId} className="hover:bg-muted/50" data-testid={`row-payroll-payable-${l.employeeId}`}>
                      <td className="px-4 py-3 font-medium">{l.employeeName}</td>
                      <td className="px-4 py-3">
                        {canOpenPayroll ? (
                          <Link href={`/payroll?month=${l.month}`} className="font-semibold text-primary underline-offset-2 hover:underline" data-testid={`link-payroll-payable-${l.employeeId}`}>{mongolianMonthLabel(l.month)}</Link>
                        ) : mongolianMonthLabel(l.month)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{money.format(l.remainingBalance)}</td>
                      <td className="space-x-1 px-4 py-3">
                        {l.closed && <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground" data-testid={`status-payroll-closed-${l.employeeId}`}>Хаагдсан сар</span>}
                        {l.attendanceNeedsRefresh && <span className="inline-flex rounded-full bg-accent/35 px-2.5 py-1 text-xs font-semibold" data-testid={`status-payroll-stale-${l.employeeId}`}>Ирц шинэчлэх шаардлагатай</span>}
                        {!l.closed && !l.attendanceNeedsRefresh && <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Хадгалсан</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
