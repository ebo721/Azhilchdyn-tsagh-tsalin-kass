import { createServer } from "node:http";
import { Router, type IRouter } from "express";
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
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  attendanceTable,
  cashTransactionsTable,
  cashClosuresTable,
  bankTransactionsTable,
  db,
  employeesTable,
  employeeSalaryHistoryTable,
  employeeShiftPlansTable,
  payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable,
  inventoryPurchasesTable,
  inventorySuppliersTable,
  inventoryPurchaseItemsTable,
  inventoryItemsTable,
  inventoryIssuesTable,
  inventoryIssueConsumptionsTable,
  fixedAssetsTable,
  operatingExpensesTable,
  deletionRequestsTable,
  shiftTemplatesTable,
  chartOfAccountsTable,
  payrollScheduleSettingsTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession, type StaffRole } from "../lib/hr-session.js";
import { planPayrollAdvancePayment } from "../lib/payroll-advance-payment.js";
import { planShiftPlanCopy } from "../lib/shift-plan-copy.js";
import { reconcileOperatingExpenses } from "../lib/operating-expense-sync.js";
import {
  cashAccountForCategory,
  isCanonicalCashCategory,
  shouldMirrorCashAsOperatingExpense,
} from "../lib/cash-account.js";


/**
 * Re-enters this router for an admin-approved deletion, the same way the original
 * request would have, but without hopping over the network to `127.0.0.1:PORT` —
 * that assumed a long-running server on a known port, which doesn't exist in a
 * serverless function (each invocation is isolated and PORT isn't set). Instead we
 * spin up a throwaway HTTP server bound to this router only for the duration of
 * this one call, so the exact same DELETE handlers and the header-based approval
 * check above run unchanged, in-process, on a loopback port the OS assigns us.
 */
export function dispatchApprovedDeletion(
  targetPath: string,
  cookie: string,
  requestId: number,
  targetRouter: IRouter,
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      targetRouter(req as never, res as never, (err?: unknown) => {
        if (err) {
          res.statusCode = 500;
          res.end();
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      fetch(`http://127.0.0.1:${port}${targetPath}`, {
        method: "DELETE",
        headers: { cookie, "x-deletion-request-id": String(requestId) },
      })
        .then((response) => resolve(response as { ok: boolean; status: number; text(): Promise<string> }))
        .catch(reject)
        .finally(() => server.close());
    });
  });
}

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

export const defaultChartOfAccounts = [
  { code: "1000", name: "Бэлэн мөнгө (касс)", type: "asset" },
  { code: "1010", name: "Банкны данс", type: "asset" },
  { code: "1200", name: "Авлага", type: "asset" },
  { code: "1500", name: "Бараа материалын үлдэгдэл", type: "asset" },
  { code: "1510", name: "Хангамжийн материалын үлдэгдэл", type: "asset" },
  { code: "1800", name: "Үндсэн хөрөнгө", type: "asset" },
  { code: "1810", name: "Хуримтлагдсан элэгдэл", type: "asset" },
  { code: "2000", name: "Өглөг", type: "liability" },
  { code: "2100", name: "Цалингийн өглөг", type: "liability" },
  { code: "2200", name: "Татварын өглөг", type: "liability" },
  { code: "2300", name: "Банкны зээл", type: "liability" },
  { code: "3000", name: "Хувь нийлүүлэгчийн хөрөнгө", type: "equity" },
  { code: "3900", name: "Хуримтлагдсан ашиг/алдагдал", type: "equity" },
  { code: "4000", name: "Хоолны үйлчилгээний орлого", type: "revenue" },
  { code: "4900", name: "Бусад орлого", type: "revenue" },
  { code: "5000", name: "Бараа материалын зардал (COGS)", type: "expense" },
  { code: "6000", name: "Цалингийн зардал", type: "expense" },
  { code: "6010", name: "Нийгмийн даатгалын зардал", type: "expense" },
  { code: "6100", name: "Түрээсийн зардал", type: "expense" },
  { code: "6200", name: "Тээврийн зардал", type: "expense" },
  { code: "6300", name: "Цахилгаан, дулаан, ус", type: "expense" },
  { code: "6400", name: "Харилцаа холбоо, интернэт", type: "expense" },
  { code: "6500", name: "Засвар үйлчилгээ", type: "expense" },
  { code: "6600", name: "Элэгдлийн зардал", type: "expense" },
  { code: "6900", name: "Бусад үйл ажиллагааны зардал", type: "expense" },
] as const;

