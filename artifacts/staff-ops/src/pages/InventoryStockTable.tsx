import type { InventoryItem } from '@workspace/api-client-react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/app-shared';

export function InventoryStockTable({ items, onOpen, onEdit }: {
  items: InventoryItem[];
  onOpen: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
}) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left">
    <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr>
      <th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3">Баримтын дугаар</th>
      <th className="px-5 py-3">Ангилал</th><th className="px-5 py-3">Нэгж</th>
      <th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Дүн</th>
      <th className="px-5 py-3 text-right">Үйлдэл</th>
    </tr></thead>
    <tbody className="divide-y divide-border">{items.map(item => <tr key={item.id}
      className="cursor-pointer transition-colors hover:bg-secondary/40" onClick={() => onOpen(item)}
      data-testid={`row-inventory-stock-${item.id}`}>
      <td className="px-5 py-3 text-sm font-semibold">{item.name}</td>
      <td className="px-5 py-3 font-mono text-xs" data-testid={`text-inventory-stock-documents-${item.id}`}>
        {item.purchaseDocumentNumbers?.length ? item.purchaseDocumentNumbers.map(number =>
          <div key={number} className="whitespace-nowrap">{number}</div>) : '—'}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">{item.category}</td>
      <td className="px-5 py-3 text-sm text-muted-foreground">{item.unit}</td>
      <td className="px-5 py-3 text-right font-mono text-sm font-bold">{item.quantity}</td>
      <td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(item.totalValue)}</td>
      <td className="px-5 py-3 text-right"><Button size="icon" variant="ghost" title="Ангилал засах"
        onClick={event => { event.stopPropagation(); onEdit(item); }} data-testid={`button-edit-inventory-category-${item.id}`}>
        <Pencil className="size-4" />
      </Button></td>
    </tr>)}</tbody>
  </table></div>;
}
