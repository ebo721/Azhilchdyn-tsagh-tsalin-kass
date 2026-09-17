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
} from "@workspace/db";
import { getStaffRole, getStaffSession, type StaffRole } from "../lib/hr-session.js";
import { planPayrollAdvancePayment } from "../lib/payroll-advance-payment.js";
import { planShiftPlanCopy } from "../lib/shift-plan-copy.js";
import { reconcileOperatingExpenses } from "../lib/operating-expense-sync.js";

const router: IRouter = Router();

/**
 * Re-enters this router for an admin-approved deletion, the same way the original
 * request would have, but without hopping over the network to `127.0.0.1:PORT` —
 * that assumed a long-running server on a known port, which doesn't exist in a
 * serverless function (each invocation is isolated and PORT isn't set). Instead we
 * spin up a throwaway HTTP server bound to this router only for the duration of
 * this one call, so the exact same DELETE handlers and the header-based approval
 * check above run unchanged, in-process, on a loopback port the OS assigns us.
 */
function dispatchApprovedDeletion(
  targetPath: string,
  cookie: string,
  requestId: number,
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      router(req as never, res as never, (err?: unknown) => {
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

async function isCashDateClosed(date: string) {
  const [closure] = await db
    .select({ id: cashClosuresTable.id })
    .from(cashClosuresTable)
    .where(eq(cashClosuresTable.date, date));
  return Boolean(closure);
}

function operatingExpenseResponse(row: typeof operatingExpensesTable.$inferSelect) {
  return { ...row, date: String(row.date), amount: Number(row.amount), paymentDate: row.paymentDate ? String(row.paymentDate) : null,
    paymentAmount: row.paymentAmount === null ? null : Number(row.paymentAmount), bankTransactionId: row.bankTransactionId,
    cashTransactionId: row.cashTransactionId, createdAt: String(row.createdAt) };
}

const inventoryMaterialLabel = (materialType: string) =>
  materialType === "food" ? "Хүнсний бараа материал" : "Хангамжийн материал";

const defaultChartOfAccounts = [
  { code: "1000", name: "Бэлэн мөнгө (касс)", type: "asset" },
  { code: "1010", name: "Банкны данс", type: "asset" },
  { code: "1200", name: "Авлага", type: "asset" },
  { code: "1500", name: "Бараа материалын үлдэгдэл", type: "asset" },
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

const chartOfAccountResponse = (row: typeof chartOfAccountsTable.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

router.use(async (req, res, next) => {
  const session = await getStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    return;
  }
  if (req.path === "/chart-of-accounts" || req.path.startsWith("/chart-of-accounts/")) {
    if (req.method === "GET" || session.role === "admin") {
      next();
      return;
    }
    res.status(403).json({ error: "Дансны төлөвлөгөөг зөвхөн админ өөрчилнө" });
    return;
  }
  if (req.method === "POST" && req.path === "/deletion-requests") {
    next();
    return;
  }
  if (req.method === "DELETE" && session.role === "admin") {
    next();
    return;
  }
  if (req.method === "DELETE") {
    const requestId = Number(req.header("x-deletion-request-id"));
    if (!Number.isInteger(requestId)) {
      res.status(403).json({ error: "Устгах үйлдэлд админы баталсан хүсэлт шаардлагатай" });
      return;
    }
    void db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.id, requestId)).then(([request]) => {
      if (!request || request.status !== "executing" || request.targetPath !== req.url) {
        res.status(403).json({ error: "Устгах хүсэлт хүчинтэй биш байна" });
        return;
      }
      next();
    }).catch(next);
    return;
  }
  const role = session.role as StaffRole;
  if (role === "admin") {
    next();
    return;
  }
  const viewerReadPrefixes = ["/employees", "/attendance", "/hour-balance", "/payroll", "/payroll-advance", "/cash", "/bank-transactions", "/inventory", "/fixed-assets", "/operating-expenses"];
  if (role === "viewer" && req.method === "GET" && viewerReadPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    next();
    return;
  }
  if (role === "accountant" && (
    (req.method === "GET" && req.path === "/employees")
    || (req.method === "PATCH" && req.path.startsWith("/employees/"))
    || req.path.startsWith("/operating-expenses")
  )) {
    next();
    return;
  }
  if (req.method === "DELETE" && req.path.startsWith("/employees/")) {
    res.status(403).json({ error: "Ажилтан устгах зөвшөөрлийг зөвхөн ерөнхий админ өгнө" });
    return;
  }
  const allowedPrefixes = role === "hr"
    ? ["/employees", "/attendance", "/hour-balance"]
      : role === "accountant"
        ? ["/hour-balance", "/payroll", "/cash", "/bank-transactions"]
      : role === "warehouse"
        ? ["/inventory", "/fixed-assets", "/operating-expenses"]
        : [];
  if (allowedPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    next();
    return;
  }
  res.status(403).json({ error: "Энэ хэсэгт хандах эрхгүй" });
});

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);
const money = (value: number) => Math.round(value * 100) / 100;
class InventoryBankPaymentConflictError extends Error {}
class OperatingExpenseBankPaymentConflictError extends Error {}
const calendarDateOffset = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
};
const descriptionTokens = (value: string) => new Set(value.toLocaleLowerCase("mn-MN").match(/[\p{L}\p{N}]+/gu) ?? []);
const inventoryBankSuggestionScore = (
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
const deletionTargetPatterns = [
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
const roleCanRequestDeletion = (role: StaffRole, targetPath: string) => role === "admin"
  || (role === "hr" && (targetPath.startsWith("/employees/") || targetPath.startsWith("/attendance")))
  || (role === "accountant" && (targetPath.startsWith("/payroll-advance/") || targetPath.startsWith("/payroll-adjustments/") || targetPath.startsWith("/bank-transactions/")))
  || (role === "warehouse" && (targetPath.startsWith("/inventory/") || targetPath.startsWith("/fixed-assets/")));
const deletionRequestResponse = (request: typeof deletionRequestsTable.$inferSelect) => ({
  ...request,
  requestedAt: request.requestedAt.toISOString(),
  approvedAt: request.approvedAt?.toISOString() ?? null,
  completedAt: request.completedAt?.toISOString() ?? null,
});
const monthlyIncomeTaxRelief = (socialInsuranceSalary: number) => {
  if (socialInsuranceSalary <= 500_000) return 20_000;
  if (socialInsuranceSalary <= 1_000_000) return 18_000;
  if (socialInsuranceSalary <= 1_500_000) return 16_000;
  if (socialInsuranceSalary <= 2_000_000) return 14_000;
  if (socialInsuranceSalary <= 2_500_000) return 12_000;
  if (socialInsuranceSalary <= 3_000_000) return 10_000;
  return 0;
};

function hoursBetween(clockIn: string, clockOut: string) {
  const [inHour, inMinute] = clockIn.split(":").map(Number);
  const [outHour, outMinute] = clockOut.split(":").map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  return Math.max(0, money((end - start) / 60));
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function isValidCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function calendarDateText(value: string | Date) {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function weekdayCount(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) count += 1;
  }
  return count;
}

function monthWeekdays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) dates.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

type SalaryHistoryRow = typeof employeeSalaryHistoryTable.$inferSelect;

function salaryAt(employee: typeof employeesTable.$inferSelect, history: SalaryHistoryRow[], date: string) {
  return history
    .filter((row) => row.employeeId === employee.id && row.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? {
      employeeId: employee.id,
      effectiveFrom: employee.joinedAt,
      employeeType: employee.employeeType,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      payrollTaxExempt: employee.payrollTaxExempt,
      fullSalaryRegardlessAttendance: employee.fullSalaryRegardlessAttendance,
    };
}

type PayrollCalculationData = {
  allEmployees: Array<typeof employeesTable.$inferSelect>;
  salaryHistory: Array<typeof employeeSalaryHistoryTable.$inferSelect>;
  records: Array<typeof attendanceTable.$inferSelect>;
  allAdjustments: Array<typeof payrollAdjustmentsTable.$inferSelect>;
  allAdvanceApprovals: Array<typeof payrollAdvanceApprovalsTable.$inferSelect>;
};

async function getPayrollSummary(month: string, existingData?: PayrollCalculationData) {
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
  const adjustments = data.allAdjustments.filter((row) => row.month === month);
  const advanceApprovals = data.allAdvanceApprovals.filter((row) => row.month === month);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const employees = allEmployees.filter((employee) =>
    employee.joinedAt <= monthEnd && (!employee.inactiveAt || employee.inactiveAt >= monthStart)
  );
  const previousMonthValue = previousMonth(month);
  const previousMonthEnd = `${previousMonthValue}-${String(daysInMonth(previousMonthValue)).padStart(2, "0")}`;
  const previousPayroll = allEmployees.some((employee) => employee.joinedAt <= previousMonthEnd)
    ? await getPayrollSummary(previousMonthValue, data)
    : null;
  const previousLineMap = new Map(previousPayroll?.lines.map((line) => [line.employeeId, line]) ?? []);
  const weekdays = monthWeekdays(month);
  const monthRecords = records.filter((record) => String(record.date).startsWith(month));
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
        ? Number(salary.baseSalary) * employee.monthlyExpectedWorkDays / weekdays.length
        : 0);
    }, 0);
    const attendedShiftGross = employeeRecords
      .filter((record) => ["present", "late"].includes(record.status))
      .reduce((total, record) => {
        const salary = salaryAt(employee, salaryHistory, String(record.date));
        return total + (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance ? Number(salary.baseSalary) : 0);
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
    totalGross: money(lines.reduce((total, line) => total + line.gross, 0)),
    totalSocialInsurance: money(lines.reduce((total, line) => total + line.socialInsurance, 0)),
    totalIncomeTax: money(lines.reduce((total, line) => total + line.incomeTax, 0)),
    totalDeductions: money(lines.reduce((total, line) => total + line.deductions, 0)),
    totalNet: money(lines.reduce((total, line) => total + line.net, 0)),
    lines,
  };
}

async function getPayrollAdvanceSummary(month: string) {
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
      approved: true,
      approvalDate: approval.approvalDate,
      approvedAt: approval.approvedAt.toISOString(),
      totalAmount: Number(approval.totalAmount),
      lines,
    };
  }
  const [employees, records] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
    db.select().from(attendanceTable),
  ]);
  const firstHalfRecords = records.filter((record) =>
    String(record.date).startsWith(month) && Number(String(record.date).slice(8, 10)) <= 15
  );
  const lines = employees.map((employee) => calculatePayrollAdvanceLine(employee, firstHalfRecords));
  return {
    month,
    approved: false,
    approvalDate: null,
    totalAmount: money(lines.reduce((total, line) => total + line.advanceAmount, 0)),
    lines,
  };
}

