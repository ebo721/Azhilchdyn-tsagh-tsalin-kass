import type { RequestHandler } from "express";
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
const requireStaffAuth: RequestHandler = async (req, res, next) => {
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
  if (req.method === "DELETE" && session.role === "accountant" && /^\/journal\/entries\/\d+$/.test(req.path)) {
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
  const matchesPrefix = (prefix: string) => req.path === prefix || req.path.startsWith(`${prefix}/`);
  const viewerReadPrefixes = ["/employees", "/attendance", "/hour-balance", "/payroll", "/payroll-advance", "/cash", "/bank-accounts", "/bank-transactions", "/inventory", "/meals", "/meal-schedule", "/fixed-assets", "/operating-expenses", "/journal"];
  if (role === "viewer" && req.method === "GET" && viewerReadPrefixes.some(matchesPrefix)) {
    next();
    return;
  }
  if (role === "accountant" && (
    (req.method === "GET" && req.path === "/employees")
    || (req.method === "GET" && (
      req.path === "/attendance/shifts"
      || req.path === "/attendance/shift-plans"
    ))
    || (req.method === "PATCH" && req.path.startsWith("/employees/"))
    || matchesPrefix("/operating-expenses")
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
        ? ["/hour-balance", "/payroll", "/payroll-advance", "/payroll-schedule", "/cash", "/bank-accounts", "/bank-transactions", "/journal"]
      : role === "warehouse"
        ? ["/inventory", "/meals", "/meal-schedule", "/fixed-assets", "/operating-expenses"]
        : [];
  if (allowedPrefixes.some(matchesPrefix)) {
    next();
    return;
  }
  res.status(403).json({ error: "Энэ хэсэгт хандах эрхгүй" });
};

export default requireStaffAuth as RequestHandler;
