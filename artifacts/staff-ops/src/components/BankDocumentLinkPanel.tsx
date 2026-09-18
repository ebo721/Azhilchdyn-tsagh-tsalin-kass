import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  getListBankTransactionJournalReviewQueryKey,
  getListBankTransactionsQueryKey,
  getListCashTransactionsQueryKey,
  getListChartOfAccountsQueryKey,
  getListInventoryPurchasesQueryKey,
  getListOperatingExpensesQueryKey,
  useLinkBankTransactionExpense,
  useLinkBankTransactionPurchase,
  useListChartOfAccounts,
  useListInventoryPurchases,
  useListOperatingExpenses,
  type BankTransactionJournalReviewItem,
  type InventoryPurchaseItemInputUnit,
} from '@workspace/api-client-react';
import { money } from '@/lib/app-shared';

type LinkType = 'expense' | 'purchase';
type PurchaseItem = { name: string; category: string; unit: string; quantity: string; unitPrice: string };
const inventoryUnits: InventoryPurchaseItemInputUnit[] = ['ширхэг', 'кг', 'грамм', 'литр', 'мл', 'метр', 'багц', 'хайрцаг'];

export function BankDocumentLinkPanel({
  row,
  onClose,
}: {
  row: BankTransactionJournalReviewItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<LinkType>('expense');
  const [existingId, setExistingId] = useState('');
  const [description, setDescription] = useState(row.description);
  const [accountId, setAccountId] = useState('');
  const [materialType, setMaterialType] = useState<'food' | 'supply'>('food');
  const [supplierName, setSupplierName] = useState(row.counterparty || '');
  const [hasReceipt, setHasReceipt] = useState(false);
  const [items, setItems] = useState<PurchaseItem[]>([
    { name: row.description, category: '', unit: 'ширхэг', quantity: '1', unitPrice: String(row.amount) },
  ]);
  const expenses = useListOperatingExpenses();
  const purchases = useListInventoryPurchases();
  const accounts = useListChartOfAccounts();
  const linkExpense = useLinkBankTransactionExpense();
  const linkPurchase = useLinkBankTransactionPurchase();

  const unpaidExpenses = useMemo(
    () => (expenses.data ?? []).filter((item) => !item.paymentDate && item.date === row.date && item.amount === row.amount),
    [expenses.data, row.date, row.amount],
  );
  const unpaidPurchases = useMemo(
    () => (purchases.data ?? []).filter((item) => !item.paymentDate && item.date === row.date && item.totalAmount === row.amount),
    [purchases.data, row.date, row.amount],
  );
  const purchaseTotal = useMemo(
    () => items.reduce((total, item) => total + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0),
    [items],
  );
  const purchaseMatchesBank = Math.round(purchaseTotal * 100) === Math.round(row.amount * 100);
  const error = linkExpense.error ?? linkPurchase.error;
  const loading = expenses.isLoading || purchases.isLoading || accounts.isLoading;
  const invalidate = () => {
    [getListBankTransactionJournalReviewQueryKey(), getListBankTransactionsQueryKey(), getListCashTransactionsQueryKey(),
      getListInventoryPurchasesQueryKey(), getListOperatingExpensesQueryKey(), getListChartOfAccountsQueryKey()]
      .forEach((queryKey) => qc.invalidateQueries({ queryKey }));
  };
  const done = () => { invalidate(); onClose(); };
  const submitExisting = () => {
    if (!existingId) return;
    if (type === 'expense') linkExpense.mutate({ id: row.id, data: { operatingExpenseId: Number(existingId) } }, { onSuccess: done });
    else linkPurchase.mutate({ id: row.id, data: { inventoryPurchaseId: Number(existingId) } }, { onSuccess: done });
  };
  const submitExpense = (event: FormEvent) => {
    event.preventDefault();
    linkExpense.mutate({ id: row.id, data: { description, accountId: Number(accountId), date: row.date, amount: row.amount } }, { onSuccess: done });
  };
  const submitPurchase = (event: FormEvent) => {
    event.preventDefault();
    linkPurchase.mutate({
      id: row.id,
      data: {
        materialType, supplierName, hasReceipt, date: row.date,
        items: items.map((item) => ({ name: item.name, category: item.category, unit: item.unit as InventoryPurchaseItemInputUnit, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })),
      },
    }, { onSuccess: done });
  };
  const updateItem = (index: number, key: keyof PurchaseItem, value: string) =>
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));

  return (
    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-4" data-testid={`bank-document-link-panel-${row.id}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-bold">Баримт холбох</p><p className="text-xs text-muted-foreground">{row.date} · {money(row.amount)}</p></div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Болих</Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Баримтуудыг уншиж байна...</p> : (
        <>
          <div className="mb-3 flex gap-2">
            <Button type="button" size="sm" variant={type === 'expense' ? 'default' : 'outline'} onClick={() => { setType('expense'); setExistingId(''); }}>Зардал</Button>
            <Button type="button" size="sm" variant={type === 'purchase' ? 'default' : 'outline'} onClick={() => { setType('purchase'); setExistingId(''); }}>Худалдан авалт</Button>
          </div>
          {(type === 'expense' ? unpaidExpenses.length > 0 : unpaidPurchases.length > 0) && (
            <div className="mb-4 flex gap-2">
              <select value={existingId} onChange={(event) => setExistingId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" data-testid={`select-existing-document-${row.id}`}>
                <option value="">Таарсан төлөгдөөгүй баримт сонгох...</option>
                {type === 'expense'
                  ? unpaidExpenses.map((item) => <option key={item.id} value={item.id}>{item.description} · {money(item.amount)}</option>)
                  : unpaidPurchases.map((item) => <option key={item.id} value={item.id}>{item.supplierName} · {money(item.totalAmount)}</option>)}
              </select>
              <Button type="button" size="sm" disabled={!existingId || linkExpense.isPending || linkPurchase.isPending} onClick={submitExisting}>Холбох</Button>
            </div>
          )}
          {type === 'expense' ? (
            <form onSubmit={submitExpense} className="space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold text-muted-foreground">Шинэ үйл ажиллагааны зардал</p>
              <input value={description} onChange={(event) => setDescription(event.target.value)} required className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="Утга" data-testid={`input-link-expense-description-${row.id}`} />
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid={`select-link-expense-account-${row.id}`}>
                <option value="">Идэвхтэй зардлын данс сонгох...</option>
                {(accounts.data ?? []).filter((account) => account.isActive && account.type === 'expense').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2 text-xs"><label>Огноо<input value={row.date} readOnly className="mt-1 h-9 w-full rounded-md border border-input bg-muted px-2" /></label><label>Дүн<input value={row.amount} readOnly className="mt-1 h-9 w-full rounded-md border border-input bg-muted px-2" /></label></div>
              <Button type="submit" size="sm" disabled={!accountId || linkExpense.isPending}>Шинэ зардал үүсгэж холбох</Button>
            </form>
          ) : (
            <form onSubmit={submitPurchase} className="space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold text-muted-foreground">Шинэ бараа материалын худалдан авалт</p>
              <div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold">Материал<select value={materialType} onChange={(event) => setMaterialType(event.target.value as 'food' | 'supply')} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="food">Хүнсний бараа материал</option><option value="supply">Хангамжийн материал</option></select></label><label className="text-xs font-semibold">Нийлүүлэгч<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm" /></label></div>
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={hasReceipt} onChange={(event) => setHasReceipt(event.target.checked)} />Баримттай</label>
              {items.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-border/70 p-2 sm:grid-cols-5">
                <input value={item.name} onChange={(event) => updateItem(index, 'name', event.target.value)} required placeholder="Нэр" className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" />
                <input value={item.category} onChange={(event) => updateItem(index, 'category', event.target.value)} required placeholder="Ангилал" className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" />
                <select value={item.unit} onChange={(event) => updateItem(index, 'unit', event.target.value)} required className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs">
                  {inventoryUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
                <input value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} required placeholder="Тоо" type="number" min="0.01" step="any" className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" />
                <input value={item.unitPrice} onChange={(event) => updateItem(index, 'unitPrice', event.target.value)} required placeholder="Нэгж үнэ" type="number" min="0" step="0.01" className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" />
                {items.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Хасах</Button>}
              </div>)}
              <p className={purchaseMatchesBank ? 'text-xs text-muted-foreground' : 'text-xs font-semibold text-destructive'}>
                Нийт: {money(purchaseTotal)} / Банкны дүн: {money(row.amount)}
              </p>
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setItems((current) => [...current, { name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }])}>+ Мөр нэмэх</Button><Button type="submit" size="sm" disabled={linkPurchase.isPending || !purchaseMatchesBank}>Шинэ худалдан авалт үүсгэж холбох</Button></div>
            </form>
          )}
          {error && <p className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error instanceof Error ? error.message : 'Баримт холбох үед алдаа гарлаа.'}</p>}
        </>
      )}
    </div>
  );
}