export const operatingExpenseAccountCodes = ["6100", "6200", "6300", "6400", "6500", "6900"] as const;
export const inventoryPurchaseAccountCodes = ["1500", "1510"] as const;
export const reservedAccountTypes: Record<string, string> = {
  "1500": "asset",
  "1510": "asset",
  "1800": "asset",
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

export async function ensureDefaultChartOfAccounts(tx: DbClient) {
  await tx.insert(chartOfAccountsTable).values([...defaultChartOfAccounts]).onConflictDoNothing({
    target: chartOfAccountsTable.code,
  });
  const conflicting = await tx.select({ code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable)
    .where(and(inArray(chartOfAccountsTable.code, [...operatingExpenseAccountCodes]), sql`${chartOfAccountsTable.type} <> 'expense'`));
  if (conflicting.length) {
    throw new Error(`Reserved operating expense account codes have a non-expense type: ${conflicting.map((row: { code: string }) => row.code).join(", ")}`);
  }
  const conflictingInventoryAccounts = await tx.select({ code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable)
    .where(and(inArray(chartOfAccountsTable.code, [...inventoryPurchaseAccountCodes]), sql`${chartOfAccountsTable.type} <> 'asset'`));
  if (conflictingInventoryAccounts.length) {
    throw new Error(`Reserved inventory account codes have a non-asset type: ${conflictingInventoryAccounts.map((row: { code: string }) => row.code).join(", ")}`);
  }
}

export async function inventoryPurchaseAccount(tx: DbClient, materialType: string) {
  await ensureDefaultChartOfAccounts(tx);
  const code = materialType === "food" ? "1500" : "1510";
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, code),
    eq(chartOfAccountsTable.type, "asset"),
  ));
  if (!account) throw new Error(`Inventory account ${code} is missing or has an invalid type`);
  return account;
}

export async function lockedExpenseAccount(tx: DbClient, accountId: number) {
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.id, accountId),
    eq(chartOfAccountsTable.type, "expense"),
  )).for("update");
  return account ?? null;
}

export async function fallbackExpenseAccount(tx: DbClient, category: string) {
  await ensureDefaultChartOfAccounts(tx);
  const normalized = category.toLocaleLowerCase("mn-MN");
  const preferredCode = normalized.includes("түрээс") ? "6100"
    : normalized.includes("тээвэр") || normalized.includes("шатахуун") ? "6200"
      : normalized.includes("цахилгаан") || normalized.includes("дулаан") || normalized.includes("ус") ? "6300"
        : normalized.includes("интернет") || normalized.includes("холбоо") ? "6400"
          : normalized.includes("засвар") ? "6500"
            : "6900";
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, preferredCode),
    eq(chartOfAccountsTable.type, "expense"),
  ));
  if (!account) throw new Error(`Expense account ${preferredCode} is missing or has an invalid type`);
  return account;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => today().slice(0, 7);
