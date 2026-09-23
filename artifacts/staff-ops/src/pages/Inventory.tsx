import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  BookOpen,
  BriefcaseBusiness,
  Copy,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  EyeOff,
  LayoutDashboard,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  PackageOpen,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  CashTransactionType,
  getGetCashSummaryQueryKey,
  getGetDashboardQueryKey,
  getGetAuthSessionQueryKey,
  getGetPayrollAdvanceQueryKey,
  getGetPayrollQueryKey,
  getGetPayrollScheduleQueryKey,
  getListCashTransactionsQueryKey,
  getListBankTransactionsQueryKey,
  getListBankAccountsQueryKey,
  getListBankTransactionCashSuggestionsQueryKey,
  getListCashClosuresQueryKey,
  getListEmployeesQueryKey,
  getListEmployeeSalaryHistoryQueryKey,
  getListInventoryPurchasesQueryKey,
  getListInventoryItemsQueryKey,
  getListInventoryPurchasePaymentBankSuggestionsQueryKey,
  getListInventorySuppliersQueryKey,
  getListInventoryIssuesQueryKey,
  getListFixedAssetsQueryKey,
  getListDeletionRequestsQueryKey,
  getListUsersQueryKey,
  getListChartOfAccountsQueryKey,
  getListUnclearTransactionsQueryKey,
  useCreateCashTransaction,
  useUpdateCashTransaction,
  useUpdateBankCashTransactionIncomeMonth,
  useDeleteCashTransaction,
  useCloseCashDay,
  useCreateEmployee,
  useDeleteAttendance,
  useDeleteEmployee,
  useDeleteShift,
  useGetCashSummary,
  useGetAuthSession,
  useGetDashboard,
  useGetHourBalance,
  useGetPayroll,
  useGetPayrollSchedule,
  useUpdatePayrollSchedule,
  useGetPayrollAdvance,
  useListCashTransactions,
  useListBankTransactions,
  useListBankAccounts,
  useCreateBankAccount,
  useUpdateBankTransactionAccount,
  useListCashClosures,
  useListEmployees,
  useListEmployeeSalaryHistory,
  useListInventoryPurchases,
  useListInventoryPurchasePaymentBankSuggestions,
  useListInventorySuppliers,
  useUpdateInventorySupplier,
  useCreateInventoryPurchase,
  useListInventoryItems,
  useUpdateInventoryItem,
  useUpdateInventoryPurchase,
  useConfirmInventoryPurchasePayment,
  useCancelInventoryPurchasePayment,
  useDeleteInventoryPurchase,
  useReclassifyInventoryPurchaseAsExpense,
  useListInventoryIssues,
  useCreateInventoryIssue,
  useUpdateInventoryIssue,
  useDeleteInventoryIssue,
  useListInventoryMaterialRequests,
  useUpdateInventoryMaterialRequestStatus,
  getListInventoryMaterialRequestsQueryKey,
  useListFixedAssets,
  useCreateFixedAsset,
  useUpdateFixedAsset,
  useDeleteFixedAsset,
  useCreateDeletionRequest,
  useListDeletionRequests,
  useApproveDeletionRequest,
  useCancelDeletionRequest,
  useListShifts,
  useListUsers,
  useListChartOfAccounts,
  useCreateChartOfAccount,
  useUpdateChartOfAccount,
  useDeleteChartOfAccount,
  useListUnclearTransactions,
  getListOperatingExpensesQueryKey,
  getListOperatingExpensePaymentBankSuggestionsQueryKey,
  useListOperatingExpenses,
  useCreateOperatingExpense,
  useUpdateOperatingExpense,
  useListOperatingExpensePaymentBankSuggestions,
  useConfirmOperatingExpensePayment,
  useCancelOperatingExpensePayment,
  useLoginHrManager,
  useLogoutHrManager,
  useRevertPayrollAdvanceApproval,
  useUpsertPayrollAdjustment,
  useApprovePayrollAdvance,
  useUpdateEmployee,
  useUpdateEmployeeSalaryHistory,
  useUpdatePayrollAdvancePayment,
  useUpdateUser,
  useDeleteUser,
  useImportKapitronBankTransactions,
  useLinkBankTransactionToCash,
  useListBankTransactionCashSuggestions,
  useTransferBankTransactionToCash,
  useMarkTransactionUnclear,
  type Employee,
  type EmployeeSalaryHistory,
  type CashTransaction,
  type InventoryPurchase,
  type InventoryPurchaseBankSuggestion,
  type InventorySupplier,
  type InventoryItem,
  type InventoryIssue,
  type InventoryMaterialRequest,
  InventoryMaterialRequestStatus,
  type FixedAsset,
  type PayrollLine,
  type PayrollScheduleInput,
  type User,
  type ChartOfAccount,
  type ChartOfAccountInput,
  type BankTransaction,
  type BankAccount,
  type CashTransactionSuggestion,
  type UnclearTransaction,
  type OperatingExpense,
  type OperatingExpenseBankSuggestion,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading, StatCard, StatusPill } from '@/components/ui-primitives';
import { AppShell } from '@/components/AppShell';
import { HourBalance } from '@/pages/HourBalance';
import { Dashboard } from '@/pages/Dashboard';
import { Employees } from '@/pages/Employees';
import { AttendancePage } from '@/pages/Attendance';
import { Payroll } from '@/pages/Payroll';
import { Cash, CashLegacy, CashDayCloseControls, AccountLabel, BankTransactions, bankDateTimeLabel } from '@/pages/Cash';
import { FixedAssets } from '@/pages/FixedAssets';
import { money, dateLabel, today, currentMonth, shiftMonth } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
const mongolianMonthLabel = (value: string) => { const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value); return match ? `${match[1]} он ${Number(match[2])} сар` : value; };


export const inventoryUnits = ['ширхэг', 'кг', 'грамм', 'литр', 'мл', 'метр', 'багц', 'хайрцаг'] as const;
const inventoryMaterialTypes = [
  { value: 'food', label: 'Хүнсний бараа материал' },
  { value: 'supply', label: 'Хангамжийн материал' },
] as const;
type InventoryMaterialType = typeof inventoryMaterialTypes[number]['value'];
const inventoryIssuePurposes = ['Түлш', 'УБ гал тогоо', 'Бусад'] as const;
const inventoryPurchasesPerPage = 20;
type InventoryForm = {
  materialType: InventoryMaterialType;
  supplierName: string;
  hasReceipt: boolean;
  date: string;
  items: Array<{ inventoryItemId?: number; name: string; category: string; unit: typeof inventoryUnits[number]; quantity: string; unitPrice: string }>;
};

