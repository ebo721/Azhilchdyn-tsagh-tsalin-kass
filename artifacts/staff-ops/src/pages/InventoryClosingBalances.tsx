import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getGetInventoryClosingQuoteQueryKey,
  getListInventoryClosingBalancesQueryKey,
  getListInventoryIssuesQueryKey,
  getListInventoryItemsQueryKey,
  useCreateInventoryClosingBalance,
  useGetInventoryClosingQuote,
  useListInventoryClosingBalances,
  useUpdateInventoryClosingBalance,
  type InventoryClosingBalance,
  type InventoryItem,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { money, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { InventoryCustodianSelect } from '@/pages/InventoryCustodianSelect';

type MType = 'food' | 'supply';
const field = 'mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';
const statusLabel = { recorded: 'Бүртгэгдсэн', pending: 'Баталгаажаагүй', confirmed: 'Баталгаажсан' } as const;
const sourceLabel = { purchase: 'Сүүлийн худалдан авалтын үнэ', opening: 'Эхний үлдэгдлийн үнэ', none: 'Үнэ олдсонгүй' } as const;
const errText = (e: unknown, fallback: string) => {
  const data = (e as { data?: { error?: string } } | null)?.data;
  return data?.error || (e instanceof Error && e.message ? e.message : fallback);
};
const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function InventoryClosingBalances({ catalog, materialType, openSignal = 0, editId = null, editSignal = 0, canManage = false }: {
  catalog: InventoryItem[]; materialType: MType; openSignal?: number; editId?: number | null; editSignal?: number; canManage?: boolean;
}) {
  const qc = useQueryClient();
  const list = useListInventoryClosingBalances({ query: { queryKey: getListInventoryClosingBalancesQueryKey(), staleTime: 15000, refetchOnMount: 'always' } });
  const create = useCreateInventoryClosingBalance();
  const update = useUpdateInventoryClosingBalance();
  const deletion = useQueueDeletion();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryClosingBalance | null>(null);
  const [itemId, setItemId] = useState('');
  const [date, setDate] = useState(today());
  const [quantity, setQuantity] = useState('');
  const [custodian, setCustodian] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => (list.data ?? []).filter((r) => r.materialType === materialType), [list.data, materialType]);
  const items = catalog.filter((i) => i.materialType === materialType);

  const openCreate = () => { if (!canManage) return; setEditing(null); setItemId(''); setDate(today()); setQuantity(''); setCustodian(''); setError(''); setOpen(true); };
  const openEdit = (r: InventoryClosingBalance) => {
    if (!canManage || r.status === 'confirmed') return;
    setEditing(r); setItemId(String(r.inventoryItemId)); setDate(r.date); setQuantity(String(r.quantity)); setCustodian(''); setError(''); setOpen(true);
  };
  useEffect(() => { if (openSignal > 0) openCreate(); }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const handled = useRef(0);
  useEffect(() => {
    if (editSignal <= handled.current || editId == null || !list.data) return;
    handled.current = editSignal;
    const r = list.data.find((x) => x.id === editId);
    if (r) openEdit(r);
  }, [editSignal, editId, list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const idNum = Number(itemId);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const params = { inventoryItemId: idNum, date };
  const quote = useGetInventoryClosingQuote(params, { query: { queryKey: getGetInventoryClosingQuoteQueryKey(params), enabled: open && idNum > 0 && validDate, staleTime: 0, refetchOnMount: 'always' } });
  const q = open && idNum > 0 && validDate ? quote.data : undefined;
  const qtyValid = /^\d+(\.\d{1,3})?$/.test(quantity.trim());
  const qty = qtyValid ? Number(quantity) : 0;
  const price = q?.unitPrice ?? null;
  const total = price != null ? qty * price : null;
  const diff = q ? Math.round((q.bookQuantity - qty) * 1000) / 1000 : null;
  const unit = (editing && String(editing.inventoryItemId) === itemId ? editing.unit : catalog.find((i) => i.id === idNum)?.unit) ?? '';
  const custodianOk = Boolean(custodian) || (editing != null && (editing.responsibleEmployeeId != null || !!editing.responsibleName));
  const canSave = idNum > 0 && validDate && qtyValid && price != null && !!q && custodianOk && !saving && !quote.isFetching;

  const submit = async () => {
    if (!canSave) return;
    setError(''); setSaving(true);
    const data = { inventoryItemId: idNum, date, quantity: qty, responsibleEmployeeId: custodian ? Number(custodian) : editing?.responsibleEmployeeId ?? null };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, data }); else await create.mutateAsync({ data });
      await Promise.all([getListInventoryItemsQueryKey(), getListInventoryClosingBalancesQueryKey(), getListInventoryIssuesQueryKey()]
        .map((queryKey) => qc.invalidateQueries({ queryKey })));
      setOpen(false); setEditing(null);
    } catch (e) { setError(errText(e, 'Хадгалж чадсангүй.')); } finally { setSaving(false); }
  };
  const remove = (r: InventoryClosingBalance) => {
    if (!window.confirm(`${r.itemName} барааны эцсийн үлдэгдлийг устгах уу?`)) return;
    deletion.request(`/inventory/closing-balances/${r.id}`, `${r.itemName} · ${r.quantity} ${r.unit} эцсийн үлдэгдэл`);
  };

  return <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card" data-testid="section-inventory-closing">
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-base font-bold">Эцсийн үлдэгдлийн тооллого</h2><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Бодит тоолсон үлдэгдлийг оруулна. Дутагдал зөвхөн баталгаажаагүй зарлага үүсгэх бөгөөд баталгаажтал үлдэгдэл өөрчлөгдөхгүй.</p></div>
      {canManage && <Button onClick={openCreate}><Plus className="size-4" />Эцсийн үлдэгдэл оруулах</Button>}
    </div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div>
      : list.isError ? <ErrorBlock onRetry={() => list.refetch()} />
      : !rows.length ? <EmptyState title="Эцсийн үлдэгдэл бүртгээгүй байна" detail="Өдрийн эцэст тоолсон үлдэгдлийг эндээс оруулна." />
      : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3 text-right">Тооллого</th><th className="px-5 py-3 text-right">Дансны үлдэгдэл</th><th className="px-5 py-3 text-right">Зөрүү</th><th className="px-5 py-3 text-right">Нэгж үнэ</th><th className="px-5 py-3 text-right">Дүн</th><th className="px-5 py-3">Хариуцагч</th><th className="px-5 py-3">Төлөв</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((r) => <tr key={r.id} data-testid={`row-inventory-closing-${r.id}`}>
          <td className="px-5 py-3 text-sm text-muted-foreground">{r.date}</td>
          <td className="px-5 py-3 text-sm font-semibold">{r.itemName}</td>
          <td className="px-5 py-3 text-right font-mono text-sm">{r.quantity} {r.unit}</td>
          <td className="px-5 py-3 text-right font-mono text-sm">{r.bookQuantity} {r.unit}</td>
          <td className="px-5 py-3 text-right font-mono text-sm font-bold">{r.difference > 0 ? `Дутагдал ${num(r.difference)}` : r.difference < 0 ? `Илүүдэл ${num(-r.difference)}` : 'Тэнцсэн'}</td>
          <td className="px-5 py-3 text-right font-mono text-sm">{money(r.unitPrice)}<div className="text-[10px] font-sans text-muted-foreground">{sourceLabel[r.priceSource]}</div></td>
          <td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(r.totalAmount)}</td>
          <td className="px-5 py-3 text-sm">{r.responsibleName || '—'}</td>
          <td className="px-5 py-3 text-sm">{statusLabel[r.status]}</td>
          <td className="px-5 py-3 text-right">{r.status === 'confirmed' || !canManage ? <span className="text-[10px] text-muted-foreground">{r.status === 'confirmed' ? 'Өөрчлөх боломжгүй' : ''}</span> : <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Засах" onClick={() => openEdit(r)} data-testid={`button-edit-closing-${r.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Устгах" disabled={deletion.isPending} onClick={() => remove(r)} data-testid={`button-delete-closing-${r.id}`}><Trash2 className="size-4" /></Button></div>}</td>
        </tr>)}</tbody></table></div>}
    {open && <Modal title={editing ? 'Эцсийн үлдэгдэл засах' : 'Эцсийн үлдэгдэл оруулах'} detail="Дутагдал гарвал баталгаажаагүй зарлага үүснэ." onClose={() => setOpen(false)}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">Огноо<input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-closing-date" /></label>
          <label className="text-xs font-semibold">Бараа материал<select className={field} value={itemId} onChange={(e) => setItemId(e.target.value)} data-testid="select-closing-item"><option value="">Сонгох</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit}</option>)}{editing && !items.some((i) => i.id === editing.inventoryItemId) && <option value={String(editing.inventoryItemId)}>{editing.itemName}</option>}</select></label>
          <label className="text-xs font-semibold">Бодит тоо хэмжээ{unit ? ` (${unit})` : ''}<input type="number" min="0" step="0.001" inputMode="decimal" className={`${field} font-mono`} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-closing-quantity" /></label>
          <InventoryCustodianSelect value={custodian} onChange={setCustodian} isNew={!editing} savedId={editing?.responsibleEmployeeId} savedName={editing?.responsibleName} testId="select-closing-custodian" />
        </div>
        {quantity !== '' && !qtyValid && <p className="text-xs font-semibold text-destructive">Тоо хэмжээ 0 эсвэл түүнээс их, 3 орны нарийвчлалтай байх ёстой.</p>}
        <div className="grid gap-3 rounded-xl border border-border bg-secondary/30 p-4 text-sm sm:grid-cols-2">
          <div>Нэгж үнэ: <span className="font-mono font-bold" data-testid="text-closing-unit-price">{idNum > 0 && quote.isFetching ? 'Тооцож байна...' : price != null ? money(price) : '—'}</span>{q && <div className="text-xs text-muted-foreground">Эх сурвалж: {sourceLabel[q.priceSource]}</div>}</div>
          <div>Дансны үлдэгдэл: <span className="font-mono font-bold" data-testid="text-closing-book-quantity">{q ? `${q.bookQuantity} ${unit}` : '—'}</span></div>
          <div>Дүн: <span className="font-mono font-bold" data-testid="text-closing-total">{total != null ? money(total) : '—'}</span></div>
          <div>Зөрүү (дансны - бодит): <span className="font-mono font-bold" data-testid="text-closing-difference">{diff != null && qtyValid ? `${num(diff)} ${unit}` : '—'}</span></div>
        </div>
        {q && q.priceSource === 'none' && <p className="text-xs font-semibold text-destructive">Энэ барааны мэдэгдэх үнэ (худалдан авалт эсвэл эхний үлдэгдэл) байхгүй тул хадгалах боломжгүй.</p>}
        {quote.isError && <p className="text-xs font-semibold text-destructive">{errText(quote.error, 'Үнэ, дансны үлдэгдлийг ачаалж чадсангүй.')}</p>}
        {diff != null && qtyValid && diff < 0 && <p className="text-xs font-semibold text-amber-700" data-testid="text-closing-surplus-warning">Илүүдэл илэрлээ ({num(-diff)} {unit}). Зарлага үүсэхгүй, үлдэгдэл өөрчлөгдөхгүй.</p>}
        {diff != null && qtyValid && diff > 0 && <p className="text-xs text-muted-foreground">Дутагдал {num(diff)} {unit}: баталгаажаагүй зарлага үүснэ. Баталгаажуулах хүртэл үлдэгдэл өөрчлөгдөхгүй.</p>}
        {error && <p className="text-xs font-semibold text-destructive" data-testid="text-closing-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={!canSave} data-testid="button-save-closing">{saving ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form>
    </Modal>}
  </section>;
}
