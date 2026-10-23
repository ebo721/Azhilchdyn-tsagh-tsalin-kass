import type { PayrollAdvanceLine } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { dateLabel, money } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';

export function AdvancePaymentHistory({ line, month, closed }: {
  line: PayrollAdvanceLine; month: string; closed: boolean;
}) {
  const deletion = useQueueDeletion();
  const paid = line.paidAmount ?? (line.paid ? line.advanceAmount : 0);
  return <div className="space-y-2 text-xs" data-testid={`advance-history-${line.employeeId}`}>
    <p className="font-semibold">Олгосон: {money(paid)}</p>
    <p>Үлдэгдэл: {money(line.remainingBalance ?? Math.max(0, line.advanceAmount - paid))}</p>
    {line.payments?.map(p => <div key={p.sequence} className="flex flex-wrap items-center justify-center gap-2 rounded border border-border p-2">
      <span>{p.sequence}-р олголт · {dateLabel(p.date)} · {money(p.amount)}</span>
      <Button type="button" size="sm" variant="outline" disabled={closed || deletion.isPending}
        data-testid={`delete-advance-${line.employeeId}-${p.sequence}`}
        onClick={() => {
          if (window.confirm('Банкны холбоосгүй, өндөрлөөгүй өдрийн энэ олголтыг буцаах уу? Банкны холбоос байвал эхлээд журналаас буцаана.')) {
            void deletion.request(`/payroll-advance/${month}/${line.employeeId}/transactions/${p.sequence}`, `${line.employeeName} · ${p.sequence}-р урьдчилгаа`);
          }
        }}>Буцаах</Button>
    </div>)}
    {line.payments && <p className="text-muted-foreground">Дараагийн олголтыг Банкны хуулга → Урьдчилгаа цалин сонгож холбоно. Банкны баталгаатай олголтыг эндээс өөрчлөхгүй.</p>}
  </div>;
}
