import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { BriefcaseBusiness, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import {
  getGetCashSummaryQueryKey,
  getListCashTransactionsQueryKey,
  getListFixedAssetsQueryKey,
  useCreateFixedAsset,
  useListFixedAssets,
  useUpdateFixedAsset,
  type FixedAsset,
} from '@workspace/api-client-react';
import { dateLabel, money, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';

type FixedAssetForm = { name: string; unitPrice: string; quantity: string; date: string; purchased: boolean };

export function FixedAssets() {
  const list = useListFixedAssets();
  const create = useCreateFixedAsset();
  const update = useUpdateFixedAsset();
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const form = useForm<FixedAssetForm>({ defaultValues: { name: '', unitPrice: '', quantity: '1', date: today(), purchased: false } });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListFixedAssetsQueryKey() });
    qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
  };
  const startCreate = () => {
    setEditing(null);
    form.reset({ name: '', unitPrice: '', quantity: '1', date: today(), purchased: false });
    setOpen(true);
  };
  const startEdit = (asset: FixedAsset) => {
    setEditing(asset);
    form.reset({
      name: asset.name,
      unitPrice: String(asset.unitPrice),
      quantity: String(asset.quantity),
      date: asset.date,
      purchased: asset.purchased,
    });
    setOpen(true);
  };
  const submit = (values: FixedAssetForm) => {
    const data = {
      name: values.name,
      unitPrice: Number(values.unitPrice),
      quantity: Number(values.quantity),
      date: values.date,
      purchased: values.purchased,
    };
    const mutation = editing ? update : create;
    mutation.mutate({
      ...(editing ? { id: editing.id } : {}),
      data,
    } as never, {
      onSuccess: () => {
        refresh();
        form.reset({ name: '', unitPrice: '', quantity: '1', date: today(), purchased: false });
        setEditing(null);
        setOpen(false);
      },
    });
  };
  const deleteAsset = (asset: FixedAsset) => {
    if (!window.confirm(`"${asset.name}" хөрөнгийг устгах уу?${asset.purchased ? ' Холбоотой кассын зарлага мөн устна.' : ''}`)) return;
    deletion.request(`/fixed-assets/${asset.id}`, `${asset.name} эд хөрөнгө`);
  };
  return <div className="page-enter">
    <div className="mb-7 flex justify-end"><Button onClick={startCreate} data-testid="button-add-fixed-asset"><Plus className="size-4" />Шинээр нэмэх</Button></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Тоног төхөөрөмж, хөрөнгийн жагсаалт</h2></div>
      {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Эд хөрөнгө бүртгэгдээгүй" detail="Тоног төхөөрөмж эсвэл хөрөнгөө шинээр нэмнэ үү." icon={BriefcaseBusiness} /> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Нэр</th><th className="px-5 py-3 text-right">Үнэ</th><th className="px-5 py-3 text-right">Тоо ширхэг</th><th className="px-5 py-3 text-right">Нийт дүн</th><th className="px-5 py-3">Төлөв</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{list.data.map((asset: FixedAsset) => <tr key={asset.id} data-testid={`row-fixed-asset-${asset.id}`}><td className="px-5 py-4 text-sm font-semibold">{dateLabel(asset.date)}</td><td className="px-5 py-4 text-sm font-semibold">{asset.name}</td><td className="px-5 py-4 text-right font-mono text-sm">{money(asset.unitPrice)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{asset.quantity}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{money(asset.totalAmount)}</td><td className="px-5 py-4"><span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', asset.purchased ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{asset.purchased ? 'Худалдан авсан' : 'Бүртгэсэн'}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => startEdit(asset)} data-testid={`button-edit-fixed-asset-${asset.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteAsset(asset)} data-testid={`button-delete-fixed-asset-${asset.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>}
    </section>
    {open && <Modal title={editing ? 'Эд хөрөнгө засах' : 'Эд хөрөнгө шинээр нэмэх'} detail="Тоног төхөөрөмж, хөрөнгийн мэдээллийг бүртгэнэ." onClose={() => setOpen(false)}>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-fixed-asset">
        <label className="block space-y-2 text-xs font-semibold">Нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('name', { required: true })} data-testid="input-fixed-asset-name" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Үнэ<input type="number" min="0" step="0.01" className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('unitPrice', { required: true, min: 0 })} data-testid="input-fixed-asset-price" /></label><label className="space-y-2 text-xs font-semibold">Тоо ширхэг<input type="number" min="1" step="1" className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('quantity', { required: true, min: 1 })} data-testid="input-fixed-asset-quantity" /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Огноо<input type="date" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-fixed-asset-date" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 p-4 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" {...form.register('purchased')} data-testid="checkbox-fixed-asset-purchased" /><span>Худалдан авсан</span></label>
        {(create.isError || update.isError) && <p className="text-xs font-semibold text-destructive">Мэдээлэл буруу эсвэл сонгосон өдрийн касс өндөрлөсөн байна.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save-fixed-asset">{create.isPending || update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}