import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { money } from '@/lib/app-shared';
import {
  getListBankTransactionJournalReviewQueryKey,
  getListBankTransactionsQueryKey,
  getListCashTransactionsQueryKey,
  getGetCashSummaryQueryKey,
  getGetDashboardQueryKey,
  getListBankTransferSuggestionsQueryKey,
  getListUnclearTransactionsQueryKey,
  useListBankTransferSuggestions,
  usePairBankTransfer,
  useUnpairBankTransfer,
  type BankTransaction,
  type BankTransactionJournalReviewItem,
  type BankTransferSuggestion,
} from '@workspace/api-client-react';

type TransferRow = Pick<BankTransaction, 'id' | 'amount' | 'description'> & { transactionAt: string };

const dt = (value: string) => value.replace('T', ' ').slice(0, 16);

export function useInvalidateInternalTransfer() {
  const qc = useQueryClient();
  return () => {
    [
      getListBankTransactionsQueryKey(),
      getListBankTransactionJournalReviewQueryKey(),
      getListCashTransactionsQueryKey(),
      getGetCashSummaryQueryKey(),
      getGetDashboardQueryKey(),
      getListUnclearTransactionsQueryKey(),
    ].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    qc.invalidateQueries({ queryKey: ['/api/bank-transactions'] });
    qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string'
      && /\/(?:payment-bank-suggestions|bank-suggestions|transfer-suggestions)$/.test(query.queryKey[0]) });
  };
}

export function InternalTransferBadge({ row, canManage }: { row: Pick<BankTransaction, 'id' | 'internalTransfer' | 'transferPeerId'>; canManage: boolean }) {
  const unpair = useUnpairBankTransfer();
  const invalidate = useInvalidateInternalTransfer();
  if (!row.internalTransfer) return null;
  const doUnpair = () => {
    if (!window.confirm('Дотоод шилжүүлгийн холбоосыг салгах уу? Хоёр гүйлгээ дахин шийдэгдээгүй жагсаалтад орно.')) return;
    unpair.mutate({ id: row.id }, {
      onSuccess: invalidate,
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Холбоос салгаж чадсангүй.'),
    });
  };
  return <div className="flex flex-wrap items-center gap-2" data-testid={`internal-transfer-${row.id}`}>
    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800" data-testid={`badge-internal-transfer-${row.id}`}>Дотоод шилжүүлэг</span>
    {row.transferPeerId != null && <Link href={`/bank-transactions?view=paired&transferPeerId=${row.transferPeerId}`} className="text-xs font-semibold text-primary underline" data-testid={`link-transfer-peer-${row.id}`}>Хос гүйлгээ #{row.transferPeerId}</Link>}
    {canManage && <Button size="sm" variant="outline" disabled={unpair.isPending} onClick={doUnpair} data-testid={`button-unpair-transfer-${row.id}`}>{unpair.isPending ? 'Салгаж байна...' : 'Холбоос салгах'}</Button>}
  </div>;
}

export function InternalTransferOpenButton({ row, onOpen, disabled }: { row: TransferRow; onOpen: () => void; disabled?: boolean }) {
  return <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onOpen} data-testid={`button-internal-transfer-${row.id}`} aria-label={`${row.description || 'Гүйлгээ'} дотоод шилжүүлэг эсэх`}><ArrowRightLeft className="size-4" />Дотоод шилжүүлэг эсэх</Button>;
}

export function InternalTransferDialog({ row, onClose }: { row: TransferRow | BankTransactionJournalReviewItem; onClose: () => void }) {
  const suggestions = useListBankTransferSuggestions(row.id, { query: { queryKey: getListBankTransferSuggestionsQueryKey(row.id), refetchOnMount: 'always' } });
  const pair = usePairBankTransfer();
  const invalidate = useInvalidateInternalTransfer();
  const [chosen, setChosen] = useState<BankTransferSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    if (!chosen) return;
    setError(null);
    pair.mutate({ id: row.id, data: { peerId: chosen.id } }, {
      onSuccess: () => { invalidate(); onClose(); },
      onError: (e) => setError(e instanceof Error ? e.message : 'Холбож чадсангүй.'),
    });
  };
  return <Modal title="Дотоод шилжүүлэг эсэх" detail="Өөрийн хоёр дансны хооронд шилжсэн бол хос гүйлгээг сонгож холбоно. Холбосон гүйлгээ тооцоонд давхар орохгүй." onClose={onClose}>
    <div className="space-y-4" data-testid="dialog-internal-transfer">
      <div className="rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm">
        <p className="font-mono text-xs">{dt(row.transactionAt)}</p>
        <p className="mt-1 font-semibold">{row.description || '—'}</p>
        <p className="font-mono font-bold">{money(row.amount)}</p>
      </div>
      {suggestions.isLoading ? <><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></>
        : suggestions.isError ? <ErrorBlock onRetry={() => suggestions.refetch()} />
        : !suggestions.data?.length ? <div data-testid="empty-transfer-suggestions"><EmptyState title="Тохирох хос гүйлгээ алга" detail="Өөрийн нөгөө дансанд ойролцоо огноо, ижил дүнтэй гүйлгээ олдсонгүй." icon={ArrowRightLeft} /></div>
        : <div className="space-y-2">{suggestions.data.map((s) => <button type="button" key={s.id} onClick={() => setChosen(s)} className={`w-full rounded-xl border px-4 py-3 text-left transition-colors hover:bg-secondary/40 ${chosen?.id === s.id ? 'border-primary bg-primary/5' : 'border-border'}`} data-testid={`option-transfer-suggestion-${s.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs">{dt(s.transactionAt)}</span>
            <span className="font-mono text-sm font-bold">{money(s.amount)}</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{s.bankName} · <span className="font-mono">{s.bankAccountNumber}</span></p>
          <p className="text-xs text-muted-foreground">{s.description || '—'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Тохирц: {s.score.toFixed(2)}% · Шимтгэл: {money(s.feeAmount)}</p>
        </button>)}</div>}
      {chosen && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" role="alert" data-testid="text-transfer-confirm">
        #{row.id} болон #{chosen.id} гүйлгээг дотоод шилжүүлэг болгож холбох уу? Шимтгэл {money(chosen.feeAmount)}.
      </div>}
      {error && <p className="text-sm font-semibold text-destructive" role="alert" data-testid="text-transfer-error">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-internal-transfer">Болих</Button>
        <Button type="button" disabled={!chosen || pair.isPending} onClick={confirm} data-testid="button-confirm-internal-transfer">{pair.isPending ? 'Холбож байна...' : 'Баталгаажуулж холбох'}</Button>
      </div>
    </div>
  </Modal>;
}
