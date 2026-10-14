import { type ReactNode, useState } from 'react';
import { BriefcaseBusiness, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { STAFF_MENUS, visibleMenuPaths, type StaffMenuPath } from '@workspace/api-zod';
import { Banknote, Clock3, Landmark, LayoutDashboard, MonitorSmartphone, PackageOpen, Receipt, ShieldCheck, Timer, UserRound, UsersRound, WalletCards, Library, Utensils, CalendarDays, ClipboardList, ArrowLeftRight } from 'lucide-react';

const menuIcons: Record<StaffMenuPath, typeof LayoutDashboard> = {
  '/': LayoutDashboard, '/employees': UsersRound, '/attendance': Clock3,
  '/attendance/devices': MonitorSmartphone, '/hour-balance': Timer, '/payroll': Banknote,
  '/cash': WalletCards, '/bank-transactions': Landmark, '/operating-expenses': Receipt,
  '/inventory': PackageOpen, '/meals': Utensils, '/meal-schedule': CalendarDays,
  '/meal-counts': ClipboardList, '/fixed-assets': BriefcaseBusiness, '/journal': Library,
  '/ar-ap': ArrowLeftRight, '/deletion-requests': ShieldCheck, '/users': UserRound,
};
export const nav = STAFF_MENUS.map(menu => ({ href: menu.path, label: menu.label, icon: menuIcons[menu.path] }));

export function AppShell({ children, role, menuPaths, onLogout }: { children: ReactNode; role: 'admin' | 'hr' | 'accountant' | 'warehouse' | 'viewer' | 'technologist'; menuPaths?: string[] | null; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const selected = visibleMenuPaths(role, menuPaths);
  const visibleNav = nav.filter(item => selected.includes(item.href as typeof selected[number]));
  const active = (visibleNav.find((item) => item.href === location) ?? visibleNav.find((item) => item.href !== '/' && location.startsWith(`${item.href}/`)))?.label ?? 'Статистик';
  return (
    <div className="min-h-[100dvh] bg-background app-grid" data-role={role}>
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')} data-testid="navigation-sidebar">
        <div className="flex items-center justify-between px-2">
          <Link href={visibleNav[0]?.href ?? '/'} className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><BriefcaseBusiness className="size-5" /></span>
            <span className="text-sm font-bold tracking-tight">САМАСАА</span>
          </Link>
          <button className="grid size-8 place-items-center rounded-lg hover:bg-sidebar-accent lg:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation"><X className="size-4" /></button>
        </div>
        <nav className="mt-10 min-h-0 flex-1 space-y-1 overflow-y-auto pb-4" data-testid="navigation-main">
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
           <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-primary" />{role === 'hr' ? 'Хүний нөөцийн менежер' : role === 'accountant' ? 'Нягтлан' : role === 'warehouse' ? 'Нярав' : role === 'viewer' ? 'Статистик харах эрх' : role === 'technologist' ? 'Хоолны технологич' : 'Ерөнхий админ'}</span><button onClick={onLogout} className="grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Системээс гарах" data-testid="button-logout"><LogOut className="size-4" /></button><div className="grid size-9 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground" data-testid="avatar-owner">{role === 'hr' ? 'HR' : role === 'accountant' ? 'НТ' : role === 'warehouse' ? 'НЯ' : role === 'viewer' ? 'СТ' : role === 'technologist' ? 'ХТ' : 'АД'}</div></div>
        </header>
        <div className="mx-auto max-w-[1440px] p-5 sm:p-8">{children}</div>
      </main>
    </div>
  );
}