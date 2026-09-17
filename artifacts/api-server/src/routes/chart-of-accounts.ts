import { Router, type IRouter } from "express";
import { createServer } from "node:http";
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
import * as shared from "../lib/route-shared.js";
import type { SalaryHistoryRow, PayrollCalculationData, Tx } from "../lib/route-shared.js";

const router: IRouter = Router();
const { dispatchApprovedDeletion, isCashDateClosed, operatingExpenseResponse, operatingExpenseAccountName, inventoryMaterialLabel, defaultChartOfAccounts, operatingExpenseAccountCodes, inventoryPurchaseAccountCodes, reservedAccountTypes, chartOfAccountResponse, ensureDefaultChartOfAccounts, inventoryPurchaseAccount, lockedExpenseAccount, fallbackExpenseAccount, today, currentMonth, money, InventoryBankPaymentConflictError, OperatingExpenseBankPaymentConflictError, calendarDateOffset, descriptionTokens, inventoryBankSuggestionScore, deletionTargetPatterns, roleCanRequestDeletion, deletionRequestResponse, monthlyIncomeTaxRelief, hoursBetween, previousMonth, nextMonth, daysInMonth, isValidCalendarDate, calendarDateText, weekdayCount, monthWeekdays, defaultPayrollSchedule, getPayrollSchedule, scheduleDate, payrollPeriod, selectPayrollScheduleVersion, scheduleVersionAffectsMonth, shiftDailyRate, weekdayDatesBetween, salaryAt, getPayrollSummary, getPayrollAdvanceSummary, calculatePayrollAdvanceLine, InventoryInsufficientStockError, planInventoryFifoConsumption, applyInventoryFifoConsumption, reverseInventoryFifoConsumption, inventoryPurchaseResponse } = shared;



router.get("/chart-of-accounts", async (_req, res, next) => {
  try {
    let rows = await db.select().from(chartOfAccountsTable).orderBy(asc(chartOfAccountsTable.code));
    if (rows.length === 0) {
      await ensureDefaultChartOfAccounts(db);
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
    const reservedType = reservedAccountTypes[input.code];
    if (reservedType && input.type !== reservedType) {
      res.status(400).json({ error: `Нөөц ${input.code} код нь ${reservedType} төрөлтэй байна` });
      return;
    }
    const [row] = await db.insert(chartOfAccountsTable).values({
      code: input.code,
      name,
      type: input.type,
      normalBalance: input.code === "1810" && input.type === "asset"
        ? "credit"
        : input.type === "asset" || input.type === "expense" ? "debit" : "credit",
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
    const reservedType = reservedAccountTypes[input.code];
    if (reservedType && input.type !== reservedType) {
      res.status(400).json({ error: `Нөөц ${input.code} код нь ${reservedType} төрөлтэй байна` });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).for("update");
      if (!existing) return { kind: "missing" as const };
      const existingReservedType = reservedAccountTypes[existing.code];
      if (existingReservedType && (input.code !== existing.code || input.type !== existingReservedType)) {
        return { kind: "reserved" as const };
      }
      if (existing.type === "expense" && input.type !== "expense") {
        const [linked] = await tx.select({ id: operatingExpensesTable.id })
          .from(operatingExpensesTable)
          .where(eq(operatingExpensesTable.accountId, id))
          .limit(1);
        if (linked) return { kind: "in_use" as const };
      }
      const [row] = await tx.update(chartOfAccountsTable).set({
        code: input.code,
        name,
        type: input.type,
        normalBalance: input.code === "1810" && input.type === "asset"
          ? "credit"
          : input.type === "asset" || input.type === "expense" ? "debit" : "credit",
      }).where(eq(chartOfAccountsTable.id, id)).returning();
      return { kind: "updated" as const, row };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Данс олдсонгүй" });
      return;
    }
    if (result.kind === "in_use") {
      res.status(409).json({ error: "Зардалд ашиглагдсан дансны төрлийг өөрчлөх боломжгүй" });
      return;
    }
    if (result.kind === "reserved") {
      res.status(409).json({ error: "Системийн mapping-д ашиглагддаг дансны код болон төрлийг өөрчлөх боломжгүй" });
      return;
    }
    const row = result.row;
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
    const [existing] = await db.select({ code: chartOfAccountsTable.code })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.id, id));
    if (existing && reservedAccountTypes[existing.code]) {
      res.status(409).json({ error: "Системийн mapping-д ашиглагддаг дансыг устгах боломжгүй" });
      return;
    }
    const [row] = await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).returning({
      id: chartOfAccountsTable.id,
    });
    if (!row) {
      res.status(404).json({ error: "Данс олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23503") {
      res.status(409).json({ error: "Энэ данс зардлын бүртгэлд ашиглагдсан тул устгах боломжгүй" });
      return;
    }
    next(error);
  }
});

export default router;
