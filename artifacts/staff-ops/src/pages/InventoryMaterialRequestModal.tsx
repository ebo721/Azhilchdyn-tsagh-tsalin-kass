import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, PackageOpen, Check } from 'lucide-react';
import { format } from 'date-fns';
import { 
  useListMaterialRequestCatalog,
  useCreateInventoryMaterialRequest,
  getListInventoryMaterialRequestsQueryKey
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui-primitives';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { today } from '@/lib/app-shared';

type MaterialRequestForm = {
  requestedDate: string;
  note: string;
  lines: Array<{
    inventoryItemId: string;
    itemName: string;
    unit: string;
    quantity: string;
  }>;
};

export function InventoryMaterialRequestModal({ 
  onClose,
  requestedDate,
  mealScheduleEntryId,
}: { 
  onClose: () => void;
  requestedDate?: string;
  mealScheduleEntryId?: number;
}) {
  const qc = useQueryClient();
  const create = useCreateInventoryMaterialRequest();
  const catalogQuery = useListMaterialRequestCatalog();
  const catalog = catalogQuery.data || [];

  const form = useForm<MaterialRequestForm>({
    defaultValues: {
      requestedDate: requestedDate || today(),
      note: '',
      lines: [{ inventoryItemId: '', itemName: '', unit: '', quantity: '1' }]
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines'
  });

  const submit = (values: MaterialRequestForm) => {
    const validLines = values.lines.filter(l => l.inventoryItemId && Number(l.quantity) > 0);
    if (validLines.length === 0) return;

    create.mutate({
      data: {
        requestedDate: values.requestedDate,
        mealScheduleEntryId: mealScheduleEntryId ?? null,
        note: values.note || null,
        lines: validLines.map(l => ({
          inventoryItemId: Number(l.inventoryItemId),
          quantity: Number(l.quantity)
        }))
      }
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryMaterialRequestsQueryKey() });
        onClose();
      }
    });
  };

  const selectedItemIds = fields.map((f, i) => form.watch(`lines.${i}.inventoryItemId`)).filter(Boolean);

  return (
    <Modal 
      title="Материал захиалах" 
      detail="Агуулахаас материал авах хүсэлт илгээх"
      onClose={onClose}
      wide
    >
      <form onSubmit={form.handleSubmit(submit)} className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Захиалгын огноо</label>
            <Input 
              type="date" 
              required
              {...form.register('requestedDate')} 
              data-testid="input-request-date" 
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Тэмдэглэл</label>
            <Input 
              placeholder="Нэмэлт мэдээлэл (заавал биш)" 
              {...form.register('note')} 
              data-testid="input-request-note" 
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Захиалах бараа</label>
          <div className="rounded-xl border border-border bg-secondary/20 p-2 space-y-2">
            {catalogQuery.isError && <p className="text-sm font-semibold text-destructive px-2">Барааны жагсаалт татахад алдаа гарлаа.</p>}
            {fields.map((field, index) => {
              const currentItemId = form.watch(`lines.${index}.inventoryItemId`);
              const currentItemName = form.watch(`lines.${index}.itemName`);
              
              return (
                <div key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-card p-2 shadow-sm border border-border sm:flex-nowrap">
                  <div className="flex-1 min-w-[200px]">
                    <ItemCombobox 
                      items={catalog.filter(c => !selectedItemIds.includes(String(c.id)) || String(c.id) === currentItemId)}
                      value={currentItemId}
                      label={currentItemName}
                      onChange={(item) => {
                        form.setValue(`lines.${index}.inventoryItemId`, String(item.id));
                        form.setValue(`lines.${index}.itemName`, item.name);
                        form.setValue(`lines.${index}.unit`, item.unit);
                      }}
                      idPrefix={`line-${index}`}
                    />
                  </div>
                  <div className="w-24 shrink-0">
                    <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-secondary/50 px-3 text-sm text-muted-foreground">
                      {form.watch(`lines.${index}.unit`) || '-'}
                    </div>
                  </div>
                  <div className="w-28 shrink-0">
                    <Input 
                      type="number" 
                      min="0.001" 
                      max="99999999999"
                      step="0.001" 
                      placeholder="Тоо" 
                      required
                      {...form.register(`lines.${index}.quantity`)} 
                      data-testid={`input-request-line-qty-${index}`} 
                    />
                  </div>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0" 
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    data-testid={`button-remove-request-line-${index}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              className="w-full border-dashed" 
              onClick={() => append({ inventoryItemId: '', itemName: '', unit: '', quantity: '1' })}
              data-testid="button-add-request-line"
            >
              <Plus className="mr-2 size-4" /> Бараа нэмэх
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-5">
          <div className="text-sm text-destructive font-semibold">
            {create.isError ? 'Захиалга хадгалахад алдаа гарлаа.' : ''}
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-request">Болих</Button>
            <Button 
              type="submit" 
              disabled={create.isPending || fields.some(f => !form.watch(`lines.${fields.indexOf(f)}.inventoryItemId`))} 
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              data-testid="button-save-request"
            >
              <PackageOpen className="mr-2 size-4" /> Захиалах
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ItemCombobox({ 
  items, 
  value, 
  label,
  onChange,
  idPrefix
}: { 
  items: Array<{ id: number; name: string; category: string; unit: string; }>;
  value: string;
  label: string;
  onChange: (item: { id: number; name: string; category: string; unit: string; }) => void;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
          data-testid={`combobox-${idPrefix}`}
        >
          <span className="truncate">{label || "Бараа сонгох..."}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Бараа хайх..." data-testid={`input-search-${idPrefix}`} />
          <CommandList>
            <CommandEmpty>Бараа олдсонгүй.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.name} ${item.category}`}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  data-testid={`option-${idPrefix}-${item.id}`}
                >
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.category}</span>
                  </div>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === String(item.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}