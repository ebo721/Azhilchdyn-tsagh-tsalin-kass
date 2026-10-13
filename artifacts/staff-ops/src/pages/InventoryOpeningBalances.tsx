import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getListInventoryIssuesQueryKey,
  getListInventoryItemsQueryKey,
  getListInventoryOpeningBalancesQueryKey,
  getListInventoryPurchasesQueryKey,
  useCreateInventoryOpeningBalance,
  useListInventoryOpeningBalances,
  useUpdateInventoryOpeningBalance,
  type InventoryItem,
  type InventoryOpeningBalance,
  type InventoryOpeningBalanceInput,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { money, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';

type MType = 'food' | 'supply';
const types: Array<{ value: MType; label: string }> = [
  { value: 'food', label: 'Хүнсний бараа материал' },
  { value: 'supply', label: 'Хангамжийн материал' },
];
const units = ['ширхэг', 'кг', 'грамм', 'литр', 'мл', 'метр', 'багц', 'хайрцаг'];
const field = 'mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';
type FormState = { mode: 'existing' | 'new'; itemId: string; materialType: MType; name: string; category: string; unit: string; date: string; quantity: string; unitPrice: string };

export function InventoryOpeningBalances({ catalog, materialType, openSignal = 0 }: { catalog: InventoryItem[]; materialType: MType; openSignal?: number }) {
  const qc = useQueryClient();
  const list = useListInventoryOpeningBalances();
  const create = useCreateInventoryOpeningBalance();
  const update = useUpdateInventoryOpeningBalance();
  const deletion = useQueueDeletion();
  const [editing, setEditing] = useState<InventoryOpeningBalance | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ mode: 'existing', itemId: '', materialType, name: '', category: '', unit: 'ширхэг', date: today(), quantity: '', unitPrice: '' });
  const [error, setError] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((row) => row.materialType === materialType), [list.data, materialType]);
  const items = catalog.filter((item) => item.materialType === form.materialType);
  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null); setError('');
    setForm({ mode: items.length || catalog.length ? 'existing' : 'new', itemId: '', materialType, name: '', category: '', unit: 'ширхэг', date: today(), quantity: '', unitPrice: '' });
    setOpen(true);
  };
  const openEdit = (row: InventoryOpeningBalance) => {
    setEditing(row); setError('');
    setForm({ mode: 'existing', itemId: String(row.inventoryItemId), materialType: row.materialType, name: row.name, category: row.category, unit: row.unit, date: row.date, quantity: String(row.quantity), unitPrice: String(row.unitPrice) });
    setOpen(true);
  };
  const pickItem = (id: string) => {
    const item = catalog.find((candidate) => String(candidate.id) === id);
    set(item ? { itemId: id, name: item.name, category: item.category, unit: item.unit } : { itemId: id });
  };
  const submit = () => {
    const quantity = Number(form.quantity);
    const unitPrice = Number(form.unitPrice);
    if (!(quantity > 0)) return setError('Тоо хэмжээ 0-ээс их байх ёстой.');
    if (form.unitPrice === '' || !(unitPrice >= 0)) return setError('Нэгж үнэ сөрөг байж болохгүй.');
    if (form.mode === 'existing' && !form.itemId) return setError('Бараа сонгоно уу.');
    if (!form.name.trim() || !form.category.trim()) return setError('Нэр, ангиллыг бөглөнө үү.');
    const data: InventoryOpeningBalanceInput = {
      ...(form.mode === 'existing' ? { inventoryItemId: Number(form.itemId) } : {}),
      materialType: form.materialType, name: form.name.trim(), category: form.category.trim(), unit: form.unit, date: form.date, quantity, unitPrice,
    };
    const options = {
      onSuccess: () => {
        [getListInventoryItemsQueryKey(), getListInventoryOpeningBalancesQueryKey(), getListInventoryIssuesQueryKey(), getListInventoryPurchasesQueryKey()]
          .forEach((queryKey) => qc.invalidateQueries({ queryKey }));
        setOpen(false); setEditing(null);
      },
      onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Хадгалж чадсангүй. Төрөл, нэгж барааны мэдээлэлтэй зөрчилдөж байж болно.'),
    };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const remove = (row: InventoryOpeningBalance) => {
    if (!window.confirm(`${row.name} барааны эхний үлдэгдлийг устгах уу?`)) return;
    deletion.request(`/inventory/opening-balances/${row.id}`, `${row.name} · ${row.quantity} ${row.unit} эхний үлдэгдэл`);
  };
  useEffect(() => { if (openSignal > 0) openCreate(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  const pending = create.isPending || update.isPending;
  const locked = Boolean(editing);

  return <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card" data-testid="section-inventory-opening">
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-base font-bold">Эхний үлдэгдлийн бүртгэл</h2><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Өмнөх үеэс шилжиж ирсэн үлдэгдэл одоо байгаа тоо хэмжээнд нэмэгдэнэ. Энэ нь касс, шинэ худалдан авалт биш бөгөөд нягтлангийн журналын бичилт үүсгэхгүй.</p></div>
      <Button onClick={openCreate} data-testid="button-add-inventory-opening"><Plus className="size-4" />Эхний үлдэгдэл оруулах</Button>
    </div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div>
      : list.isError ? <ErrorBlock onRetry={() => list.refetch()} />
      : !rows.length ? <EmptyState title="Эхний үлдэгдэл бүртгээгүй байна" detail="Өмнө нь байсан барааны үлдэгдлийг эндээс оруулна." />
      : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3 text-right">Тоо</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Нэгж үнэ</th><th className="px-5 py-3 text-right">Дүн</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.id} data-testid={`row-inventory-opening-${row.id}`}>
          <td className="px-5 py-3 text-sm text-muted-foreground">{row.date}</td>
          <td className="px-5 py-3 text-sm font-semibold">{row.name}<div className="text-xs font-normal text-muted-foreground">{row.category}</div></td>
          <td className="px-5 py-3 text-right font-mono text-sm">{row.quantity} {row.unit}</td>
          <td className="px-5 py-3 text-right font-mono text-sm font-bold">{row.remainingQuantity} {row.unit}</td>
          <td className="px-5 py-3 text-right font-mono text-sm">{money(row.unitPrice)}</td>
          <td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(row.totalAmount)}</td>
          <td className="px-5 py-3 text-right"><div className="flex justify-end gap-1">
            {row.editable ? <Button size="icon" variant="ghost" title="Засах" onClick={() => openEdit(row)} data-testid={`button-edit-inventory-opening-${row.id}`}><Pencil className="size-4" /></Button> : <span className="self-center text-[10px] text-muted-foreground">Ашиглагдсан</span>}
            <Button size="icon" variant="ghost" title="Устгах" disabled={deletion.isPending} onClick={() => remove(row)} data-testid={`button-delete-inventory-opening-${row.id}`}><Trash2 className="size-4" /></Button>
          </div></td></tr>)}</tbody></table></div>}
    {open && <Modal title={editing ? 'Эхний үлдэгдэл засах' : 'Эхний үлдэгдэл оруулах'} detail="Одоо байгаа барааны тоо хэмжээнд нэмэгдэнэ. Касс болон журналд нөлөөлөхгүй." onClose={() => setOpen(false)}>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
        <label className="block text-xs font-semibold">Бараа материалын төрөл<select className={field} value={form.materialType} disabled={locked} onChange={(e) => set({ materialType: e.target.value as MType, itemId: '' })} data-testid="select-inventory-opening-type">{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        {!locked && <div className="inline-flex rounded-xl bg-secondary p-1">{(['existing', 'new'] as const).map((mode) => <button type="button" key={mode} onClick={() => set({ mode, itemId: '', name: '', category: '' })} className={`rounded-lg px-4 py-2 text-sm font-bold ${form.mode === mode ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`} data-testid={`button-inventory-opening-mode-${mode}`}>{mode === 'existing' ? 'Одоо байгаа бараа' : 'Шинэ бараа'}</button>)}</div>}
        {form.mode === 'existing' ? <label className="block text-xs font-semibold">Бараа материал<select className={field} value={form.itemId} disabled={locked} onChange={(e) => pickItem(e.target.value)} data-testid="select-inventory-opening-item"><option value="">Сонгох</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit}</option>)}{locked && <option value={form.itemId}>{form.name}</option>}</select></label>
          : <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold">Нэр<input className={field} value={form.name} onChange={(e) => set({ name: e.target.value })} data-testid="input-inventory-opening-name" /></label><label className="text-xs font-semibold">Ангилал<input className={field} value={form.category} onChange={(e) => set({ category: e.target.value })} data-testid="input-inventory-opening-category" /></label></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">Нэгж<select className={field} value={form.unit} disabled={form.mode === 'existing'} onChange={(e) => set({ unit: e.target.value })} data-testid="select-inventory-opening-unit">{[...new Set([...units, form.unit])].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
          <label className="text-xs font-semibold">Огноо<input type="date" className={field} value={form.date} onChange={(e) => set({ date: e.target.value })} data-testid="input-inventory-opening-date" /></label>
          <label className="text-xs font-semibold">Тоо хэмжээ<input type="number" min="0.001" step="0.001" className={`${field} font-mono`} value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} data-testid="input-inventory-opening-quantity" /></label>
          <label className="text-xs font-semibold">Нэгж үнэ<input type="number" min="0" step="0.01" className={`${field} font-mono`} value={form.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} data-testid="input-inventory-opening-price" /></label>
        </div>
        <p className="text-xs text-muted-foreground">Нийт дүн: <span className="font-mono font-bold">{money((Number(form.quantity) || 0) * (Number(form.unitPrice) || 0))}</span></p>
        {error && <p className="text-xs font-semibold text-destructive" data-testid="text-inventory-opening-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={pending} data-testid="button-save-inventory-opening">{pending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form>
    </Modal>}
  </section>;
}
