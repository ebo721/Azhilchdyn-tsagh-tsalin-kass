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
    const rows = await db.select({
      transaction: cashTransactionsTable,
      accountCode: chartOfAccountsTable.code,
      accountName: chartOfAccountsTable.name,
    }).from(cashTransactionsTable)
      .leftJoin(chartOfAccountsTable, eq(cashTransactionsTable.accountId, chartOfAccountsTable.id))
      .where(isNull(cashTransactionsTable.unclearAt))
      .orderBy(desc(cashTransactionsTable.date), desc(cashTransactionsTable.id));
    const [expenseRows, inventoryPurchases] = await Promise.all([
      db.select({
        cashTransactionId: operatingExpensesTable.cashTransactionId,
        category: chartOfAccountsTable.name,
      }).from(operatingExpensesTable).innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, operatingExpensesTable.accountId)).where(isNotNull(operatingExpensesTable.cashTransactionId)),
      db.select({ id: inventoryPurchasesTable.id, materialType: inventoryPurchasesTable.materialType }).from(inventoryPurchasesTable),
    ]);
    const subcategoryByCashId = new Map(expenseRows.map((expense) => [expense.cashTransactionId, expense.category]));
    const inventoryCategoryBySourceKey = new Map(inventoryPurchases.map((purchase) => [`purchase:${purchase.id}`, inventoryMaterialLabel(purchase.materialType)]));
    res.json(ListCashTransactionsResponse.parse(rows.map((row) => {
      const transaction = row.transaction;
      const category = transaction.type === "expense"
        ? transaction.sourceType === "payroll" || transaction.sourceType === "payroll_advance"
          ? "Цалин"
          : transaction.sourceType === "inventory_purchase"
            ? inventoryCategoryBySourceKey.get(transaction.sourceKey ?? "") ?? "Хангамжийн материал"
            : transaction.sourceType === "fixed_asset_purchase"
              ? "Эд хөрөнгө"
              : isCanonicalCashCategory(transaction.category)
                ? transaction.category
                : "Үйл ажиллагааны зардал"
        : transaction.category;
      return {
      ...transaction,
      accountId: transaction.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      category,
      subcategory: category === "Үйл ажиллагааны зардал"
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
      };
    })));
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
    const result = await db.transaction(async (tx) => {
      const category = input.category.trim();
      const cashAccount = await cashAccountForCategory(tx, category);
      const [cash] = await tx.insert(cashTransactionsTable).values({
        ...input,
        category,
        accountId: cashAccount?.id ?? null,
        incomeMonth: input.type === "income" ? input.incomeMonth : null,
      }).returning();
      if (input.type === "expense" && shouldMirrorCashAsOperatingExpense(category)) {
        const account = await fallbackExpenseAccount(tx, input.category);
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          accountId: account.id,
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: cash.id,
        });
        return { cash, subcategory: account.name, cashAccount };
      }
      return { cash, subcategory: null, cashAccount };
    });
    const { cash: transaction, subcategory, cashAccount } = result;
    res.status(201).json({
      ...transaction,
      subcategory,
      accountId: transaction.accountId,
      accountCode: cashAccount?.code ?? null,
      accountName: cashAccount?.name ?? null,
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
    const result = await db.transaction(async (tx) => {
      const category = input.category.trim();
      const cashAccount = await cashAccountForCategory(tx, category);
      const [cash] = await tx.update(cashTransactionsTable)
        .set({
          ...input,
          category,
          accountId: cashAccount?.id ?? null,
          incomeMonth: input.type === "income" ? input.incomeMonth : null,
        })
        .where(eq(cashTransactionsTable.id, id))
        .returning();
      await tx.delete(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, id));
      if (input.type === "expense" && shouldMirrorCashAsOperatingExpense(category)) {
        const account = await fallbackExpenseAccount(tx, input.category);
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          accountId: account.id,
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: id,
        });
        return { cash, subcategory: account.name, cashAccount };
      }
      return { cash, subcategory: null, cashAccount };
    });
    const { cash: transaction, subcategory, cashAccount } = result;
    res.json({
      ...transaction,
      subcategory,
      accountId: transaction.accountId,
      accountCode: cashAccount?.code ?? null,
      accountName: cashAccount?.name ?? null,
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
    const account = await cashAccountForCategory(db, transaction.category);
    res.json(UpdateBankCashTransactionIncomeMonthResponse.parse({
      ...transaction,
      subcategory: null,
      accountId: transaction.accountId,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
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

export default router;