function calculatePayrollAdvanceLine(
  employee: typeof employeesTable.$inferSelect,
  records: Array<typeof attendanceTable.$inferSelect>,
) {
  const daysWorked = records.filter((record) =>
    record.employeeId === employee.id && ["present", "late"].includes(record.status)
  ).length;
  const dailySalary = employee.employeeType === "shift" ? money(Number(employee.baseSalary)) : 0;
  const baseSalary = employee.employeeType === "office" ? money(Number(employee.baseSalary)) : 0;
  const totalSalary = employee.employeeType === "shift"
    ? money(daysWorked * dailySalary)
    : baseSalary;
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType: employee.employeeType,
    baseSalary,
    daysWorked,
    dailySalary,
    totalSalary,
    advanceAmount: employee.employeeType === "shift" ? totalSalary : money(totalSalary * 0.5),
    paid: false,
    paymentDate: null,
  };
}

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [employees, transactions, inventoryPurchases, fixedAssets] = await Promise.all([
      db.select().from(employeesTable),
      db.select().from(cashTransactionsTable).where(isNull(cashTransactionsTable.unclearAt)).orderBy(desc(cashTransactionsTable.createdAt)),
      db.select().from(inventoryPurchasesTable),
      db.select().from(fixedAssetsTable),
    ]);
    const previousMonthValue = previousMonth(currentMonth());
    const previousMonthSalesIncome = transactions
      .filter((transaction) => transaction.incomeMonth === previousMonthValue && transaction.type === "income")
      .reduce((total, transaction) => total + Number(transaction.amount), 0);
    const previousMonthPayrollExpense = transactions
      .filter((transaction) => transaction.type === "expense"
        && (transaction.sourceType === "payroll" || transaction.sourceType === "payroll_advance")
        && transaction.sourceKey?.startsWith(`${previousMonthValue}:`))
      .reduce((total, transaction) => total + Number(transaction.amount), 0);
    const previousMonthInventoryExpense = inventoryPurchases
      .filter((purchase) => purchase.date.startsWith(previousMonthValue))
      .reduce((total, purchase) => total + Number(purchase.totalAmount), 0);
    const recentCash = transactions.slice(0, 3).map((transaction) => ({
      id: `cash-${transaction.id}`,
      type: "cash",
      title: transaction.type === "income" ? "Орлого бүртгэгдлээ" : "Зарлага бүртгэгдлээ",
      detail: `${transaction.description} · ${money(Number(transaction.amount)).toLocaleString()}₮`,
      createdAt: String(transaction.createdAt),
    }));
    const recentInventoryPurchases = inventoryPurchases.map((purchase) => ({
      id: `inventory-purchase-${purchase.id}`,
      type: "inventory_purchase",
      title: "Бараа материал худалдан авлаа",
      detail: `${purchase.documentName} · ${money(Number(purchase.totalAmount)).toLocaleString()}₮`,
      createdAt: String(purchase.createdAt),
    }));
    const recentFixedAssets = fixedAssets
      .filter((asset) => asset.purchased)
      .map((asset) => ({
        id: `fixed-asset-${asset.id}`,
        type: "fixed_asset_purchase",
        title: "Эд хөрөнгө худалдан авлаа",
        detail: `${asset.name} · ${asset.quantity} ш · ${money(Number(asset.unitPrice) * asset.quantity).toLocaleString()}₮`,
        createdAt: String(asset.createdAt),
      }));
    const data = GetDashboardResponse.parse({
      employeeCount: employees.filter((employee) => employee.status === "active").length,
      previousMonthSalesIncome: money(previousMonthSalesIncome),
      previousMonthPayrollExpense: money(previousMonthPayrollExpense),
      previousMonthInventoryExpense: money(previousMonthInventoryExpense),
      recentActivity: [...recentCash, ...recentInventoryPurchases, ...recentFixedAssets]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/employees", async (_req, res, next) => {
  try {
    const rows = await db.select().from(employeesTable).orderBy(desc(employeesTable.id));
    res.json(ListEmployeesResponse.parse(rows.map((employee) => ({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      joinedAt: String(employee.joinedAt),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/employees", async (req, res, next) => {
  try {
    const input = CreateEmployeeBody.parse(req.body);
    const session = await getStaffSession(req);
    if (input.fullSalaryRegardlessAttendance === true && session?.role !== "admin") {
      res.status(403).json({ error: "Цалинг бүтэн бодох тусгай тохиргоог зөвхөн админ өөрчилнө" });
      return;
    }
    const joinedAt = calendarDateText(input.joinedAt);
    if (!isValidCalendarDate(joinedAt)) {
      res.status(400).json({ error: "Ажилд орсон огноо буруу байна" });
      return;
    }
    const employee = await db.transaction(async (tx) => {
      const [created] = await tx.insert(employeesTable).values({
        ...input,
        joinedAt,
        salaryType: input.employeeType === "shift" ? "hourly" : "monthly",
      }).returning();
      await tx.insert(employeeSalaryHistoryTable).values({
        employeeId: created.id,
        effectiveFrom: joinedAt,
        employeeType: input.employeeType,
        baseSalary: input.baseSalary,
        socialInsuranceSalary: input.socialInsuranceSalary,
        payrollTaxExempt: input.payrollTaxExempt,
        fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance ?? false,
      });
      return created;
    });
    res.status(201).json({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/employees/:id", async (req, res, next) => {
  try {
    const { id } = UpdateEmployeeParams.parse(req.params);
    const input = UpdateEmployeeBody.parse(req.body);
    const session = await getStaffSession(req);
    if (input.fullSalaryRegardlessAttendance !== undefined && session?.role !== "admin") {
      res.status(403).json({ error: "Цалинг бүтэн бодох тусгай тохиргоог зөвхөн админ өөрчилнө" });
      return;
    }
    const [current] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    if (!current) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const joinedAt = input.joinedAt ? calendarDateText(input.joinedAt) : undefined;
    const salaryEffectiveDate = input.salaryEffectiveDate ? calendarDateText(input.salaryEffectiveDate) : undefined;
    if (joinedAt && !isValidCalendarDate(joinedAt)) {
      res.status(400).json({ error: "Ажилд орсон огноо буруу байна" });
      return;
    }
    if (input.status === "inactive" && (!input.inactiveAt || !isValidCalendarDate(input.inactiveAt))) {
      res.status(400).json({ error: "Идэвхгүй болсон огноог сонгоно уу" });
      return;
    }
    const effectiveJoinedAt = joinedAt ?? current.joinedAt;
    const salaryHistory = await db.select().from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, id))
      .orderBy(employeeSalaryHistoryTable.effectiveFrom);
    const baselineSalary = salaryHistory[0];
    const nextSalary = salaryHistory[1];
    const joinedAtChanged = joinedAt !== undefined && joinedAt !== String(current.joinedAt);
    if (input.status === "inactive" && input.inactiveAt && input.inactiveAt < effectiveJoinedAt) {
      res.status(400).json({ error: "Идэвхгүй болсон огноо ажилд орсон огнооноос өмнө байж болохгүй" });
      return;
    }
    const salaryChanged = (input.employeeType !== undefined && input.employeeType !== current.employeeType)
      || (input.baseSalary !== undefined && Number(input.baseSalary) !== Number(current.baseSalary))
      || (input.socialInsuranceSalary !== undefined
        && Number(input.socialInsuranceSalary) !== (current.payrollTaxExempt ? 0 : Number(current.socialInsuranceSalary)))
      || (input.payrollTaxExempt !== undefined && input.payrollTaxExempt !== current.payrollTaxExempt)
      || (input.fullSalaryRegardlessAttendance !== undefined && input.fullSalaryRegardlessAttendance !== current.fullSalaryRegardlessAttendance);
    const correctingInitialEmployment = joinedAtChanged
      && baselineSalary
      && String(baselineSalary.effectiveFrom) === String(current.joinedAt)
      && (!salaryEffectiveDate || salaryEffectiveDate === joinedAt);
    if (joinedAtChanged && nextSalary && joinedAt! >= String(nextSalary.effectiveFrom)) {
      res.status(409).json({ error: `Ажилд орсон огноо дараагийн цалингийн огноо ${String(nextSalary.effectiveFrom)}-с өмнө байх ёстой` });
      return;
    }
    if (salaryChanged && !correctingInitialEmployment && (!salaryEffectiveDate || !isValidCalendarDate(salaryEffectiveDate))) {
      res.status(400).json({ error: "Цалин өөрчлөгдөх огноог сонгоно уу" });
      return;
    }
    if (salaryEffectiveDate && salaryEffectiveDate < effectiveJoinedAt) {
      res.status(400).json({ error: "Цалин өөрчлөгдөх огноо ажилд орсон огнооноос өмнө байж болохгүй" });
      return;
    }
    if (salaryChanged && salaryEffectiveDate && !correctingInitialEmployment) {
      const [latestSalary] = await db.select({ effectiveFrom: employeeSalaryHistoryTable.effectiveFrom })
        .from(employeeSalaryHistoryTable)
        .where(eq(employeeSalaryHistoryTable.employeeId, id))
        .orderBy(desc(employeeSalaryHistoryTable.effectiveFrom))
        .limit(1);
      if (latestSalary && salaryEffectiveDate <= String(latestSalary.effectiveFrom)) {
        res.status(409).json({
          error: `Шинэ цалингийн огноо ${String(latestSalary.effectiveFrom)}-с хойш байх ёстой. Өмнөх цалинг залруулах бол цалингийн түүхийн мөрийг засна уу`,
        });
        return;
      }
    }
    const { salaryEffectiveDate: _salaryEffectiveDate, joinedAt: _joinedAt, ...employeeInput } = input;
    const employee = await db.transaction(async (tx) => {
      const [updated] = await tx.update(employeesTable)
        .set({
          ...employeeInput,
          ...(joinedAt ? { joinedAt } : {}),
          ...(employeeInput.status === "active" ? { inactiveAt: null } : {}),
          ...(employeeInput.employeeType ? { salaryType: employeeInput.employeeType === "shift" ? "hourly" : "monthly" } : {}),
        })
        .where(eq(employeesTable.id, id))
        .returning();
      if (salaryChanged && (salaryEffectiveDate || correctingInitialEmployment)) {
        if (correctingInitialEmployment && baselineSalary) {
          await tx.update(employeeSalaryHistoryTable).set({
            effectiveFrom: joinedAt!,
            employeeType: employeeInput.employeeType ?? current.employeeType,
            baseSalary: employeeInput.baseSalary ?? Number(current.baseSalary),
            socialInsuranceSalary: employeeInput.socialInsuranceSalary ?? Number(current.socialInsuranceSalary),
            payrollTaxExempt: employeeInput.payrollTaxExempt ?? current.payrollTaxExempt,
            fullSalaryRegardlessAttendance: employeeInput.fullSalaryRegardlessAttendance ?? current.fullSalaryRegardlessAttendance,
          }).where(eq(employeeSalaryHistoryTable.id, baselineSalary.id));
        } else {
          await tx.insert(employeeSalaryHistoryTable).values({
            employeeId: id,
            effectiveFrom: salaryEffectiveDate!,
            employeeType: employeeInput.employeeType ?? current.employeeType,
            baseSalary: employeeInput.baseSalary ?? Number(current.baseSalary),
            socialInsuranceSalary: employeeInput.socialInsuranceSalary ?? Number(current.socialInsuranceSalary),
            payrollTaxExempt: employeeInput.payrollTaxExempt ?? current.payrollTaxExempt,
            fullSalaryRegardlessAttendance: employeeInput.fullSalaryRegardlessAttendance ?? current.fullSalaryRegardlessAttendance,
          });
        }
      } else if (joinedAtChanged && baselineSalary) {
        await tx.update(employeeSalaryHistoryTable)
          .set({ effectiveFrom: joinedAt! })
          .where(eq(employeeSalaryHistoryTable.id, baselineSalary.id));
      }
      return updated;
    });
    res.json({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      joinedAt: String(employee.joinedAt),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/salary-history", async (req, res, next) => {
  try {
    const { id } = ListEmployeeSalaryHistoryParams.parse(req.params);
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, id));
    if (!employee) {
      res.status(404).json({ error: "Ажилтан олдсонгүй" });
      return;
    }
    const rows = await db.select().from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, id))
      .orderBy(desc(employeeSalaryHistoryTable.effectiveFrom));
    res.json(ListEmployeeSalaryHistoryResponse.parse(rows.map((row) => ({
      ...row,
      baseSalary: Number(row.baseSalary),
      socialInsuranceSalary: Number(row.socialInsuranceSalary),
      effectiveFrom: String(row.effectiveFrom),
      createdAt: row.createdAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.patch("/employees/:id/salary-history/:historyId", async (req, res, next) => {
  try {
    const { id, historyId } = UpdateEmployeeSalaryHistoryParams.parse(req.params);
    const input = UpdateEmployeeSalaryHistoryBody.parse(req.body);
    const session = await getStaffSession(req);
    if (input.fullSalaryRegardlessAttendance !== undefined && session?.role !== "admin") {
      res.status(403).json({ error: "Цалинг бүтэн бодох тусгай тохиргоог зөвхөн админ өөрчилнө" });
      return;
    }
    const effectiveFrom = calendarDateText(input.effectiveFrom);
    if (!isValidCalendarDate(effectiveFrom)) {
      res.status(400).json({ error: "Цалин хүчинтэй болох огноо буруу байна" });
      return;
    }
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    if (!employee) {
      res.status(404).json({ error: "Ажилтан олдсонгүй" });
      return;
    }
    const history = await db.select().from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, id))
      .orderBy(employeeSalaryHistoryTable.effectiveFrom);
    const index = history.findIndex((row) => row.id === historyId);
    if (index < 0) {
      res.status(404).json({ error: "Цалингийн түүх олдсонгүй" });
      return;
    }
    if (index > 0 && effectiveFrom < String(employee.joinedAt)) {
      res.status(400).json({ error: "Цалингийн огноо ажилд орсон огнооноос өмнө байж болохгүй" });
      return;
    }
    const previous = history[index - 1];
    const next = history[index + 1];
    if ((previous && effectiveFrom <= String(previous.effectiveFrom)) || (next && effectiveFrom >= String(next.effectiveFrom))) {
      res.status(409).json({ error: "Хүчинтэй огноо өмнөх болон дараагийн цалингийн огнооны хооронд байх ёстой" });
      return;
    }
    if (history.some((row) => row.id !== historyId && String(row.effectiveFrom) === effectiveFrom)) {
      res.status(409).json({ error: "Энэ огноонд цалингийн өөр мөр бүртгэлтэй байна" });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(employeeSalaryHistoryTable).set({
        effectiveFrom,
        baseSalary: input.baseSalary,
        socialInsuranceSalary: input.socialInsuranceSalary,
        ...(input.fullSalaryRegardlessAttendance === undefined ? {} : {
          fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance,
        }),
      }).where(eq(employeeSalaryHistoryTable.id, historyId)).returning();
      if (index === history.length - 1) {
        await tx.update(employeesTable).set({
          baseSalary: input.baseSalary,
          socialInsuranceSalary: input.socialInsuranceSalary,
          ...(input.fullSalaryRegardlessAttendance === undefined ? {} : {
            fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance,
          }),
        }).where(eq(employeesTable.id, id));
      }
      return row;
    });
    res.json(UpdateEmployeeSalaryHistoryResponse.parse({
      ...updated,
      baseSalary: Number(updated.baseSalary),
      socialInsuranceSalary: Number(updated.socialInsuranceSalary),
      effectiveFrom: String(updated.effectiveFrom),
      createdAt: updated.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.delete("/employees/:id/salary-history/:historyId", async (req, res, next) => {
  try {
    const { id, historyId } = DeleteEmployeeSalaryHistoryParams.parse(req.params);
    const history = await db.select().from(employeeSalaryHistoryTable)
      .where(eq(employeeSalaryHistoryTable.employeeId, id))
      .orderBy(employeeSalaryHistoryTable.effectiveFrom);
    const index = history.findIndex((row) => row.id === historyId);
    if (index < 0) {
      res.status(404).json({ error: "Цалингийн түүх олдсонгүй" });
      return;
    }
    if (history.length === 1 || index === 0) {
      res.status(409).json({ error: "Ажилд орсон үеийн анхны цалингийн мөрийг устгах боломжгүй" });
      return;
    }
    const target = history[index];
    const next = history[index + 1];
    const affectedPaidPayroll = await db.select({
      month: payrollAdjustmentsTable.month,
      paidAmount: payrollAdjustmentsTable.paidAmount,
      secondPaidAmount: payrollAdjustmentsTable.secondPaidAmount,
    }).from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.employeeId, id));
    const affectedPaidMonth = affectedPaidPayroll.find((row) =>
      row.month >= String(target.effectiveFrom).slice(0, 7)
      && (!next || row.month <= String(next.effectiveFrom).slice(0, 7))
      && (Number(row.paidAmount) > 0 || Number(row.secondPaidAmount) > 0)
    );
    if (affectedPaidMonth) {
      res.status(409).json({ error: `${affectedPaidMonth.month} сарын олгосон цалинд нөлөөлөх тул энэ мөрийг устгах боломжгүй` });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.delete(employeeSalaryHistoryTable).where(eq(employeeSalaryHistoryTable.id, historyId));
      if (index === history.length - 1) {
        const previous = history[index - 1];
        await tx.update(employeesTable).set({
          employeeType: previous.employeeType,
          salaryType: previous.employeeType === "shift" ? "hourly" : "monthly",
          baseSalary: previous.baseSalary,
          socialInsuranceSalary: previous.socialInsuranceSalary,
          payrollTaxExempt: previous.payrollTaxExempt,
          fullSalaryRegardlessAttendance: previous.fullSalaryRegardlessAttendance,
        }).where(eq(employeesTable.id, id));
      }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.delete("/employees/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid employee id" });
      return;
    }
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    if (!employee) {
      res.status(404).json({ error: "Ажилтан олдсонгүй" });
      return;
    }
    const attendance = await db
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .where(eq(attendanceTable.employeeId, id))
      .limit(1);
    if (attendance.length) {
      res.status(409).json({ error: "Ирцийн бүртгэлтэй ажилтанг устгах боломжгүй" });
      return;
    }
    const adjustments = await db
      .select({ paidAmount: payrollAdjustmentsTable.paidAmount })
      .from(payrollAdjustmentsTable)
      .where(eq(payrollAdjustmentsTable.employeeId, id));
    const hasPaidPayroll = adjustments.some((row) => Number(row.paidAmount) > 0);
    const approvals = await db
      .select({ lines: payrollAdvanceApprovalsTable.lines })
      .from(payrollAdvanceApprovalsTable);
    const hasPaidAdvance = approvals.some((approval) =>
      Array.isArray(approval.lines) && (approval.lines as Array<Record<string, unknown>>).some((line) =>
        Number(line.employeeId) === id && line.paid === true,
      ),
    );
    if (hasPaidPayroll || hasPaidAdvance) {
      res.status(409).json({ error: "Цалин олгосон түүхтэй ажилтанг устгах боломжгүй" });
      return;
    }
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/attendance/shifts", async (_req, res, next) => {
  try {
    const rows = await db.select().from(shiftTemplatesTable).orderBy(shiftTemplatesTable.startTime);
    res.json(ListShiftsResponse.parse(rows));
  } catch (error) {
    next(error);
  }
});

router.post("/attendance/shifts", async (req, res, next) => {
  try {
    const input = CreateShiftBody.parse(req.body);
    if (input.startTime === input.endTime) {
      res.status(400).json({ error: "Ээлжийн эхлэх, тарах цаг ижил байж болохгүй" });
      return;
    }
    const [shift] = await db.insert(shiftTemplatesTable).values(input).returning();
    res.status(201).json(shift);
  } catch (error) {
    next(error);
  }
});

router.patch("/attendance/shifts/:id", async (req, res, next) => {
  try {
    const { id } = UpdateShiftParams.parse(req.params);
    const input = UpdateShiftBody.parse(req.body);
    if (input.startTime === input.endTime) {
      res.status(400).json({ error: "Ээлжийн эхлэх, тарах цаг ижил байж болохгүй" });
      return;
    }
    const [shift] = await db.update(shiftTemplatesTable).set(input).where(eq(shiftTemplatesTable.id, id)).returning();
    if (!shift) {
      res.status(404).json({ error: "Ээлж олдсонгүй" });
      return;
    }
    res.json(shift);
  } catch (error) {
    next(error);
  }
});

router.delete("/attendance/shifts/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Ээлжийн дугаар буруу байна" });
      return;
    }
    const plans = await db.select().from(employeeShiftPlansTable).where(eq(employeeShiftPlansTable.shiftId, id));
    if (plans.length) {
      res.status(409).json({ error: "Энэ ээлж сарын төлөвлөгөөнд ашиглагдсан тул устгах боломжгүй" });
      return;
    }
    await db.delete(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/attendance/shift-plans", async (req, res, next) => {
  try {
    const { month } = ListShiftPlansQueryParams.parse(req.query);
    const [plans, employees, shifts] = await Promise.all([
      db.select().from(employeeShiftPlansTable),
      db.select().from(employeesTable),
      db.select().from(shiftTemplatesTable),
    ]);
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee.name]));
    const shiftMap = new Map(shifts.map((shift) => [shift.id, shift]));
    const rows = plans.filter((plan) => plan.date.startsWith(month)).map((plan) => {
      const shift = shiftMap.get(plan.shiftId);
      return {
        id: plan.id,
        employeeId: plan.employeeId,
        employeeName: employeeMap.get(plan.employeeId) ?? "Тодорхойгүй",
        date: plan.date,
        shiftId: plan.shiftId,
        shiftName: shift?.name ?? "Тодорхойгүй",
        startTime: shift?.startTime ?? "",
        endTime: shift?.endTime ?? "",
      };
    });
    res.json(ListShiftPlansResponse.parse(rows));
  } catch (error) {
    next(error);
  }
});

router.put("/attendance/shift-plans", async (req, res, next) => {
  try {
    const parsed = UpsertShiftPlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const existing = await db.select().from(employeeShiftPlansTable).where(and(
      eq(employeeShiftPlansTable.employeeId, input.employeeId),
      eq(employeeShiftPlansTable.date, input.date),
    ));
    if (input.shiftId === null) {
      if (existing[0]) await db.delete(employeeShiftPlansTable).where(eq(employeeShiftPlansTable.id, existing[0].id));
      res.json(null);
      return;
    }
    const [shift] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, input.shiftId));
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, input.employeeId));
    if (!shift || !employee) {
      res.status(404).json({ error: "Ажилтан эсвэл ээлж олдсонгүй" });
      return;
    }
    const [plan] = existing[0]
      ? await db.update(employeeShiftPlansTable).set({ shiftId: input.shiftId }).where(eq(employeeShiftPlansTable.id, existing[0].id)).returning()
      : await db.insert(employeeShiftPlansTable).values(input as { employeeId: number; date: string; shiftId: number }).returning();
    res.json({
      id: plan.id,
      employeeId: plan.employeeId,
      employeeName: employee.name,
      date: plan.date,
      shiftId: shift.id,
      shiftName: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/attendance/shift-plans/copy-previous", async (req, res, next) => {
  try {
    const { sourceMonth, month, overwrite } = CopyPreviousShiftPlansBody.parse(req.body);
    if (sourceMonth === month) {
      res.status(400).json({ error: "Хуулах эх сар болон зорилтот сар ижил байж болохгүй" });
      return;
    }
    const targetDayCount = daysInMonth(month);
    const [activeEmployees, shifts, sourcePlans, targetPlans] = await Promise.all([
      db.select({ id: employeesTable.id }).from(employeesTable).where(and(
        eq(employeesTable.status, "active"),
        eq(employeesTable.employeeType, "shift"),
      )),
      db.select({ id: shiftTemplatesTable.id }).from(shiftTemplatesTable),
      db.select().from(employeeShiftPlansTable),
      db.select().from(employeeShiftPlansTable),
    ]);
    const activeEmployeeIds = new Set(activeEmployees.map(({ id }) => id));
    const validShiftIds = new Set(shifts.map(({ id }) => id));
    const copyPlan = planShiftPlanCopy({
      sourceMonth,
      targetMonth: month,
      targetDayCount,
      overwrite,
      activeEmployeeIds,
      validShiftIds,
      sourcePlans,
      targetPlans,
    });

    await db.transaction(async (tx) => {
      for (const action of copyPlan.actions) {
        if (action.type === "update") {
          await tx.update(employeeShiftPlansTable)
            .set({ shiftId: action.shiftId })
            .where(eq(employeeShiftPlansTable.id, action.targetId));
        } else {
          await tx.insert(employeeShiftPlansTable).values({
            employeeId: action.employeeId,
            date: action.date,
            shiftId: action.shiftId,
          });
        }
      }
    });

    res.json(CopyPreviousShiftPlansResponse.parse({
      sourceMonth,
      targetMonth: month,
      copied: copyPlan.copied,
      overwritten: copyPlan.overwritten,
      skipped: copyPlan.skipped,
      unavailableDates: copyPlan.unavailableDates,
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/attendance", async (req, res, next) => {
  try {
    const query = ListAttendanceQueryParams.parse(req.query);
    const [records, employees] = await Promise.all([
      db.select().from(attendanceTable).orderBy(desc(attendanceTable.date), desc(attendanceTable.id)),
      db.select().from(employeesTable),
    ]);
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee.name]));
    const filtered = records
      .filter((record) => !query.date || String(record.date) === query.date)
      .filter((record) => !query.month || String(record.date).startsWith(query.month))
      .map((record) => ({
        ...record,
        employeeName: employeeMap.get(record.employeeId) ?? "Тодорхойгүй",
        date: String(record.date),
        hours: Number(record.hours),
      }));
    res.json(ListAttendanceResponse.parse(filtered));
  } catch (error) {
    next(error);
  }
});

router.post("/attendance", async (req, res, next) => {
  try {
    const input = CreateAttendanceBody.parse(req.body);
    const [record] = await db
      .insert(attendanceTable)
      .values({ ...input, hours: hoursBetween(input.clockIn, input.clockOut) })
      .returning();
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, record.employeeId));
    res.status(201).json({
      ...record,
      employeeName: employee?.name ?? "Тодорхойгүй",
      date: String(record.date),
      hours: Number(record.hours),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/attendance", async (req, res, next) => {
  try {
    const input = UpsertAttendanceBody.parse(req.body);
    const selectedHours = input.status === "present" ? (input.hours ?? 8) : 0;
    const clockIn = input.clockIn ?? (input.status === "present" ? "09:00" : "00:00");
    const clockOut = input.clockOut ?? (
      input.status === "present"
        ? selectedHours === 12 ? "21:00" : "17:00"
        : "00:00"
    );
    const existing = await db
      .select()
      .from(attendanceTable)
      .where(and(
        eq(attendanceTable.employeeId, input.employeeId),
        eq(attendanceTable.date, input.date),
      ));
    const [record] = existing.length
      ? await db
          .update(attendanceTable)
          .set({ status: input.status, clockIn, clockOut, hours: selectedHours })
          .where(eq(attendanceTable.id, existing[0].id))
          .returning()
      : await db
          .insert(attendanceTable)
          .values({
            employeeId: input.employeeId,
            date: input.date,
            status: input.status,
            clockIn,
            clockOut,
            hours: selectedHours,
          })
          .returning();
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, record.employeeId));
    res.json({
      ...record,
      employeeName: employee?.name ?? "Тодорхойгүй",
      date: String(record.date),
      hours: Number(record.hours),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/attendance", async (req, res, next) => {
  try {
    const input = DeleteAttendanceQueryParams.parse(req.query);
    await db.delete(attendanceTable).where(and(
      eq(attendanceTable.employeeId, input.employeeId),
      eq(attendanceTable.date, input.date),
    ));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/hour-balance", async (req, res, next) => {
  try {
    const { month } = GetHourBalanceQueryParams.parse(req.query);
    const selectedMonth = month ?? currentMonth();
    const [employees, records] = await Promise.all([
      db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
      db.select().from(attendanceTable),
    ]);
    const monthRecords = records.filter((record) => String(record.date).startsWith(selectedMonth));
    const lines = employees.map((employee) => {
      const employeeRecords = monthRecords.filter((record) => record.employeeId === employee.id);
      const workedRecords = employeeRecords.filter((record) =>
        ["present", "late"].includes(record.status),
      );
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.role,
        month: selectedMonth,
        totalHours: money(workedRecords.reduce((total, record) => total + Number(record.hours), 0)),
        expectedWorkDays: employee.employeeType === "office"
          ? weekdayCount(selectedMonth)
          : employee.monthlyExpectedWorkDays,
        workDays: workedRecords.length,
        eightHourDays: workedRecords.filter((record) => Number(record.hours) === 8).length,
        twelveHourDays: workedRecords.filter((record) => Number(record.hours) === 12).length,
        leaveDays: employeeRecords.filter((record) => record.status === "leave").length,
      };
    });
    res.json(GetHourBalanceResponse.parse(lines));
  } catch (error) {
    next(error);
  }
});

router.get("/payroll", async (req, res, next) => {
  try {
    const { month } = GetPayrollQueryParams.parse(req.query);
    res.json(GetPayrollResponse.parse(await getPayrollSummary(month ?? currentMonth())));
  } catch (error) {
    next(error);
  }
});

router.put("/payroll-adjustments", async (req, res, next) => {
  try {
    const input = UpsertPayrollAdjustmentBody.parse(req.body);
    if (input.paidAmount > 0 && (!input.paymentDate || !isValidCalendarDate(input.paymentDate))) {
      res.status(400).json({ error: "Цалин олгосон огноог зөв оруулна уу" });
      return;
    }
    if (input.secondPaidAmount > 0 && (!input.secondPaymentDate || !isValidCalendarDate(input.secondPaymentDate))) {
      res.status(400).json({ error: "Хоёр дахь цалин олгосон огноог зөв оруулна уу" });
      return;
    }
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, input.employeeId));
    if (!employee) {
      res.status(404).json({ error: "Ажилтан олдсонгүй" });
      return;
    }
    const [existingAdjustment] = await db
      .select()
      .from(payrollAdjustmentsTable)
      .where(and(
        eq(payrollAdjustmentsTable.employeeId, input.employeeId),
        eq(payrollAdjustmentsTable.month, input.month),
      ));
    const protectedDates = new Set([
      Number(existingAdjustment?.paidAmount ?? 0) > 0 ? existingAdjustment?.paymentDate : null,
      Number(existingAdjustment?.secondPaidAmount ?? 0) > 0 ? existingAdjustment?.secondPaymentDate : null,
      input.paidAmount > 0 ? input.paymentDate : null,
      input.secondPaidAmount > 0 ? input.secondPaymentDate : null,
    ].filter((date): date is string => typeof date === "string"));
    for (const date of protectedDates) {
      if (await isCashDateClosed(date)) {
        res.status(409).json({ error: `${date} өдрийн касс өндөрлөсөн тул цалингийн гүйлгээг засах боломжгүй` });
        return;
      }
    }
    const sourceType = "payroll";
    const sourceKey = `${input.month}:${input.employeeId}`;
    const adjustment = await db.transaction(async (tx) => {
      const [savedAdjustment] = await tx
        .insert(payrollAdjustmentsTable)
        .values(input)
        .onConflictDoUpdate({
          target: [payrollAdjustmentsTable.employeeId, payrollAdjustmentsTable.month],
          set: {
            manualDeduction: input.manualDeduction,
            paidAmount: input.paidAmount,
            paymentDate: input.paidAmount > 0 ? input.paymentDate : null,
            secondPaidAmount: input.secondPaidAmount,
            secondPaymentDate: input.secondPaidAmount > 0 ? input.secondPaymentDate : null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (input.paidAmount > 0 && input.paymentDate) {
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Цалин",
          description: `${employee.name} · ${input.month} сарын цалин`,
          amount: input.paidAmount,
          date: input.paymentDate,
          sourceType,
          sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            amount: input.paidAmount,
            date: input.paymentDate,
            description: `${employee.name} · ${input.month} сарын цалин`,
          },
        });
      } else {
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, sourceType),
          eq(cashTransactionsTable.sourceKey, sourceKey),
        ));
      }

      const secondSourceKey = `${sourceKey}:2`;
      if (input.secondPaidAmount > 0 && input.secondPaymentDate) {
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Цалин",
          description: `${employee.name} · ${input.month} сарын цалин · 2-р олголт`,
          amount: input.secondPaidAmount,
          date: input.secondPaymentDate,
          sourceType,
          sourceKey: secondSourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            amount: input.secondPaidAmount,
            date: input.secondPaymentDate,
            description: `${employee.name} · ${input.month} сарын цалин · 2-р олголт`,
          },
        });
      } else {
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, sourceType),
          eq(cashTransactionsTable.sourceKey, secondSourceKey),
        ));
      }

      return savedAdjustment;
    });
    res.json({
      employeeId: adjustment.employeeId,
      month: adjustment.month,
      taxRelief: Number(adjustment.taxRelief),
      manualDeduction: Number(adjustment.manualDeduction),
      paidAmount: Number(adjustment.paidAmount),
      paymentDate: adjustment.paymentDate,
      secondPaidAmount: Number(adjustment.secondPaidAmount),
      secondPaymentDate: adjustment.secondPaymentDate,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/payroll-adjustments/:month/:employeeId/transactions/:sequence", async (req, res, next) => {
  try {
    const { month, employeeId, sequence } = DeletePayrollAdjustmentTransactionParams.parse({
      ...req.params,
      sequence: Number(req.params.sequence),
    });
    const [adjustment] = await db
      .select()
      .from(payrollAdjustmentsTable)
      .where(and(
        eq(payrollAdjustmentsTable.employeeId, employeeId),
        eq(payrollAdjustmentsTable.month, month),
      ));
    if (!adjustment) {
      res.status(404).json({ error: "Цалингийн тохируулга олдсонгүй" });
      return;
    }

    const paymentDate = sequence === 1 ? adjustment.paymentDate : adjustment.secondPaymentDate;
    const paidAmount = Number(sequence === 1 ? adjustment.paidAmount : adjustment.secondPaidAmount);
    if (paidAmount <= 0) {
      res.status(404).json({ error: `${sequence}-р гүйлгээ олдсонгүй` });
      return;
    }
    if (paymentDate && await isCashDateClosed(paymentDate)) {
      res.status(409).json({ error: `${paymentDate} өдрийн касс өндөрлөсөн тул цалингийн гүйлгээг устгах боломжгүй` });
      return;
    }

    const sourceKey = sequence === 1 ? `${month}:${employeeId}` : `${month}:${employeeId}:2`;
    await db.transaction(async (tx) => {
      await tx
        .update(payrollAdjustmentsTable)
        .set(sequence === 1
          ? { paidAmount: 0, paymentDate: null, updatedAt: new Date() }
          : { secondPaidAmount: 0, secondPaymentDate: null, updatedAt: new Date() })
        .where(eq(payrollAdjustmentsTable.id, adjustment.id));
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "payroll"),
        eq(cashTransactionsTable.sourceKey, sourceKey),
      ));
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/payroll-advance", async (req, res, next) => {
  try {
    const { month } = GetPayrollAdvanceQueryParams.parse(req.query);
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month ?? currentMonth())));
  } catch (error) {
    next(error);
  }
});

