import { useMemo, useState, type FormEvent } from 'react';
import { format, startOfMonth } from 'date-fns';
import {
  ArrowDownRight,
  CalendarDays,
  Clock3,
  RefreshCw,
  Search,
  UtensilsCrossed,
} from 'lucide-react';
import {
  getListMealCountsQueryKey,
  useListMealCounts,
  type MealCount,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeading } from '@/components/ui-primitives';

type Interval = { dateFrom: string; dateTo: string };

const numberFormat = new Intl.NumberFormat('mn-MN');

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function displayDate(value: string) {
  if (!isValidDate(value)) return value;
  return format(new Date(`${value}T12:00:00`), 'yyyy.MM.dd');
}

function displaySync(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'yyyy.MM.dd · HH:mm');
}

export function MealCounts() {
  const [initialInterval] = useState<Interval>(() => {
    const today = new Date();
    return {
      dateFrom: format(startOfMonth(today), 'yyyy-MM-dd'),
      dateTo: format(today, 'yyyy-MM-dd'),
    };
  });
  const [dateFrom, setDateFrom] = useState(initialInterval.dateFrom);
  const [dateTo, setDateTo] = useState(initialInterval.dateTo);
  const [applied, setApplied] = useState<Interval>(initialInterval);
  const [validation, setValidation] = useState('');
  const [search, setSearch] = useState('');
  const [mealType, setMealType] = useState('');

  const query = useListMealCounts(applied, {
    query: {
      queryKey: getListMealCountsQueryKey(applied),
      staleTime: 30_000,
      refetchOnMount: 'always',
    },
  });

  const counts = query.data ?? [];
  const mealTypes = useMemo(
    () => Array.from(new Set(counts.map((item) => item.mealType))).sort((a, b) => a.localeCompare(b)),
    [counts],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return counts
      .filter((item) => (!mealType || item.mealType === mealType)
        && (!term || item.mealType.toLocaleLowerCase().includes(term)
          || item.date.includes(term)
          || displayDate(item.date).includes(term)
          || String(item.count).includes(term)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.mealType.localeCompare(b.mealType));
  }, [counts, mealType, search]);

  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const dayCount = new Set(counts.map((item) => item.date)).size;
  const latestSync = counts.reduce((latest, item) => {
    const timestamp = Date.parse(item.syncedAt);
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);
  const filtersActive = Boolean(search.trim() || mealType);
  const intervalChanged = dateFrom !== applied.dateFrom || dateTo !== applied.dateTo;

  function applyInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDate(dateFrom) || !isValidDate(dateTo)) {
      setValidation('Эхлэх болон дуусах өдрийг зөв оруулна уу.');
      return;
    }
    if (dateFrom > dateTo) {
      setValidation('Эхлэх өдөр дуусах өдрөөс хойш байж болохгүй.');
      return;
    }
    if ((Date.parse(`${dateTo}T12:00:00Z`) - Date.parse(`${dateFrom}T12:00:00Z`)) / 86_400_000 >= 366) {
      setValidation('Нэг удаад 366 хүртэл хоногийн мэдээлэл харах боломжтой.');
      return;
    }
    setValidation('');
    if (dateFrom === applied.dateFrom && dateTo === applied.dateTo) {
      void query.refetch();
    } else {
      setApplied({ dateFrom, dateTo });
      setMealType('');
    }
  }

  return (
    <div className="page-enter space-y-6 pb-8" data-testid="page-meal-counts">
      <PageHeading
        eyebrow="Reader · Синк"
        title="Хоолны тоо"
        detail="Reader-ээс илгээсэн хоолны тоог өдрөөр болон хоолны төрлөөр харах хэсэг."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-testid="button-refresh-meal-counts"
          >
            <RefreshCw className={`mr-2 size-4 ${query.isFetching ? 'animate-spin' : ''}`} />
            Шинэчлэх
          </Button>
        }
      />

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Огнооны интервал">
        <div className="border-b border-border bg-secondary/30 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarDays className="size-4 text-primary" aria-hidden="true" />
            Хугацаа сонгох
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Огноогоо тохируулаад “Харах” товчийг дарна уу.</p>
        </div>
        <form onSubmit={applyInterval} noValidate className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:p-6">
          <div className="min-w-0 flex-1">
            <label htmlFor="meal-count-date-from" className="mb-1.5 block text-xs font-semibold text-foreground">Эхлэх өдөр</label>
            <Input
              id="meal-count-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => { setDateFrom(event.target.value); setValidation(''); }}
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? 'meal-count-date-error' : undefined}
              data-testid="input-meal-count-date-from"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="meal-count-date-to" className="mb-1.5 block text-xs font-semibold text-foreground">Дуусах өдөр</label>
            <Input
              id="meal-count-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => { setDateTo(event.target.value); setValidation(''); }}
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? 'meal-count-date-error' : undefined}
              data-testid="input-meal-count-date-to"
            />
          </div>
          <Button type="submit" className="w-full sm:w-auto sm:min-w-32" data-testid="button-apply-meal-count-dates">
            Харах <ArrowDownRight className="ml-2 size-4" aria-hidden="true" />
          </Button>
        </form>
        {validation && <p id="meal-count-date-error" role="alert" className="px-5 pb-5 text-sm font-medium text-destructive sm:px-6" data-testid="status-meal-count-date-error">{validation}</p>}
        {intervalChanged && !validation && (
          <p className="px-5 pb-5 text-xs text-muted-foreground sm:px-6" data-testid="status-meal-count-unapplied">
            Огноо өөрчлөгдсөн байна. Шинэ хугацааг харахын тулд “Харах” товчийг дарна уу.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p data-testid="text-meal-count-applied-range">
          Харуулж буй хугацаа: <span className="font-semibold text-foreground">{displayDate(applied.dateFrom)} — {displayDate(applied.dateTo)}</span>
        </p>
        <span className="inline-flex items-center gap-1.5" data-testid="status-meal-count-sync">
          <span className={`size-1.5 rounded-full ${query.isFetching ? 'bg-accent' : 'bg-primary'}`} />
          {query.isFetching ? 'Мэдээлэл шинэчилж байна' : latestSync ? `Сүүлд синк хийсэн: ${displaySync(new Date(latestSync).toISOString())}` : 'Reader-ийн мэдээлэл хүлээж байна'}
        </span>
      </div>

      {query.isLoading ? (
        <div className="space-y-5" data-testid="status-meal-count-loading">
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((index) => <LoadingBlock key={index} className="h-28" />)}</div>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            {[0, 1, 2, 3].map((index) => <LoadingBlock key={index} className="h-12" />)}
          </div>
        </div>
      ) : query.isError ? (
        <ErrorBlock onRetry={() => void query.refetch()} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Хугацааны тойм">
            <div className="rounded-2xl border border-primary/20 bg-primary p-5 text-primary-foreground shadow-sm" data-testid="card-meal-count-total">
              <p className="text-[11px] font-bold uppercase tracking-[.14em] opacity-75">Нийт тоо</p>
              <p className="mt-5 font-mono text-3xl font-bold tracking-tight" data-testid="value-meal-count-total">{numberFormat.format(total)}</p>
              <p className="mt-1 text-xs opacity-75">Сонгосон хугацааны бүх бүртгэл</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="card-meal-count-days">
              <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-muted-foreground">Бүртгэлтэй өдөр</p><CalendarDays className="size-4 text-primary" aria-hidden="true" /></div>
              <p className="mt-5 font-mono text-3xl font-bold tracking-tight" data-testid="value-meal-count-days">{numberFormat.format(dayCount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Өдөр тутмын бүртгэл</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="card-meal-count-records">
              <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-muted-foreground">Нийт мөр</p><UtensilsCrossed className="size-4 text-primary" aria-hidden="true" /></div>
              <p className="mt-5 font-mono text-3xl font-bold tracking-tight" data-testid="value-meal-count-records">{numberFormat.format(counts.length)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{mealTypes.length} төрлийн хоол</p>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Хоолны тооны жагсаалт">
            <div className="flex flex-col gap-4 border-b border-border p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">Дэлгэрэнгүй бүртгэл</h2>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="text-meal-count-results">
                  {filtersActive ? `${filtered.length} / ${counts.length} мөр харагдаж байна` : `${counts.length} мөр бүртгэгдсэн`}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <div className="relative w-full sm:flex-1 lg:w-64 lg:flex-none">
                  <label htmlFor="meal-count-search" className="sr-only">Огноо эсвэл хоолны төрлөөр хайх</label>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="meal-count-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                    placeholder="Огноо, төрөл, тоогоор хайх"
                    data-testid="input-search-meal-counts"
                  />
                </div>
                <div className="w-full sm:w-48">
                  <label htmlFor="meal-count-type" className="sr-only">Хоолны төрлөөр шүүх</label>
                  <select
                    id="meal-count-type"
                    value={mealType}
                    onChange={(event) => setMealType(event.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-meal-count-type"
                  >
                    <option value="">Бүх төрөл</option>
                    {mealTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {!filtered.length ? (
              <EmptyState
                title={filtersActive ? 'Илэрц олдсонгүй' : 'Одоогоор бүртгэл алга'}
                detail={filtersActive
                  ? 'Хайлтын үг эсвэл хоолны төрлийн шүүлтүүрээ өөрчилж үзнэ үү.'
                  : 'Энэ хугацаанд Reader-ээс хоолны тоо ирээгүй байна. Дараа нь шинэчлэх товчийг дарж шалгана уу.'}
                icon={UtensilsCrossed}
              />
            ) : (
              <>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left">
                    <thead className="bg-secondary/50 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                      <tr><th scope="col" className="px-6 py-3">Огноо</th><th scope="col" className="px-6 py-3">Хоолны төрөл</th><th scope="col" className="px-6 py-3">Синк хийсэн</th><th scope="col" className="px-6 py-3 text-right">Тоо</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.map((item, index) => <MealCountRow key={`${item.date}-${item.mealType}-${index}`} item={item} index={index} />)}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-border sm:hidden">
                  {filtered.map((item, index) => (
                    <article key={`${item.date}-${item.mealType}-${index}`} className="p-5" data-testid={`card-meal-count-${index}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-xs font-semibold text-primary">{displayDate(item.date)}</p>
                          <h3 className="mt-1 text-base font-bold text-foreground">{item.mealType}</h3>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-2xl font-bold tracking-tight text-foreground" data-testid={`value-meal-count-${index}`}>{numberFormat.format(item.count)}</p>
                          <p className="text-[10px] text-muted-foreground">тоо</p>
                        </div>
                      </div>
                      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" /> Синк: {displaySync(item.syncedAt)}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MealCountRow({ item, index }: { item: MealCount; index: number }) {
  return (
    <tr className="transition-colors hover:bg-secondary/30" data-testid={`row-meal-count-${index}`}>
      <td className="px-6 py-4 font-mono text-sm font-semibold text-foreground">{displayDate(item.date)}</td>
      <td className="px-6 py-4"><span className="inline-flex rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{item.mealType}</span></td>
      <td className="px-6 py-4 text-xs text-muted-foreground">{displaySync(item.syncedAt)}</td>
      <td className="px-6 py-4 text-right font-mono text-lg font-bold text-foreground" data-testid={`value-meal-count-${index}`}>{numberFormat.format(item.count)}</td>
    </tr>
  );
}