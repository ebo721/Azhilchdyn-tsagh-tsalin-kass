export * from "./deletion-request-helpers.js";
export * from "./inventory-fifo-helpers.js";
export * from "./payroll-calc-helpers.js";
export * from "./chart-of-accounts-helpers.js";
export * from "./date-utils.js";

import { daysInMonth } from "./date-utils.js";
import {
  CreateAttendanceBody,
  CreateShiftBody,
  CreateCashTransactionBody,
  CloseCashDayBody,
  CreateEmployeeBody,
  DeleteAttendanceQueryParams,
  CopyPreviousShiftPlansBody,
  CopyPreviousShiftPlansResponse,
  ApprovePayrollAdvanceBody,
  GetDashboardResponse,
  GetHourBalanceQueryParams,
  GetHourBalanceResponse,
  GetPayrollQueryParams,
  GetPayrollResponse,
  GetPayrollAdvanceQueryParams,
  GetPayrollAdvanceResponse,
  GetCashSummaryResponse,
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  ListShiftPlansQueryParams,
  ListShiftPlansResponse,
  ListShiftsResponse,
  RevertPayrollAdvanceApprovalQueryParams,
  ListCashTransactionsResponse,
  ListCashClosuresResponse,
  CloseCashDayResponse,
  UpdateCashTransactionBody,
  UpdateCashTransactionParams,
  UpdateBankCashTransactionIncomeMonthBody,
  UpdateBankCashTransactionIncomeMonthParams,
  UpdateBankCashTransactionIncomeMonthResponse,
  DeleteCashTransactionParams,
  CreateInventoryPurchaseBody,
  CreateInventoryPurchaseResponse,
  ListInventoryPurchasesResponse,
  ListInventorySuppliersResponse,
  UpdateInventorySupplierBody,
  UpdateInventorySupplierParams,
  UpdateInventorySupplierResponse,
  DeleteInventorySupplierParams,
  ListInventoryItemsResponse,
  UpdateInventoryItemBody,
  UpdateInventoryItemParams,
  UpdateInventoryItemResponse,
  UpdateInventoryPurchaseBody,
  UpdateInventoryPurchaseParams,
  UpdateInventoryPurchaseResponse,
  DeleteInventoryPurchaseParams,
  ReclassifyInventoryPurchaseAsExpenseParams,
  ReclassifyInventoryPurchaseAsExpenseBody,
  ReclassifyInventoryPurchaseAsExpenseResponse,
  ConfirmInventoryPurchasePaymentBody,
  ConfirmInventoryPurchasePaymentParams,
  ConfirmInventoryPurchasePaymentResponse,
  ListInventoryPurchasePaymentBankSuggestionsParams,
  ListInventoryPurchasePaymentBankSuggestionsResponse,
  CancelInventoryPurchasePaymentParams,
  CancelInventoryPurchasePaymentResponse,
  CreateInventoryIssueBody,
  CreateInventoryIssueResponse,
  ListInventoryIssuesResponse,
  UpdateInventoryIssueBody,
  UpdateInventoryIssueParams,
  UpdateInventoryIssueResponse,
  DeleteInventoryIssueParams,
  CreateFixedAssetBody,
  CreateFixedAssetResponse,
  UpdateFixedAssetBody,
  UpdateFixedAssetParams,
  UpdateFixedAssetResponse,
  DeleteFixedAssetParams,
  ListFixedAssetsResponse,
  CreateOperatingExpenseBody,
  CreateOperatingExpenseResponse,
  ListOperatingExpensesResponse,
  UpdateOperatingExpenseBody,
  UpdateOperatingExpenseParams,
  UpdateOperatingExpenseResponse,
  DeleteOperatingExpenseParams,
  ListOperatingExpensePaymentBankSuggestionsParams,
  ListOperatingExpensePaymentBankSuggestionsResponse,
  ConfirmOperatingExpensePaymentBody,
  ConfirmOperatingExpensePaymentParams,
  ConfirmOperatingExpensePaymentResponse,
  CancelOperatingExpensePaymentParams,
  CancelOperatingExpensePaymentResponse,
  CreateDeletionRequestBody,
  CreateDeletionRequestResponse,
  ListDeletionRequestsResponse,
  ApproveDeletionRequestParams,
  ApproveDeletionRequestResponse,
  CancelDeletionRequestParams,
  CancelDeletionRequestResponse,
  ListEmployeesResponse,
  ListEmployeeSalaryHistoryParams,
  ListEmployeeSalaryHistoryResponse,
  DeleteEmployeeSalaryHistoryParams,
  UpdateEmployeeSalaryHistoryBody,
  UpdateEmployeeSalaryHistoryParams,
  UpdateEmployeeSalaryHistoryResponse,
  DeletePayrollAdjustmentTransactionParams,
  UpsertPayrollAdjustmentBody,
  UpdatePayrollAdvancePaymentBody,
  UpsertAttendanceBody,
  UpsertShiftPlanBody,
  UpdateShiftBody,
  UpdateShiftParams,
  UpdateEmployeeBody,
  UpdateEmployeeParams,
  ListChartOfAccountsResponse,
  GetPayrollScheduleResponse,
  UpdatePayrollScheduleBody,
  UpdatePayrollScheduleResponse,
  CreateChartOfAccountBody,
  CreateChartOfAccountResponse,
  UpdateChartOfAccountBody,
  UpdateChartOfAccountParams,
  UpdateChartOfAccountResponse,
  DeleteChartOfAccountParams,
} from "@workspace/api-zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  attendanceTable,
  cashTransactionsTable,
  cashClosuresTable,
  db,
  employeesTable,
  employeeSalaryHistoryTable,
  employeeShiftPlansTable,
  payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable,
  inventorySuppliersTable,
  inventoryIssuesTable,
  fixedAssetsTable,
  operatingExpensesTable,
  deletionRequestsTable,
  shiftTemplatesTable,
  chartOfAccountsTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession } from "../lib/hr-session.js";
