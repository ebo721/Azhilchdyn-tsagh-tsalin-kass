import type { InventoryPurchase } from '@workspace/api-client-react';
import { bankDateTimeLabel } from '@/pages/Cash';
import { money } from '@/lib/app-shared';

export function PurchaseBankConnection({ purchase, detail = false }: {
  purchase: InventoryPurchase; detail?: boolean;
}) {
  const link = purchase.bankConnection;
  return <div className="mt-2 space-y-1" data-testid={`purchase-bank-connection-${purchase.id}`}>
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${link
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
      {link ? 'Банктай холбогдсон' : 'Банктай холбогдоогүй'}
    </span>
    {link && <p className="text-xs text-muted-foreground">Банк #{link.id}{link.kind === 'group' ? ' · Багц төлбөр' : ''}</p>}
    {detail && link && <dl className="space-y-1 rounded-xl border border-border p-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">Гүйлгээний огноо</dt><dd>{bankDateTimeLabel(link.transactionAt)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">{link.kind === 'group' ? 'Банкны нийт дүн' : 'Гүйлгээний дүн'}</dt><dd className="font-mono">{money(link.amount)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Гүйлгээний утга</dt><dd className="break-words">{link.description || '—'}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Банкны данс</dt><dd className="break-words">{link.account || '—'}</dd></div>
    </dl>}
    {detail && !link && <p className="text-xs text-muted-foreground">Төлбөр төлсөн төлөв нь банкны гүйлгээтэй холбогдсоныг илэрхийлэхгүй.</p>}
  </div>;
}
