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



router.get("/employees", async (_req, res, next) => {
  try {
    const rows = await db.select().from(employeesTable).orderBy(desc(employeesTable.id));
    res.json(ListEmployeesResponse.parse(rows.map((employee) => ({
      ...employee,
      salaryType: employee.salaryType === "hourly" ? "daily" : employee.salaryType,
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
    const salaryType = input.employeeType === "office" ? "monthly" : input.salaryType;
    if (input.employeeType === "shift" && salaryType === "monthly" && input.monthlyExpectedWorkDays <= 0) {
      res.status(400).json({ error: "Сарын цалинтай ээлжийн ажилтны сард ажиллах ёстой хоногийг 1-ээс ихээр оруулна уу" });
      return;
    }
    const employee = await db.transaction(async (tx) => {
      const [created] = await tx.insert(employeesTable).values({
        ...input,
        joinedAt,
         salaryType,
      }).returning();
      await tx.insert(employeeSalaryHistoryTable).values({
        employeeId: created.id,
        effectiveFrom: joinedAt,
        employeeType: input.employeeType,
         salaryType,
         monthlyExpectedWorkDays: input.monthlyExpectedWorkDays,
        baseSalary: input.baseSalary,
        socialInsuranceSalary: input.socialInsuranceSalary,
        payrollTaxExempt: input.payrollTaxExempt,
        fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance ?? false,
        payFrequency: input.payFrequency,
      });
      return created;
    });
    res.status(201).json({
      ...employee,
      salaryType: employee.salaryType === "hourly" ? "daily" : employee.salaryType,
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
    const currentSalaryType = current.salaryType === "hourly" ? "daily" : current.salaryType;
    const requestedEmployeeType = input.employeeType ?? current.employeeType;
    const requestedSalaryType = requestedEmployeeType === "office"
      ? "monthly"
      : (input.salaryType ?? currentSalaryType);
    const salaryChanged = (input.employeeType !== undefined && input.employeeType !== current.employeeType)
      || (requestedSalaryType !== currentSalaryType)
      || (input.monthlyExpectedWorkDays !== undefined
        && input.monthlyExpectedWorkDays !== current.monthlyExpectedWorkDays)
      || (input.baseSalary !== undefined && Number(input.baseSalary) !== Number(current.baseSalary))
      || (input.socialInsuranceSalary !== undefined
        && Number(input.socialInsuranceSalary) !== (current.payrollTaxExempt ? 0 : Number(current.socialInsuranceSalary)))
      || (input.payrollTaxExempt !== undefined && input.payrollTaxExempt !== current.payrollTaxExempt)
      || (input.fullSalaryRegardlessAttendance !== undefined && input.fullSalaryRegardlessAttendance !== current.fullSalaryRegardlessAttendance)
      || (input.payFrequency !== undefined && input.payFrequency !== current.payFrequency);
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
    const normalizedSalaryType = (employeeInput.employeeType ?? current.employeeType) === "office"
      ? "monthly"
      : (employeeInput.salaryType ?? (current.salaryType === "hourly" ? "daily" : current.salaryType));
    if ((employeeInput.employeeType ?? current.employeeType) === "shift"
      && normalizedSalaryType === "monthly"
      && (employeeInput.monthlyExpectedWorkDays ?? current.monthlyExpectedWorkDays) <= 0) {
      res.status(400).json({ error: "Сарын цалинтай ээлжийн ажилтны сард ажиллах ёстой хоногийг 1-ээс ихээр оруулна уу" });
      return;
    }
    const employee = await db.transaction(async (tx) => {
      const [updated] = await tx.update(employeesTable)
        .set({
          ...employeeInput,
          ...(joinedAt ? { joinedAt } : {}),
          ...(employeeInput.status === "active" ? { inactiveAt: null } : {}),
           salaryType: normalizedSalaryType,
        })
        .where(eq(employeesTable.id, id))
        .returning();
      if (salaryChanged && (salaryEffectiveDate || correctingInitialEmployment)) {
        if (correctingInitialEmployment && baselineSalary) {
          await tx.update(employeeSalaryHistoryTable).set({
            effectiveFrom: joinedAt!,
            employeeType: employeeInput.employeeType ?? current.employeeType,
            salaryType: normalizedSalaryType,
            monthlyExpectedWorkDays: employeeInput.monthlyExpectedWorkDays ?? current.monthlyExpectedWorkDays,
            baseSalary: employeeInput.baseSalary ?? Number(current.baseSalary),
            socialInsuranceSalary: employeeInput.socialInsuranceSalary ?? Number(current.socialInsuranceSalary),
            payrollTaxExempt: employeeInput.payrollTaxExempt ?? current.payrollTaxExempt,
            fullSalaryRegardlessAttendance: employeeInput.fullSalaryRegardlessAttendance ?? current.fullSalaryRegardlessAttendance,
            payFrequency: employeeInput.payFrequency ?? current.payFrequency,
          }).where(eq(employeeSalaryHistoryTable.id, baselineSalary.id));
        } else {
          await tx.insert(employeeSalaryHistoryTable).values({
            employeeId: id,
            effectiveFrom: salaryEffectiveDate!,
            employeeType: employeeInput.employeeType ?? current.employeeType,
            salaryType: normalizedSalaryType,
            monthlyExpectedWorkDays: employeeInput.monthlyExpectedWorkDays ?? current.monthlyExpectedWorkDays,
            baseSalary: employeeInput.baseSalary ?? Number(current.baseSalary),
            socialInsuranceSalary: employeeInput.socialInsuranceSalary ?? Number(current.socialInsuranceSalary),
            payrollTaxExempt: employeeInput.payrollTaxExempt ?? current.payrollTaxExempt,
            fullSalaryRegardlessAttendance: employeeInput.fullSalaryRegardlessAttendance ?? current.fullSalaryRegardlessAttendance,
            payFrequency: employeeInput.payFrequency ?? current.payFrequency,
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
      salaryType: row.salaryType === "hourly" ? "daily" : row.salaryType,
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
    const target = history[index];
    const targetSalaryType = target.employeeType === "office"
      ? "monthly"
      : (input.salaryType ?? (target.salaryType === "hourly" ? "daily" : target.salaryType));
    const targetDays = input.monthlyExpectedWorkDays ?? target.monthlyExpectedWorkDays;
    if (target.employeeType === "shift" && targetSalaryType === "monthly" && targetDays <= 0) {
      res.status(400).json({ error: "Сарын цалинтай ээлжийн ажилтны сард ажиллах ёстой хоногийг 1-ээс ихээр оруулна уу" });
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
        ...(input.salaryType === undefined ? {} : {
          salaryType: targetSalaryType,
        }),
        ...(input.monthlyExpectedWorkDays === undefined ? {} : {
          monthlyExpectedWorkDays: input.monthlyExpectedWorkDays,
        }),
        ...(input.fullSalaryRegardlessAttendance === undefined ? {} : {
          fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance,
        }),
        ...(input.payFrequency === undefined ? {} : {
          payFrequency: input.payFrequency,
        }),
      }).where(eq(employeeSalaryHistoryTable.id, historyId)).returning();
      if (index === history.length - 1) {
        await tx.update(employeesTable).set({
          baseSalary: input.baseSalary,
          socialInsuranceSalary: input.socialInsuranceSalary,
          ...(input.salaryType === undefined ? {} : {
            salaryType: employee.employeeType === "office" ? "monthly" : input.salaryType,
          }),
          ...(input.monthlyExpectedWorkDays === undefined ? {} : {
            monthlyExpectedWorkDays: input.monthlyExpectedWorkDays,
          }),
          ...(input.fullSalaryRegardlessAttendance === undefined ? {} : {
            fullSalaryRegardlessAttendance: input.fullSalaryRegardlessAttendance,
          }),
          ...(input.payFrequency === undefined ? {} : {
            payFrequency: input.payFrequency,
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
          salaryType: previous.employeeType === "shift" ? previous.salaryType : "monthly",
          monthlyExpectedWorkDays: previous.monthlyExpectedWorkDays,
          baseSalary: previous.baseSalary,
          socialInsuranceSalary: previous.socialInsuranceSalary,
          payrollTaxExempt: previous.payrollTaxExempt,
          fullSalaryRegardlessAttendance: previous.fullSalaryRegardlessAttendance,
          payFrequency: previous.payFrequency,
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

export default router;
