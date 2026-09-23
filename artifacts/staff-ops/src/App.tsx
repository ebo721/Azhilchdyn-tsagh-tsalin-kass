import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadingBlock } from '@/components/ui-primitives';
import { AppShell } from '@/components/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { Employees } from '@/pages/Employees';
import { AttendancePage } from '@/pages/Attendance';
import { HourBalance } from '@/pages/HourBalance';
import { Payroll } from '@/pages/Payroll';
import { Cash, BankTransactions } from '@/pages/Cash';
import { Inventory } from '@/pages/Inventory';
import { FixedAssets } from '@/pages/FixedAssets';
import { Meals } from '@/pages/Meals';
import { MealSchedule } from '@/pages/MealSchedule';
import { OperatingExpenses } from '@/pages/OperatingExpenses';
import { Journal } from '@/pages/Journal';
import { DeletionRequests } from '@/pages/DeletionRequests';
import { UserSettings } from '@/pages/settings/UserSettings';
import { ChartOfAccountsSettings } from '@/pages/settings/ChartOfAccountsSettings';
import { UnclearTransactionsSettings } from '@/pages/settings/UnclearTransactionsSettings';
import { HrLogin } from '@/pages/HrLogin';
import NotFound from '@/pages/not-found';
import { useGetAuthSession, useLogoutHrManager } from '@workspace/api-client-react';
import { BankTransactionJournalReview } from '@/pages/BankTransactionJournalReview';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  const [, navigate] = useLocation();
  const session = useGetAuthSession();
  const logout = useLogoutHrManager();
  // Keep this frontend-compatible while the generated client catches up with the API role.
  const sessionRole = session.data?.authenticated ? String(session.data.role) : '';
  const role = ['hr', 'admin', 'accountant', 'warehouse', 'viewer', 'technologist'].includes(sessionRole)
    ? sessionRole as 'hr' | 'admin' | 'accountant' | 'warehouse' | 'viewer' | 'technologist'
    : null;
  useEffect(() => {
    if (role === 'hr' && !['/employees', '/attendance', '/hour-balance'].includes(location)) navigate('/employees', { replace: true });
    if (role === 'accountant' && !['/employees', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/bank-transactions/journal-review', '/operating-expenses', '/journal'].includes(location)) navigate('/hour-balance', { replace: true });
    if (role === 'warehouse' && !['/inventory', '/fixed-assets', '/operating-expenses', '/meals', '/meal-schedule'].includes(location)) navigate('/inventory', { replace: true });
    if (role === 'viewer' && !['/employees', '/attendance', '/hour-balance', '/payroll', '/cash', '/bank-transactions', '/bank-transactions/journal-review', '/operating-expenses', '/inventory', '/fixed-assets', '/journal', '/meals', '/meal-schedule'].includes(location)) navigate('/employees', { replace: true });
    if (role === 'technologist' && !['/meals', '/meal-schedule'].includes(location)) navigate('/meals', { replace: true });
  }, [location, navigate, role]);
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><LoadingBlock className="size-12" /></div>;
  if (!role) return <HrLogin />;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); navigate('/'); } });
  return <ErrorBoundary resetKey={location}><AppShell role={role} onLogout={signOut}>{role === 'admin' ? <Switch><Route path="/" component={Dashboard} /><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/bank-transactions/journal-review" component={BankTransactionJournalReview} /><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/journal" component={Journal} /><Route path="/meals" component={Meals} /><Route path="/meal-schedule" component={MealSchedule} /><Route path="/deletion-requests" component={DeletionRequests} /><Route path="/users" component={() => <UserSettings UnclearTransactionsSettings={UnclearTransactionsSettings} ChartOfAccountsSettings={ChartOfAccountsSettings} />} /><Route component={NotFound} /></Switch> : role === 'hr' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route component={Employees} /></Switch> : role === 'accountant' ? <Switch><Route path="/employees" component={Employees} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/bank-transactions/journal-review" component={BankTransactionJournalReview} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/journal" component={Journal} /><Route component={HourBalance} /></Switch> : role === 'viewer' ? <Switch><Route path="/employees" component={Employees} /><Route path="/attendance" component={AttendancePage} /><Route path="/hour-balance" component={HourBalance} /><Route path="/payroll" component={Payroll} /><Route path="/cash" component={Cash} /><Route path="/bank-transactions" component={BankTransactions} /><Route path="/bank-transactions/journal-review" component={BankTransactionJournalReview} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/journal" component={Journal} /><Route path="/meals" component={Meals} /><Route path="/meal-schedule" component={MealSchedule} /><Route component={Employees} /></Switch> : role === 'technologist' ? <Switch><Route path="/meals" component={Meals} /><Route path="/meal-schedule" component={MealSchedule} /><Route component={Meals} /></Switch> : <Switch><Route path="/inventory" component={Inventory} /><Route path="/fixed-assets" component={FixedAssets} /><Route path="/operating-expenses" component={OperatingExpenses} /><Route path="/meals" component={Meals} /><Route path="/meal-schedule" component={MealSchedule} /><Route component={Inventory} /></Switch>}</AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;