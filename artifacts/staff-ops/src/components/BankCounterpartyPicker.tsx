import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListJournalSuppliersQueryKey, useCreateJournalSupplier, type JournalSupplier } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  options: JournalSupplier[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
};

export function BankCounterpartyPicker({ options, value, onChange, disabled, onBusyChange }: Props) {
  const qc = useQueryClient();
  const create = useCreateJournalSupplier();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [validation, setValidation] = useState('');
  const q = search.trim().toLocaleLowerCase('mn-MN');
  const visible = options.filter(party => String(party.id) === value || party.name.toLocaleLowerCase('mn-MN').includes(q));
  const save = async () => {
    const normalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 200) {
      setValidation('Нэрийг 1–200 тэмдэгтээр оруулна уу.');
      return;
    }
    if (disabled || create.isPending) return;
    setValidation('');
    onBusyChange(true);
    try {
      const party = await create.mutateAsync({ data: { name: normalized } });
      const key = getListJournalSuppliersQueryKey();
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<JournalSupplier[]>(key, current => [
        ...(current ?? []).filter(item => item.id !== party.id), party,
      ]);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/inventory/suppliers') });
      onChange(String(party.id));
      setSearch('');
      setAdding(false);
      setName('');
    } catch {
      // The mutation error is rendered below; retain the user's draft for retry.
    } finally {
      onBusyChange(false);
    }
  };
  const error = create.error as { data?: { error?: string }; message?: string } | null;
  return <div className="space-y-3">
    <div className="space-y-1.5 text-xs font-semibold">
      <label htmlFor="bank-ar-ap-party-search">Харилцагч / хувь хүн</label>
      <Input id="bank-ar-ap-party-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Нэрээр хайх" disabled={disabled} data-testid="input-bank-ar-ap-supplier-search" />
      <select aria-label="Харилцагч эсвэл хувь хүн сонгох" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-bank-ar-ap-supplier">
        <option value="">Харилцагч / хувь хүн сонгоно уу</option>
        {visible.map(party => <option key={party.id} value={party.id}>{party.name}</option>)}
      </select>
      {visible.length === 0 && <p className="font-normal text-muted-foreground" data-testid="text-bank-ar-ap-supplier-empty">Тохирох харилцагч / хувь хүн олдсонгүй. Шинээр бүртгэж болно.</p>}
    </div>
    <p className="text-xs text-muted-foreground">Байгууллага эсвэл ажилтан биш хувь хүн сонгоно. Энд бүртгэхэд ажилтны бүртгэлд нэмэгдэхгүй.</p>
    {!adding ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
      create.reset(); setValidation(''); setName(search); setAdding(true);
    }} data-testid="button-add-bank-counterparty">Шинэ харилцагч / хувь хүн бүртгэх</Button> :
      <div className="space-y-3 rounded-lg border border-border bg-secondary/25 p-3" data-testid="form-bank-counterparty">
        <label className="block space-y-1.5 text-xs font-semibold">Байгууллага эсвэл хувь хүний нэр
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={200} disabled={disabled}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}
            placeholder="Нэрийг бүтнээр оруулна уу" data-testid="input-bank-counterparty-name" />
        </label>
        {validation && <p role="alert" className="text-xs text-destructive" data-testid="error-bank-counterparty-name">{validation}</p>}
        {create.isError && <p role="alert" className="text-xs text-destructive" data-testid="error-bank-counterparty-save">{error?.data?.error ?? error?.message ?? 'Харилцагч бүртгэж чадсангүй. Дахин оролдоно уу.'}</p>}
        <p className="text-xs text-muted-foreground">Нэр давхардвал өмнөх бүртгэлийг сонгоно. Харилцагч бүртгэх нь дангаараа авлага, өглөг үүсгэхгүй.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setAdding(false)} data-testid="button-cancel-bank-counterparty">Болих</Button>
          <Button type="button" size="sm" disabled={disabled} onClick={() => void save()} data-testid="button-save-bank-counterparty">{create.isPending ? 'Бүртгэж байна...' : 'Бүртгээд сонгох'}</Button>
        </div>
      </div>}
  </div>;
}