export const money = (value: number) => Math.round(value * 100) / 100;
export class InventoryBankPaymentConflictError extends Error {}
export class OperatingExpenseBankPaymentConflictError extends Error {}
export const calendarDateOffset = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
};
export const descriptionTokens = (value: string) => new Set(value.toLocaleLowerCase("mn-MN").match(/[\p{L}\p{N}]+/gu) ?? []);
export const inventoryBankSuggestionScore = (
  purchase: typeof inventoryPurchasesTable.$inferSelect,
  bank: typeof bankTransactionsTable.$inferSelect,
) => {
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  const distance = Math.abs((Date.parse(`${purchase.date}T00:00:00Z`) - Date.parse(`${bankDate}T00:00:00Z`)) / 86_400_000);
  const bankAmount = Number(bank.amount);
  const purchaseAmount = Number(purchase.totalAmount);
  const amountCloseness = Math.max(0, 1 - Math.abs(bankAmount - purchaseAmount) / Math.max(bankAmount, purchaseAmount, 1));
  const bankTokens = descriptionTokens(`${bank.description} ${bank.counterparty}`);
  const purchaseTokens = descriptionTokens(purchase.documentName);
  const overlap = [...bankTokens].filter((token) => purchaseTokens.has(token)).length;
  const tokenOverlap = overlap / Math.max(new Set([...bankTokens, ...purchaseTokens]).size, 1);
  return Math.round((0.4 * (1 - distance / 7) + 0.35 * amountCloseness + 0.25 * tokenOverlap) * 10_000) / 100;
};
export const deletionTargetPatterns = [
  /^\/employees\/\d+$/,
  /^\/employees\/\d+\/salary-history\/\d+$/,
  /^\/attendance\/shifts\/\d+$/,
  /^\/attendance\?employeeId=\d+&date=\d{4}-\d{2}-\d{2}$/,
  /^\/payroll-advance\/approval\?month=\d{4}-\d{2}$/,
  /^\/payroll-adjustments\/\d{4}-\d{2}\/\d+\/transactions\/[12]$/,
  /^\/cash\/transactions\/\d+$/,
  /^\/bank-transactions\/\d+$/,
  /^\/fixed-assets\/\d+$/,
  /^\/inventory\/issues\/\d+$/,
  /^\/inventory\/purchases\/\d+$/,
  /^\/inventory\/suppliers\/\d+$/,
];
export const roleCanRequestDeletion = (role: StaffRole, targetPath: string) => role === "admin"
  || (role === "hr" && (targetPath.startsWith("/employees/") || targetPath.startsWith("/attendance")))
  || (role === "accountant" && (targetPath.startsWith("/payroll-advance/") || targetPath.startsWith("/payroll-adjustments/") || targetPath.startsWith("/bank-transactions/")))
  || (role === "warehouse" && (targetPath.startsWith("/inventory/") || targetPath.startsWith("/fixed-assets/")));
export const deletionRequestResponse = (request: typeof deletionRequestsTable.$inferSelect) => ({
  ...request,
  requestedAt: request.requestedAt.toISOString(),
  approvedAt: request.approvedAt?.toISOString() ?? null,
  completedAt: request.completedAt?.toISOString() ?? null,
});
export const monthlyIncomeTaxRelief = (socialInsuranceSalary: number) => {
  if (socialInsuranceSalary <= 500_000) return 20_000;
  if (socialInsuranceSalary <= 1_000_000) return 18_000;
  if (socialInsuranceSalary <= 1_500_000) return 16_000;
  if (socialInsuranceSalary <= 2_000_000) return 14_000;
  if (socialInsuranceSalary <= 2_500_000) return 12_000;
  if (socialInsuranceSalary <= 3_000_000) return 10_000;
  return 0;
};

export function hoursBetween(clockIn: string, clockOut: string) {
  const [inHour, inMinute] = clockIn.split(":").map(Number);
  const [outHour, outMinute] = clockOut.split(":").map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  return Math.max(0, money((end - start) / 60));
}

export function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function isValidCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function calendarDateText(value: string | Date) {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

export function weekdayCount(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) count += 1;
  }
  return count;
}

export function monthWeekdays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) dates.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

export const defaultPayrollSchedule = {
  periodStartDay: 1,
  advanceCutoffDay: 15,
  periodEndDay: 31,
  advancePayDay: 15,
  finalPayDay: 31,
};

export async function getPayrollSchedule(month = currentMonth()) {
  let [row] = await db.select().from(payrollScheduleSettingsTable)
    .where(lte(payrollScheduleSettingsTable.effectiveFromMonth, month))
    .orderBy(desc(payrollScheduleSettingsTable.effectiveFromMonth))
    .limit(1);
  if (!row) {
    [row] = await db.insert(payrollScheduleSettingsTable)
      .values({ ...defaultPayrollSchedule, effectiveFromMonth: "0001-01" })
      .onConflictDoNothing({ target: payrollScheduleSettingsTable.effectiveFromMonth })
      .returning();
    if (!row) {
      [row] = await db.select().from(payrollScheduleSettingsTable)
        .where(eq(payrollScheduleSettingsTable.effectiveFromMonth, "0001-01")).limit(1);
    }
  }
  return row;
}

export function scheduleDate(month: string, day: number) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