router.post("/payroll-advance/approve", async (req, res, next) => {
  try {
    const { month, approvalDate } = ApprovePayrollAdvanceBody.parse(req.body);
    if (!isValidCalendarDate(approvalDate)) {
      res.status(400).json({ error: "Урьдчилгаа цалин батлах огноог зөв оруулна уу" });
      return;
    }
    const existing = await getPayrollAdvanceSummary(month);
    if (!existing.approved) {
      await db.insert(payrollAdvanceApprovalsTable).values({
        month,
        lines: existing.lines,
        totalAmount: existing.totalAmount,
        approvalDate,
      }).onConflictDoNothing();
    }
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month)));
  } catch (error) {
    next(error);
  }
});

router.delete("/payroll-advance/approval", async (req, res, next) => {
  try {
    if (await getStaffRole(req) !== "admin") {
      res.status(403).json({ error: "Урьдчилгаа цалингийн батлалтыг зөвхөн ерөнхий админ буцаана" });
      return;
    }
    const { month } = RevertPayrollAdvanceApprovalQueryParams.parse(req.query);
    const [approval] = await db
      .select()
      .from(payrollAdvanceApprovalsTable)
      .where(eq(payrollAdvanceApprovalsTable.month, month));
    if (!approval) {
      res.status(404).json({ error: "Батлагдсан урьдчилгаа цалин олдсонгүй" });
      return;
    }
    const lines = Array.isArray(approval.lines)
      ? approval.lines as Array<{ paid?: boolean }>
      : [];
    if (lines.some((line) => line.paid === true)) {
      res.status(409).json({ error: "Эхлээд олгосон урьдчилгаа цалингийн мөрүүдийг Олгоогүй болгоно уу" });
      return;
    }
    await db
      .delete(payrollAdvanceApprovalsTable)
      .where(eq(payrollAdvanceApprovalsTable.id, approval.id));
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month)));
  } catch (error) {
    next(error);
  }
});

