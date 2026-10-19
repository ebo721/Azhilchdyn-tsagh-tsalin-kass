import { useQueryClient } from '@tanstack/react-query';
import { usePostBankTransactionJournal } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

export function BankPendingPurchaseButton({ id, accountId, disabled, onSaved }: {
  id: number; accountId: number; disabled?: boolean; onSaved?: () => void;
}) {
  const post = usePostBankTransactionJournal();
  const qc = useQueryClient();
  return <div className="space-y-2">
    <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal py-2 text-left"
      disabled={disabled || post.isPending} data-testid={`button-post-pending-purchase-${id}`}
      onClick={() => post.mutate({ id, data: { accountId } }, {
        onSuccess: () => {
          void qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string'
            && ['/api/bank-transactions', '/api/inventory', '/api/cash', '/api/journal', '/api/dashboard'].some(prefix => String(q.queryKey[0]).startsWith(prefix)) });
          onSaved?.();
        },
      })}>{post.isPending ? 'Бичиж байна...' : 'Барааны задаргааг дараа бүртгэх · Касс, журналд бичих'}</Button>
    {post.isError && <p role="alert" className="text-xs text-destructive">{(post.error as { data?: { error?: string } }).data?.error ?? 'Бүртгэж чадсангүй. Дахин оролдоно уу.'}</p>}
  </div>;
}
