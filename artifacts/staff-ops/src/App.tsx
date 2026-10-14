import { useEffect, useRef } from 'react';
import { accessibleMenuPaths, menuForPage, visibleMenuPaths } from '@workspace/api-zod/staff-menu-policy';
import { getGetAuthSessionQueryKey } from '@workspace/api-client-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadingBlock } from '@/components/ui-primitives';
import { AppShell } from '@/components/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { Employees } from '@/pages/Employees';
import { AttendancePage } from '@/pages/Attendance';
import { AttendanceDevices } from '@/pages/AttendanceDevices';
import { AttendanceDevice } from '@/pages/AttendanceDevice';
import { HourBalance } from '@/pages/HourBalance';
import { Payroll } from '@/pages/Payroll';
import { Cash, BankTransactions } from '@/pages/Cash';
import { Inventory } from '@/pages/Inventory';
import { FixedAssets } from '@/pages/FixedAssets';
import { Meals } from '@/pages/Meals';
import { MealSchedule } from '@/pages/MealSchedule';
import { MealCounts } from '@/pages/MealCounts';
import { OperatingExpenses } from '@/pages/OperatingExpenses';
import { Journal, JournalNew } from '@/pages/Journal';
import { ArAp } from '@/pages/ArAp';
import { DeletionRequests } from '@/pages/DeletionRequests';
import { UserSettings } from '@/pages/settings/UserSettings';
import { ChartOfAccountsSettings } from '@/pages/settings/ChartOfAccountsSettings';
import { UnclearTransactionsSettings } from '@/pages/settings/UnclearTransactionsSettings';
import { HrLogin } from '@/pages/HrLogin';
import NotFound from '@/pages/not-found';
import { useGetAuthSession, useLogoutHrManager } from '@workspace/api-client-react';
import { BankTransactionJournalReview } from '@/pages/BankTransactionJournalReview';
import { Route, Switch, useLocation, useSearch, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  const [, navigate] = useLocation();
  const search = useSearch();
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey(), refetchOnMount: 'always', refetchInterval: 30_000 } });
  const logout = useLogoutHrManager();
  // Keep this frontend-compatible while the generated client catches up with the API role.
  const sessionRole = session.data?.authenticated ? String(session.data.role) : '';
  const role = ['hr', 'admin', 'accountant', 'warehouse', 'viewer', 'technologist'].includes(sessionRole)
    ? sessionRole as 'hr' | 'admin' | 'accountant' | 'warehouse' | 'viewer' | 'technologist'
    : null;
  const menuPaths = session.data?.menuPaths;
  const allowed = role ? accessibleMenuPaths(role, menuPaths) : [];
  const visible = role ? visibleMenuPaths(role, menuPaths) : [];
  const landingByRole = { admin: '/', hr: '/employees', accountant: '/hour-balance', warehouse: '/inventory', viewer: '/employees', technologist: '/meals' } as const;
  const preferred = role ? landingByRole[role] : '/';
  const landing = visible.find(path => path === preferred) ?? visible[0];
  const currentMenu = menuForPage(location);
  const journalWritePage = location === '/journal/new';
  const pageAllowed = !!currentMenu && allowed.includes(currentMenu)
    && (!journalWritePage || role === 'admin' || role === 'accountant');
  const previousIdentity = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!session.data) return;
    const identity = session.data.authenticated ? session.data.id : null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) {
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== getGetAuthSessionQueryKey()[0] });
    }
    previousIdentity.current = identity;
  }, [session.data?.authenticated, session.data?.id]);
  useEffect(() => {
    if (location === '/attendance/device' || !role || !landing) return;
    if (!pageAllowed && (currentMenu || role !== 'admin')) navigate(landing, { replace: true });
  }, [location, navigate, role, landing, pageAllowed, currentMenu]);
  if (location === '/attendance/device') return <ErrorBoundary resetKey={location}><AttendanceDevice /></ErrorBoundary>;
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><LoadingBlock className="size-12" /></div>;
  if (!role) return <HrLogin />;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); navigate('/'); } });
  if (!visible.length) return <AppShell role={role} menuPaths={menuPaths} onLogout={signOut}>
    <div className="rounded-2xl border border-border bg-card p-6" data-testid="no-accessible-menus">
      <h1 className="text-lg font-bold">Танд нээсэн цэс байхгүй байна</h1>
      <p className="mt-2 text-sm text-muted-foreground">Админд хандаж шаардлагатай цэсээ нээлгэнэ үү. Системээс гарах боломжтой.</p>
    </div>
  </AppShell>;
  if (currentMenu && !pageAllowed) return <LoadingBlock className="h-32" />;
  if (location === '/ar-ap' && (role === 'admin' || role === 'accountant' || role === 'viewer')) {
    return <ErrorBoundary resetKey={location}><AppShell role={role} menuPaths={menuPaths} onLogout={signOut}><ArAp canCreate={role !== 'viewer'} /></AppShell></ErrorBoundary>;
  }
  if (location === '/journal/new' && (role === 'admin' || role === 'accountant')) {
    const account = new URLSearchParams(search).get('account');
    const initialAccountCode = account === '1200' || account === '2000' ? account : undefined;
    return <ErrorBoundary resetKey={location}><AppShell role={role} menuPaths={menuPaths} onLogout={signOut}><JournalNew initialAccountCode={initialAccountCode} onClose={() => navigate('/journal')} /></AppShell></ErrorBoundary>;
  }
  return <ErrorBoundary resetKey={location}><AppShell role={role} menuPaths={menuPaths} onLogout={signOut}>
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/employees" component={Employees} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/attendance/devices" component={AttendanceDevices} />
      <Route path="/hour-balance" component={HourBalance} />
      <Route path="/payroll" component={Payroll} />
      <Route path="/cash" component={Cash} />
      <Route path="/bank-transactions" component={BankTransactions} />
      <Route path="/bank-transactions/journal-review" component={BankTransactionJournalReview} />
      <Route path="/inventory" component={Inventory} />
      <Route path="/fixed-assets" component={FixedAssets} />
      <Route path="/operating-expenses" component={OperatingExpenses} />
      <Route path="/journal" component={Journal} />
      <Route path="/meals" component={Meals} />
      <Route path="/meal-schedule" component={MealSchedule} />
      <Route path="/meal-counts" component={MealCounts} />
      <Route path="/deletion-requests" component={DeletionRequests} />
      <Route path="/users" component={() => <UserSettings UnclearTransactionsSettings={UnclearTransactionsSettings} ChartOfAccountsSettings={ChartOfAccountsSettings} />} />
      <Route component={NotFound} />
    </Switch>
  </AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;