router.put("/payroll-advance/payment", async (req, res, next) => {
  try {
    const input = UpdatePayrollAdvancePaymentBody.parse(req.body);
    if (input.paid && (!input.paymentDate || !isValidCalendarDate(input.paymentDate))) {
      res.status(400).json({ error: "Урьдчилгаа олгосон огноог зөв оруулна уу" });
      return;
    }
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, input.employeeId));
    if (!employee) {
      res.status(404).json({ error: "Ажилтан олдсонгүй" });
      return;
    }
    const paymentResult = await db.transaction(async (tx) => {
      const [approval] = await tx
        .select()
        .from(payrollAdvanceApprovalsTable)
        .where(eq(payrollAdvanceApprovalsTable.month, input.month))
        .for("update");
      if (!approval) return "approval_not_found" as const;

      const sourceLines = Array.isArray(approval.lines)
        ? approval.lines as Array<Record<string, unknown>>
        : [];
      if (!sourceLines.some((line) => Number(line.employeeId) === input.employeeId)) {
        return "line_not_found" as const;
      }
      const previousLine = sourceLines.find((line) => Number(line.employeeId) === input.employeeId);
      const protectedDates = new Set([
        previousLine?.paid === true && typeof previousLine.paymentDate === "string" ? previousLine.paymentDate : null,
        input.paid ? input.paymentDate : null,
      ].filter((date): date is string => typeof date === "string"));
      for (const date of protectedDates) {
        const [closure] = await tx
          .select({ id: cashClosuresTable.id })
          .from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, date));
        if (closure) return "cash_closed" as const;
      }
      let paymentInput = input;
      let paymentSourceLines = sourceLines;
      if (!input.paid) {
        const attendanceRecords = await tx
          .select()
          .from(attendanceTable)
          .where(eq(attendanceTable.employeeId, input.employeeId));
        const firstHalfRecords = attendanceRecords.filter((record) =>
          String(record.date).startsWith(input.month)
          && Number(String(record.date).slice(8, 10)) <= 15
        );
        const refreshedLine = calculatePayrollAdvanceLine(employee, firstHalfRecords);
        paymentSourceLines = sourceLines.map((line) =>
          Number(line.employeeId) === input.employeeId ? refreshedLine : line
        );
        paymentInput = { ...input, advanceAmount: refreshedLine.advanceAmount };
      }
      const { lines, totalAmount, cashTransaction } = planPayrollAdvancePayment(paymentSourceLines, paymentInput);

      await tx
        .update(payrollAdvanceApprovalsTable)
        .set({ lines, totalAmount })
        .where(eq(payrollAdvanceApprovalsTable.id, approval.id));

      if (cashTransaction) {
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Урьдчилгаа цалин",
          description: `${employee.name} · ${input.month} сарын урьдчилгаа`,
          amount: cashTransaction.amount,
          date: cashTransaction.date,
          sourceType: cashTransaction.sourceType,
          sourceKey: cashTransaction.sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            amount: cashTransaction.amount,
            date: cashTransaction.date,
            description: `${employee.name} · ${input.month} сарын урьдчилгаа`,
          },
        });
      } else {
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, "payroll_advance"),
          eq(cashTransactionsTable.sourceKey, `${input.month}:${input.employeeId}`),
        ));
      }
      return "updated" as const;
    });
    if (paymentResult === "approval_not_found") {
      res.status(409).json({ error: "Эхлээд тухайн сарын урьдчилгаа цалинг батална уу" });
      return;
    }
    if (paymentResult === "line_not_found") {
      res.status(404).json({ error: "Урьдчилгаа цалингийн мөр олдсонгүй" });
      return;
    }
    if (paymentResult === "cash_closed") {
      res.status(409).json({ error: "Касс өндөрлөсөн өдрийн урьдчилгааны гүйлгээг засах боломжгүй" });
      return;
    }
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(input.month)));
  } catch (error) {
    next(error);
  }
});

router.get("/cash/summary", async (_req, res, next) => {
  try {
    const transactions = await db.select().from(cashTransactionsTable).where(isNull(cashTransactionsTable.unclearAt));
    const summary = transactions.reduce(
      (result, transaction) => {
        const amount = Number(transaction.amount);
        const isIncome = transaction.type === "income";
        result.balance += isIncome ? amount : -amount;
        result[isIncome ? "income" : "expense"] += amount;
        if (String(transaction.date) === today()) {
          result[isIncome ? "todayIncome" : "todayExpense"] += amount;
        }
        return result;
      },
      { balance: 0, income: 0, expense: 0, todayIncome: 0, todayExpense: 0 },
    );
    res.json(GetCashSummaryResponse.parse(Object.fromEntries(
      Object.entries(summary).map(([key, value]) => [key, money(value)]),
    )));
  } catch (error) {
    next(error);
  }
});