export function payrollPeriod(month: string, schedule: typeof defaultPayrollSchedule) {
  const startMonth = schedule.periodStartDay > schedule.periodEndDay ? previousMonth(month) : month;
  const finalPaymentMonth = schedule.finalPayDay < schedule.advancePayDay ? nextMonth(month) : month;
  const periodStart = scheduleDate(startMonth, schedule.periodStartDay);
  const periodEnd = scheduleDate(month, schedule.periodEndDay);
  const advancePeriodEnd = schedule.advanceCutoffDay >= schedule.periodStartDay
    ? scheduleDate(startMonth, schedule.advanceCutoffDay)
    : scheduleDate(month, schedule.advanceCutoffDay);
  return {
    periodStart,
    advancePeriodEnd,
    periodEnd,
    advancePaymentDate: scheduleDate(month, schedule.advancePayDay),
    finalPaymentDate: scheduleDate(finalPaymentMonth, schedule.finalPayDay),
  };
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

export function shiftDailyRate(salary: Pick<SalaryHistoryRow, "salaryType" | "baseSalary" | "monthlyExpectedWorkDays">) {
  return salary.salaryType === "monthly"
    ? Number(salary.baseSalary) / Math.max(1, salary.monthlyExpectedWorkDays)
    : Number(salary.baseSalary);
}

export function weekdayDatesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let value = new Date(`${start}T00:00:00.000Z`); value <= new Date(`${end}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + 1)) {
    if (value.getUTCDay() >= 1 && value.getUTCDay() <= 5) dates.push(value.toISOString().slice(0, 10));
  }
  return dates;
}

export type SalaryHistoryRow = typeof employeeSalaryHistoryTable.$inferSelect;

export function salaryAt(employee: typeof employeesTable.$inferSelect, history: SalaryHistoryRow[], date: string) {
  return history
    .filter((row) => row.employeeId === employee.id && row.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? {
      employeeId: employee.id,
      effectiveFrom: employee.joinedAt,
      employeeType: employee.employeeType,
      salaryType: employee.salaryType === "hourly" ? "daily" : employee.salaryType,
      monthlyExpectedWorkDays: employee.monthlyExpectedWorkDays,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      payrollTaxExempt: employee.payrollTaxExempt,
      fullSalaryRegardlessAttendance: employee.fullSalaryRegardlessAttendance,
      payFrequency: employee.payFrequency,
    };
}

export type PayrollCalculationData = {
  allEmployees: Array<typeof employeesTable.$inferSelect>;
  salaryHistory: Array<typeof employeeSalaryHistoryTable.$inferSelect>;
  records: Array<typeof attendanceTable.$inferSelect>;
  allAdjustments: Array<typeof payrollAdjustmentsTable.$inferSelect>;
  allAdvanceApprovals: Array<typeof payrollAdvanceApprovalsTable.$inferSelect>;
};

export async function getPayrollSummary(month: string, existingData?: PayrollCalculationData) {
  const data = existingData ?? await (async () => {
    const [allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals] = await Promise.all([
      db.select().from(employeesTable),
      db.select().from(employeeSalaryHistoryTable),
      db.select().from(attendanceTable),
      db.select().from(payrollAdjustmentsTable),
      db.select().from(payrollAdvanceApprovalsTable),
    ]);
    return { allEmployees, salaryHistory, records, allAdjustments, allAdvanceApprovals };
  })();
  const { allEmployees, salaryHistory, records } = data;
  const rawSchedule = await getPayrollSchedule(month);
  const schedule = {
    effectiveFromMonth: rawSchedule.effectiveFromMonth,
    id: rawSchedule.id,
    periodStartDay: rawSchedule.periodStartDay,
    advanceCutoffDay: rawSchedule.advanceCutoffDay,
    periodEndDay: rawSchedule.periodEndDay,
    advancePayDay: rawSchedule.advancePayDay,
    finalPayDay: rawSchedule.finalPayDay,
  };
  const period = payrollPeriod(month, schedule);
  const adjustments = data.allAdjustments.filter((row) => row.month === month);
  const advanceApprovals = data.allAdvanceApprovals.filter((row) => row.month === month);
  const monthStart = period.periodStart;
  const monthEnd = period.periodEnd;
  const employees = allEmployees.filter((employee) =>
    employee.joinedAt <= monthEnd && (!employee.inactiveAt || employee.inactiveAt >= monthStart)
  );
  const previousMonthValue = previousMonth(month);
  const previousMonthEnd = `${previousMonthValue}-${String(daysInMonth(previousMonthValue)).padStart(2, "0")}`;
  const previousPayroll = allEmployees.some((employee) => employee.joinedAt <= previousMonthEnd)
    ? await getPayrollSummary(previousMonthValue, data)
    : null;
  const previousLineMap = new Map(previousPayroll?.lines.map((line) => [line.employeeId, line]) ?? []);
  const weekdays = weekdayDatesBetween(period.periodStart, period.periodEnd);
  const monthRecords = records.filter((record) => String(record.date) >= period.periodStart && String(record.date) <= period.periodEnd);
  const adjustmentMap = new Map(adjustments.map((adjustment) => [adjustment.employeeId, adjustment]));
  const approvedAdvanceLines = Array.isArray(advanceApprovals[0]?.lines)
    ? advanceApprovals[0].lines as Array<{ employeeId: number; advanceAmount: number; paid?: boolean }>
    : [];
  const paidAdvanceMap = new Map(
    approvedAdvanceLines
      .filter((line) => line.paid === true)
      .map((line) => [line.employeeId, Number(line.advanceAmount)]),
  );

  const lines = employees.map((employee) => {
    const employeeRecords = monthRecords.filter((record) => record.employeeId === employee.id);
    const daysWorked = employeeRecords.filter((record) =>
      ["present", "late"].includes(record.status),
    ).length;
    const hours = money(employeeRecords.reduce((total, record) => total + Number(record.hours), 0));
    const eligibleWeekdays = weekdays.filter((date) =>
      date >= employee.joinedAt && (!employee.inactiveAt || date <= employee.inactiveAt)
    );
    const paidWeekdays = employeeRecords.length === 0
      ? []
      : eligibleWeekdays.filter((date) =>
          !employeeRecords.some((record) => String(record.date) === date && record.status === "leave")
        );
    const workedRecords = employeeRecords
      .filter((record) =>
        ["present", "late"].includes(record.status)
        && String(record.date) >= employee.joinedAt
        && (!employee.inactiveAt || String(record.date) <= employee.inactiveAt)
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const excessWorkedDayCount = Math.max(0, workedRecords.length - eligibleWeekdays.length);
    const excessWorkedRecords = workedRecords
      .filter((record) => !eligibleWeekdays.includes(String(record.date)))
      .slice(0, excessWorkedDayCount);
    const officeSalaryDates = eligibleWeekdays.filter((date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return salary.fullSalaryRegardlessAttendance || paidWeekdays.includes(date);
    });
    const officeGross = officeSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.employeeType === "office" ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0) + excessWorkedRecords.reduce((total, record) => {
      const salary = salaryAt(employee, salaryHistory, String(record.date));
      return total + (salary.employeeType === "office" && !salary.fullSalaryRegardlessAttendance ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0);
    const fullShiftGross = eligibleWeekdays.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
        return total + (salary.employeeType === "shift" && salary.fullSalaryRegardlessAttendance
          ? (salary.salaryType === "monthly" ? Number(salary.baseSalary) : Number(salary.baseSalary) * salary.monthlyExpectedWorkDays) / weekdays.length
        : 0);
    }, 0);
    const attendedShiftGross = employeeRecords
      .filter((record) => ["present", "late"].includes(record.status))
      .reduce((total, record) => {
        const salary = salaryAt(employee, salaryHistory, String(record.date));
        return total + (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance
          ? salary.salaryType === "monthly"
            ? Number(salary.baseSalary) / Math.max(1, salary.monthlyExpectedWorkDays)
            : Number(salary.baseSalary)
          : 0);
      }, 0);
    const gross = money(officeGross + fullShiftGross + attendedShiftGross);
    const insuredSalaryDates = eligibleWeekdays.filter((date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return salary.fullSalaryRegardlessAttendance || paidWeekdays.includes(date);
    });
    const socialInsuranceSalary = money(insuredSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.payrollTaxExempt ? 0 : Number(salary.socialInsuranceSalary) / weekdays.length);
    }, 0) + excessWorkedRecords.reduce((total, record) => {
      const salary = salaryAt(employee, salaryHistory, String(record.date));
      return total + (salary.payrollTaxExempt || salary.fullSalaryRegardlessAttendance ? 0 : Number(salary.socialInsuranceSalary) / weekdays.length);
    }, 0));
    const payrollTaxExempt = socialInsuranceSalary === 0;
    const socialInsurance = payrollTaxExempt ? 0 : money(socialInsuranceSalary * 0.115);
    const taxableIncome = payrollTaxExempt ? 0 : money(Math.max(0, socialInsuranceSalary - socialInsurance));
    const adjustment = adjustmentMap.get(employee.id);
    const calculatedIncomeTax = payrollTaxExempt ? 0 : money(taxableIncome * 0.1);
    const taxRelief = payrollTaxExempt ? 0 : monthlyIncomeTaxRelief(socialInsuranceSalary);
    const incomeTax = payrollTaxExempt ? 0 : money(Math.max(0, calculatedIncomeTax - taxRelief));
    const advanceAmount = money(paidAdvanceMap.get(employee.id) ?? 0);
    const manualDeduction = money(Number(adjustment?.manualDeduction ?? 0));
    const firstPaidAmount = money(Number(adjustment?.paidAmount ?? 0));
    const secondPaidAmount = money(Number(adjustment?.secondPaidAmount ?? 0));
    const paidAmount = money(firstPaidAmount + secondPaidAmount);
    const deductions = money(socialInsurance + incomeTax + advanceAmount + manualDeduction);
    const carryoverAmount = money(previousLineMap.get(employee.id)?.balanceAmount ?? 0);
    const payableBeforePayment = money(gross - deductions + carryoverAmount);
    const payable = money(Math.max(0, payableBeforePayment));
    const rawBalanceAmount = payableBeforePayment - paidAmount;
    const balanceAmount = money(Math.abs(rawBalanceAmount) <= 1 ? 0 : rawBalanceAmount);
    const remainingAmount = money(Math.max(0, balanceAmount));
    const overpaidAmount = money(Math.max(0, -balanceAmount));
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      role: employee.role,
      employeeType: employee.employeeType,
      daysWorked,
      hours,
      gross,
      socialInsuranceSalary,
      socialInsurance,
      taxableIncome,
      calculatedIncomeTax,
      taxRelief,
      incomeTax,
      advanceAmount,
      manualDeduction,
      deductions,
      carryoverAmount,
      payable,
      paidAmount,
      paymentDate: adjustment?.paymentDate ?? null,
      secondPaidAmount,
      secondPaymentDate: adjustment?.secondPaymentDate ?? null,
      remainingAmount,
      overpaidAmount,
      balanceAmount,
      net: payable,
    };
  });

  return {
    month,
    periodStart: period.periodStart,
    advancePeriodEnd: period.advancePeriodEnd,
    periodEnd: period.periodEnd,
    advancePaymentDate: period.advancePaymentDate,
    finalPaymentDate: period.finalPaymentDate,
    schedule,
    totalGross: money(lines.reduce((total, line) => total + line.gross, 0)),
    totalSocialInsurance: money(lines.reduce((total, line) => total + line.socialInsurance, 0)),
    totalIncomeTax: money(lines.reduce((total, line) => total + line.incomeTax, 0)),
    totalDeductions: money(lines.reduce((total, line) => total + line.deductions, 0)),
    totalNet: money(lines.reduce((total, line) => total + line.net, 0)),
    lines,
  };
}

export async function getPayrollAdvanceSummary(month: string) {
  const rawSchedule = await getPayrollSchedule(month);
  const schedule = {
    effectiveFromMonth: rawSchedule.effectiveFromMonth,
    id: rawSchedule.id,
    periodStartDay: rawSchedule.periodStartDay,
    advanceCutoffDay: rawSchedule.advanceCutoffDay,
    periodEndDay: rawSchedule.periodEndDay,
    advancePayDay: rawSchedule.advancePayDay,
    finalPayDay: rawSchedule.finalPayDay,
  };
  const period = payrollPeriod(month, schedule);
  const [approval] = await db
    .select()
    .from(payrollAdvanceApprovalsTable)
    .where(eq(payrollAdvanceApprovalsTable.month, month));
  if (approval) {
    const lines = Array.isArray(approval.lines)
      ? (approval.lines as Array<Record<string, unknown>>).map((line) => ({
          ...line,
          paid: line.paid === true,
          paymentDate: typeof line.paymentDate === "string" ? line.paymentDate : null,
        }))
      : [];
    return {
      month,
      periodStart: period.periodStart,
      advancePeriodEnd: period.advancePeriodEnd,
      periodEnd: period.periodEnd,
      advancePaymentDate: period.advancePaymentDate,
      finalPaymentDate: period.finalPaymentDate,
      schedule,
      approved: true,
      approvalDate: approval.approvalDate,
      approvedAt: approval.approvedAt.toISOString(),
      totalAmount: Number(approval.totalAmount),
      lines,
    };
  }
  const [allEmployees, records, salaryHistory] = await Promise.all([
    db.select().from(employeesTable),
    db.select().from(attendanceTable),
    db.select().from(employeeSalaryHistoryTable),
  ]);
  const employees = allEmployees.filter((employee) =>
    employee.joinedAt <= period.advancePeriodEnd
    && (!employee.inactiveAt || employee.inactiveAt >= period.periodStart)
    && salaryAt(employee, salaryHistory, period.advancePeriodEnd).payFrequency === "twice",
  );
  const firstHalfRecords = records.filter((record) =>
    String(record.date) >= period.periodStart && String(record.date) <= period.advancePeriodEnd
  );
  const lines = employees.map((employee) => calculatePayrollAdvanceLine(
    employee,
    firstHalfRecords,
    salaryHistory,
    period.periodStart,
    period.periodEnd,
    period.advancePeriodEnd,
  ));
  return {
    month,
    periodStart: period.periodStart,
    advancePeriodEnd: period.advancePeriodEnd,
    periodEnd: period.periodEnd,
    advancePaymentDate: period.advancePaymentDate,
    finalPaymentDate: period.finalPaymentDate,
    schedule,
    approved: false,
    approvalDate: null,
    totalAmount: money(lines.reduce((total, line) => total + line.advanceAmount, 0)),
    lines,
  };
}

export function calculatePayrollAdvanceLine(
  employee: typeof employeesTable.$inferSelect,
  records: Array<typeof attendanceTable.$inferSelect>,
  salaryHistory: SalaryHistoryRow[] = [],
  periodStart?: string,
  periodEnd?: string,
  advancePeriodEnd?: string,
) {
  const attendedRecords = records.filter((record) =>
    record.employeeId === employee.id
    && ["present", "late"].includes(record.status)
    && (!periodStart || String(record.date) >= periodStart)
    && (!advancePeriodEnd || String(record.date) <= advancePeriodEnd),
  );
  const daysWorked = attendedRecords.length;
  const salaryFor = (date: string) => salaryAt(employee, salaryHistory, date);
  const firstSalary = salaryFor(
    attendedRecords[0] ? String(attendedRecords[0].date) : (advancePeriodEnd ?? employee.joinedAt),
  );
  const officeSalary = salaryFor(advancePeriodEnd ?? employee.joinedAt);
  const effectiveEmployeeType = officeSalary.employeeType;
  const dailySalary = effectiveEmployeeType === "shift"
      ? money(shiftDailyRate(firstSalary))
    : 0;
  const totalSalary = effectiveEmployeeType === "shift"
    ? money(attendedRecords.reduce((total, record) => {
      const salary = salaryFor(String(record.date));
      const rate = shiftDailyRate(salary);
      return total + rate;
    }, 0))
    : money(Number(officeSalary.baseSalary));
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType: effectiveEmployeeType,
    baseSalary: money(Number(officeSalary.baseSalary)),
    daysWorked,
    dailySalary,
    totalSalary,
    advanceAmount: effectiveEmployeeType === "shift" ? totalSalary : money(totalSalary * 0.5),
    paid: false,
    paymentDate: null,
  };
}

export class InventoryInsufficientStockError extends Error {}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = Tx | typeof db;

/**
 * Reads available purchase lots for an item oldest-first (locking them for the
 * rest of this transaction) and works out which lot(s) an issue of `quantity`
 * would draw from. Read-only -- writes nothing. Returns null if the eligible
 * lots don't cover the requested quantity.
 */
export async function planInventoryFifoConsumption(tx: Tx, inventoryItemId: number, quantity: number) {
  const lots = await tx
    .select({
      id: inventoryPurchaseItemsTable.id,
      remainingQuantity: inventoryPurchaseItemsTable.remainingQuantity,
      unitPrice: inventoryPurchaseItemsTable.unitPrice,
    })
    .from(inventoryPurchaseItemsTable)
    .innerJoin(inventoryPurchasesTable, eq(inventoryPurchaseItemsTable.purchaseId, inventoryPurchasesTable.id))
    .where(and(
      eq(inventoryPurchaseItemsTable.inventoryItemId, inventoryItemId),
      gt(inventoryPurchaseItemsTable.remainingQuantity, 0),
    ))
    .orderBy(inventoryPurchasesTable.date, inventoryPurchaseItemsTable.id)
    .for("update");
  let remaining = quantity;
  const consumptions: Array<{ purchaseItemId: number; quantity: number; unitPrice: number }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.remainingQuantity), remaining);
    if (take <= 0) continue;
    consumptions.push({ purchaseItemId: lot.id, quantity: take, unitPrice: Number(lot.unitPrice) });
    remaining = money(remaining - take);
  }
  if (remaining > 0.0005) return null;
  return consumptions;
}

/** Writes a plan from planInventoryFifoConsumption: draws down the lots, records the
 * consumption ledger, and decrements the item's total quantity. Returns the FIFO cost. */
export async function applyInventoryFifoConsumption(
  tx: Tx,
  issueId: number,
  inventoryItemId: number,
  consumptions: Array<{ purchaseItemId: number; quantity: number; unitPrice: number }>,
) {
  for (const consumption of consumptions) {
    await tx.update(inventoryPurchaseItemsTable)
      .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} - ${consumption.quantity}` })
      .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
  }
  if (consumptions.length > 0) {
    await tx.insert(inventoryIssueConsumptionsTable).values(
      consumptions.map((consumption) => ({ issueId, ...consumption })),
    );
  }
  const totalQuantity = money(consumptions.reduce((total, consumption) => total + consumption.quantity, 0));
  await tx.update(inventoryItemsTable)
    .set({ quantity: sql`${inventoryItemsTable.quantity} - ${totalQuantity}` })
    .where(eq(inventoryItemsTable.id, inventoryItemId));
  return money(consumptions.reduce((total, consumption) => total + consumption.quantity * consumption.unitPrice, 0));
}

