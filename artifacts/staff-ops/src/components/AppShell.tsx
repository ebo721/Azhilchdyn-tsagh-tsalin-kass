import { type ReactNode, useState } from 'react';
import { BriefcaseBusiness, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Banknote, Clock3, Landmark, LayoutDashboard, PackageOpen, Receipt, ShieldCheck, Timer, UserRound, UsersRound, WalletCards } from 'lucide-react';

export const nav = [
  { href: '/', label: 'Статистик', icon: LayoutDashboard },
  { href: '/employees', label: 'Ажилчид', icon: UsersRound },
  { href: '/attendance', label: 'Ирц', icon: Clock3 },
  { href: '/hour-balance', label: 'Цагийн баланс', icon: Timer },
  { href: '/payroll', label: 'Цалин', icon: Banknote },
  { href: '/cash', label: 'Касс', icon: WalletCards },
  { href: '/bank-transactions', label: 'Банкны гүйлгээ', icon: Landmark },
  { href: '/operating-expenses', label: 'Үйл ажиллагааны зардал', icon: Receipt },
  { href: '/inventory', label: 'Бараа материал', icon: PackageOpen },
  { href: '/fixed-assets', label: 'Эд хөрөнгө', icon: BriefcaseBusiness },
  { href: '/deletion-requests', label: 'Устгах хүсэлт', icon: ShieldCheck },
  { href: '/users', label: 'Хэрэглэгчийн тохиргоо', icon: UserRound },
];

export function AppShell({ children, role, onLogout }: { children: ReactNode; role: 'admin' | 'hr' | 'accountant' | 'warehouse' | 'viewer'; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = role === 'hr'
    ? nav.filter((item) => ['/employees', '/attendance', '/hour-balance'].includes(item.href))
    : role === 'accountant'
      ? nav.filter((item) => ['/employees', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/operating-expenses'].includes(item.href))
      : role === 'warehouse'
        ? nav.filter((item) => ['/inventory', '/fixed-assets', '/operating-expenses'].includes(item.href))
        : role === 'viewer'
          ? nav.filter((item) => ['/employees', '/attendance', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/operating-expenses', '/inventory', '/fixed-assets'].includes(item.href))
          : nav;
  const active = visibleNav.find((item) => item.href === location)?.label ?? 'Статистик';
  return (
    <div className="min-h-[100dvh] bg-background app-grid" data-role={role}>
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')} data-testid="navigation-sidebar">
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
            <span className="text-sm font-bold tracking-tight">САМАСАА</span>
          </Link>
          <button className="grid size-8 place-items-center rounded-lg hover:bg-sidebar-accent lg:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation"><X className="size-4" /></button>
        </div>
        <nav className="mt-10 space-y-1" data-testid="navigation-main">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')} data-testid={`link-nav-${label}`}>
              <Icon className="size-[17px]" /><span>{label}</span>{location === href && <ChevronRight className="ml-auto size-4 opacity-60" />}
            </Link>
          ))}
        </nav>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Цэс хаах" data-testid="button-navigation-overlay" />}
      <main className="min-h-[100dvh] lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8" data-testid="top-header">
          <div className="flex items-center gap-3"><button className="grid size-9 place-items-center rounded-xl border border-border bg-card lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-navigation"><Menu className="size-4" /></button><p className="text-sm font-semibold">{active}</p></div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />{role === 'hr' ? 'Хүний нөөцийн менежер' : role === 'accountant' ? 'Нягтлан' : role === 'warehouse' ? 'Нярав' : role === 'viewer' ? 'Статистик харах эрх' : 'Ерөнхий админ'}</span><button onClick={onLogout} className="grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Системээс гарах" data-testid="button-logout"><LogOut className="size-4" /></button><div className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground" data-testid="avatar-owner">{role === 'hr' ? 'HR' : role === 'accountant' ? 'НТ' : role === 'warehouse' ? 'НЯ' : role === 'viewer' ? 'СТ' : 'АД'}</div></div>
        </header>
        <div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div>
      </main>
    </div>
  );
}