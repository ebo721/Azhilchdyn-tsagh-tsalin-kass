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

export default router;
