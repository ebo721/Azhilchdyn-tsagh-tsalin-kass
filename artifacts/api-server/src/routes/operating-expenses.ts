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



router.get("/operating-expenses", async (_req, res, next) => {
  try {
    const rows = await db.transaction((tx) => reconcileOperatingExpenses(tx)) as Array<typeof operatingExpensesTable.$inferSelect>;
    const accounts = await db.select().from(chartOfAccountsTable);
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    res.json(ListOperatingExpensesResponse.parse(rows.map((row) => {
      const category = names.get(row.accountId);
      if (!category) throw new Error(`Operating expense account ${row.accountId} is missing`);
      return operatingExpenseResponse(row, category);
    })));
  } catch (error) { next(error); }
});

router.post("/operating-expenses", async (req, res, next) => {
  try {
    const input = CreateOperatingExpenseBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) { res.status(400).json({ error: "Хуанлийн огноо буруу байна" }); return; }
    if (await isCashDateClosed(input.date)) { res.status(409).json({ error: "Өндөрлөсөн өдөр зардал бүртгэх боломжгүй" }); return; }
    const row = await db.transaction(async (tx) => {
      const account = await lockedExpenseAccount(tx, input.accountId);
      if (!account) return null;
      return (await tx.insert(operatingExpensesTable).values({
        description: input.description.trim(), accountId: account.id, date: input.date, amount: money(input.amount),
      }).returning())[0];
    });
    if (!row) { res.status(400).json({ error: "Зардлын хүчинтэй данс сонгоно уу" }); return; }
    res.status(201).json(CreateOperatingExpenseResponse.parse(operatingExpenseResponse(row, await operatingExpenseAccountName(row.accountId))));
  } catch (error) { next(error); }
});

router.put("/operating-expenses/:id", async (req, res, next) => {
  try {
    const { id } = UpdateOperatingExpenseParams.parse(req.params);
    const input = UpdateOperatingExpenseBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) { res.status(400).json({ error: "Хуанлийн огноо буруу байна" }); return; }
    if (await isCashDateClosed(input.date)) { res.status(409).json({ error: "Өндөрлөсөн өдөр зардал бүртгэх боломжгүй" }); return; }
    const result = await db.transaction(async (tx) => {
      const account = await lockedExpenseAccount(tx, input.accountId);
      if (!account) return "invalid_account" as const;
      const [old] = await tx.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, id)).for("update");
      if (!old) return null;
      if (old.paymentDate) return "paid" as const;
      const [oldClosure] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, old.date));
      if (oldClosure) return "closed" as const;
      return (await tx.update(operatingExpensesTable).set({
        description: input.description.trim(), accountId: account.id, date: input.date, amount: money(input.amount),
      }).where(eq(operatingExpensesTable.id, id)).returning())[0];
    });
    if (result === null) { res.status(404).json({ error: "Зардал олдсонгүй" }); return; }
    if (result === "paid") { res.status(409).json({ error: "Төлбөр батлагдсан зардлыг засах боломжгүй" }); return; }
    if (result === "closed") { res.status(409).json({ error: "Өндөрлөсөн өдрийн зардлыг засах боломжгүй" }); return; }
    if (result === "invalid_account") { res.status(400).json({ error: "Зардлын хүчинтэй данс сонгоно уу" }); return; }
    res.json(UpdateOperatingExpenseResponse.parse(operatingExpenseResponse(result, await operatingExpenseAccountName(result.accountId))));
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
    const expenseAccountName = await operatingExpenseAccountName(expense.accountId);
    const words = `${expense.description} ${expenseAccountName}`.toLocaleLowerCase("mn-MN").split(/\s+/).filter((w) => w.length > 1);
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
      const cashAccount = await cashAccountForCategory(tx, "Үйл ажиллагааны зардал");
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense", category: "Үйл ажиллагааны зардал", description: expense.description,
        accountId: cashAccount?.id ?? null,
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
    res.json(ConfirmOperatingExpensePaymentResponse.parse(operatingExpenseResponse(row, await operatingExpenseAccountName(row.accountId))));
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
    res.json(CancelOperatingExpensePaymentResponse.parse(operatingExpenseResponse(row, await operatingExpenseAccountName(row.accountId))));
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

export default router;
