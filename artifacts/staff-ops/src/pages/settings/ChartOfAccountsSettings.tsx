import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import {
  getListChartOfAccountsQueryKey,
  useCreateChartOfAccount,
  useDeleteChartOfAccount,
  useListChartOfAccounts,
  useUpdateChartOfAccount,
  type ChartOfAccount,
  type ChartOfAccountInput,
} from '@workspace/api-client-react';

const chartOfAccountTypeLabels: Record<ChartOfAccountInput['type'], string> = {
  asset: 'Хөрөнгө',
  liability: 'Өр төлбөр',
  equity: 'Эздийн өмч',
  revenue: 'Орлого',
  expense: 'Зардал',
};

function ChartOfAccountModal({ account, onClose }: { account?: ChartOfAccount; onClose: () => void }) {
  const create = useCreateChartOfAccount();
  const update = useUpdateChartOfAccount();
  const qc = useQueryClient();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<ChartOfAccountInput['type']>(account?.type ?? 'asset');
  const pending = create.isPending || update.isPending;
  const failed = create.isError || update.isError;
  const save = () => {
    const data = { code: code.trim(), name: name.trim(), type };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListChartOfAccountsQueryKey() });
        onClose();
      },
    };
    if (account) update.mutate({ id: account.id, data }, options);
    else create.mutate({ data }, options);
  };
  return <Modal title={account ? 'Данс засах' : 'Данс нэмэх'} detail="Дансны код зөвхөн тооноос бүрдэнэ." onClose={onClose}>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold">Дансны код<Input inputMode="numeric" pattern="[0-9]*" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="Жишээ: 1000" data-testid="input-chart-account-code" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Дансны нэр<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Жишээ: Бэлэн мөнгө" data-testid="input-chart-account-name" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Дансны төрөл<select value={type} onChange={(event) => setType(event.target.value as ChartOfAccountInput['type'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-chart-account-type">{Object.entries(chartOfAccountTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {failed && <p className="text-xs font-semibold text-destructive">Хадгалах боломжгүй байна. Дансны код давхардсан эсэхийг шалгана уу.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button onClick={save} disabled={!code.trim() || !name.trim() || pending} data-testid="button-save-chart-account">{pending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
    </div>
  </Modal>;
}

export function ChartOfAccountsSettings() {
  const list = useListChartOfAccounts();
  const deletion = useDeleteChartOfAccount();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ChartOfAccount | 'new' | null>(null);
  const remove = (account: ChartOfAccount) => {
    if (!window.confirm(`${account.code} — ${account.name} дансыг устгах уу?`)) return;
    deletion.mutate({ id: account.id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListChartOfAccountsQueryKey() }),
      onError: () => window.alert('Дансыг устгах боломжгүй байна.'),
    });
  };
  return <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="panel-chart-of-accounts">
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold">Дансны төлөвлөгөө</h2><p className="mt-1 text-xs text-muted-foreground">Санхүүгийн тайлангийн дансны код, нэр болон төрлийг удирдана.</p></div><Button onClick={() => setEditing('new')} data-testid="button-add-chart-account"><Plus className="size-4" />Данс нэмэх</Button></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Данс бүртгэгдээгүй" detail="Эхний дансаа нэмнэ үү." icon={BookOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Код</th><th className="px-5 py-3">Дансны нэр</th><th className="px-5 py-3">Төрөл</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((account) => <tr key={account.id} data-testid={`row-chart-account-${account.id}`}><td className="px-5 py-4 font-mono text-sm font-bold text-primary">{account.code}</td><td className="px-5 py-4 text-sm font-semibold">{account.name}</td><td className="px-5 py-4"><span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-bold">{chartOfAccountTypeLabels[account.type]}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(account)} data-testid={`button-edit-chart-account-${account.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(account)} disabled={deletion.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-chart-account-${account.id}`}><Trash2 className="size-4" />Устгах</Button></div></td></tr>)}</tbody></table></div>}
    {editing && <ChartOfAccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </section>;
}
