import { useEffect, useMemo, useRef, useState } from 'react';
import { getListInventoryCustodiansQueryKey, useListInventoryCustodians } from '@workspace/api-client-react';

export function InventoryCustodianSelect({ value, onChange, isNew, savedId, savedName, testId }: {
  value: string;
  onChange: (value: string) => void;
  isNew: boolean;
  savedId?: number | null;
  savedName?: string | null;
  testId: string;
}) {
  const custodians = useListInventoryCustodians({ query: { queryKey: getListInventoryCustodiansQueryKey(), refetchOnMount: 'always', staleTime: 0 } });
  const list = custodians.data ?? [];
  const [search, setSearch] = useState('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const defaulted = useRef(false);
  useEffect(() => {
    if (!isNew || defaulted.current || value || !custodians.data) return;
    if (custodians.data.length === 1) { defaulted.current = true; onChangeRef.current(String(custodians.data[0].id)); }
  }, [isNew, value, custodians.data]);
  const q = search.trim().toLocaleLowerCase('mn-MN');
  const filtered = useMemo(() => list.filter((c) => c.name.toLocaleLowerCase('mn-MN').includes(q) || String(c.id) === value), [list, q, value]);
  const cls = 'mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';
  const savedActive = !isNew && savedId != null && savedName ? savedId : null;
  const savedMissing = savedActive !== null && !list.some((c) => c.id === savedId);
  const legacy = !isNew && savedId == null && !!savedName;
  return <div className="block space-y-2 text-xs font-semibold" data-testid={`${testId}-field`}>
    <label className="block">Хариуцагч
      {custodians.isLoading ? <div className="mt-1 h-10 animate-pulse rounded-lg bg-secondary" data-testid={`${testId}-loading`} /> : custodians.isError ? <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive" data-testid={`${testId}-error`}><span>Хариуцагчийн жагсаалтыг ачаалж чадсангүй.</span><button type="button" className="font-bold underline" onClick={() => custodians.refetch()} data-testid={`${testId}-retry`}>Дахин оролдох</button></div>
      : <>
        {list.length > 0 && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ажилтны нэрээр хайх" aria-label="Хариуцагчийн нэрээр хайх" className={cls} data-testid={`${testId}-search`} />}
        <select className={cls} aria-label="Хариуцагч" value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
          <option value="">{isNew ? 'Сонгох' : savedName ? `Өөрчлөхгүй (${savedName})` : 'Сонгоогүй'}</option>
          {savedMissing && <option value={String(savedId)}>{savedName}</option>}
          {filtered.map((c) => <option value={String(c.id)} key={c.id}>{c.id === savedActive ? savedName : c.name}</option>)}
        </select>
        {!filtered.length && list.length > 0 && <span className="mt-1 block font-normal text-muted-foreground" data-testid={`${testId}-no-results`}>Ажилтан олдсонгүй.</span>}
        {legacy && <span className="mt-1 block font-normal text-muted-foreground" data-testid={`${testId}-legacy`}>Хуучин бүртгэл: {savedName}. Хоосон орхивол өөрчлөгдөхгүй.</span>}
      </>}
    </label>
    {!custodians.isLoading && !custodians.isError && !list.length && !savedMissing && <p className="font-normal text-muted-foreground" data-testid={`${testId}-empty`}>Хариуцагч тохируулаагүй байна. Админ: Тохиргоо → Хэрэглэгч хэсэгт агуулахын хэрэглэгчид ажилтан сонгоно уу.</p>}
  </div>;
}
