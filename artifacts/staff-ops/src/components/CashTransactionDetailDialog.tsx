import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui-primitives';
import { dateLabel } from '@/lib/app-shared';
import { bankDateTimeLabel } from '@/pages/Cash';
import { getGetCashTransactionDetailQueryKey, useGetCashTransactionDetail } from '@workspace/api-client-react';

const KIND_LABELS: Record<string, string> = {
  manual: 'Гараар оруулсан',
  payroll: 'Цалин',
  payroll_advance: 'Цалингийн урьдчилгаа',
  inventory_purchase: 'Агуулахын худалдан авалт',
  inventory_purchase_group: 'Агуулахын худалдан авалтын бүлэг',
  fixed_asset_purchase: 'Үндсэн хөрөнгийн худалдан авалт',
  operating_expense: 'Үйл ажиллагааны зардал',
  bank_transaction: 'Банкны гүйлгээнээс',
};

const preciseMoney = (value: number) => `${new Intl.NumberFormat('mn-MN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ₮`;
const timestampLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('mn-MN');
};
const monthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
const accountText = (code: string | null, name: string | null) => (code || name ? [code, name].filter(Boolean).join(' — ') : 'Оноогоогүй');

function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <div className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium [overflow-wrap:anywhere]" data-testid={testId}>{children}</dd></div>;
}

export function CashTransactionDetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useGetCashTransactionDetail(id, { query: { queryKey: getGetCashTransactionDetailQueryKey(id), refetchOnMount: 'always', staleTime: 0, retry: false } });
  const { data, isFetching, isError, error } = query;
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error && error.message ? error.message : 'Дэлгэрэнгүй мэдээлэл татахад алдаа гарлаа.';
  const cash = data?.cashTransaction;
  const bank = data?.bankTransaction ?? null;
  const income = cash?.type === 'income';

  let body: ReactNode;
  if (isFetching) {
    body = <div className="space-y-3" data-testid="cash-detail-loading"><div className="h-6 w-1/2 animate-pulse rounded-lg bg-foreground/10" /><div className="h-24 animate-pulse rounded-lg bg-foreground/10" /><div className="h-24 animate-pulse rounded-lg bg-foreground/10" /></div>;
  } else if (isError) {
    body = <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center" data-testid="cash-detail-error">
      <p className="text-sm font-semibold text-destructive">{message}</p>
      {status === 404 ? <p className="mt-1 text-xs text-muted-foreground">Энэ гүйлгээ устсан эсвэл өөрчлөгдсөн байж магадгүй.</p> : <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()} data-testid="button-retry-cash-detail">Дахин оролдох</Button>}
    </div>;
  } else if (!cash) {
    body = <div className="rounded-xl border border-border p-5 text-center text-sm font-semibold" data-testid="cash-detail-error">Кассын гүйлгээ олдсонгүй.</div>;
  } else {
    body = <div className="space-y-5" data-testid="cash-transaction-detail">
      <section className="rounded-xl border border-border p-4">
        <h3 className="mb-3 text-sm font-bold">Кассын гүйлгээ</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Кассын ID">#{cash.id}</Field>
          <Field label="Огноо">{dateLabel(cash.date)}</Field>
          {cash.incomeMonth && <Field label="Хамаарах сар">{monthLabel(cash.incomeMonth)}</Field>}
          <Field label="Төрөл">{income ? 'Орлого' : 'Зарлага'}</Field>
          <Field label="Дүн"><span className={`font-mono font-bold ${income ? 'text-primary' : 'text-orange-800'}`}>{income ? '+' : '−'}{preciseMoney(cash.amount)}</span></Field>
          <Field label="Ангилал">{cash.category}{cash.subcategory ? ` / ${cash.subcategory}` : ''}</Field>
          <div className="sm:col-span-2"><Field label="Тайлбар">{cash.description || '—'}</Field></div>
          <Field label="GL данс">{accountText(cash.accountCode, cash.accountName)}</Field>
          <Field label="Эх үүсвэр">{KIND_LABELS[cash.transactionKind] ?? cash.transactionKind}</Field>
          <Field label="Банкны баталгаажилт">{cash.bankVerifiedAt ? `Баталгаажсан · ${timestampLabel(cash.bankVerifiedAt)}` : 'Баталгаажаагүй'}</Field>
          <Field label="Журнал">{cash.journalEntryId ? `Журнал #${cash.journalEntryId}` : 'Журналгүй'}</Field>
          <Field label="Үүсгэсэн огноо">{timestampLabel(cash.createdAt)}</Field>
        </dl>
      </section>
      {bank ? <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" data-testid="cash-detail-bank">
        <h3 className="mb-3 text-sm font-bold">Холбогдсон банкны гүйлгээ</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Банкны гүйлгээний ID">#{bank.id}</Field>
          <Field label="Гүйлгээний огноо">{bankDateTimeLabel(bank.transactionAt)}</Field>
          {bank.executedAt && <Field label="Гүйцэтгэсэн">{bankDateTimeLabel(bank.executedAt)}</Field>}
          <Field label="Банк">{bank.bankName || '—'}</Field>
          <Field label="Өөрийн банкны данс"><span className="font-mono">{bank.bankAccountNumber || '—'}</span></Field>
          <Field label="Данс">{bank.account || '—'}</Field>
          <Field label="Харьцсан тал">{bank.counterparty || '—'}</Field>
          <Field label="Чиглэл ба дүн"><span className={`font-mono font-bold ${bank.type === 'income' ? 'text-primary' : 'text-orange-800'}`}>{bank.type === 'income' ? 'Орлого +' : 'Зарлага −'}{preciseMoney(bank.amount)}</span></Field>
          <Field label="Үлдэгдэл">{bank.balance === null ? '—' : preciseMoney(bank.balance)}</Field>
          <Field label="GL данс">{accountText(bank.accountCode, bank.accountName)}</Field>
          <div className="sm:col-span-2"><Field label="Гүйлгээний утга">{bank.description || '—'}</Field></div>
        </dl>
      </section> : <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-4 text-sm" data-testid="cash-detail-unlinked">
        <p className="font-semibold">Банкны гүйлгээтэй шууд холбогдоогүй байна.</p>
        <p className="mt-1 text-xs text-muted-foreground">Энэ кассын гүйлгээнд холбосон банкны гүйлгээ бүртгэгдээгүй байна.</p>
      </div>}
    </div>;
  }

  return <Modal title="Кассын гүйлгээний дэлгэрэнгүй" detail="Зөвхөн харах горим" onClose={onClose} wide>
    {body}
    <div className="mt-5 flex justify-end border-t border-border pt-4"><Button variant="outline" onClick={onClose} data-testid="button-close-cash-detail">Хаах</Button></div>
  </Modal>;
}
