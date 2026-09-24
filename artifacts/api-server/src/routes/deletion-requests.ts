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
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import mealScheduleRouter from "./meal-schedule.js";
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
  mealsTable,
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
const protectedMealScheduleRouter: IRouter = Router();
protectedMealScheduleRouter.use(requireStaffAuth, mealScheduleRouter);
const { dispatchApprovedDeletion, isCashDateClosed, operatingExpenseResponse, operatingExpenseAccountName, inventoryMaterialLabel, defaultChartOfAccounts, operatingExpenseAccountCodes, inventoryPurchaseAccountCodes, reservedAccountTypes, chartOfAccountResponse, ensureDefaultChartOfAccounts, inventoryPurchaseAccount, lockedExpenseAccount, fallbackExpenseAccount, today, currentMonth, money, InventoryBankPaymentConflictError, OperatingExpenseBankPaymentConflictError, calendarDateOffset, descriptionTokens, inventoryBankSuggestionScore, deletionTargetPatterns, roleCanRequestDeletion, deletionRequestResponse, monthlyIncomeTaxRelief, hoursBetween, previousMonth, nextMonth, daysInMonth, isValidCalendarDate, calendarDateText, weekdayCount, monthWeekdays, defaultPayrollSchedule, getPayrollSchedule, scheduleDate, payrollPeriod, selectPayrollScheduleVersion, scheduleVersionAffectsMonth, shiftDailyRate, weekdayDatesBetween, salaryAt, getPayrollSummary, getPayrollAdvanceSummary, calculatePayrollAdvanceLine, InventoryInsufficientStockError, planInventoryFifoConsumption, applyInventoryFifoConsumption, reverseInventoryFifoConsumption, inventoryPurchaseResponse } = shared;



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

    // Meal deletion is kept in the same transaction as approval.  Locking the
    // request first makes concurrent approvals serialize before either can
    // remove the meal or mark the request completed.
    const mealMatch = request.targetPath.match(/^\/meals\/(\d+)$/);
    if (mealMatch) {
      try {
        const completed = await db.transaction(async (tx) => {
          const [lockedRequest] = await tx.select().from(deletionRequestsTable)
            .where(eq(deletionRequestsTable.id, id)).for("update");
          if (!lockedRequest) throw new Error("REQUEST_NOT_FOUND");
          if (lockedRequest.status !== "pending") throw new Error("RESOLVED");
          const mealId = Number(mealMatch[1]);
          const [meal] = await tx.select({ id: mealsTable.id }).from(mealsTable)
            .where(eq(mealsTable.id, mealId)).for("update");
          if (!meal) throw new Error("MEAL_NOT_FOUND");
          await tx.delete(mealsTable).where(eq(mealsTable.id, mealId));
          const [updated] = await tx.update(deletionRequestsTable).set({
            status: "completed",
            approvedAt: new Date(),
            completedAt: new Date(),
            error: null,
          }).where(eq(deletionRequestsTable.id, id)).returning();
          if (!updated) throw new Error("REQUEST_NOT_FOUND");
          return updated;
        });
        res.json(ApproveDeletionRequestResponse.parse(deletionRequestResponse(completed)));
      } catch (error) {
        if (error instanceof Error && error.message === "REQUEST_NOT_FOUND") {
          res.status(404).json({ error: "Устгах хүсэлт олдсонгүй" });
          return;
        }
        if (error instanceof Error && error.message === "RESOLVED") {
          res.status(409).json({ error: "Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна" });
          return;
        }
        if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
          res.status(404).json({ error: "Хоол олдсонгүй" });
          return;
        }
        let databaseError: unknown = error;
        let databaseCode: string | undefined;
        for (let depth = 0; depth < 6 && databaseError && typeof databaseError === "object"; depth++) {
          databaseCode = (databaseError as { code?: string }).code;
          if (databaseCode) break;
          databaseError = (databaseError as { cause?: unknown }).cause;
        }
        if (databaseCode === "23503" || databaseCode === "23001") {
          res.status(409).json({ error: "Энэ хоол хуваарьт ашиглагдаж байгаа тул эхлээд хуваарийн бичлэгийг устгана уу" });
          return;
        }
        throw error;
      }
      return;
    }

    const [executing] = await db.transaction(async (tx) => {
      const [lockedRequest] = await tx.select().from(deletionRequestsTable)
        .where(eq(deletionRequestsTable.id, id)).for("update");
      if (!lockedRequest) throw new Error("REQUEST_NOT_FOUND");
      if (lockedRequest.status !== "pending") throw new Error("RESOLVED");
      return tx.update(deletionRequestsTable).set({
        status: "executing",
        approvedAt: new Date(),
        error: null,
      }).where(eq(deletionRequestsTable.id, id)).returning();
    });
    const execution = await dispatchApprovedDeletion(
      request.targetPath,
      req.headers.cookie ?? "",
      id,
      request.targetPath.startsWith("/meal-schedule/")
        ? protectedMealScheduleRouter
        : router,
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
    if (error instanceof Error && error.message === "REQUEST_NOT_FOUND") {
      res.status(404).json({ error: "Устгах хүсэлт олдсонгүй" });
      return;
    }
    if (error instanceof Error && error.message === "RESOLVED") {
      res.status(409).json({ error: "Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна" });
      return;
    }
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

export default router;