import { planPayrollAdvancePayment } from "../lib/payroll-advance-payment.js";
import { planShiftPlanCopy } from "../lib/shift-plan-copy.js";
import { reconcileOperatingExpenses } from "../lib/operating-expense-sync.js";
import {
  cashAccountForCategory,
  isCanonicalCashCategory,
  shouldMirrorCashAsOperatingExpense,
} from "../lib/cash-account.js";


export async function isCashDateClosed(date: string) {
  const [closure] = await db
    .select({ id: cashClosuresTable.id })
    .from(cashClosuresTable)
    .where(eq(cashClosuresTable.date, date));
  return Boolean(closure);
}

export function operatingExpenseResponse(row: typeof operatingExpensesTable.$inferSelect, category: string) {
  return { ...row, category, date: String(row.date), amount: Number(row.amount), paymentDate: row.paymentDate ? String(row.paymentDate) : null,
    paymentAmount: row.paymentAmount === null ? null : Number(row.paymentAmount), bankTransactionId: row.bankTransactionId,
    cashTransactionId: row.cashTransactionId, createdAt: String(row.createdAt) };
}

export async function operatingExpenseAccountName(accountId: number) {
  const [account] = await db
    .select({ name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, accountId));
  if (!account) throw new Error(`Operating expense account ${accountId} is missing`);
  return account.name;
}

export const inventoryMaterialLabel = (materialType: string) =>
  materialType === "food" ? "Хүнсний бараа материал" : "Хангамжийн материал";

export const operatingExpenseAccountCodes = ["6100", "6200", "6300", "6400", "6500", "6900"] as const;
export const inventoryPurchaseAccountCodes = ["1500", "1510"] as const;
export const reservedAccountTypes: Record<string, string> = {
  "1500": "asset",
  "1510": "asset",
  "1800": "asset",
  "1810": "asset",
  "4000": "revenue",
  "6000": "expense",
  "6100": "expense",
  "6200": "expense",
  "6300": "expense",
  "6400": "expense",
  "6500": "expense",
  "6900": "expense",
};

export const chartOfAccountResponse = (row: typeof chartOfAccountsTable.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

export async function lockedExpenseAccount(tx: DbClient, accountId: number) {
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.id, accountId),
    eq(chartOfAccountsTable.type, "expense"),
  )).for("update");
  return account ?? null;
}

export const calendarDateOffset = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
};
export const deletionRequestResponse = (request: typeof deletionRequestsTable.$inferSelect) => ({
  ...request,
  requestedAt: request.requestedAt.toISOString(),
  approvedAt: request.approvedAt?.toISOString() ?? null,
  completedAt: request.completedAt?.toISOString() ?? null,
});
export function calendarDateText(value: string | Date) {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

export const defaultPayrollSchedule = {
  periodStartDay: 1,
  advanceCutoffDay: 15,
  periodEndDay: 31,
  advancePayDay: 15,
  finalPayDay: 31,
};

export function scheduleDate(month: string, day: number) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

export function selectPayrollScheduleVersion<T extends { effectiveFromMonth: string }>(
  versions: T[],
  month: string,
) {
  return versions
    .filter((version) => version.effectiveFromMonth <= month)
    .sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth))[0];
}

export function scheduleVersionAffectsMonth(
  month: string,
  effectiveFromMonth: string,
  nextEffectiveFromMonth?: string,
) {
  return month >= effectiveFromMonth
    && (!nextEffectiveFromMonth || month < nextEffectiveFromMonth);
}

export function weekdayDatesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let value = new Date(`${start}T00:00:00.000Z`); value <= new Date(`${end}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + 1)) {
    if (value.getUTCDay() >= 1 && value.getUTCDay() <= 5) dates.push(value.toISOString().slice(0, 10));
  }
  return dates;
}

export type SalaryHistoryRow = typeof employeeSalaryHistoryTable.$inferSelect;

export type PayrollCalculationData = {
  allEmployees: Array<typeof employeesTable.$inferSelect>;
  salaryHistory: Array<typeof employeeSalaryHistoryTable.$inferSelect>;
  records: Array<typeof attendanceTable.$inferSelect>;
  allAdjustments: Array<typeof payrollAdjustmentsTable.$inferSelect>;
  allAdvanceApprovals: Array<typeof payrollAdvanceApprovalsTable.$inferSelect>;
};

export class InventoryInsufficientStockError extends Error {}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = Tx | typeof db;
