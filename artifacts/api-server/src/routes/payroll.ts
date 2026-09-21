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
  journalEntriesTable,
  journalLinesTable,
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
  receivablesTable,
  payrollScheduleSettingsTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession, type StaffRole } from "../lib/hr-session.js";
import { planPayrollAdvancePayment } from "../lib/payroll-advance-payment.js";
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";
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



router.get("/payroll-schedule", async (_req, res, next) => {
  try {
    const schedule = await getPayrollSchedule();
    res.json(GetPayrollScheduleResponse.parse(schedule));
  } catch (error) {
    next(error);
  }
});

router.put("/payroll-schedule", async (req, res, next) => {
  try {
    const input = UpdatePayrollScheduleBody.parse(req.body);
    const effectiveFromMonth = currentMonth();
    const spansPreviousMonth = input.periodStartDay > input.periodEndDay;
    if (!spansPreviousMonth
      && (input.advanceCutoffDay < input.periodStartDay || input.advanceCutoffDay > input.periodEndDay)) {
      res.status(400).json({ error: "Урьдчилгааны таслах өдөр цалингийн хугацааны дотор байх ёстой" });
      return;
    }
    if (spansPreviousMonth && input.advanceCutoffDay > input.periodEndDay && input.advanceCutoffDay < input.periodStartDay) {
      res.status(400).json({ error: "Урьдчилгааны таслах өдөр цалингийн хугацааны дотор байх ёстой" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
      const [nextVersion] = await tx.select({
        effectiveFromMonth: payrollScheduleSettingsTable.effectiveFromMonth,
      }).from(payrollScheduleSettingsTable)
        .where(gt(payrollScheduleSettingsTable.effectiveFromMonth, effectiveFromMonth))
        .orderBy(asc(payrollScheduleSettingsTable.effectiveFromMonth))
        .limit(1);
      const [approvedMonths, paidMonths] = await Promise.all([
        tx.select({ month: payrollAdvanceApprovalsTable.month })
          .from(payrollAdvanceApprovalsTable)
          .where(gte(payrollAdvanceApprovalsTable.month, effectiveFromMonth)),
        tx.select({ month: payrollAdjustmentsTable.month })
          .from(payrollAdjustmentsTable).where(and(
          gte(payrollAdjustmentsTable.month, effectiveFromMonth),
          sql`(${payrollAdjustmentsTable.paidAmount} > 0 OR ${payrollAdjustmentsTable.secondPaidAmount} > 0)`,
        )),
      ]);
      const protectedMonth = [...approvedMonths, ...paidMonths].find((row) =>
        scheduleVersionAffectsMonth(
          row.month,
          effectiveFromMonth,
          nextVersion?.effectiveFromMonth,
        )
      );
      if (protectedMonth) return { protectedMonth: protectedMonth.month, saved: null };
      const [saved] = await tx.insert(payrollScheduleSettingsTable)
        .values({ ...input, effectiveFromMonth })
        .onConflictDoUpdate({
          target: payrollScheduleSettingsTable.effectiveFromMonth,
          set: { ...input, updatedAt: new Date() },
        }).returning();
      return { protectedMonth: null, saved };
    });
    if (result.protectedMonth) {
      res.status(409).json({ error: `${result.protectedMonth} сарын цалин батлагдсан эсвэл олгогдсон тул энэ үечлэлийн тохиргоог өөрчлөх боломжгүй` });
      return;
    }
    res.json(UpdatePayrollScheduleResponse.parse(result.saved));
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
    const secondSourceKey = `${sourceKey}:2`;
    const selectedReceivableId = input.receivableId ?? null;
    const adjustment = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
      const existingCashRows = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, sourceType),
        inArray(cashTransactionsTable.sourceKey, [sourceKey, secondSourceKey]),
      )).for("update");
      const cashBySourceKey = new Map(existingCashRows.map((cash) => [cash.sourceKey, cash]));
      const paymentInputs = [
        { key: sourceKey, amount: input.paidAmount, date: input.paymentDate },
        { key: secondSourceKey, amount: input.secondPaidAmount, date: input.secondPaymentDate },
      ];
      for (const payment of paymentInputs) {
        const existingCash = cashBySourceKey.get(payment.key);
        if (existingCash
          && (existingCash.bankTransactionId !== null || existingCash.bankVerifiedAt !== null)
          && (Number(existingCash.amount) !== payment.amount || String(existingCash.date) !== payment.date)) {
          throw Object.assign(new Error("Банкны хуулгаар баталгаажсан цалингийн гүйлгээний дүн, огноог өөрчлөх боломжгүй"), { status: 409 });
        }
      }
      const settlementDate = input.paidAmount > 0
        ? input.paymentDate
        : input.secondPaidAmount > 0
          ? input.secondPaymentDate
          : null;
      const postingChanged = existingAdjustment?.receivableId !== selectedReceivableId
        || Number(existingAdjustment?.manualDeduction ?? 0) !== input.manualDeduction
        || (Number(existingAdjustment?.paidAmount ?? 0) > 0
          ? existingAdjustment?.paymentDate
          : Number(existingAdjustment?.secondPaidAmount ?? 0) > 0
            ? existingAdjustment?.secondPaymentDate
            : null) !== settlementDate;
      let journalEntryId = existingAdjustment?.journalEntryId ?? null;

      if (journalEntryId && postingChanged) {
        await voidJournalEntry(tx, { journalEntryId, voidedBy: null });
        journalEntryId = null;
      }

      if (selectedReceivableId !== null) {
        if (input.manualDeduction <= 0) {
          throw Object.assign(new Error("Авлагаас суутгах дүн 0-ээс их байх ёстой"), { status: 400 });
        }
        const [receivable] = await tx.select().from(receivablesTable)
          .where(eq(receivablesTable.id, selectedReceivableId))
          .for("update");
        if (!receivable || Number(receivable.employeeId) !== input.employeeId) {
          throw Object.assign(new Error("Сонгосон авлага энэ ажилтанд хамаарахгүй байна"), { status: 409 });
        }
        if (!journalEntryId && settlementDate) {
          const accounts = await tx.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code })
            .from(chartOfAccountsTable)
            .where(and(inArray(chartOfAccountsTable.code, ["1200", "2100"]), eq(chartOfAccountsTable.isActive, true)));
          const accountByCode = new Map(accounts.map((account) => [account.code, account.id]));
          const receivableAccountId = accountByCode.get("1200");
          const payrollPayableAccountId = accountByCode.get("2100");
          if (!receivableAccountId || !payrollPayableAccountId) {
            throw Object.assign(new Error("1200 болон 2100 данс идэвхтэй байх шаардлагатай"), { status: 409 });
          }
          const posting = await postJournalEntry(tx, {
            date: settlementDate,
            description: `${employee.name} · ${input.month} сарын цалингаас авлага суутгав`,
            sourceType: "payroll_receivable",
            sourceId: existingAdjustment?.id ?? null,
            createdBy: null,
            lines: [
              { accountId: payrollPayableAccountId, debit: input.manualDeduction, credit: 0 },
              {
                accountId: receivableAccountId,
                debit: 0,
                credit: input.manualDeduction,
                allocation: { kind: "settle", receivableId: selectedReceivableId },
              },
            ],
          });
          if (posting.status !== "posted") throw new Error("Payroll receivable journal must be balanced");
          journalEntryId = posting.journalEntryId;
        }
      } else if (journalEntryId) {
        await voidJournalEntry(tx, { journalEntryId, voidedBy: null });
        journalEntryId = null;
      }

      const [savedAdjustment] = await tx
        .insert(payrollAdjustmentsTable)
        .values({ ...input, receivableId: selectedReceivableId, journalEntryId })
        .onConflictDoUpdate({
          target: [payrollAdjustmentsTable.employeeId, payrollAdjustmentsTable.month],
          set: {
            manualDeduction: input.manualDeduction,
            receivableId: selectedReceivableId,
            paidAmount: input.paidAmount,
            paymentDate: input.paidAmount > 0 ? input.paymentDate : null,
            secondPaidAmount: input.secondPaidAmount,
            secondPaymentDate: input.secondPaidAmount > 0 ? input.secondPaymentDate : null,
            journalEntryId,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (input.paidAmount > 0 && input.paymentDate) {
        const account = await cashAccountForCategory(tx, "Цалин");
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Цалин",
          accountId: account?.id ?? null,
          description: `${employee.name} · ${input.month} сарын цалин`,
          amount: input.paidAmount,
          date: input.paymentDate,
          sourceType,
          sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            accountId: account?.id ?? null,
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

      if (input.secondPaidAmount > 0 && input.secondPaymentDate) {
        const account = await cashAccountForCategory(tx, "Цалин");
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Цалин",
          accountId: account?.id ?? null,
          description: `${employee.name} · ${input.month} сарын цалин · 2-р олголт`,
          amount: input.secondPaidAmount,
          date: input.secondPaymentDate,
          sourceType,
          sourceKey: secondSourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            accountId: account?.id ?? null,
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
      receivableId: adjustment.receivableId,
      paidAmount: Number(adjustment.paidAmount),
      paymentDate: adjustment.paymentDate,
      secondPaidAmount: Number(adjustment.secondPaidAmount),
      secondPaymentDate: adjustment.secondPaymentDate,
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      res.status(Number(error.status)).json({ error: error instanceof Error ? error.message : "Цалингийн тохируулга хадгалж чадсангүй" });
      return;
    }
    next(error);
  }
});

router.delete("/payroll-adjustments/:month/:employeeId/transactions/:sequence", async (req, res, next) => {
  try {
    const { month, employeeId, sequence } = DeletePayrollAdjustmentTransactionParams.parse({
      ...req.params,
      sequence: Number(req.params.sequence),
    });
    const sourceKey = sequence === 1 ? `${month}:${employeeId}` : `${month}:${employeeId}:2`;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
      const [adjustment] = await tx
        .select()
        .from(payrollAdjustmentsTable)
        .where(and(
          eq(payrollAdjustmentsTable.employeeId, employeeId),
          eq(payrollAdjustmentsTable.month, month),
        ))
        .for("update");
      if (!adjustment) return "missing_adjustment" as const;
      const paymentDate = sequence === 1 ? adjustment.paymentDate : adjustment.secondPaymentDate;
      const paidAmount = Number(sequence === 1 ? adjustment.paidAmount : adjustment.secondPaidAmount);
      if (paidAmount <= 0) return "missing_transaction" as const;
      if (paymentDate) {
        const [closure] = await tx.select({ id: cashClosuresTable.id })
          .from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, paymentDate));
        if (closure) return "cash_closed" as const;
      }
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "payroll"),
        eq(cashTransactionsTable.sourceKey, sourceKey),
      )).for("update");
      if (cash && (cash.bankTransactionId !== null || cash.bankVerifiedAt !== null)) {
        return "bank_linked" as const;
      }
      if (adjustment.journalEntryId) {
        const remainingPaidAmount = Number(sequence === 1 ? adjustment.secondPaidAmount : adjustment.paidAmount);
        if (remainingPaidAmount <= 0) {
          await voidJournalEntry(tx, { journalEntryId: adjustment.journalEntryId, voidedBy: null });
        }
      }
      await tx
        .update(payrollAdjustmentsTable)
        .set(sequence === 1
          ? {
              paidAmount: 0,
              paymentDate: null,
              journalEntryId: Number(adjustment.secondPaidAmount) > 0 ? adjustment.journalEntryId : null,
              updatedAt: new Date(),
            }
          : {
              secondPaidAmount: 0,
              secondPaymentDate: null,
              journalEntryId: Number(adjustment.paidAmount) > 0 ? adjustment.journalEntryId : null,
              updatedAt: new Date(),
            })
        .where(eq(payrollAdjustmentsTable.id, adjustment.id));
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "payroll"),
        eq(cashTransactionsTable.sourceKey, sourceKey),
      ));
      return "deleted" as const;
    });
    if (result === "missing_adjustment") {
      res.status(404).json({ error: "Цалингийн тохируулга олдсонгүй" });
      return;
    }
    if (result === "missing_transaction") {
      res.status(404).json({ error: `${sequence}-р гүйлгээ олдсонгүй` });
      return;
    }
    if (result === "cash_closed") {
      res.status(409).json({ error: "Касс өндөрлөсөн өдрийн цалингийн гүйлгээг устгах боломжгүй" });
      return;
    }
    if (result === "bank_linked") {
      res.status(409).json({ error: "Банкны хуулгаар баталгаажсан цалингийн гүйлгээг эхлээд журналаас буцаана уу" });
      return;
    }
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
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
      const existing = await getPayrollAdvanceSummary(month);
      if (!existing.approved) {
        await tx.insert(payrollAdvanceApprovalsTable).values({
          month,
          lines: existing.lines,
          totalAmount: existing.totalAmount,
          approvalDate,
        }).onConflictDoNothing();
      }
    });
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
        const [scheduleRow] = await tx.select().from(payrollScheduleSettingsTable)
          .where(lte(payrollScheduleSettingsTable.effectiveFromMonth, input.month))
          .orderBy(desc(payrollScheduleSettingsTable.effectiveFromMonth))
          .limit(1);
        const schedule = scheduleRow ?? { ...defaultPayrollSchedule };
        const period = payrollPeriod(input.month, schedule);
        const firstHalfRecords = attendanceRecords.filter((record) =>
          String(record.date) >= period.periodStart
          && String(record.date) <= period.advancePeriodEnd
        );
        const history = await tx.select().from(employeeSalaryHistoryTable)
          .where(eq(employeeSalaryHistoryTable.employeeId, input.employeeId));
        const refreshedLine = calculatePayrollAdvanceLine(
          employee,
          firstHalfRecords,
          history,
          period.periodStart,
          period.periodEnd,
          period.advancePeriodEnd,
        );
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
        const account = await cashAccountForCategory(tx, "Урьдчилгаа цалин");
        const [payrollExpenseAccount, cashAccount] = await Promise.all([
          tx.select().from(chartOfAccountsTable).where(and(
            eq(chartOfAccountsTable.code, "6000"),
            eq(chartOfAccountsTable.type, "expense"),
            eq(chartOfAccountsTable.normalBalance, "debit"),
            eq(chartOfAccountsTable.isActive, true),
          )),
          tx.select().from(chartOfAccountsTable).where(and(
            eq(chartOfAccountsTable.code, "1000"),
            eq(chartOfAccountsTable.type, "asset"),
            eq(chartOfAccountsTable.normalBalance, "debit"),
            eq(chartOfAccountsTable.isActive, true),
          )),
        ]);
        if (!payrollExpenseAccount[0] || !cashAccount[0]) {
          throw new Error("Payroll posting accounts 6000 and 1000 must be active");
        }
        const sourceKey = `${input.month}:${input.employeeId}`;
        const [previousCash] = await tx.select().from(cashTransactionsTable)
          .where(and(
            eq(cashTransactionsTable.sourceType, "payroll_advance"),
            eq(cashTransactionsTable.sourceKey, sourceKey),
          ))
          .for("update");
        if (previousCash && (previousCash.bankTransactionId !== null || previousCash.bankVerifiedAt !== null)) {
          throw Object.assign(new Error("Банкны хуулгаар баталгаажсан урьдчилгаа цалинг эх үүсвэрээс өөрчлөх боломжгүй"), { status: 409 });
        }
        await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Урьдчилгаа цалин",
          accountId: account?.id ?? null,
          description: `${employee.name} · ${input.month} сарын урьдчилгаа`,
          amount: cashTransaction.amount,
          date: cashTransaction.date,
          sourceType: cashTransaction.sourceType,
          sourceKey: cashTransaction.sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            accountId: account?.id ?? null,
            amount: cashTransaction.amount,
            date: cashTransaction.date,
            description: `${employee.name} · ${input.month} сарын урьдчилгаа`,
          },
        });
        const [cash] = await tx.select().from(cashTransactionsTable)
          .where(and(
            eq(cashTransactionsTable.sourceType, "payroll_advance"),
            eq(cashTransactionsTable.sourceKey, sourceKey),
          ))
          .for("update");
        if (!cash) throw new Error("Payroll cash transaction was not persisted");

        let reusable = false;
        if (previousCash?.journalEntryId) {
          const [existingEntry] = await tx.select().from(journalEntriesTable)
            .where(eq(journalEntriesTable.id, previousCash.journalEntryId))
            .for("update");
          if (existingEntry?.status === "posted" && String(existingEntry.date) === cashTransaction.date) {
            const existingLines = await tx.select().from(journalLinesTable)
              .where(eq(journalLinesTable.journalEntryId, existingEntry.id));
            const amount = Number(cashTransaction.amount);
            reusable = existingLines.length === 2
              && existingLines.some((line) =>
                line.accountId === payrollExpenseAccount[0].id
                && Number(line.debit) === amount
                && Number(line.credit) === 0)
              && existingLines.some((line) =>
                line.accountId === cashAccount[0].id
                && Number(line.credit) === amount
                && Number(line.debit) === 0);
          }
          if (!reusable) {
            if (!existingEntry) throw new Error("Linked payroll journal entry was not found");
            if (existingEntry.status !== "posted") throw new Error("Linked payroll journal entry is not posted");
            await voidJournalEntry(tx, { journalEntryId: existingEntry.id, voidedBy: null });
          }
        }
        if (!reusable) {
          const posting = await postJournalEntry(tx, {
            date: cashTransaction.date,
            description: `${employee.name} · ${input.month} сарын урьдчилгаа`,
            sourceType: "payroll",
            sourceId: approval.id,
            createdBy: null,
            lines: [
              { accountId: payrollExpenseAccount[0].id, debit: cashTransaction.amount, credit: 0 },
              { accountId: cashAccount[0].id, debit: 0, credit: cashTransaction.amount },
            ],
          });
          if (posting.status !== "posted") throw new Error("Payroll journal entry must be balanced");
          await tx.update(cashTransactionsTable)
            .set({ journalEntryId: posting.journalEntryId })
            .where(eq(cashTransactionsTable.id, cash.id));
        }
      } else {
        const sourceKey = `${input.month}:${input.employeeId}`;
        const [cash] = await tx.select().from(cashTransactionsTable)
          .where(and(
            eq(cashTransactionsTable.sourceType, "payroll_advance"),
            eq(cashTransactionsTable.sourceKey, sourceKey),
          ))
          .for("update");
        if (cash && (cash.bankTransactionId !== null || cash.bankVerifiedAt !== null)) {
          return "bank_linked" as const;
        }
        if (cash?.journalEntryId) {
          await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
        }
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, "payroll_advance"),
          eq(cashTransactionsTable.sourceKey, sourceKey),
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
    if (paymentResult === "bank_linked") {
      res.status(409).json({ error: "Банкны хуулгаар баталгаажсан урьдчилгаа цалинг эхлээд журналаас буцаана уу" });
      return;
    }
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(input.month)));
  } catch (error) {
    next(error);
  }
});

export default router;