/** Undoes a previous applyInventoryFifoConsumption for this issue: adds the
 * consumed quantity back to its original lots and to the item's total, then
 * clears the consumption ledger for this issue. */
export async function reverseInventoryFifoConsumption(tx: Tx, issueId: number, inventoryItemId: number) {
  const consumptions = await tx.select().from(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
  for (const consumption of consumptions) {
    await tx.update(inventoryPurchaseItemsTable)
      .set({ remainingQuantity: sql`${inventoryPurchaseItemsTable.remainingQuantity} + ${consumption.quantity}` })
      .where(eq(inventoryPurchaseItemsTable.id, consumption.purchaseItemId));
  }
  const totalQuantity = money(consumptions.reduce((total, consumption) => total + Number(consumption.quantity), 0));
  if (totalQuantity > 0) {
    await tx.update(inventoryItemsTable)
      .set({ quantity: sql`${inventoryItemsTable.quantity} + ${totalQuantity}` })
      .where(eq(inventoryItemsTable.id, inventoryItemId));
  }
  await tx.delete(inventoryIssueConsumptionsTable).where(eq(inventoryIssueConsumptionsTable.issueId, issueId));
}

export async function inventoryPurchaseResponse(id: number) {
  const [row] = await db.select({
    purchase: inventoryPurchasesTable,
    accountCode: chartOfAccountsTable.code,
    accountName: chartOfAccountsTable.name,
  }).from(inventoryPurchasesTable)
    .leftJoin(chartOfAccountsTable, eq(inventoryPurchasesTable.accountId, chartOfAccountsTable.id))
    .where(eq(inventoryPurchasesTable.id, id));
  if (!row) return null;
  const purchase = row.purchase;
  const [items, closure] = await Promise.all([
    db.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id)),
    db.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, purchase.date)),
  ]);
  return {
    id: purchase.id,
    materialType: purchase.materialType,
    accountId: purchase.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    supplierName: purchase.documentName,
    hasReceipt: purchase.hasReceipt,
    date: purchase.date,
    totalAmount: Number(purchase.totalAmount),
    paid: purchase.paymentDate !== null,
    paymentDate: purchase.paymentDate,
    paymentAmount: purchase.paymentAmount === null ? null : Number(purchase.paymentAmount),
    createdAt: purchase.createdAt.toISOString(),
    editable: closure.length === 0,
    items: items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalAmount: Number(item.totalAmount),
    })),
  };
}