export function Inventory() {
  const session = useGetAuthSession();
  const canManageMaterialRequests = session.data?.role === 'admin' || session.data?.role === 'warehouse';
  const purchasesQuery = useListInventoryPurchases();
  const suppliers = useListInventorySuppliers();
  const updateSupplier = useUpdateInventorySupplier();
  const catalog = useListInventoryItems();
  const updateCatalogItem = useUpdateInventoryItem();
  const issues = useListInventoryIssues();
  const create = useCreateInventoryPurchase();
  const update = useUpdateInventoryPurchase();
  const reclassify = useReclassifyInventoryPurchaseAsExpense();
  const chartOfAccounts = useListChartOfAccounts();
  const confirmPurchasePayment = useConfirmInventoryPurchasePayment();
  const cancelPurchasePayment = useCancelInventoryPurchasePayment();
  const deletion = useQueueDeletion();
  const remove = deletion;
  const removeIssue = deletion;
  const createIssue = useCreateInventoryIssue();
  const updateIssue = useUpdateInventoryIssue();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryPurchase | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<InventoryPurchase | null>(null);
  const [paymentPurchase, setPaymentPurchase] = useState<InventoryPurchase | null>(null);
  const [selectedPaymentBank, setSelectedPaymentBank] = useState<InventoryPurchaseBankSuggestion | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<InventorySupplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<InventorySupplier | null>(null);
  const [stockSearch, setStockSearch] = useState('');
  const [materialTypeTab, setMaterialTypeTab] = useState<InventoryMaterialType>('food');
  const [inventoryTab, setInventoryTab] = useState<'stock' | 'purchases' | 'suppliers' | 'issues' | 'requests'>('stock');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [categoryItem, setCategoryItem] = useState<InventoryItem | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<InventoryIssue | null>(null);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseMonth, setPurchaseMonth] = useState(currentMonth());
  const [reclassifyPurchase, setReclassifyPurchase] = useState<InventoryPurchase | null>(null);
  const form = useForm<InventoryForm>({
    defaultValues: { materialType: 'food', supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] },
  });
  const rows = useFieldArray({ control: form.control, name: 'items' });
  const issueForm = useForm<{ inventoryItemId: string; date: string; quantity: string; purpose: string }>({
    defaultValues: { inventoryItemId: '', date: today(), quantity: '', purpose: '' },
  });
  const categoryForm = useForm<{ name: string; category: string }>({ defaultValues: { name: '', category: '' } });
  const reclassifyForm = useForm<{ accountId: string }>({ defaultValues: { accountId: '' } });
  const supplierForm = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const paymentForm = useForm<{ date: string; amount: string }>({ defaultValues: { date: today(), amount: '' } });
  const paymentBankSuggestions = useListInventoryPurchasePaymentBankSuggestions(paymentPurchase?.id ?? 0, {
    query: {
      queryKey: getListInventoryPurchasePaymentBankSuggestionsQueryKey(paymentPurchase?.id ?? 0),
      enabled: Boolean(paymentPurchase),
    },
  });
  const watchedItems = form.watch('items');
  const grandTotal = watchedItems.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const filteredPurchases = purchasesQuery.data?.filter((purchase) =>
    purchase.materialType === materialTypeTab && purchase.date.startsWith(purchaseMonth)
  ) ?? [];
  const filteredPurchaseTotal = filteredPurchases.reduce((total, purchase) => total + purchase.totalAmount, 0);
  const filteredPurchaseAccounts = [...new Map(filteredPurchases
    .filter((purchase) => purchase.accountCode && purchase.accountName)
    .map((purchase) => [purchase.accountId, { code: purchase.accountCode, name: purchase.accountName }])).values()];
  const purchasePageCount = Math.max(1, Math.ceil(filteredPurchases.length / inventoryPurchasesPerPage));
  const paginatedPurchases = filteredPurchases.slice(
    (purchasePage - 1) * inventoryPurchasesPerPage,
    purchasePage * inventoryPurchasesPerPage,
  );
  const query = useMemo(() => {
    if (!purchasesQuery.data) return purchasesQuery;
    const data = new Proxy(filteredPurchases, {
      get(target, property, receiver) {
        if (property === 'map') return paginatedPurchases.map.bind(paginatedPurchases);
        return Reflect.get(target, property, receiver);
      },
    });
    return { ...purchasesQuery, data };
  }, [filteredPurchases, paginatedPurchases, purchasesQuery]);
  useEffect(() => {
    if (purchasePage > purchasePageCount) setPurchasePage(purchasePageCount);
  }, [purchasePage, purchasePageCount]);
  useEffect(() => setPurchasePage(1), [materialTypeTab, purchaseMonth]);
  const openForm = () => {
    setEditing(null);
    form.reset({ materialType: materialTypeTab, supplierName: '', hasReceipt: false, date: today(), items: [{ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' }] });
    setOpen(true);
  };
  const editPurchase = (purchase: InventoryPurchase) => {
    setEditing(purchase);
    form.reset({
      materialType: purchase.materialType,
      supplierName: purchase.supplierName,
      hasReceipt: purchase.hasReceipt,
      date: purchase.date,
      items: purchase.items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit as typeof inventoryUnits[number],
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })),
    });
    setOpen(true);
  };
  const submit = (values: InventoryForm) => {
    const data = {
      materialType: values.materialType,
      supplierName: values.supplierName,
      hasReceipt: values.hasReceipt,
      date: values.date,
      items: values.items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        catalog.refetch();
        setOpen(false);
        setEditing(null);
      },
    };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const editCategory = (item: InventoryItem) => {
    setCategoryItem(item);
    categoryForm.reset({ name: item.name, category: item.category });
  };
  const submitCategory = (values: { name: string; category: string }) => {
    if (!categoryItem) return;
    updateCatalogItem.mutate({ id: categoryItem.id, data: values }, {
      onSuccess: () => {
        catalog.refetch();
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        setCategoryItem(null);
      },
    });
  };
  const filteredCatalog = catalog.data?.filter((item) => item.materialType === materialTypeTab && `${item.name} ${item.category}`.toLocaleLowerCase('mn-MN').includes(stockSearch.toLocaleLowerCase('mn-MN'))) ?? [];
  const selectedItemHistory = selectedItem
    ? query.data?.flatMap((purchase) => purchase.items
      .filter((item) => item.inventoryItemId === selectedItem.id)
      .map((item) => ({ ...item, purchaseId: purchase.id, date: purchase.date }))) ?? []
    : [];
  const deletePurchase = (purchase: InventoryPurchase) => {
    if (!window.confirm(`"${purchase.supplierName}" худалдан авалтыг устгах уу?`)) return;
    deletion.request(`/inventory/purchases/${purchase.id}`, `${purchase.supplierName} · ${money(purchase.totalAmount)}`);
  };
  const openReclassify = (purchase: InventoryPurchase) => {
    setReclassifyPurchase(purchase);
    reclassifyForm.reset({ accountId: '' });
  };
  const submitReclassify = (values: { accountId: string }) => {
    if (!reclassifyPurchase) return;
    reclassify.mutate({ id: reclassifyPurchase.id, data: { accountId: Number(values.accountId) } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getListOperatingExpensesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        setReclassifyPurchase(null);
      },
    });
  };
  const togglePurchasePayment = (purchase: InventoryPurchase, checked: boolean) => {
    if (checked) {
      setSelectedPaymentBank(null);
      setPaymentPurchase(purchase);
      paymentForm.reset({ date: today(), amount: String(purchase.totalAmount) });
      return;
    }
    if (!window.confirm(`"${purchase.supplierName}" худалдан авалтын төлбөрийг цуцлах уу? Кассын зарлага хамт устна.`)) return;
    cancelPurchasePayment.mutate({ id: purchase.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
      },
    });
  };
  const submitPurchasePayment = (values: { date: string; amount: string }) => {
    if (!paymentPurchase) return;
    confirmPurchasePayment.mutate({ id: paymentPurchase.id, data: {
      date: values.date,
      amount: Number(values.amount),
      bankTransactionId: selectedPaymentBank?.id ?? null,
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCashSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey() });
        setPaymentPurchase(null);
        setSelectedPaymentBank(null);
      },
    });
  };
  const selectPaymentBank = (suggestion: InventoryPurchaseBankSuggestion) => {
    setSelectedPaymentBank(suggestion);
    paymentForm.setValue('date', suggestion.transactionAt.slice(0, 10), { shouldValidate: true });
    paymentForm.setValue('amount', String(suggestion.amount), { shouldValidate: true });
  };
  const openSupplierEdit = (supplier: InventorySupplier) => {
    setEditingSupplier(supplier);
    supplierForm.reset({ name: supplier.name });
  };
  const submitSupplier = (values: { name: string }) => {
    if (!editingSupplier) return;
    updateSupplier.mutate({ id: editingSupplier.id, data: values }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventorySuppliersQueryKey() });
        qc.invalidateQueries({ queryKey: getListInventoryPurchasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListCashTransactionsQueryKey() });
        setEditingSupplier(null);
      },
    });
  };
  const deleteSupplier = (supplier: InventorySupplier) => {
    if (!window.confirm(`"${supplier.name}" харилцагчийг сангаас устгах уу? Худалдан авалтын түүх устахгүй.`)) return;
    deletion.request(`/inventory/suppliers/${supplier.id}`, `${supplier.name} харилцагч`);
  };
  const selectedSupplierPurchases = selectedSupplier
    ? purchasesQuery.data?.filter((purchase) =>
      purchase.supplierName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('mn-MN')
      === selectedSupplier.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('mn-MN')) ?? []
    : [];
  const openIssueForm = () => {
    setEditingIssue(null);
    issueForm.reset({ inventoryItemId: '', date: today(), quantity: '', purpose: '' });
    setIssueOpen(true);
  };
  const editIssue = (issue: InventoryIssue) => {
    setEditingIssue(issue);
    issueForm.reset({
      inventoryItemId: String(issue.inventoryItemId),
      date: issue.date,
      quantity: String(issue.quantity),
      purpose: issue.purpose,
    });
    setIssueOpen(true);
  };
  const submitIssue = (values: { inventoryItemId: string; date: string; quantity: string; purpose: string }) => {
    const data = {
      inventoryItemId: Number(values.inventoryItemId),
      date: values.date,
      quantity: Number(values.quantity),
      purpose: values.purpose,
    };
    const options = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInventoryIssuesQueryKey() });
        catalog.refetch();
        setIssueOpen(false);
        setEditingIssue(null);
      },
    };
    if (editingIssue) updateIssue.mutate({ id: editingIssue.id, data }, options);
    else createIssue.mutate({ data }, options);
  };
  const deleteIssue = (issue: InventoryIssue) => {
    if (!window.confirm(`${issue.itemName} барааны ${issue.quantity} ${issue.unit} зарлагыг устгах уу?`)) return;
    deletion.request(`/inventory/issues/${issue.id}`, `${issue.itemName} · ${issue.quantity} ${issue.unit} зарлага`);
  };
  const requestsQuery = useListInventoryMaterialRequests({ query: { enabled: inventoryTab === 'requests', queryKey: getListInventoryMaterialRequestsQueryKey() } });
  const updateRequestStatus = useUpdateInventoryMaterialRequestStatus();

  const handleRequestStatusChange = (request: InventoryMaterialRequest, status: 'approved' | 'rejected' | 'fulfilled') => {
    updateRequestStatus.mutate(
      { id: request.id, data: { status } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListInventoryMaterialRequestsQueryKey() });
        }
      }
    );
  };

  return <div className="page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl bg-secondary p-1"><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'stock' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('stock')} data-testid="tab-inventory-stock">Үлдэгдэл</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'purchases' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('purchases')} data-testid="tab-inventory-purchases">Худалдан авалт</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'suppliers' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('suppliers')} data-testid="tab-inventory-suppliers">Харилцагч</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'issues' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('issues')} data-testid="tab-inventory-issues">Зарлага</button><button className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', inventoryTab === 'requests' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')} onClick={() => setInventoryTab('requests')} data-testid="tab-inventory-requests">Захиалга</button></div>{inventoryTab === 'purchases' ? <Button onClick={openForm} data-testid="button-add-inventory-purchase"><Plus className="size-4" />Худалдан авалт бүртгэх</Button> : inventoryTab === 'issues' ? <Button onClick={openIssueForm} data-testid="button-add-inventory-issue"><Plus className="size-4" />Зарлага гаргах</Button> : null}</div>
    {(inventoryTab === 'stock' || inventoryTab === 'purchases') && <div className="mb-5 inline-flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Бараа материалын төрөл">{inventoryMaterialTypes.map((type) => <button key={type.value} role="tab" aria-selected={materialTypeTab === type.value} className={cn('rounded-lg px-4 py-2 text-sm font-bold transition-colors', materialTypeTab === type.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary')} onClick={() => setMaterialTypeTab(type.value)} data-testid={`tab-inventory-material-${type.value}`}>{type.label}</button>)}</div>}
    {inventoryTab === 'stock' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-base font-bold">Барааны үлдэгдэл</h2><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="pl-9" placeholder="Нэр эсвэл ангиллаар хайх" data-testid="input-search-inventory-stock" /></div></div>
      {catalog.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : catalog.isError ? <ErrorBlock onRetry={() => catalog.refetch()} /> : !filteredCatalog.length ? <EmptyState title="Бараа материал олдсонгүй" detail={stockSearch ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Худалдан авалт бүртгэхэд барааны үлдэгдэл автоматаар үүснэ.'} icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3">Ангилал</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3 text-right">Үлдэгдэл</th><th className="px-5 py-3 text-right">Дүн</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{filteredCatalog.map((item) => <tr key={item.id} className="cursor-pointer transition-colors hover:bg-secondary/40" onClick={() => setSelectedItem(item)} data-testid={`row-inventory-stock-${item.id}`}><td className="px-5 py-3 text-sm font-semibold">{item.name}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-5 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{item.quantity}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(item.totalValue)}</td><td className="px-5 py-3 text-right"><Button size="icon" variant="ghost" title="Ангилал засах" onClick={(event) => { event.stopPropagation(); editCategory(item); }} data-testid={`button-edit-inventory-category-${item.id}`}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table></div>}
    </section>}
    {inventoryTab === 'purchases' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap gap-2 border-b border-border bg-secondary/25 px-5 py-3" data-testid="inventory-purchase-linked-accounts">{filteredPurchaseAccounts.length ? filteredPurchaseAccounts.map((account) => <div key={account.code} className="rounded-lg border border-border bg-card px-3 py-2"><AccountLabel code={account.code} name={account.name} /></div>) : <AccountLabel code={null} name={null} />}</div>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold">Худалдан авалтын жагсаалт</h2><p className="mt-1 text-xs text-muted-foreground">Сонгосон сарын нийт: <strong className="font-mono text-primary">{money(filteredPurchaseTotal)}</strong></p></div><div className="flex flex-wrap items-center gap-2"><div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setPurchaseMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-inventory-purchase-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(purchaseMonth)}</span><input type="month" value={purchaseMonth} onChange={(event) => setPurchaseMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Бараа материалын худалдан авалтын сар сонгох" data-testid="input-inventory-purchase-month" /></label></div><button type="button" onClick={() => setPurchaseMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-inventory-purchase-next-month"><ChevronRight className="size-4" /></button></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{query.data?.length ?? 0} бүртгэл</span></div></div>
      {query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : !query.data?.length ? <EmptyState title="Худалдан авалт олдсонгүй" detail="Сонгосон сар болон бараа материалын төрөлд тохирох худалдан авалт алга." icon={PackageOpen} /> : <>
        <div className="divide-y divide-border md:hidden">{query.data.map((purchase) => <article className="p-4" key={purchase.id} data-testid={`inventory-purchase-mobile-${purchase.id}`}><button className="w-full text-left" onClick={() => setSelectedPurchase(purchase)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(purchase.date)}</p></div><p className="shrink-0 font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</p></div></button><label className="mt-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={purchase.paid} onChange={(event) => togglePurchasePayment(purchase, event.target.checked)} disabled={confirmPurchasePayment.isPending || cancelPurchasePayment.isPending} data-testid={`checkbox-inventory-payment-${purchase.id}`} />Төлбөр төлсөн{purchase.paid && <span className="text-muted-foreground">· {dateLabel(purchase.paymentDate!)} · {money(purchase.paymentAmount ?? 0)}</span>}</label><div className="mt-3 flex items-center justify-between gap-2"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)}>Дэлгэрэнгүй</Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Үйл ажиллагааны зардал руу шилжүүлэх" onClick={() => openReclassify(purchase)}><ArrowRightLeft className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)}><Trash2 className="size-4" /></Button></>}</div></div></article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Баримт</th><th className="px-5 py-3 text-right">Үнийн дүн</th><th className="px-5 py-3">Төлбөр</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{query.data.map((purchase) => <tr key={purchase.id} data-testid={`inventory-purchase-${purchase.id}`}><td className="px-5 py-4"><p className="text-sm font-semibold">{purchase.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">{purchase.items.length} төрлийн бараа</p></td><td className="px-5 py-4 text-sm">{dateLabel(purchase.date)}</td><td className="px-5 py-4"><span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', purchase.hasReceipt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-700')}>{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</span></td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</td><td className="px-5 py-4"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={purchase.paid} onChange={(event) => togglePurchasePayment(purchase, event.target.checked)} disabled={confirmPurchasePayment.isPending || cancelPurchasePayment.isPending} data-testid={`checkbox-inventory-payment-${purchase.id}`} /><span>{purchase.paid ? 'Төлсөн' : 'Төлөөгүй'}</span></label>{purchase.paid && <p className="mt-1 text-[10px] text-muted-foreground">{dateLabel(purchase.paymentDate!)} · {money(purchase.paymentAmount ?? 0)}</p>}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedPurchase(purchase)} data-testid={`button-view-inventory-${purchase.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button>{purchase.editable && <><Button size="icon" variant="ghost" onClick={() => editPurchase(purchase)} data-testid={`button-edit-inventory-${purchase.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Үйл ажиллагааны зардал руу шилжүүлэх" onClick={() => openReclassify(purchase)} data-testid={`button-reclassify-inventory-${purchase.id}`}><ArrowRightLeft className="size-4" /></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => deletePurchase(purchase)} data-testid={`button-delete-inventory-${purchase.id}`}><Trash2 className="size-4" /></Button></>}</div></td></tr>)}</tbody><tfoot className="border-t-2 border-border bg-secondary/35"><tr><td className="px-5 py-3 text-sm font-bold" colSpan={3}>Сонгосон сарын нийт</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary" data-testid="value-inventory-purchase-total">{money(filteredPurchaseTotal)}</td><td colSpan={2} /></tr></tfoot></table></div>
      </>}
    </section>}
    {inventoryTab === 'purchases' && !query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 && <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">{query.data?.length ?? 0} баримтаас {(purchasePage - 1) * inventoryPurchasesPerPage + 1}–{Math.min(purchasePage * inventoryPurchasesPerPage, query.data?.length ?? 0)}-г харуулж байна</p>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button type="button" variant="outline" size="sm" disabled={purchasePage === 1} onClick={() => setPurchasePage((page) => Math.max(1, page - 1))} data-testid="button-inventory-purchases-previous">Өмнөх</Button>
        <span className="min-w-20 text-center font-mono text-xs font-bold">{purchasePage} / {purchasePageCount}</span>
        <Button type="button" variant="outline" size="sm" disabled={purchasePage === purchasePageCount} onClick={() => setPurchasePage((page) => Math.min(purchasePageCount, page + 1))} data-testid="button-inventory-purchases-next">Дараах</Button>
      </div>
    </div>}
    {inventoryTab === 'suppliers' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Харилцагчид</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{suppliers.data?.length ?? 0} харилцагч</span></div>
      {suppliers.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></div> : suppliers.isError ? <ErrorBlock onRetry={() => suppliers.refetch()} /> : !suppliers.data?.length ? <EmptyState title="Харилцагч бүртгэгдээгүй" detail="Худалдан авалт бүртгэхэд харилцагч автоматаар нэмэгдэнэ." icon={PackageOpen} /> : <>
        <div className="divide-y divide-border md:hidden">{suppliers.data.map((supplier: InventorySupplier) => <article key={supplier.id} className="p-4" data-testid={`inventory-supplier-mobile-${supplier.id}`}><h3 className="text-sm font-bold">{supplier.name}</h3><div className="mt-3 grid grid-cols-3 gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Нийт худалдан авалт</p><p className="mt-1 font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Үлдэгдэл төлбөр</p><p className={cn('mt-1 font-mono text-sm font-bold', supplier.unpaidAmount > 0 ? 'text-orange-800' : 'text-muted-foreground')}>{money(supplier.unpaidAmount)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Баримт</p><p className="mt-1 font-mono text-sm font-bold">{supplier.purchaseCount}</p></div></div><div className="mt-3 flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedSupplier(supplier)} data-testid={`button-view-supplier-${supplier.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => openSupplierEdit(supplier)} data-testid={`button-edit-supplier-${supplier.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteSupplier(supplier)} data-testid={`button-delete-supplier-${supplier.id}`}><Trash2 className="size-4" /></Button></div></article>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Харилцагч</th><th className="px-5 py-3 text-right">Нийт худалдан авалт</th><th className="px-5 py-3 text-right">Үлдэгдэл төлбөр</th><th className="px-5 py-3 text-right">Худалдан авалтын баримт</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{suppliers.data.map((supplier: InventorySupplier) => <tr key={supplier.id} data-testid={`inventory-supplier-${supplier.id}`}><td className="px-5 py-4 text-sm font-semibold">{supplier.name}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold text-primary">{money(supplier.totalAmount)}</td><td className={cn('px-5 py-4 text-right font-mono text-sm font-bold', supplier.unpaidAmount > 0 ? 'text-orange-800' : 'text-muted-foreground')}>{money(supplier.unpaidAmount)}</td><td className="px-5 py-4 text-right font-mono text-sm font-bold">{supplier.purchaseCount}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => setSelectedSupplier(supplier)} data-testid={`button-view-supplier-${supplier.id}`}>Дэлгэрэнгүй<ChevronRight className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => openSupplierEdit(supplier)} data-testid={`button-edit-supplier-${supplier.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={deletion.isPending} onClick={() => deleteSupplier(supplier)} data-testid={`button-delete-supplier-${supplier.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>
      </>}
    </section>}
    {editingSupplier && <Modal title="Харилцагчийн нэр засах" detail="Холбоотой худалдан авалт болон кассын тайлбар шинэ нэртэй хамт шинэчлэгдэнэ." onClose={() => setEditingSupplier(null)}>
      <Form {...supplierForm}><form onSubmit={supplierForm.handleSubmit(submitSupplier)} className="space-y-5" data-testid="form-inventory-supplier-edit"><label className="block space-y-2 text-xs font-semibold">Харилцагчийн нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...supplierForm.register('name', { required: true })} data-testid="input-inventory-supplier-edit-name" /></label>{updateSupplier.isError && <p className="text-xs font-semibold text-destructive">Нэрийг хадгалахад алдаа гарлаа. Ижил нэртэй харилцагч байгаа эсэхийг шалгана уу.</p>}<div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setEditingSupplier(null)}>Болих</Button><Button type="submit" disabled={updateSupplier.isPending}>{updateSupplier.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div></form></Form>
    </Modal>}
    {selectedSupplier && <Modal title={selectedSupplier.name} detail={`${selectedSupplierPurchases.length} худалдан авалт · ${money(selectedSupplierPurchases.reduce((total, purchase) => total + purchase.totalAmount, 0))}`} onClose={() => setSelectedSupplier(null)} wide>
      {!selectedSupplierPurchases.length ? <EmptyState title="Худалдан авалтын түүх алга" detail="Энэ харилцагчтай холбоотой худалдан авалт олдсонгүй." icon={PackageOpen} /> : <div className="max-h-[62vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Огноо</th><th className="px-3 py-2">Баримт</th><th className="px-3 py-2 text-right">Барааны төрөл</th><th className="px-3 py-2 text-right">Нийт дүн</th><th className="px-3 py-2 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{selectedSupplierPurchases.map((purchase) => <tr key={purchase.id}><td className="px-3 py-3 text-sm font-semibold">{dateLabel(purchase.date)}</td><td className="px-3 py-3 text-sm">{purchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'}</td><td className="px-3 py-3 text-right font-mono text-sm">{purchase.items.length}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold text-primary">{money(purchase.totalAmount)}</td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => { setSelectedSupplier(null); setSelectedPurchase(purchase); }}>Худалдан авалт үзэх</Button></td></tr>)}</tbody></table></div></div>}
    </Modal>}
    {paymentPurchase && <Modal title="Худалдан авалтын төлбөр" detail={`${paymentPurchase.supplierName} · Нийт ${money(paymentPurchase.totalAmount)}`} onClose={() => { setPaymentPurchase(null); setSelectedPaymentBank(null); }}>
      <Form {...paymentForm}><form onSubmit={paymentForm.handleSubmit(submitPurchasePayment)} className="space-y-5" data-testid="form-inventory-payment">
        <section aria-labelledby="inventory-bank-suggestions-title">
          <div className="flex items-center justify-between gap-3"><div><h3 id="inventory-bank-suggestions-title" className="text-sm font-bold">Тохирох банкны гүйлгээ</h3><p className="mt-1 text-xs text-muted-foreground">Харилцагч, огноо, дүнгээр эрэмбэлсэн холбогдоогүй зарлагууд.</p></div>{selectedPaymentBank && <Button type="button" size="sm" variant="outline" onClick={() => setSelectedPaymentBank(null)}>Сонголт арилгах</Button>}</div>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1" data-testid="inventory-payment-bank-suggestions">
            {paymentBankSuggestions.isLoading ? <><LoadingBlock className="h-20" /><LoadingBlock className="h-20" /></> : paymentBankSuggestions.isError ? <ErrorBlock onRetry={() => paymentBankSuggestions.refetch()} /> : !paymentBankSuggestions.data?.length ? <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Тохирох банкны гүйлгээ олдсонгүй.</p> : paymentBankSuggestions.data.map((suggestion) => {
              const selected = selectedPaymentBank?.id === suggestion.id;
              return <button type="button" key={suggestion.id} onClick={() => selectPaymentBank(suggestion)} className={cn('w-full rounded-xl border p-3 text-left transition-colors', selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40')} data-testid={`button-select-inventory-bank-${suggestion.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{suggestion.description || 'Банкны гүйлгээ'}</p><p className="mt-1 text-xs text-muted-foreground">{bankDateTimeLabel(suggestion.transactionAt)} · Тохирц {suggestion.score.toFixed(2)}%</p></div><div className="shrink-0 text-right"><p className="font-mono text-sm font-bold text-orange-800">−{money(suggestion.amount)}</p>{selected && <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-primary"><Check className="size-3" />Сонгосон</span>}</div></div></button>;
            })}
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Төлсөн огноо<input type="date" readOnly={Boolean(selectedPaymentBank)} className={cn('h-10 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary', selectedPaymentBank ? 'bg-muted' : 'bg-background')} {...paymentForm.register('date', { required: true })} data-testid="input-inventory-payment-date" /></label><label className="space-y-2 text-xs font-semibold">Төлсөн дүн<input type="number" min="0.01" step="0.01" readOnly={Boolean(selectedPaymentBank)} className={cn('h-10 w-full rounded-lg border border-input px-3 font-mono text-sm outline-none focus:border-primary', selectedPaymentBank ? 'bg-muted' : 'bg-background')} {...paymentForm.register('amount', { required: true, min: 0.01 })} data-testid="input-inventory-payment-amount" /></label></div>
        {confirmPurchasePayment.isError && <p className="text-xs font-semibold text-destructive">Төлбөрийг батлах боломжгүй байна. Сонгосон банкны гүйлгээ өөр бүртгэлтэй холбогдсон эсэх болон огноо өндөрлөсөн эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => { setPaymentPurchase(null); setSelectedPaymentBank(null); }} data-testid="button-cancel-inventory-payment">Болих</Button><Button type="submit" disabled={confirmPurchasePayment.isPending} data-testid="button-confirm-inventory-payment">{confirmPurchasePayment.isPending ? 'Баталж байна...' : selectedPaymentBank ? 'Холбож батлах' : 'Банкгүйгээр батлах'}</Button></div>
      </form></Form>
    </Modal>}
    {selectedPurchase && <Modal title={selectedPurchase.supplierName} detail={`${dateLabel(selectedPurchase.date)} · ${selectedPurchase.hasReceipt ? 'Баримттай' : 'Баримтгүй'} · ${money(selectedPurchase.totalAmount)}`} onClose={() => setSelectedPurchase(null)}>
      <div className="mb-4 rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={selectedPurchase.accountCode} name={selectedPurchase.accountName} /></div>
      <div className="max-h-[62vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Барааны нэр</th><th className="px-3 py-2">Ангилал</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт дүн</th></tr></thead><tbody className="divide-y divide-border">{selectedPurchase.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-sm font-semibold">{item.name}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.category}</td><td className="px-3 py-3 text-sm text-muted-foreground">{item.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{item.quantity}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(item.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(item.totalAmount)}</td></tr>)}</tbody></table></div></div>
    </Modal>}
    {inventoryTab === 'issues' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Зарлагын жагсаалт</h2><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{issues.data?.length ?? 0} бүртгэл</span></div>
      {issues.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : issues.isError ? <ErrorBlock onRetry={() => issues.refetch()} /> : !issues.data?.length ? <EmptyState title="Зарлага бүртгэгдээгүй" detail="Бараа материалын зарлагыг энд бүртгэнэ." icon={PackageOpen} /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Огноо</th><th className="px-5 py-3">Бараа материал</th><th className="px-5 py-3 text-right">Тоо хэмжээ</th><th className="px-5 py-3">Нэгж</th><th className="px-5 py-3 text-right">Өртөг</th><th className="px-5 py-3">Зориулалт</th><th className="px-5 py-3 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{issues.data.map((issue) => <tr key={issue.id} data-testid={`row-inventory-issue-${issue.id}`}><td className="px-5 py-3 text-sm font-semibold">{dateLabel(issue.date)}</td><td className="px-5 py-3 text-sm font-semibold">{issue.itemName}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold">{issue.quantity}</td><td className="px-5 py-3 text-sm text-muted-foreground">{issue.unit}</td><td className="px-5 py-3 text-right font-mono text-sm font-bold text-primary">{money(issue.totalCost)}</td><td className="px-5 py-3 text-sm">{issue.purpose}</td><td className="px-5 py-3"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => editIssue(issue)} data-testid={`button-edit-inventory-issue-${issue.id}`}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" disabled={removeIssue.isPending} onClick={() => deleteIssue(issue)} data-testid={`button-delete-inventory-issue-${issue.id}`}><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div>}
    </section>}
    {inventoryTab === 'requests' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-bold">Захиалгын жагсаалт</h2></div>
      {updateRequestStatus.isError && <p className="border-b border-border bg-destructive/10 px-5 py-3 text-sm font-semibold text-destructive">Захиалгын төлөвийг өөрчилж чадсангүй. Мэдээллийг шинэчлээд дахин оролдоно уу.</p>}
      {requestsQuery.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : requestsQuery.isError ? <ErrorBlock onRetry={() => requestsQuery.refetch()} /> : !requestsQuery.data?.length ? <EmptyState title="Захиалга олдсонгүй" detail="Одоогоор бүртгэгдсэн материалын захиалга алга байна." icon={PackageOpen} /> : <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Огноо</th>
              <th className="px-5 py-3">Захиалагч</th>
              <th className="px-5 py-3">Жагсаалт</th>
              <th className="px-5 py-3">Тэмдэглэл</th>
              <th className="px-5 py-3">Төлөв</th>
              <th className="px-5 py-3 text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {requestsQuery.data.map((req) => (
              <tr key={req.id} className="transition-colors hover:bg-secondary/40" data-testid={`row-inventory-request-${req.id}`}>
                <td className="px-5 py-3 text-sm font-semibold">{dateLabel(req.requestedDate)}</td>
                <td className="px-5 py-3 text-sm font-semibold">{req.requesterName}</td>
                <td className="px-5 py-3 text-sm">
                  <div className="flex flex-col gap-1">
                    {req.lines.map(line => (
                      <div key={line.id} className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{line.itemName}</span>
                        <span className="text-xs text-muted-foreground font-mono bg-secondary/50 px-1.5 py-0.5 rounded">{line.quantity} {line.unit}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">{req.note || '-'}</td>
                <td className="px-5 py-3">
                  {req.status === 'pending' && <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-1 text-[10px] font-bold text-orange-700 dark:text-orange-400">Хүлээгдэж буй</span>}
                  {req.status === 'approved' && <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-1 text-[10px] font-bold text-blue-700 dark:text-blue-400">Зөвшөөрсөн</span>}
                  {req.status === 'rejected' && <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-bold text-destructive">Татгалзсан</span>}
                  {req.status === 'fulfilled' && <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">Олгосон</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {canManageMaterialRequests && req.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" className="h-8 border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-900 dark:hover:bg-blue-900/30 dark:hover:text-blue-300" onClick={() => handleRequestStatusChange(req, 'approved')} disabled={updateRequestStatus.isPending} data-testid={`button-approve-request-${req.id}`}>
                          <Check className="mr-1 size-3.5" /> Зөвшөөрөх
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 border-destructive/20 hover:bg-destructive/10 hover:text-destructive" onClick={() => { if (window.confirm('Энэхүү захиалгад татгалзах уу?')) handleRequestStatusChange(req, 'rejected'); }} disabled={updateRequestStatus.isPending} data-testid={`button-reject-request-${req.id}`}>
                          <X className="mr-1 size-3.5" /> Татгалзах
                        </Button>
                      </>
                    )}
                    {canManageMaterialRequests && req.status === 'approved' && (
                      <Button size="sm" variant="default" className="h-8" onClick={() => handleRequestStatusChange(req, 'fulfilled')} disabled={updateRequestStatus.isPending} data-testid={`button-fulfill-request-${req.id}`}>
                        <Check className="mr-1 size-3.5" /> Олгох
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>}
    {selectedItem && <Modal title={selectedItem.name} detail={`${selectedItem.category} · Үлдэгдэл ${selectedItem.quantity} ${selectedItem.unit}`} onClose={() => setSelectedItem(null)}>
      {!selectedItemHistory.length ? <EmptyState title="Худалдан авалтын түүх алга" detail="Энэ бараанд холбогдох худалдан авалт олдсонгүй." icon={PackageOpen} /> : <div className="max-h-[60vh] overflow-y-auto"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Огноо</th><th className="px-3 py-2 text-right">Тоо</th><th className="px-3 py-2">Нэгж</th><th className="px-3 py-2 text-right">Нэгж үнэ</th><th className="px-3 py-2 text-right">Нийт үнэ</th></tr></thead><tbody className="divide-y divide-border">{selectedItemHistory.map((line) => <tr key={`${line.purchaseId}-${line.id}`}><td className="px-3 py-3 text-sm font-semibold">{dateLabel(line.date)}</td><td className="px-3 py-3 text-right font-mono text-sm">{line.quantity}</td><td className="px-3 py-3 text-sm text-muted-foreground">{line.unit}</td><td className="px-3 py-3 text-right font-mono text-sm">{money(line.unitPrice)}</td><td className="px-3 py-3 text-right font-mono text-sm font-bold">{money(line.totalAmount)}</td></tr>)}</tbody></table></div></div>}
    </Modal>}
    {categoryItem && <Modal title="Бараа материал засах" detail={`${categoryItem.quantity} ${categoryItem.unit} үлдэгдэлтэй`} onClose={() => setCategoryItem(null)}>
      <Form {...categoryForm}><form onSubmit={categoryForm.handleSubmit(submitCategory)} className="space-y-5" data-testid="form-inventory-category">
        <label className="block space-y-2 text-xs font-semibold">Бараа материалын нэр<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...categoryForm.register('name', { required: true })} data-testid="input-inventory-name-edit" /></label>
        <label className="block space-y-2 text-xs font-semibold">Ангилал<input className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...categoryForm.register('category', { required: true })} data-testid="input-inventory-category-edit" /></label>
        {updateCatalogItem.isError && <p className="text-xs font-semibold text-destructive">Мэдээллийг хадгалахад алдаа гарлаа. Ижил нэртэй бараа байгаа эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setCategoryItem(null)}>Болих</Button><Button type="submit" disabled={updateCatalogItem.isPending} data-testid="button-save-inventory-category">{updateCatalogItem.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
    {reclassifyPurchase && <Modal title="Үйл ажиллагааны зардал руу шилжүүлэх" detail={`${reclassifyPurchase.supplierName} · ${money(reclassifyPurchase.totalAmount)} — энэ худалдан авалт бараа материалаас хасагдаж, зардал болно.`} onClose={() => setReclassifyPurchase(null)}>
      <Form {...reclassifyForm}><form onSubmit={reclassifyForm.handleSubmit(submitReclassify)} className="space-y-5" data-testid="form-inventory-reclassify">
        <label className="block space-y-2 text-xs font-semibold">Зардлын данс<select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...reclassifyForm.register('accountId', { required: true })} data-testid="select-reclassify-account"><option value="">Данс сонгоно уу</option>{chartOfAccounts.data?.filter((account) => account.type === 'expense').map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
        {reclassify.isError && <p className="text-xs font-semibold text-destructive">Шилжүүлэхэд алдаа гарлаа. Барааны үлдэгдэл аль хэдийн зарлагдсан эсэхийг шалгана уу.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setReclassifyPurchase(null)}>Болих</Button><Button type="submit" disabled={reclassify.isPending} data-testid="button-save-reclassify">{reclassify.isPending ? 'Шилжүүлж байна...' : 'Шилжүүлэх'}</Button></div>
      </form></Form>
    </Modal>}
    {issueOpen && <Modal title={editingIssue ? 'Бараа материалын зарлага засах' : 'Бараа материалын зарлага'} detail="Үлдэгдлээс бараа сонгож, зарлагын мэдээллийг оруулна." onClose={() => setIssueOpen(false)}>
      <Form {...issueForm}><form onSubmit={issueForm.handleSubmit(submitIssue)} className="space-y-5">
        <label className="block space-y-2 text-xs font-semibold">Бараа материал<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('inventoryItemId', { required: true })} data-testid="select-inventory-issue-item"><option value="">Сонгох</option>{catalog.data?.map((item) => <option value={item.id} key={item.id} disabled={item.quantity <= 0}>{item.name} · {item.quantity} {item.unit}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('date', { required: true })} data-testid="input-inventory-issue-date" /></label><label className="space-y-2 text-xs font-semibold">Тоо хэмжээ<input type="number" min="0.001" step="0.001" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...issueForm.register('quantity', { required: true, min: 0.001 })} data-testid="input-inventory-issue-quantity" /></label></div>
        <label className="block space-y-2 text-xs font-semibold">Зориулалт<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...issueForm.register('purpose', { required: true })} data-testid="select-inventory-issue-purpose"><option value="">Сонгох</option>{editingIssue?.purpose && !inventoryIssuePurposes.includes(editingIssue.purpose as typeof inventoryIssuePurposes[number]) && <option value={editingIssue.purpose}>{editingIssue.purpose}</option>}{inventoryIssuePurposes.map((purpose) => <option value={purpose} key={purpose}>{purpose}</option>)}</select></label>
        {(createIssue.isError || updateIssue.isError) && <p className="text-xs font-semibold text-destructive">Үлдэгдэл хүрэлцэхгүй эсвэл мэдээлэл буруу байна.</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setIssueOpen(false)}>Болих</Button><Button type="submit" disabled={createIssue.isPending || updateIssue.isPending} data-testid="button-save-inventory-issue">{createIssue.isPending || updateIssue.isPending ? 'Хадгалж байна...' : editingIssue ? 'Засварыг хадгалах' : 'Зарлага хадгалах'}</Button></div>
      </form></Form>
    </Modal>}
    {open && <Modal wide fullScreen title={editing ? 'Худалдан авалт засах' : 'Бараа материалын худалдан авалт'} detail="Сангаас хайж сонгох эсвэл шинэ бараа бүртгэнэ." onClose={() => setOpen(false)}>
      {editing && <div className="mb-3 rounded-xl border border-border bg-secondary/35 px-4 py-3"><AccountLabel code={editing.accountCode} name={editing.accountName} /></div>}
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-3">
        <label className="block space-y-2 text-xs font-semibold">Бараа материалын төрөл<select className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('materialType', { required: true })} data-testid="select-inventory-material-type">{inventoryMaterialTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs font-semibold">Харилцагч<input list="inventory-supplier-options" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('supplierName', { required: true })} placeholder="Жишээ: Номин" data-testid="input-inventory-supplier-name" /></label><label className="space-y-2 text-xs font-semibold">Худалдан авалтын огноо<input type="date" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('date', { required: true })} data-testid="input-inventory-purchase-date" /></label></div>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" {...form.register('hasReceipt')} data-testid="checkbox-inventory-has-receipt" /><span>Баримттай</span></label>
        <datalist id="inventory-supplier-options">{suppliers.data?.map((supplier) => <option value={supplier.name} key={supplier.id} />)}</datalist>
        <datalist id="inventory-catalog-options">{catalog.data?.filter((item) => item.materialType === form.watch('materialType')).map((item) => <option value={item.name} key={item.id}>{item.category} · {item.unit}</option>)}</datalist>
        <div className="space-y-3">{rows.fields.map((field, index) => {
          const item = watchedItems[index];
          const total = (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0);
          const selectCatalogItem = (name: string) => {
            const match = catalog.data?.find((candidate) => candidate.name.toLocaleLowerCase('mn-MN') === name.trim().toLocaleLowerCase('mn-MN'));
            form.setValue(`items.${index}.inventoryItemId`, match?.id);
            if (match) {
              form.setValue(`items.${index}.name`, match.name);
              form.setValue(`items.${index}.category`, match.category);
              form.setValue(`items.${index}.unit`, match.unit as typeof inventoryUnits[number]);
            }
          };
          return <div className="rounded-xl border border-border bg-secondary/20 p-3" key={field.id}>
            <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold">Бараа {index + 1}</span>{rows.fields.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => rows.remove(index)} aria-label={`${index + 1}-р барааг устгах`}><Trash2 className="size-4" /></Button>}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.35fr_1fr_.75fr_1fr]"><label className="space-y-1 text-xs font-semibold">Барааны нэр<input list="inventory-catalog-options" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.name`, { required: true, onChange: (event) => selectCatalogItem(event.target.value) })} placeholder="Сангаас хайх эсвэл шинээр бичих" data-testid={`input-inventory-name-${index}`} /></label><label className="space-y-1 text-xs font-semibold">Ангилал<input className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.category`, { required: true })} placeholder="Мах, Сүү, Ногоо..." data-testid={`input-inventory-category-${index}`} /></label><label className="space-y-1 text-xs font-semibold">Хэмжих нэгж<select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register(`items.${index}.unit`, { required: true })} data-testid={`select-inventory-unit-${index}`}>{inventoryUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label><label className="space-y-1 text-xs font-semibold">Тоо<input type="number" min="0.001" step="0.001" className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register(`items.${index}.quantity`, { required: true, min: 0.001 })} data-testid={`input-inventory-quantity-${index}`} /></label><label className="space-y-1 text-xs font-semibold sm:col-span-2 lg:col-span-1">Үнэ<input type="number" min="0" step="0.01" className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register(`items.${index}.unitPrice`, { required: true, min: 0 })} data-testid={`input-inventory-price-${index}`} /></label></div>
            <div className="mt-3 flex justify-end text-sm"><span className="text-muted-foreground">Нийт:&nbsp;</span><strong className="font-mono">{money(total)}</strong></div>
          </div>;
        })}</div>
        <Button type="button" variant="outline" className="w-full" onClick={() => rows.append({ name: '', category: '', unit: 'ширхэг', quantity: '1', unitPrice: '' })} data-testid="button-add-inventory-row"><Plus className="size-4" />Бараа нэмэх</Button>
        <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-3"><span className="text-sm font-bold">Нийт дүн</span><strong className="font-mono text-lg text-primary">{money(grandTotal)}</strong></div>
        <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Болих</Button><Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save-inventory-purchase">{create.isPending || update.isPending ? 'Хадгалж байна...' : editing ? 'Засварыг хадгалах' : 'Бүртгэх'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}
