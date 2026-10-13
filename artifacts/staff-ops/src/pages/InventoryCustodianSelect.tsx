import { useEffect, useRef } from 'react';
import { getListInventoryCustodiansQueryKey, useGetAuthSession, useListInventoryCustodians } from '@workspace/api-client-react';

export function InventoryCustodianSelect({ value, onChange, isNew, savedId, savedName, testId }: {
  value: string;
  onChange: (value: string) => void;
  isNew: boolean;
  savedId?: number | null;
  savedName?: string | null;
  testId: string;
}) {
  const session = useGetAuthSession();
  const custodians = useListInventoryCustodians({ query: { queryKey: getListInventoryCustodiansQueryKey(), refetchOnMount: 'always', staleTime: 0 } });
  const list = custodians.data ?? [];
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const sessionId = session.data?.id ?? null;
  const defaulted = useRef(false);
  useEffect(() => {
    if (!isNew || defaulted.current || value || !custodians.data || sessionId === null) return;
    if (custodians.data.some((c) => c.id === sessionId)) { defaulted.current = true; onChangeRef.current(String(sessionId)); }
  }, [isNew, value, custodians.data, sessionId]);
  const cls = 'mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary';
  const savedMissing = !isNew && savedId != null && savedName && !list.some((c) => c.id === savedId);
  const savedActive = !isNew && savedId != null && savedName ? savedId : null;
  return <div className="block space-y-2 text-xs font-semibold" data-testid={`${testId}-field`}>
    <label className="block">Хариуцагч
      {custodians.isLoading ? <div className="mt-1 h-10 animate-pulse rounded-lg bg-secondary" data-testid={`${testId}-loading`} /> : custodians.isError ? <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive" data-testid={`${testId}-error`}><span>Хариуцагчийн жагсаалтыг ачаалж чадсангүй.</span><button type="button" className="font-bold underline" onClick={() => custodians.refetch()} data-testid={`${testId}-retry`}>Дахин оролдох</button></div>
        : <select className={cls} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
          <option value="">{isNew ? 'Сонгох' : savedName ? `Өөрчлөхгүй (${savedName})` : 'Сонгоогүй'}</option>
          {savedMissing && <option value={String(savedId)}>{savedName}</option>}
          {list.map((c) => <option value={String(c.id)} key={c.id}>{c.id === savedActive ? savedName : c.name}</option>)}
        </select>}
    </label>
    {!custodians.isLoading && !custodians.isError && !list.length && !savedMissing && <p className="font-normal text-muted-foreground" data-testid={`${testId}-empty`}>Хариуцагчийн нэр тохируулаагүй байна. Админ: Тохиргоо → Хэрэглэгч хэсэгт агуулахын хэрэглэгчид «Няравын нэр» оруулна уу.</p>}
  </div>;
}
