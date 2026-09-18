import { useGetJournalTrialBalance } from '@workspace/api-client-react';
import { Modal, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import { formatMoney } from '../utils';

export function TrialBalance({ onClose }: { onClose: () => void }) {
  const { data: trialBalance, isLoading, isError, refetch } = useGetJournalTrialBalance();

  return (
    <Modal title="Шалгах баланс" detail="Бүх дансны үлдэгдлийн жагсаалт" onClose={onClose} wide>
      {isLoading ? (
        <LoadingBlock className="h-64" />
      ) : isError ? (
        <ErrorBlock onRetry={() => refetch()} />
      ) : !trialBalance ? (
        <div className="p-4 text-center text-sm text-muted-foreground">Мэдээлэл олдсонгүй</div>
      ) : (
        <div className="space-y-6">
          <div className={`rounded-xl border p-4 text-center ${trialBalance.balanced ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
            <p className="text-sm font-bold uppercase tracking-wider mb-1">
              Тэнцэл
            </p>
            <p className="text-2xl font-bold font-mono">
              {trialBalance.balanced ? 'Тэнцсэн ✓' : 'Тэнцээгүй ✗'}
            </p>
          </div>
          
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/50 text-muted-foreground border-b text-xs font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Код</th>
                    <th className="px-4 py-3">Дансны нэр</th>
                    <th className="px-4 py-3 text-right">Дебет</th>
                    <th className="px-4 py-3 text-right">Кредит</th>
                    <th className="px-4 py-3 text-right">Эцсийн үлдэгдэл</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {trialBalance.accounts.map((acc) => (
                    <tr key={acc.accountId} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs">{acc.code}</td>
                      <td className="px-4 py-2 font-medium">{acc.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(acc.debit)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(acc.credit)}</td>
                      <td className={`px-4 py-2 text-right font-mono text-xs font-bold ${acc.balance < 0 ? 'text-destructive' : ''}`}>
                        {formatMoney(Math.abs(acc.balance))}
                        <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                          {acc.normalBalance === 'debit' ? (acc.balance >= 0 ? 'Дт' : 'Кт') : (acc.balance >= 0 ? 'Кт' : 'Дт')}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {trialBalance.accounts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Гүйлгээтэй данс алга</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-secondary/50 border-t font-bold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-right uppercase tracking-wider text-xs">Нийт</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-primary">{formatMoney(trialBalance.totalDebit)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-primary">{formatMoney(trialBalance.totalCredit)}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
