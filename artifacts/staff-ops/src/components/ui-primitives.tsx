import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CashDayCloseControls } from '@/App';

export function LoadingBlock({ className = '' }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-foreground/8', className)} data-testid="loading-skeleton" />;
}

export function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center" data-testid="status-error">
      <p className="text-sm font-semibold text-destructive">Мэдээлэл татахад алдаа гарлаа.</p>
      <p className="mt-1 text-xs text-muted-foreground">Холболтоо шалгаад дахин оролдоно уу.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="button-retry">Дахин оролдох</Button>
    </div>
  );
}

export function EmptyState({ title, detail, icon: Icon = Search }: { title: string; detail: string; icon?: typeof Search }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border-t border-border p-8 text-center" data-testid="status-empty">
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function StatCard({ label, value, meta, icon: Icon, tone = 'teal' }: { label: string; value: string; meta: string; icon: typeof Activity; tone?: 'teal' | 'gold' | 'blue' | 'orange' }) {
  const colors = { teal: 'bg-primary/10 text-primary', gold: 'bg-accent/25 text-foreground', blue: 'bg-sky-100 text-sky-800', orange: 'bg-orange-100 text-orange-800' };
  return (
    <div className="group rounded-2xl border border-border/80 bg-card p-5 shadow-[0_1px_0_hsl(var(--foreground)/.03)] transition-transform duration-200 hover:-translate-y-0.5" data-testid={`card-stat-${label}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span>
        <span className={cn('grid size-9 place-items-center rounded-xl', colors[tone])}><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-5 font-mono text-[clamp(1.35rem,2.8vw,2rem)] font-bold tracking-tight text-foreground" data-testid={`value-stat-${label}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  const styles: Record<string, string> = {
    active: 'bg-primary/10 text-primary',
    inactive: 'bg-muted text-muted-foreground',
    present: 'bg-primary/10 text-primary',
    late: 'bg-accent/35 text-foreground',
    leave: 'bg-sky-100 text-sky-800',
    absent: 'bg-destructive/10 text-destructive',
  };
  const labels: Record<string, string> = { active: 'Идэвхтэй', inactive: 'Идэвхгүй', present: 'Ирсэн', late: 'Хоцорсон', leave: 'Чөлөөтэй', absent: 'Ирээгүй' };
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold', styles[value] ?? 'bg-muted text-muted-foreground')} data-testid={`status-pill-${value}`}>{labels[value] ?? value}</span>;
}

export function PageHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p>}
        <h1 className="font-sans text-3xl font-bold tracking-[-.04em] text-foreground sm:text-[2.25rem]" data-testid="heading-page">{title}</h1>
        {detail && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">{title === 'Касс' && <CashDayCloseControls />}{action}</div>
    </div>
  );
}

export function Modal({ title, detail, onClose, children, wide = false, fullScreen = false }: { title: string; detail: string; onClose: () => void; children: ReactNode; wide?: boolean; fullScreen?: boolean }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return createPortal(
    <div className={cn('fixed inset-0 z-50 flex justify-center overflow-y-auto bg-foreground/35 backdrop-blur-[2px] sm:p-4', fullScreen ? 'items-start p-0' : 'items-center p-3')} role="dialog" aria-modal="true" data-testid="modal">
      <div className={cn('w-full overflow-y-auto border border-border bg-card p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7', fullScreen ? 'h-[100dvh] max-h-none rounded-none pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:max-h-[calc(100dvh-2rem)] sm:pt-7' : 'max-h-[calc(100dvh-1.5rem)] rounded-2xl', wide ? 'sm:max-w-5xl' : 'sm:max-w-xl')}>
        <div className="sticky top-0 z-10 -mx-2 mb-6 flex items-start justify-between gap-4 bg-card px-2 pb-3">
          <div><p className="text-lg font-bold tracking-tight">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Цонх хаах" data-testid="button-close-modal"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}