router.get("/cash/transactions", async (_req, res, next) => {
  try {
    const rows = await db.select().from(cashTransactionsTable).where(isNull(cashTransactionsTable.unclearAt)).orderBy(desc(cashTransactionsTable.date), desc(cashTransactionsTable.id));
    const [expenseRows, inventoryPurchases] = await Promise.all([
      db.select({
        cashTransactionId: operatingExpensesTable.cashTransactionId,
        category: operatingExpensesTable.category,
      }).from(operatingExpensesTable).where(isNotNull(operatingExpensesTable.cashTransactionId)),
      db.select({ id: inventoryPurchasesTable.id, materialType: inventoryPurchasesTable.materialType }).from(inventoryPurchasesTable),
    ]);
    const subcategoryByCashId = new Map(expenseRows.map((expense) => [expense.cashTransactionId, expense.category]));
    const inventoryCategoryBySourceKey = new Map(inventoryPurchases.map((purchase) => [`purchase:${purchase.id}`, inventoryMaterialLabel(purchase.materialType)]));
    res.json(ListCashTransactionsResponse.parse(rows.map((transaction) => ({
      ...transaction,
      category: transaction.type === "expense"
        ? transaction.sourceType === "payroll" || transaction.sourceType === "payroll_advance"
          ? "Цалин"
          : transaction.sourceType === "inventory_purchase"
            ? inventoryCategoryBySourceKey.get(transaction.sourceKey ?? "") ?? "Хангамжийн материал"
            : transaction.sourceType === "fixed_asset_purchase"
              ? "Эд хөрөнгө"
              : "Үйл ажиллагааны зардал"
        : transaction.category,
      subcategory: transaction.type === "expense"
        && !["payroll", "payroll_advance", "inventory_purchase", "fixed_asset_purchase"].includes(transaction.sourceType ?? "")
        ? subcategoryByCashId.get(transaction.id) ?? (transaction.category !== "Үйл ажиллагааны зардал" ? transaction.category : null)
        : null,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      bankTransactionId: transaction.bankTransactionId,
      bankVerifiedAt: transaction.bankVerifiedAt?.toISOString() ?? null,
      createdAt: String(transaction.createdAt),
      editable: transaction.sourceType === null,
      transactionKind: transaction.sourceType ?? "manual",
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/cash/transactions", async (req, res, next) => {
  try {
    const input = CreateCashTransactionBody.parse(req.body);
    if (input.type === "income" && input.incomeMonth === null) {
      res.status(400).json({ error: "Орлогын хамаарах сар шаардлагатай" });
      return;
    }
    if (await isCashDateClosed(input.date)) {
      res.status(409).json({ error: `${input.date} өдрийн касс өндөрлөсөн тул гүйлгээ нэмэх боломжгүй` });
      return;
    }
    const transaction = await db.transaction(async (tx) => {
      const [cash] = await tx.insert(cashTransactionsTable).values({
        ...input,
        category: input.type === "expense" ? "Үйл ажиллагааны зардал" : input.category.trim(),
        incomeMonth: input.type === "income" ? input.incomeMonth : null,
      }).returning();
      if (input.type === "expense") {
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          category: input.category.trim(),
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: cash.id,
        });
      }
      return cash;
    });
    res.status(201).json({
      ...transaction,
      subcategory: input.type === "expense" ? input.category.trim() : null,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      bankTransactionId: transaction.bankTransactionId,
      bankVerifiedAt: transaction.bankVerifiedAt?.toISOString() ?? null,
      createdAt: String(transaction.createdAt),
      editable: true,
      transactionKind: "manual",
    });
  } catch (error) {
    next(error);
  }
});

router.put("/cash/transactions/:id", async (req, res, next) => {
  try {
    const { id } = UpdateCashTransactionParams.parse(req.params);
    const input = UpdateCashTransactionBody.parse(req.body);
    if (input.type === "income" && input.incomeMonth === null) {
      res.status(400).json({ error: "Орлогын хамаарах сар шаардлагатай" });
      return;
    }
    const [existing] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (existing.sourceType !== null) {
      res.status(409).json({ error: "Автомат гүйлгээг эх үүсвэр цэснээс засна уу" });
      return;
    }
    if (await isCashDateClosed(String(existing.date)) || await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн гүйлгээг засах боломжгүй" });
      return;
    }
    const transaction = await db.transaction(async (tx) => {
      const [cash] = await tx.update(cashTransactionsTable)
        .set({
          ...input,
          category: input.type === "expense" ? "Үйл ажиллагааны зардал" : input.category.trim(),
          incomeMonth: input.type === "income" ? input.incomeMonth : null,
        })
        .where(eq(cashTransactionsTable.id, id))
        .returning();
      await tx.delete(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, id));
      if (input.type === "expense") {
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          category: input.category.trim(),
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: id,
        });
      }
      return cash;
    });
    res.json({
      ...transaction,
      subcategory: input.type === "expense" ? input.category.trim() : null,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      bankTransactionId: transaction.bankTransactionId,
      bankVerifiedAt: transaction.bankVerifiedAt?.toISOString() ?? null,
      createdAt: String(transaction.createdAt),
      editable: true,
      transactionKind: "manual",
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/cash/transactions/:id/income-month", async (req, res, next) => {
  try {
    const { id } = UpdateBankCashTransactionIncomeMonthParams.parse(req.params);
    const { incomeMonth } = UpdateBankCashTransactionIncomeMonthBody.parse(req.body);
    const [existing] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (existing.sourceType !== "bank_transaction" || existing.type !== "income") {
      res.status(409).json({ error: "Зөвхөн банкнаас орсон кассын орлогын хамаарах сарыг засах боломжтой" });
      return;
    }
    if (await isCashDateClosed(String(existing.date))) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн гүйлгээг засах боломжгүй" });
      return;
    }
    const [transaction] = await db
      .update(cashTransactionsTable)
      .set({ incomeMonth })
      .where(eq(cashTransactionsTable.id, id))
      .returning();
    res.json(UpdateBankCashTransactionIncomeMonthResponse.parse({
      ...transaction,
      subcategory: null,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      bankTransactionId: transaction.bankTransactionId,
      bankVerifiedAt: transaction.bankVerifiedAt?.toISOString() ?? null,
      createdAt: String(transaction.createdAt),
      editable: false,
      transactionKind: "bank_transaction",
    }));
  } catch (error) {
    next(error);
  }
});

router.delete("/cash/transactions/:id", async (req, res, next) => {
  try {
    const { id } = DeleteCashTransactionParams.parse(req.params);
    const [existing] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (existing.sourceType !== null) {
      res.status(409).json({ error: "Автомат гүйлгээг эх үүсвэр цэснээс өөрчилнө үү" });
      return;
    }
    if (await isCashDateClosed(String(existing.date))) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн гүйлгээг устгах боломжгүй" });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.delete(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, id));
      await tx.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/cash/closures", async (_req, res, next) => {
  try {
    const rows = await db.select().from(cashClosuresTable).orderBy(desc(cashClosuresTable.date));
    res.json(ListCashClosuresResponse.parse(rows.map((row) => ({
      id: row.id,
      date: row.date,
      closedAt: row.closedAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/cash/closures", async (req, res, next) => {
  try {
    const { date } = CloseCashDayBody.parse(req.body);
    if (!isValidCalendarDate(date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    if (date > today()) {
      res.status(400).json({ error: "Ирээдүйн өдрийн кассыг өндөрлөх боломжгүй" });
      return;
    }
    const [created] = await db
      .insert(cashClosuresTable)
      .values({ date })
      .onConflictDoNothing()
      .returning();
    const saved = created ?? (await db
      .select()
      .from(cashClosuresTable)
      .where(eq(cashClosuresTable.date, date)))[0];
    res.status(201).json(CloseCashDayResponse.parse({
      id: saved.id,
      date: saved.date,
      closedAt: saved.closedAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/deletion-requests", async (_req, res, next) => {
  try {
    const requests = await db.select().from(deletionRequestsTable).orderBy(desc(deletionRequestsTable.requestedAt));
    res.json(ListDeletionRequestsResponse.parse(requests.map(deletionRequestResponse)));
  } catch (error) {
    next(error);
  }
});

router.post("/deletion-requests", async (req, res, next) => {
  try {
    const input = CreateDeletionRequestBody.parse(req.body);
    const role = await getStaffRole(req);
    const targetPath = input.targetPath.trim();
    const label = input.label.trim();
    if (!role || !deletionTargetPatterns.some((pattern) => pattern.test(targetPath)) || !roleCanRequestDeletion(role, targetPath)) {
      res.status(400).json({ error: "Устгах хүсэлтийн төрөл буруу байна" });
      return;
    }
    if (!label) {
      res.status(400).json({ error: "Устгах хүсэлтийн тайлбар шаардлагатай" });
      return;
    }
    const [pending] = await db.select().from(deletionRequestsTable).where(and(
      eq(deletionRequestsTable.targetPath, targetPath),
      eq(deletionRequestsTable.status, "pending"),
    ));
    if (pending) {
      res.status(200).json(CreateDeletionRequestResponse.parse(deletionRequestResponse(pending)));
      return;
    }
    const [created] = await db.insert(deletionRequestsTable).values({
      targetPath,
      label,
      requesterRole: role,
    }).returning();
    res.status(201).json(CreateDeletionRequestResponse.parse(deletionRequestResponse(created)));
  } catch (error) {
    next(error);
  }
});

router.post("/deletion-requests/:id/approve", async (req, res, next) => {
  try {
    const { id } = ApproveDeletionRequestParams.parse(req.params);
    if (await getStaffRole(req) !== "admin") {
      res.status(403).json({ error: "Зөвхөн ерөнхий админ устгах хүсэлтийг батална" });
      return;
    }
    const [request] = await db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.id, id));
    if (!request) {
      res.status(404).json({ error: "Устгах хүсэлт олдсонгүй" });
      return;
    }
    if (request.status !== "pending") {
      res.status(409).json({ error: "Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна" });
      return;
    }
    const [executing] = await db.update(deletionRequestsTable).set({
      status: "executing",
      approvedAt: new Date(),
      error: null,
    }).where(eq(deletionRequestsTable.id, id)).returning();
    const execution = await dispatchApprovedDeletion(
      request.targetPath,
      req.headers.cookie ?? "",
      id,
    );
    if (!execution.ok) {
      const errorBody = await execution.text();
      const [failed] = await db.update(deletionRequestsTable).set({
        status: "failed",
        error: errorBody || `HTTP ${execution.status}`,
      }).where(eq(deletionRequestsTable.id, id)).returning();
      res.status(execution.status).json({ error: "Устгах үйлдэл амжилтгүй", request: deletionRequestResponse(failed) });
      return;
    }
    const [completed] = await db.update(deletionRequestsTable).set({
      status: "completed",
      completedAt: new Date(),
    }).where(eq(deletionRequestsTable.id, id)).returning();
    res.json(ApproveDeletionRequestResponse.parse(deletionRequestResponse(completed ?? executing)));
  } catch (error) {
    next(error);
  }
});

router.post("/deletion-requests/:id/cancel", async (req, res, next) => {
  try {
    const { id } = CancelDeletionRequestParams.parse(req.params);
    if (await getStaffRole(req) !== "admin") {
      res.status(403).json({ error: "Зөвхөн ерөнхий админ устгах хүсэлтийг цуцална" });
      return;
    }
    const [cancelled] = await db.update(deletionRequestsTable).set({
      status: "cancelled",
      completedAt: new Date(),
      error: null,
    }).where(and(
      eq(deletionRequestsTable.id, id),
      eq(deletionRequestsTable.status, "pending"),
    )).returning();
    if (!cancelled) {
      res.status(409).json({ error: "Хүлээгдэж буй устгах хүсэлт олдсонгүй" });
      return;
    }
    res.json(CancelDeletionRequestResponse.parse(deletionRequestResponse(cancelled)));
  } catch (error) {
    next(error);
  }
});

router.get("/fixed-assets", async (_req, res, next) => {
  try {
    const rows = await db.select().from(fixedAssetsTable).orderBy(desc(fixedAssetsTable.date), desc(fixedAssetsTable.id));
    res.json(ListFixedAssetsResponse.parse(rows.map((asset) => ({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount: money(Number(asset.unitPrice) * Number(asset.quantity)),
      createdAt: asset.createdAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/fixed-assets", async (req, res, next) => {
  try {
    const input = CreateFixedAssetBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Хөрөнгийн нэр хоосон байж болохгүй" });
      return;
    }
    if (input.purchased && await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдөр худалдан авсан хөрөнгө бүртгэх боломжгүй" });
      return;
    }
    const totalAmount = money(input.unitPrice * input.quantity);
    const asset = await db.transaction(async (tx) => {
      const [created] = await tx.insert(fixedAssetsTable).values({
        name,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        date: input.date,
        purchased: input.purchased,
      }).returning();
      if (input.purchased) {
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey: `fixed-asset:${created.id}`,
        });
      }
      return created;
    });
    res.status(201).json(CreateFixedAssetResponse.parse({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount,
      createdAt: asset.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.put("/fixed-assets/:id", async (req, res, next) => {
  try {
    const { id } = UpdateFixedAssetParams.parse(req.params);
    const input = UpdateFixedAssetBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Хөрөнгийн нэр хоосон байж болохгүй" });
      return;
    }
    const [existing] = await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    const totalAmount = money(input.unitPrice * input.quantity);
    const result = await db.transaction(async (tx) => {
      const affectedDates = new Set<string>();
      if (existing.purchased) affectedDates.add(existing.date);
      if (input.purchased) affectedDates.add(input.date);
      if (affectedDates.size) {
        const closures = await tx.select({ date: cashClosuresTable.date }).from(cashClosuresTable);
        if (closures.some(({ date }) => affectedDates.has(date))) return { kind: "cash_closed" as const };
      }

      const [updated] = await tx.update(fixedAssetsTable).set({
        name,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        date: input.date,
        purchased: input.purchased,
      }).where(eq(fixedAssetsTable.id, id)).returning();
      const sourceKey = `fixed-asset:${id}`;
      if (input.purchased) {
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            description: `${name} (${input.quantity} ширхэг)`,
            amount: totalAmount,
            date: input.date,
          },
        });
      } else {
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
          eq(cashTransactionsTable.sourceKey, sourceKey),
        ));
      }
      return { kind: "updated" as const, asset: updated };
    });
    if (result.kind === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг засах боломжгүй" });
      return;
    }
    res.json(UpdateFixedAssetResponse.parse({
      ...result.asset,
      unitPrice: Number(result.asset.unitPrice),
      quantity: Number(result.asset.quantity),
      totalAmount,
      createdAt: result.asset.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.delete("/fixed-assets/:id", async (req, res, next) => {
  try {
    const { id } = DeleteFixedAssetParams.parse(req.params);
    const [existing] = await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      if (existing.purchased) {
        const [closure] = await tx.select({ id: cashClosuresTable.id })
          .from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, existing.date));
        if (closure) return "cash_closed" as const;
      }
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${id}`),
      ));
      await tx.delete(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
      return "deleted" as const;
    });
    if (result === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг устгах боломжгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/purchases", async (_req, res, next) => {
  try {
    const [purchases, items, closures] = await Promise.all([
      db.select().from(inventoryPurchasesTable).orderBy(desc(inventoryPurchasesTable.date), desc(inventoryPurchasesTable.id)),
      db.select().from(inventoryPurchaseItemsTable).orderBy(inventoryPurchaseItemsTable.id),
      db.select({ date: cashClosuresTable.date }).from(cashClosuresTable),
    ]);
    const closedDates = new Set(closures.map((closure) => closure.date));
    res.json(ListInventoryPurchasesResponse.parse(purchases.map((purchase) => ({
      id: purchase.id,
      materialType: purchase.materialType,
      supplierName: purchase.documentName,
      hasReceipt: purchase.hasReceipt,
      date: purchase.date,
      totalAmount: Number(purchase.totalAmount),
      paid: purchase.paymentDate !== null,
      paymentDate: purchase.paymentDate,
      paymentAmount: purchase.paymentAmount === null ? null : Number(purchase.paymentAmount),
      createdAt: purchase.createdAt.toISOString(),
      editable: !closedDates.has(purchase.date),
      items: items
        .filter((item) => item.purchaseId === purchase.id)
        .map((item) => ({
          id: item.id,
          inventoryItemId: item.inventoryItemId,
          name: item.name,
          category: item.category,
          unit: item.unit,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalAmount: Number(item.totalAmount),
        })),
    }))));
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/suppliers", async (_req, res, next) => {
  try {
    const [suppliers, purchases, purchaseItems] = await Promise.all([
      db.select().from(inventorySuppliersTable).orderBy(inventorySuppliersTable.name),
      db.select().from(inventoryPurchasesTable),
      db.select().from(inventoryPurchaseItemsTable),
    ]);
    const normalized = (name: string) => name.trim().toLocaleLowerCase("mn-MN");
    res.json(ListInventorySuppliersResponse.parse(suppliers.map((supplier) => {
      const supplierPurchases = purchases.filter((purchase) => normalized(purchase.documentName) === supplier.normalizedName);
      const purchaseIds = new Set(supplierPurchases.map((purchase) => purchase.id));
      const groupedItems = new Map<string, { name: string; unit: string; quantity: number; totalAmount: number }>();
      for (const item of purchaseItems) {
        if (!purchaseIds.has(item.purchaseId)) continue;
        const key = `${item.name.trim().toLocaleLowerCase("mn-MN")}\u0000${item.unit}`;
        const existing = groupedItems.get(key);
        if (existing) {
          existing.quantity += Number(item.quantity);
          existing.totalAmount += Number(item.totalAmount);
        } else {
          groupedItems.set(key, { name: item.name, unit: item.unit, quantity: Number(item.quantity), totalAmount: Number(item.totalAmount) });
        }
      }
      return {
        id: supplier.id,
        name: supplier.name,
        purchaseCount: supplierPurchases.length,
        totalAmount: money(supplierPurchases.reduce((total, purchase) => total + Number(purchase.totalAmount), 0)),
        unpaidAmount: money(supplierPurchases.reduce((total, purchase) => total + Number(purchase.totalAmount) - Number(purchase.paymentAmount ?? 0), 0)),
        items: [...groupedItems.values()].map((item) => ({ ...item, totalAmount: money(item.totalAmount) })),
      };
    })));
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/suppliers/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventorySupplierParams.parse(req.params);
    const input = UpdateInventorySupplierBody.parse(req.body);
    const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!name) {
      res.status(400).json({ error: "Харилцагчийн нэр хоосон байж болохгүй" });
      return;
    }
    const normalizedName = name.toLocaleLowerCase("mn-MN");
    const [supplier] = await db.select().from(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, id));
    if (!supplier) {
      res.status(404).json({ error: "Харилцагч олдсонгүй" });
      return;
    }
    const [duplicate] = await db.select({ id: inventorySuppliersTable.id })
      .from(inventorySuppliersTable)
      .where(eq(inventorySuppliersTable.normalizedName, normalizedName));
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: "Ийм нэртэй харилцагч аль хэдийн байна" });
      return;
    }
    const allPurchases = await db.select().from(inventoryPurchasesTable);
    const matchingPurchases = allPurchases.filter((purchase) =>
      purchase.documentName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("mn-MN") === supplier.normalizedName
    );
    const purchaseIds = matchingPurchases.map((purchase) => purchase.id);
    const updatedSupplier = await db.transaction(async (tx) => {
      const [updated] = await tx.update(inventorySuppliersTable)
        .set({ name, normalizedName })
        .where(eq(inventorySuppliersTable.id, id))
        .returning();
      if (purchaseIds.length > 0) {
        await tx.update(inventoryPurchasesTable)
          .set({ documentName: name })
          .where(inArray(inventoryPurchasesTable.id, purchaseIds));
        await tx.update(cashTransactionsTable)
          .set({ description: name })
          .where(and(
            eq(cashTransactionsTable.sourceType, "inventory_purchase"),
            inArray(cashTransactionsTable.sourceKey, purchaseIds.map((purchaseId) => `purchase:${purchaseId}`)),
          ));
      }
      return updated;
    });
    const purchaseItems = purchaseIds.length > 0
      ? await db.select().from(inventoryPurchaseItemsTable).where(inArray(inventoryPurchaseItemsTable.purchaseId, purchaseIds))
      : [];
    const groupedItems = new Map<string, { name: string; unit: string; quantity: number; totalAmount: number }>();
    for (const item of purchaseItems) {
      const key = `${item.name.trim().toLocaleLowerCase("mn-MN")}\u0000${item.unit}`;
      const grouped = groupedItems.get(key);
      if (grouped) {
        grouped.quantity += Number(item.quantity);
        grouped.totalAmount += Number(item.totalAmount);
      } else {
        groupedItems.set(key, { name: item.name, unit: item.unit, quantity: Number(item.quantity), totalAmount: Number(item.totalAmount) });
      }
    }
    res.json(UpdateInventorySupplierResponse.parse({
      id: updatedSupplier.id,
      name: updatedSupplier.name,
      purchaseCount: matchingPurchases.length,
      totalAmount: money(matchingPurchases.reduce((total, purchase) => total + Number(purchase.totalAmount), 0)),
      items: [...groupedItems.values()].map((item) => ({ ...item, totalAmount: money(item.totalAmount) })),
    }));
  } catch (error) {
    next(error);
  }
});

router.delete("/inventory/suppliers/:id", async (req, res, next) => {
  try {
    const { id } = DeleteInventorySupplierParams.parse(req.params);
    const [supplier] = await db.select({ id: inventorySuppliersTable.id })
      .from(inventorySuppliersTable)
      .where(eq(inventorySuppliersTable.id, id));
    if (!supplier) {
      res.status(404).json({ error: "Харилцагч олдсонгүй" });
      return;
    }
    await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/items", async (_req, res, next) => {
  try {
    const [items, lots] = await Promise.all([
      db.select().from(inventoryItemsTable).orderBy(inventoryItemsTable.category, inventoryItemsTable.name),
      db.select({
        inventoryItemId: inventoryPurchaseItemsTable.inventoryItemId,
        remainingQuantity: inventoryPurchaseItemsTable.remainingQuantity,
        unitPrice: inventoryPurchaseItemsTable.unitPrice,
      }).from(inventoryPurchaseItemsTable),
    ]);
    const valueByItem = new Map<number, number>();
    for (const lot of lots) {
      if (lot.inventoryItemId === null) continue;
      const current = valueByItem.get(lot.inventoryItemId) ?? 0;
      valueByItem.set(lot.inventoryItemId, current + Number(lot.remainingQuantity) * Number(lot.unitPrice));
    }
    res.json(ListInventoryItemsResponse.parse(items.map((item) => ({
      id: item.id,
      materialType: item.materialType,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: Number(item.quantity),
      totalValue: money(valueByItem.get(item.id) ?? 0),
      createdAt: item.createdAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/items/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventoryItemParams.parse(req.params);
    const input = UpdateInventoryItemBody.parse(req.body);
    const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
    const normalizedName = name.toLocaleLowerCase("mn-MN");
    const category = input.category.trim();
    if (!name || !category) {
      res.status(400).json({ error: "Барааны нэр болон ангилал хоосон байж болохгүй" });
      return;
    }
    const [duplicate] = await db.select({ id: inventoryItemsTable.id })
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.normalizedName, normalizedName));
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: "Ийм нэртэй бараа материал аль хэдийн байна" });
      return;
    }
    const item = await db.transaction(async (tx) => {
      const [updatedItem] = await tx.update(inventoryItemsTable)
        .set({ name, normalizedName, category })
        .where(eq(inventoryItemsTable.id, id))
        .returning();
      if (updatedItem) {
        await tx.update(inventoryPurchaseItemsTable)
          .set({ name, category })
          .where(eq(inventoryPurchaseItemsTable.inventoryItemId, id));
      }
      return updatedItem;
    });
    if (!item) {
      res.status(404).json({ error: "Бараа материал олдсонгүй" });
      return;
    }
    res.json(UpdateInventoryItemResponse.parse({
      ...item,
      quantity: Number(item.quantity),
      createdAt: item.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

class InventoryInsufficientStockError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reads available purchase lots for an item oldest-first (locking them for the
 * rest of this transaction) and works out which lot(s) an issue of `quantity`
 * would draw from. Read-only -- writes nothing. Returns null if the eligible
 * lots don't cover the requested quantity.
 */
async function planInventoryFifoConsumption(tx: Tx, inventoryItemId: number, quantity: number) {
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
async function applyInventoryFifoConsumption(
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
async function reverseInventoryFifoConsumption(tx: Tx, issueId: number, inventoryItemId: number) {
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

router.get("/inventory/issues", async (_req, res, next) => {
  try {
    const [rows, consumptions] = await Promise.all([
      db
        .select({
          id: inventoryIssuesTable.id,
          inventoryItemId: inventoryIssuesTable.inventoryItemId,
          itemName: inventoryItemsTable.name,
          unit: inventoryItemsTable.unit,
          date: inventoryIssuesTable.date,
          quantity: inventoryIssuesTable.quantity,
          purpose: inventoryIssuesTable.purpose,
          createdAt: inventoryIssuesTable.createdAt,
        })
        .from(inventoryIssuesTable)
        .innerJoin(inventoryItemsTable, eq(inventoryIssuesTable.inventoryItemId, inventoryItemsTable.id))
        .orderBy(desc(inventoryIssuesTable.date), desc(inventoryIssuesTable.id)),
      db.select({
        issueId: inventoryIssueConsumptionsTable.issueId,
        quantity: inventoryIssueConsumptionsTable.quantity,
        unitPrice: inventoryIssueConsumptionsTable.unitPrice,
      }).from(inventoryIssueConsumptionsTable),
    ]);
    const costByIssue = new Map<number, number>();
    for (const consumption of consumptions) {
      const current = costByIssue.get(consumption.issueId) ?? 0;
      costByIssue.set(consumption.issueId, current + Number(consumption.quantity) * Number(consumption.unitPrice));
    }
    res.json(ListInventoryIssuesResponse.parse(rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      totalCost: money(costByIssue.get(row.id) ?? 0),
      createdAt: row.createdAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/issues", async (req, res, next) => {
  try {
    const input = CreateInventoryIssueBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const purpose = input.purpose.trim();
    if (!purpose) {
      res.status(400).json({ error: "Зориулалт хоосон байж болохгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, input.inventoryItemId));
      if (!item) return { status: "not-found" as const };
      // Plan first (read-only) so an insufficient-stock case never leaves a
      // half-written issue behind: nothing is written until the plan succeeds.
      const plan = await planInventoryFifoConsumption(tx, input.inventoryItemId, input.quantity);
      if (!plan) return { status: "insufficient" as const };
      const [issue] = await tx.insert(inventoryIssuesTable).values({
        inventoryItemId: input.inventoryItemId,
        date: input.date,
        quantity: input.quantity,
        purpose,
      }).returning();
      const totalCost = await applyInventoryFifoConsumption(tx, issue.id, input.inventoryItemId, plan);
      return { status: "created" as const, item, issue, totalCost };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Бараа материал олдсонгүй" });
      return;
    }
    if (result.status === "insufficient") {
      res.status(409).json({ error: "Барааны үлдэгдэл хүрэлцэхгүй байна" });
      return;
    }
    res.status(201).json(CreateInventoryIssueResponse.parse({
      id: result.issue.id,
      inventoryItemId: result.issue.inventoryItemId,
      itemName: result.item.name,
      unit: result.item.unit,
      date: result.issue.date,
      quantity: Number(result.issue.quantity),
      totalCost: result.totalCost,
      purpose: result.issue.purpose,
      createdAt: result.issue.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/issues/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventoryIssueParams.parse(req.params);
    const input = UpdateInventoryIssueBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const purpose = input.purpose.trim();
    if (!purpose) {
      res.status(400).json({ error: "Зориулалт хоосон байж болохгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, id));
      if (!existing) return { status: "not-found" as const };
      const [newItem] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, input.inventoryItemId));
      if (!newItem) return { status: "item-not-found" as const };
      // Reverse the old consumption so its lots are free again, then re-plan
      // for the new item/quantity. If the re-plan comes up short, throw so the
      // whole transaction (including the reversal) rolls back -- returning a
      // status here instead would still commit the reversal with nothing to
      // replace it, silently conjuring stock that was never actually returned.
      await reverseInventoryFifoConsumption(tx, existing.id, existing.inventoryItemId);
      const plan = await planInventoryFifoConsumption(tx, input.inventoryItemId, input.quantity);
      if (!plan) throw new InventoryInsufficientStockError();
      const [issue] = await tx.update(inventoryIssuesTable).set({
        inventoryItemId: input.inventoryItemId,
        date: input.date,
        quantity: input.quantity,
        purpose,
      }).where(eq(inventoryIssuesTable.id, id)).returning();
      const totalCost = await applyInventoryFifoConsumption(tx, issue.id, input.inventoryItemId, plan);
      return { status: "updated" as const, issue, item: newItem, totalCost };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Зарлагын бүртгэл олдсонгүй" });
      return;
    }
    if (result.status === "item-not-found") {
      res.status(404).json({ error: "Бараа материал олдсонгүй" });
      return;
    }
    res.json(UpdateInventoryIssueResponse.parse({
      id: result.issue.id,
      inventoryItemId: result.issue.inventoryItemId,
      itemName: result.item.name,
      unit: result.item.unit,
      date: result.issue.date,
      quantity: Number(result.issue.quantity),
      totalCost: result.totalCost,
      purpose: result.issue.purpose,
      createdAt: result.issue.createdAt.toISOString(),
    }));
  } catch (error) {
    if (error instanceof InventoryInsufficientStockError) {
      res.status(409).json({ error: "Барааны үлдэгдэл хүрэлцэхгүй байна" });
      return;
    }
    next(error);
  }
});

router.delete("/inventory/issues/:id", async (req, res, next) => {
  try {
    const { id } = DeleteInventoryIssueParams.parse(req.params);
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, id));
      if (!existing) return false;
      await reverseInventoryFifoConsumption(tx, existing.id, existing.inventoryItemId);
      await tx.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, id));
      return true;
    });
    if (!deleted) {
      res.status(404).json({ error: "Зарлагын бүртгэл олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/purchases", async (req, res, next) => {
  try {
    const input = CreateInventoryPurchaseBody.parse(req.body);
    const supplierName = input.supplierName.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!supplierName) {
      res.status(400).json({ error: "Харилцагчийн нэр хоосон байж болохгүй" });
      return;
    }
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    if (await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдөр худалдан авалт бүртгэх боломжгүй" });
      return;
    }
    const normalizedItems = input.items.map((item) => ({
      ...item,
      name: item.name.trim(),
      category: item.category.trim(),
      totalAmount: money(item.quantity * item.unitPrice),
    }));
    if (normalizedItems.some((item) => !item.name || !item.category)) {
      res.status(400).json({ error: "Барааны нэр болон ангилал хоосон байж болохгүй" });
      return;
    }
    const totalAmount = money(normalizedItems.reduce((total, item) => total + item.totalAmount, 0));
    const result = await db.transaction(async (tx) => {
      const normalizedSupplierName = supplierName.toLocaleLowerCase("mn-MN");
      let [supplier] = await tx.select().from(inventorySuppliersTable)
        .where(eq(inventorySuppliersTable.normalizedName, normalizedSupplierName));
      if (!supplier) {
        [supplier] = await tx.insert(inventorySuppliersTable).values({
          name: supplierName,
          normalizedName: normalizedSupplierName,
        }).onConflictDoNothing().returning();
        if (!supplier) {
          [supplier] = await tx.select().from(inventorySuppliersTable)
            .where(eq(inventorySuppliersTable.normalizedName, normalizedSupplierName));
        }
      }
      const [purchase] = await tx
        .insert(inventoryPurchasesTable)
        .values({ materialType: input.materialType, documentName: supplier.name, hasReceipt: input.hasReceipt, date: input.date, totalAmount })
        .returning();
      const purchaseLines = [];
      for (const item of normalizedItems) {
        const normalizedName = item.name.toLocaleLowerCase("mn-MN");
        let [catalogItem] = item.inventoryItemId
          ? await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, item.inventoryItemId))
          : await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.normalizedName, normalizedName));
        if (!catalogItem) {
          [catalogItem] = await tx.insert(inventoryItemsTable).values({
            materialType: input.materialType,
            name: item.name,
            normalizedName,
            category: item.category,
            unit: item.unit,
            quantity: 0,
          }).returning();
        }
        await tx.update(inventoryItemsTable)
          .set({ materialType: input.materialType, quantity: sql`${inventoryItemsTable.quantity} + ${item.quantity}` })
          .where(eq(inventoryItemsTable.id, catalogItem.id));
        purchaseLines.push({
          purchaseId: purchase.id,
          inventoryItemId: catalogItem.id,
          name: catalogItem.name,
          category: catalogItem.category,
          unit: catalogItem.unit,
          quantity: item.quantity,
          remainingQuantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
        });
      }
      const savedItems = await tx.insert(inventoryPurchaseItemsTable).values(purchaseLines).returning();
      return { purchase, savedItems };
    });
    res.status(201).json(CreateInventoryPurchaseResponse.parse({
      id: result.purchase.id,
      materialType: result.purchase.materialType,
      supplierName: result.purchase.documentName,
      hasReceipt: result.purchase.hasReceipt,
      date: result.purchase.date,
      totalAmount: Number(result.purchase.totalAmount),
      paid: false,
      paymentDate: null,
      paymentAmount: null,
      createdAt: result.purchase.createdAt.toISOString(),
      editable: true,
      items: result.savedItems.map((item) => ({
        id: item.id,
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalAmount: Number(item.totalAmount),
      })),
    }));
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/purchases/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventoryPurchaseParams.parse(req.params);
    const input = UpdateInventoryPurchaseBody.parse(req.body);
    const supplierName = input.supplierName.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!supplierName) {
      res.status(400).json({ error: "Харилцагчийн нэр хоосон байж болохгүй" });
      return;
    }
    const [existing] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    if (await isCashDateClosed(existing.date) || await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авалтыг засах боломжгүй" });
      return;
    }
    const normalizedItems = input.items.map((item) => ({
      ...item,
      name: item.name.trim(),
      category: item.category.trim(),
      totalAmount: money(item.quantity * item.unitPrice),
    }));
    if (normalizedItems.some((item) => !item.name || !item.category)) {
      res.status(400).json({ error: "Барааны нэр болон ангилал хоосон байж болохгүй" });
      return;
    }
    const totalAmount = money(normalizedItems.reduce((total, item) => total + item.totalAmount, 0));
    const result = await db.transaction(async (tx) => {
      const normalizedSupplierName = supplierName.toLocaleLowerCase("mn-MN");
      let [supplier] = await tx.select().from(inventorySuppliersTable)
        .where(eq(inventorySuppliersTable.normalizedName, normalizedSupplierName));
      if (!supplier) {
        [supplier] = await tx.insert(inventorySuppliersTable).values({
          name: supplierName,
          normalizedName: normalizedSupplierName,
        }).onConflictDoNothing().returning();
        if (!supplier) {
          [supplier] = await tx.select().from(inventorySuppliersTable)
            .where(eq(inventorySuppliersTable.normalizedName, normalizedSupplierName));
        }
      }
      const oldLines = await tx.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id));
      // A lot that's already been (partially) consumed by a FIFO issue can't be
      // silently replaced -- the issue's consumption record would point at a
      // deleted row. Block the edit instead of corrupting the ledger.
      const consumedLine = oldLines.find((line) => Number(line.remainingQuantity) < Number(line.quantity));
      if (consumedLine) {
        return { kind: "consumed" as const };
      }
      for (const oldLine of oldLines) {
        if (oldLine.inventoryItemId) {
          await tx.update(inventoryItemsTable)
            .set({ quantity: sql`${inventoryItemsTable.quantity} - ${oldLine.quantity}` })
            .where(eq(inventoryItemsTable.id, oldLine.inventoryItemId));
        }
      }
      await tx.delete(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id));
      const purchaseLines = [];
      for (const item of normalizedItems) {
        const normalizedName = item.name.toLocaleLowerCase("mn-MN");
        let [catalogItem] = item.inventoryItemId
          ? await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, item.inventoryItemId))
          : await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.normalizedName, normalizedName));
        if (!catalogItem) {
          [catalogItem] = await tx.insert(inventoryItemsTable).values({
            materialType: input.materialType,
            name: item.name,
            normalizedName,
            category: item.category,
            unit: item.unit,
            quantity: 0,
          }).returning();
        }
        await tx.update(inventoryItemsTable)
          .set({ materialType: input.materialType, quantity: sql`${inventoryItemsTable.quantity} + ${item.quantity}` })
          .where(eq(inventoryItemsTable.id, catalogItem.id));
        purchaseLines.push({
          purchaseId: id,
          inventoryItemId: catalogItem.id,
          name: catalogItem.name,
          category: catalogItem.category,
          unit: catalogItem.unit,
          quantity: item.quantity,
          remainingQuantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
        });
      }
      const savedItems = await tx.insert(inventoryPurchaseItemsTable).values(purchaseLines).returning();
      const [purchase] = await tx.update(inventoryPurchasesTable).set({
        materialType: input.materialType,
        documentName: supplier.name,
        hasReceipt: input.hasReceipt,
        date: input.date,
        totalAmount,
      }).where(eq(inventoryPurchasesTable.id, id)).returning();
      if (existing.paymentDate) {
        await tx.update(cashTransactionsTable)
          .set({ category: inventoryMaterialLabel(input.materialType), description: supplier.name })
          .where(and(
            eq(cashTransactionsTable.sourceType, "inventory_purchase"),
            eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
          ));
      }
      return { kind: "updated" as const, purchase, savedItems };
    });
    if (result.kind === "consumed") {
      res.status(409).json({ error: "Энэ худалдан авалтын бараа аль хэдийн зарлагдсан тул засах боломжгүй" });
      return;
    }
    res.json(UpdateInventoryPurchaseResponse.parse({
      id: result.purchase.id,
      materialType: result.purchase.materialType,
      supplierName: result.purchase.documentName,
      hasReceipt: result.purchase.hasReceipt,
      date: result.purchase.date,
      totalAmount: Number(result.purchase.totalAmount),
      paid: result.purchase.paymentDate !== null,
      paymentDate: result.purchase.paymentDate,
      paymentAmount: result.purchase.paymentAmount === null ? null : Number(result.purchase.paymentAmount),
      createdAt: result.purchase.createdAt.toISOString(),
      editable: true,
      items: result.savedItems.map((item) => ({
        id: item.id,
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalAmount: Number(item.totalAmount),
      })),
    }));
  } catch (error) {
    next(error);
  }
});

async function inventoryPurchaseResponse(id: number) {
  const [purchase] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
  if (!purchase) return null;
  const [items, closure] = await Promise.all([
    db.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id)),
    db.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, purchase.date)),
  ]);
  return {
    id: purchase.id,
    materialType: purchase.materialType,
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

router.get("/inventory/purchases/:id/payment-bank-suggestions", async (req, res, next) => {
  try {
    const { id } = ListInventoryPurchasePaymentBankSuggestionsParams.parse(req.params);
    const [purchase] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!purchase) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    const candidates = await db.select().from(bankTransactionsTable).where(and(
      eq(bankTransactionsTable.type, "expense"),
      isNull(bankTransactionsTable.cashTransactionId),
      isNull(bankTransactionsTable.transferredAt),
      isNull(bankTransactionsTable.unclearAt),
      gte(bankTransactionsTable.transactionAt, calendarDateOffset(purchase.date, -7)),
      lte(bankTransactionsTable.transactionAt, calendarDateOffset(purchase.date, 8)),
    ));
    const suggestions = candidates
      .map((bank) => ({ bank, score: inventoryBankSuggestionScore(purchase, bank) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ bank, score }) => ({
        id: bank.id,
        transactionAt: bank.transactionAt.toISOString(),
        amount: Number(bank.amount),
        description: bank.description,
        score,
      }));
    res.json(ListInventoryPurchasePaymentBankSuggestionsResponse.parse(suggestions));
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/purchases/:id/payment", async (req, res, next) => {
  try {
    const { id } = ConfirmInventoryPurchasePaymentParams.parse(req.params);
    const input = ConfirmInventoryPurchasePaymentBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const [existing] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if ((existing.paymentDate && await isCashDateClosed(existing.paymentDate)) || await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг өөрчлөх боломжгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [currentPurchase] = await tx.select().from(inventoryPurchasesTable)
        .where(eq(inventoryPurchasesTable.id, id))
        .for("update");
      if (!currentPurchase) return "purchase_missing" as const;
      if (currentPurchase.paymentDate !== null) return "already_paid" as const;
      const [closure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable)
        .where(eq(cashClosuresTable.date, input.date));
      if (closure) return "cash_closed" as const;
      const [existingCash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      const [bank] = input.bankTransactionId == null
        ? []
        : await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, input.bankTransactionId));
      if (input.bankTransactionId != null) {
        if (!bank) return "bank_missing" as const;
        const bankDate = bank.transactionAt.toISOString().slice(0, 10);
        if (bank.type !== "expense" || bank.unclearAt !== null || bankDate !== input.date || money(Number(bank.amount)) !== money(input.amount)) {
          return "bank_mismatch" as const;
        }
        if (existingCash?.bankTransactionId && existingCash.bankTransactionId !== bank.id) return "bank_conflict" as const;
        if ((bank.cashTransactionId !== null || bank.transferredAt !== null) && bank.cashTransactionId !== existingCash?.id) {
          return "bank_conflict" as const;
        }
      }
      await tx.update(inventoryPurchasesTable)
        .set({ paymentDate: input.date, paymentAmount: money(input.amount) })
        .where(eq(inventoryPurchasesTable.id, id));
      const verifiedAt = bank ? new Date() : null;
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense",
        category: inventoryMaterialLabel(currentPurchase.materialType),
        description: currentPurchase.documentName,
        amount: money(input.amount),
        date: input.date,
        sourceType: "inventory_purchase",
        sourceKey: `purchase:${id}`,
        bankTransactionId: bank?.id ?? null,
        bankVerifiedAt: verifiedAt,
      }).onConflictDoUpdate({
        target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
        set: {
          category: inventoryMaterialLabel(currentPurchase.materialType),
          description: currentPurchase.documentName,
          amount: money(input.amount),
          date: input.date,
          ...(bank ? { bankTransactionId: bank.id, bankVerifiedAt: verifiedAt } : {}),
        },
      }).returning({ id: cashTransactionsTable.id });
      if (bank && bank.cashTransactionId !== cash!.id) {
        const [updatedBank] = await tx.update(bankTransactionsTable)
          .set({ cashTransactionId: cash!.id, transferredAt: verifiedAt })
          .where(and(
            eq(bankTransactionsTable.id, bank.id),
            isNull(bankTransactionsTable.cashTransactionId),
            isNull(bankTransactionsTable.transferredAt),
          ))
          .returning({ id: bankTransactionsTable.id });
        if (!updatedBank) throw new InventoryBankPaymentConflictError();
      }
      return "paid" as const;
    });
    if (result === "purchase_missing") {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (result === "already_paid") {
      res.status(409).json({ error: "Энэ худалдан авалтын төлбөр аль хэдийн батлагдсан байна" });
      return;
    }
    if (result === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг өөрчлөх боломжгүй" });
      return;
    }
    if (result === "bank_missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "bank_mismatch") {
      res.status(409).json({ error: "Сонгосон банкны гүйлгээний төрөл, огноо эсвэл дүн тохирохгүй байна" });
      return;
    }
    if (result === "bank_conflict") {
      res.status(409).json({ error: "Банкны гүйлгээ өөр кассын бүртгэлтэй аль хэдийн холбогдсон байна" });
      return;
    }
    const response = await inventoryPurchaseResponse(id);
    res.json(ConfirmInventoryPurchasePaymentResponse.parse(response));
  } catch (error) {
    const databaseCode = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (error instanceof InventoryBankPaymentConflictError || databaseCode === "23505") {
      res.status(409).json({ error: "Банкны гүйлгээ өөр кассын бүртгэлтэй аль хэдийн холбогдсон байна" });
      return;
    }
    next(error);
  }
});

router.delete("/inventory/purchases/:id/payment", async (req, res, next) => {
  try {
    const { id } = CancelInventoryPurchasePaymentParams.parse(req.params);
    const [existing] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (existing.paymentDate && await isCashDateClosed(existing.paymentDate)) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг цуцлах боломжгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [currentPurchase] = await tx.select().from(inventoryPurchasesTable)
        .where(eq(inventoryPurchasesTable.id, id))
        .for("update");
      if (!currentPurchase) return "missing" as const;
      if (currentPurchase.paymentDate) {
        const [closure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, currentPurchase.paymentDate));
        if (closure) return "closed" as const;
      }
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      if (cash?.bankTransactionId) {
        await tx.update(bankTransactionsTable)
          .set({ cashTransactionId: null, transferredAt: null })
          .where(and(
            eq(bankTransactionsTable.id, cash.bankTransactionId),
            eq(bankTransactionsTable.cashTransactionId, cash.id),
          ));
      }
      await tx.update(inventoryPurchasesTable)
        .set({ paymentDate: null, paymentAmount: null })
        .where(eq(inventoryPurchasesTable.id, id));
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      return "cancelled" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (result === "closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг цуцлах боломжгүй" });
      return;
    }
    const response = await inventoryPurchaseResponse(id);
    res.json(CancelInventoryPurchasePaymentResponse.parse(response));
  } catch (error) {
    next(error);
  }
});

router.delete("/inventory/purchases/:id", async (req, res, next) => {
  try {
    const { id } = DeleteInventoryPurchaseParams.parse(req.params);
    const [existing] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (await isCashDateClosed(existing.date) || (existing.paymentDate && await isCashDateClosed(existing.paymentDate))) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авалтыг устгах боломжгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      const lines = await tx.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id));
      const consumedLine = lines.find((line) => Number(line.remainingQuantity) < Number(line.quantity));
      if (consumedLine) {
        return { kind: "consumed" as const };
      }
      if (cash?.bankTransactionId) {
        await tx.update(bankTransactionsTable)
          .set({ cashTransactionId: null, transferredAt: null })
          .where(and(
            eq(bankTransactionsTable.id, cash.bankTransactionId),
            eq(bankTransactionsTable.cashTransactionId, cash.id),
          ));
      }
      for (const line of lines) {
        if (line.inventoryItemId) {
          await tx.update(inventoryItemsTable)
            .set({ quantity: sql`${inventoryItemsTable.quantity} - ${line.quantity}` })
            .where(eq(inventoryItemsTable.id, line.inventoryItemId));
        }
      }
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      await tx.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
      return { kind: "deleted" as const };
    });
    if (result.kind === "consumed") {
      res.status(409).json({ error: "Энэ худалдан авалтын бараа аль хэдийн зарлагдсан тул устгах боломжгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/purchases/:id/reclassify-as-expense", async (req, res, next) => {
  try {
    const { id } = ReclassifyInventoryPurchaseAsExpenseParams.parse(req.params);
    const input = ReclassifyInventoryPurchaseAsExpenseBody.parse(req.body);
    const category = input.category.trim();
    if (!category) {
      res.status(400).json({ error: "Ангилал сонгоно уу" });
      return;
    }
    const [existing] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Худалдан авалт олдсонгүй" });
      return;
    }
    if (await isCashDateClosed(existing.date) || (existing.paymentDate && await isCashDateClosed(existing.paymentDate))) {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авалтыг шилжүүлэх боломжгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const lines = await tx.select().from(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id));
      const consumedLine = lines.find((line) => Number(line.remainingQuantity) < Number(line.quantity));
      if (consumedLine) {
        return { kind: "consumed" as const };
      }
      // Reverse the stock this purchase added -- once reclassified it's not
      // inventory anymore.
      for (const line of lines) {
        if (line.inventoryItemId) {
          await tx.update(inventoryItemsTable)
            .set({ quantity: sql`${inventoryItemsTable.quantity} - ${line.quantity}` })
            .where(eq(inventoryItemsTable.id, line.inventoryItemId));
        }
      }
      const [newExpense] = await tx.insert(operatingExpensesTable).values({
        description: existing.documentName,
        category,
        date: existing.date,
        amount: existing.totalAmount,
        paymentDate: existing.paymentDate,
        paymentAmount: existing.paymentAmount,
      }).returning();
      // If this purchase was already paid, retarget its existing cash
      // transaction at the new expense (in place) instead of deleting and
      // recreating one -- that keeps an existing bank-statement link intact
      // rather than having to re-verify it.
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
      ));
      if (cash) {
        await tx.update(cashTransactionsTable).set({
          category: "Үйл ажиллагааны зардал",
          description: existing.documentName,
          sourceType: "operating_expense",
          sourceKey: `expense:${newExpense.id}`,
        }).where(eq(cashTransactionsTable.id, cash.id));
        await tx.update(operatingExpensesTable).set({
          bankTransactionId: cash.bankTransactionId,
          cashTransactionId: cash.id,
        }).where(eq(operatingExpensesTable.id, newExpense.id));
      }
      await tx.delete(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.purchaseId, id));
      await tx.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, id));
      const [savedExpense] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, newExpense.id));
      return { kind: "reclassified" as const, expense: savedExpense };
    });
    if (result.kind === "consumed") {
      res.status(409).json({ error: "Энэ худалдан авалтын бараа аль хэдийн зарлагдсан тул шилжүүлэх боломжгүй" });
      return;
    }
    res.status(201).json(ReclassifyInventoryPurchaseAsExpenseResponse.parse(operatingExpenseResponse(result.expense)));
  } catch (error) {
    next(error);
  }
});

router.get("/operating-expenses", async (_req, res, next) => {
  try {
    const rows = await db.transaction((tx) => reconcileOperatingExpenses(tx));
    res.json(ListOperatingExpensesResponse.parse(rows.map(operatingExpenseResponse)));
  } catch (error) { next(error); }
});

router.post("/operating-expenses", async (req, res, next) => {
  try {
    const input = CreateOperatingExpenseBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) { res.status(400).json({ error: "Хуанлийн огноо буруу байна" }); return; }
    if (await isCashDateClosed(input.date)) { res.status(409).json({ error: "Өндөрлөсөн өдөр зардал бүртгэх боломжгүй" }); return; }
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, input.categoryId));
    if (!account) { res.status(400).json({ error: "Сонгосон данс олдсонгүй" }); return; }
    const [row] = await db.insert(operatingExpensesTable).values({
      description: input.description.trim(), category: account.name, categoryId: account.id, date: input.date, amount: money(input.amount),
    }).returning();
    res.status(201).json(CreateOperatingExpenseResponse.parse(operatingExpenseResponse(row)));
  } catch (error) { next(error); }
});

router.put("/operating-expenses/:id", async (req, res, next) => {
  try {
    const { id } = UpdateOperatingExpenseParams.parse(req.params);
    const input = UpdateOperatingExpenseBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) { res.status(400).json({ error: "Хуанлийн огноо буруу байна" }); return; }
    if (await isCashDateClosed(input.date)) { res.status(409).json({ error: "Өндөрлөсөн өдөр зардал бүртгэх боломжгүй" }); return; }
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, input.categoryId));
    if (!account) { res.status(400).json({ error: "Сонгосон данс олдсонгүй" }); return; }
    const result = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id)).for("update");
      if (!old) return null;
      if (old.paymentDate) return "paid" as const;
      const [oldClosure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, old.date));
      if (oldClosure) return "closed" as const;
      return (await tx.update(operatingExpensesTable).set({
        description: input.description.trim(), category: account.name, categoryId: account.id, date: input.date, amount: money(input.amount),
      }).where(eq(operatingExpensesTable.id, id)).returning())[0];
    });
    if (result === null) { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    if (result === "paid") { res.status(409).json({ error: "Төлбөр батлагдсан зардлыг засах боломжгүй" }); return; }
    if (result === "closed") { res.status(409).json({ error: "Өндөрлөсөн өдрийн зардлыг засах боломжгүй" }); return; }
    res.json(UpdateOperatingExpenseResponse.parse(operatingExpenseResponse(result)));
  } catch (error) { next(error); }
});

router.get("/operating-expenses/:id/payment-bank-suggestions", async (req, res, next) => {
  try {
    const { id } = ListOperatingExpensePaymentBankSuggestionsParams.parse(req.params);
    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id));
    if (!expense) { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    const start = new Date(`${expense.date}T00:00:00.000Z`); start.setUTCDate(start.getUTCDate() - 7);
    const end = new Date(`${expense.date}T23:59:59.999Z`); end.setUTCDate(end.getUTCDate() + 7);
    const banks = await db.select().from(bankTransactionsTable).where(and(
      eq(bankTransactionsTable.type, "expense"), isNull(bankTransactionsTable.cashTransactionId),
      isNull(bankTransactionsTable.transferredAt), isNull(bankTransactionsTable.unclearAt),
      gte(bankTransactionsTable.transactionAt, start), lte(bankTransactionsTable.transactionAt, end),
    ));
    const words = `${expense.description} ${expense.category}`.toLocaleLowerCase("mn-MN").split(/\s+/).filter((w) => w.length > 1);
    const result = banks.map((bank) => {
      const days = Math.abs(new Date(bank.transactionAt).getTime() - new Date(`${expense.date}T12:00:00Z`).getTime()) / 86400000;
      const text = `${bank.description} ${bank.counterparty}`.toLocaleLowerCase("mn-MN");
      const score = (Math.abs(Number(bank.amount) - Number(expense.amount)) < 0.01 ? 60 : 0) + Math.max(0, 30 - days * 4) + words.filter((w) => text.includes(w)).length * 5;
      return { id: bank.id, transactionAt: bank.transactionAt.toISOString(), amount: Number(bank.amount), description: bank.description, score };
    }).sort((a, b) => b.score - a.score);
    res.json(ListOperatingExpensePaymentBankSuggestionsResponse.parse(result));
  } catch (error) { next(error); }
});

router.put("/operating-expenses/:id/payment", async (req, res, next) => {
  try {
    const { id } = ConfirmOperatingExpensePaymentParams.parse(req.params);
    const input = ConfirmOperatingExpensePaymentBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) { res.status(400).json({ error: "Хуанлийн огноо буруу байна" }); return; }
    if (await isCashDateClosed(input.date)) { res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг өөрчлөх боломжгүй" }); return; }
    const result = await db.transaction(async (tx) => {
      const [expense] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id)).for("update");
      if (!expense) return "missing" as const;
      if (expense.paymentDate) return "paid" as const;
      if (input.bankTransactionId) {
        const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, input.bankTransactionId)).for("update");
        if (!bank) return "bank_missing" as const;
        const bankDate = calendarDateText(bank.transactionAt);
        if (bank.type !== "expense" || bankDate !== input.date || Number(bank.amount) !== Number(input.amount) || bank.cashTransactionId || bank.transferredAt || bank.unclearAt) return "bank_conflict" as const;
      }
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense", category: "Үйл ажиллагааны зардал", description: expense.description,
        amount: money(input.amount), date: input.date, sourceType: "operating_expense", sourceKey: `expense:${id}`,
        bankTransactionId: input.bankTransactionId ?? null,
        bankVerifiedAt: input.bankTransactionId ? new Date() : null,
      }).returning();
      if (input.bankTransactionId) {
        const [linkedBank] = await tx.update(bankTransactionsTable)
          .set({ cashTransactionId: cash.id, transferredAt: new Date() })
          .where(and(
            eq(bankTransactionsTable.id, input.bankTransactionId),
            isNull(bankTransactionsTable.cashTransactionId),
            isNull(bankTransactionsTable.transferredAt),
          ))
          .returning({ id: bankTransactionsTable.id });
        if (!linkedBank) throw new OperatingExpenseBankPaymentConflictError();
      }
      await tx.update(operatingExpensesTable).set({
        paymentDate: input.date, paymentAmount: money(input.amount),
        bankTransactionId: input.bankTransactionId ?? null, cashTransactionId: cash.id,
      }).where(eq(operatingExpensesTable.id, id));
      return "ok" as const;
    });
    if (result === "missing") { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    if (result === "paid") { res.status(409).json({ error: "Төлбөр аль хэдийн батлагдсан байна" }); return; }
    if (result === "bank_missing") { res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" }); return; }
    if (result === "bank_conflict") { res.status(409).json({ error: "Банкны гүйлгээ тохирохгүй эсвэл холбогдсон байна" }); return; }
    const [row] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id));
    res.json(ConfirmOperatingExpensePaymentResponse.parse(operatingExpenseResponse(row)));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (error instanceof OperatingExpenseBankPaymentConflictError || code === "23505") {
      res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн холбогдсон байна" });
      return;
    }
    next(error);
  }
});

router.delete("/operating-expenses/:id/payment", async (req, res, next) => {
  try {
    const { id } = CancelOperatingExpensePaymentParams.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const [expense] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id)).for("update");
      if (!expense) return "missing" as const;
      const [expenseClosure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, expense.date));
      if (expenseClosure) return "closed" as const;
      if (expense.paymentDate && await isCashDateClosed(expense.paymentDate)) return "closed" as const;
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.id, expense.cashTransactionId ?? -1),
      )).for("update");
      const [legacyCash] = cash ? [cash] : await tx.select().from(cashTransactionsTable).where(and(eq(cashTransactionsTable.sourceType, "operating_expense"), eq(cashTransactionsTable.sourceKey, `expense:${id}`))).for("update");
      if (legacyCash?.bankTransactionId) await tx.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, legacyCash.bankTransactionId));
      await tx.update(operatingExpensesTable).set({ bankTransactionId: null, cashTransactionId: null }).where(eq(operatingExpensesTable.id, id));
      await tx.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, legacyCash?.id ?? -1));
      await tx.update(operatingExpensesTable).set({ paymentDate: null, paymentAmount: null }).where(eq(operatingExpensesTable.id, id));
      return "ok" as const;
    });
    if (result === "missing") { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    if (result === "closed") { res.status(409).json({ error: "Өндөрлөсөн өдрийн төлбөрийг цуцлах боломжгүй" }); return; }
    const [row] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id));
    res.json(CancelOperatingExpensePaymentResponse.parse(operatingExpenseResponse(row)));
  } catch (error) { next(error); }
});

router.delete("/operating-expenses/:id", async (req, res, next) => {
  try {
    const { id } = DeleteOperatingExpenseParams.parse(req.params);
    const deleted = await db.transaction(async (tx) => {
      const [expense] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id)).for("update");
      if (!expense) return "missing" as const;
      const [expenseClosure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, expense.date));
      if (expenseClosure) return "closed" as const;
      if (expense.paymentDate && await isCashDateClosed(expense.paymentDate)) return "closed" as const;
      const [cash] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, expense.cashTransactionId ?? -1)).for("update");
      const [legacyCash] = cash ? [cash] : await tx.select().from(cashTransactionsTable).where(and(eq(cashTransactionsTable.sourceType, "operating_expense"), eq(cashTransactionsTable.sourceKey, `expense:${id}`))).for("update");
      if (legacyCash?.bankTransactionId) await tx.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, legacyCash.bankTransactionId));
      await tx.update(operatingExpensesTable).set({ bankTransactionId: null, cashTransactionId: null }).where(eq(operatingExpensesTable.id, id));
      await tx.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, legacyCash?.id ?? -1));
      await tx.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, id));
      return "ok" as const;
    });
    if (deleted === "missing") { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    if (deleted === "closed") { res.status(409).json({ error: "Өндөрлөсөн өдрийн зардлыг устгах боломжгүй" }); return; }
    res.status(204).send();
  } catch (error) { next(error); }
});

router.get("/chart-of-accounts", async (_req, res, next) => {
  try {
    let rows = await db.select().from(chartOfAccountsTable).orderBy(asc(chartOfAccountsTable.code));
    if (rows.length === 0) {
      await db.insert(chartOfAccountsTable).values([...defaultChartOfAccounts]).onConflictDoNothing({
        target: chartOfAccountsTable.code,
      });
      rows = await db.select().from(chartOfAccountsTable).orderBy(asc(chartOfAccountsTable.code));
    }
    res.json(ListChartOfAccountsResponse.parse(rows.map(chartOfAccountResponse)));
  } catch (error) {
    next(error);
  }
});

router.post("/chart-of-accounts", async (req, res, next) => {
  try {
    const input = CreateChartOfAccountBody.parse(req.body);
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Дансны нэр хоосон байж болохгүй" });
      return;
    }
    const [row] = await db.insert(chartOfAccountsTable).values({
      code: input.code,
      name,
      type: input.type,
    }).returning();
    res.status(201).json(CreateChartOfAccountResponse.parse(chartOfAccountResponse(row)));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Энэ дансны код бүртгэлтэй байна" });
      return;
    }
    next(error);
  }
});

router.put("/chart-of-accounts/:id", async (req, res, next) => {
  try {
    const { id } = UpdateChartOfAccountParams.parse(req.params);
    const input = UpdateChartOfAccountBody.parse(req.body);
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Дансны нэр хоосон байж болохгүй" });
      return;
    }
    const [row] = await db.update(chartOfAccountsTable).set({
      code: input.code,
      name,
      type: input.type,
    }).where(eq(chartOfAccountsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Данс олдсонгүй" });
      return;
    }
    res.json(UpdateChartOfAccountResponse.parse(chartOfAccountResponse(row)));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Энэ дансны код бүртгэлтэй байна" });
      return;
    }
    next(error);
  }
});

router.delete("/chart-of-accounts/:id", async (req, res, next) => {
  try {
    const { id } = DeleteChartOfAccountParams.parse(req.params);
    const [row] = await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).returning({
      id: chartOfAccountsTable.id,
    });
    if (!row) {
      res.status(404).json({ error: "Данс олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;