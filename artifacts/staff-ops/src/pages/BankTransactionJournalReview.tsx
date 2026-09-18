import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { PageHeading, LoadingBlock, ErrorBlock, EmptyState } from '@/components/ui-primitives';
import { Check, X, ArrowDownLeft, ArrowUpRight, ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { money } from '@/lib/app-shared';
import { bankDateTimeLabel } from './Cash';
import {
  useListBankTransactionJournalReview,
  usePostBankTransactionJournal,
  useRejectBankTransactionSuggestion,
  useListChartOfAccounts,
  useGetAuthSession,
  getListChartOfAccountsQueryKey,
  getListBankTransactionJournalReviewQueryKey,
  getListBankTransactionsQueryKey,
  getListUnclearTransactionsQueryKey,
  BankTransactionJournalReviewItemType,
  BankTransactionJournalReviewItem
} from '@workspace/api-client-react';

export function BankTransactionJournalReview() {
  const qc = useQueryClient();
  const session = useGetAuthSession();
  const list = useListBankTransactionJournalReview();
  const canMutate = session.data?.role === 'admin' || session.data?.role === 'accountant';
  const accounts = useListChartOfAccounts({
    query: {
      enabled: canMutate,
      queryKey: getListChartOfAccountsQueryKey(),
    },
  });

  const post = usePostBankTransactionJournal();
  const reject = useRejectBankTransactionSuggestion();

  const [selectedAccounts, setSelectedAccounts] = useState<Record<number, number>>({});
  const isAdmin = session.data?.role === 'admin';

  const mutationError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : 'Гүйлгээг журналд шивэхэд алдаа гарлаа.');
  };

  const handleApprove = (item: BankTransactionJournalReviewItem) => {
    if (!item.suggestedAccountId) return;
    post.mutate({ id: item.id, data: { accountId: item.suggestedAccountId } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBankTransactionJournalReviewQueryKey() });
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
      },
      onError: mutationError,
    });
  };
  
  const handleCustomPost = (item: BankTransactionJournalReviewItem) => {
    const accountId = selectedAccounts[item.id];
    if (!accountId) return;
    post.mutate({ id: item.id, data: { accountId } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBankTransactionJournalReviewQueryKey() });
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
      },
      onError: mutationError,
    });
  };
  
  const handleReject = (item: BankTransactionJournalReviewItem) => {
    reject.mutate({ id: item.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBankTransactionJournalReviewQueryKey() });
        qc.invalidateQueries({ queryKey: getListUnclearTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
      },
      onError: mutationError,
    });
  };

  const handleAccountSelect = (itemId: number, accountIdStr: string) => {
    setSelectedAccounts(prev => ({ ...prev, [itemId]: Number(accountIdStr) }));
  };

  return (
    <div className="page-enter">
      <div className="mb-6">
        <Link href="/bank-transactions" className="inline-flex items-center text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-to-bank-transactions">
          <ChevronLeft className="mr-1 size-4" /> Буцах
        </Link>
      </div>
      
      <PageHeading 
        eyebrow="Банкны гүйлгээ" 
        title="Журналд шивэх" 
        detail="Танигдсан гүйлгээнүүдийг баталгаажуулж журналд холбох." 
      />

      {list.isLoading || (canMutate && accounts.isLoading) ? (
        <div className="space-y-3 mt-6">
          <LoadingBlock className="h-16" />
          <LoadingBlock className="h-16" />
          <LoadingBlock className="h-16" />
        </div>
      ) : list.isError ? (
        <div className="mt-6"><ErrorBlock onRetry={() => list.refetch()} /></div>
      ) : canMutate && accounts.isError ? (
        <div className="mt-6"><ErrorBlock onRetry={() => accounts.refetch()} /></div>
      ) : !list.data?.length ? (
        <div className="mt-6">
          <EmptyState 
            title="Шивэх гүйлгээ алга" 
            detail="Журналд шивэх шаардлагатай гүйлгээ байхгүй байна." 
            icon={RefreshCw} 
          />
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="divide-y divide-border">
            {list.data.map(row => {
              const isIncome = row.type === BankTransactionJournalReviewItemType.income;
              const hasSuggestion = row.suggestedAccountId !== null;
              
              const isPending = post.isPending || reject.isPending;
              
              return (
                <div key={row.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center transition-colors hover:bg-secondary/35" data-testid={`journal-review-row-${row.id}`}>
                  <div className="flex flex-1 items-start gap-4">
                    <span className={cn('grid mt-0.5 size-10 shrink-0 place-items-center rounded-xl', isIncome ? 'bg-primary/10 text-primary' : 'bg-orange-100 text-orange-800')}>
                      {isIncome ? <ArrowDownLeft className="size-5" /> : <ArrowUpRight className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{row.description}</p>
                        <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
                          {bankDateTimeLabel(row.transactionAt)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{row.counterparty}</p>
                      
                      <div className="mt-2 text-sm font-medium">
                        {hasSuggestion ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-muted-foreground">Санал болгосон данс:</span>
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                              {row.suggestedAccountName}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 border border-slate-200">Тодорхойгүй</span>
                            {isAdmin ? (
                              <Link href="/users" className="inline-flex items-center text-xs font-semibold text-primary hover:underline" data-testid={`link-unclear-transactions-${row.id}`}>
                                Тохиргоо руу очих <ExternalLink className="ml-1 size-3" />
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">Зөвхөн админ шийдвэрлэх боломжтой</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-3 sm:w-80 shrink-0">
                    <p className={cn('font-mono text-lg font-bold', isIncome ? 'text-primary' : 'text-orange-800')}>
                      {isIncome ? '+' : '−'}{money(row.amount)}
                    </p>
                    
                    {hasSuggestion && canMutate && (
                      <div className="flex flex-col w-full gap-2 mt-1">
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="flex-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                            onClick={() => handleApprove(row)}
                            disabled={isPending}
                            data-testid={`button-approve-suggestion-${row.id}`}
                          >
                            <Check className="mr-1.5 size-3.5" /> Зөвшөөрөх
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="flex-none text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => handleReject(row)}
                            disabled={isPending}
                            data-testid={`button-reject-suggestion-${row.id}`}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                        
                        <div className="flex gap-2 items-center">
                          <select 
                            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary disabled:opacity-50"
                            value={selectedAccounts[row.id] || ''}
                            onChange={(e) => handleAccountSelect(row.id, e.target.value)}
                            disabled={isPending}
                            data-testid={`select-custom-account-${row.id}`}
                          >
                            <option value="" disabled>Өөр данс сонгох...</option>
                            {accounts.data?.filter((account) =>
                              account.isActive
                              && (isIncome
                                ? account.type === 'revenue'
                                : account.type === 'expense' || account.type === 'asset' || account.type === 'liability')
                            ).map(a => (
                              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                            ))}
                          </select>
                          <Button 
                            size="sm"
                            disabled={!selectedAccounts[row.id] || isPending}
                            onClick={() => handleCustomPost(row)}
                            data-testid={`button-post-custom-${row.id}`}
                          >
                            Шивэх
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
