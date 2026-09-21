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
  PostCashTransactionJournalBody,
  PostCashTransactionJournalParams,
  PostCashTransactionJournalResponse,
  ListCashTransactionBankSuggestionsParams,
  ListCashTransactionBankSuggestionsResponse,
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
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
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
  journalEntriesTable,
  journalLinesTable,
  payrollScheduleSettingsTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession, type StaffRole } from "../lib/hr-session.js";
import { planPayrollAdvancePayment } from "../lib/payroll-advance-payment.js";
import { planShiftPlanCopy } from "../lib/shift-plan-copy.js";
import { JournalValidationError, postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";
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

async function lockCashDate(tx: any, date: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-date:${date}`}))`);
}

async function safeCashAccount(tx: any, category: string) {
  try {
    return await cashAccountForCategory(tx, category);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is missing or has an invalid type")) return null;
    throw error;
  }
}

async function activeAccountByCode(tx: any, code: string, type: string) {
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, code),
    eq(chartOfAccountsTable.type, type),
    eq(chartOfAccountsTable.isActive, true),
  ));
  return account;
}

async function cashLedgerAccount(tx: any, bankTransactionId: number | null = null) {
  const code = bankTransactionId === null ? "1000" : "1010";
  const account = await activeAccountByCode(tx, code, "asset");
  if (!account || account.normalBalance !== "debit") {
    throw new Error(`Settlement account ${code} is missing or inactive`);
  }
  return account;
}

async function journalCounterAccount(tx: any, type: string, category: string, mappedAccount: any) {
  if (type === "income" && mappedAccount?.isActive && mappedAccount.type === "revenue") {
    return mappedAccount;
  }
  if (type === "expense" && mappedAccount?.isActive && ["expense", "asset"].includes(mappedAccount.type)) {
    return mappedAccount;
  }
  if (type === "income") {
    const account = await activeAccountByCode(tx, "4900", "revenue");
    if (!account) throw new Error("Other revenue account 4900 is missing or inactive");
    return account;
  }
  const fallback = await fallbackExpenseAccount(tx, category);
  if (fallback.isActive) return fallback;
  const canonicalFallback = await activeAccountByCode(tx, "6900", "expense");
  if (!canonicalFallback) throw new Error("Expense account 6900 is missing or inactive");
  return canonicalFallback;
}

async function postCashJournal(tx: any, cash: any, counterAccount: any, cashAccount: any, createdBy: number | null = null) {
  const posting = await postJournalEntry(tx, {
    date: String(cash.date),
    description: cash.description.trim(),
    sourceType: "cash",
    sourceId: cash.id,
    createdBy,
    lines: cash.type === "income"
      ? [
        { accountId: cashAccount.id, debit: Number(cash.amount), credit: 0 },
        { accountId: counterAccount.id, debit: 0, credit: Number(cash.amount) },
      ]
      : [
        { accountId: counterAccount.id, debit: Number(cash.amount), credit: 0 },
        { accountId: cashAccount.id, debit: 0, credit: Number(cash.amount) },
      ],
  });
  if (posting.status !== "posted") throw new Error("Cash journal entry must be balanced");
  return posting.journalEntryId;
}

function cashBankSuggestionScore(
  cash: typeof cashTransactionsTable.$inferSelect,
  bank: typeof bankTransactionsTable.$inferSelect,
) {
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  const distance = Math.abs((Date.parse(`${cash.date}T00:00:00Z`) - Date.parse(`${bankDate}T00:00:00Z`)) / 86_400_000);
  const cashTokens = descriptionTokens(cash.description);
  const bankTokens = descriptionTokens(bank.description);
  const overlap = [...cashTokens].filter((token) => bankTokens.has(token)).length;
  const tokenOverlap = overlap / Math.max(new Set([...cashTokens, ...bankTokens]).size, 1);
  return Math.round((0.7 * (1 - distance / 7) + 0.3 * tokenOverlap) * 10_000) / 100;
}

async function journalNeedsReplacement(tx: any, existing: any, input: any, counterAccount: any, settlementAccountId: number) {
  if (existing.type !== input.type
    || existing.category !== input.category.trim()
    || Number(existing.amount) !== Number(input.amount)
    || String(existing.date) !== input.date
    || existing.description !== input.description) return true;
  if (!existing.journalEntryId) return false;
  const lines = await tx.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, existing.journalEntryId));
  const counterLines = lines.filter((line: any) => line.accountId !== settlementAccountId);
  return counterLines.length !== 1 || counterLines[0].accountId !== counterAccount.id;
}



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
      journalEntryId: transaction.journalEntryId,
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
      const cashAccount = await safeCashAccount(tx, category);
      const linkedAccount = await journalCounterAccount(tx, input.type, category, cashAccount);
      const [cash] = await tx.insert(cashTransactionsTable).values({
        ...input,
        category,
        accountId: cashAccount?.id ?? null,
        incomeMonth: input.type === "income" ? input.incomeMonth : null,
      }).returning();
      if (input.type === "expense" && shouldMirrorCashAsOperatingExpense(category)) {
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          accountId: linkedAccount.id,
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: cash.id,
        });
      }
      const ledgerAccount = await cashLedgerAccount(tx, cash.bankTransactionId);
      const journalEntryId = await postCashJournal(tx, cash, linkedAccount, ledgerAccount);
      const [linkedCash] = await tx.update(cashTransactionsTable)
        .set({ journalEntryId })
        .where(eq(cashTransactionsTable.id, cash.id))
        .returning();
      return {
        cash: linkedCash,
        subcategory: input.type === "expense" && shouldMirrorCashAsOperatingExpense(category) ? linkedAccount.name : null,
        cashAccount,
      };
    });
    const { cash: transaction, subcategory, cashAccount } = result;
    res.status(201).json({
      ...transaction,
      category: transaction.category,
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
    const session = await getStaffSession(req);
    if (session?.role !== "admin") {
      res.status(403).json({ error: "Кассын гүйлгээг зөвхөн админ засах эрхтэй" });
      return;
    }
    const { id } = UpdateCashTransactionParams.parse(req.params);
    const input = UpdateCashTransactionBody.parse(req.body);
    if (input.type === "income" && input.incomeMonth === null) {
      res.status(400).json({ error: "Орлогын хамаарах сар шаардлагатай" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id)).for("update");
      if (!existing) throw Object.assign(new Error("Кассын гүйлгээ олдсонгүй"), { status: 404 });
      if (existing.bankTransactionId !== null || existing.sourceType === "bank_transaction") {
        throw Object.assign(new Error("Банктай холбогдсон кассын гүйлгээг банкны гүйлгээний цэснээс өөрчилнө үү"), { status: 409 });
      }
      if (await isCashDateClosed(String(existing.date)) || await isCashDateClosed(input.date)) {
        throw Object.assign(new Error("Өндөрлөсөн өдрийн гүйлгээг засах боломжгүй"), { status: 409 });
      }
      const category = input.category.trim();
      const cashAccount = await safeCashAccount(tx, category);
      const mirrorAccount = input.type === "expense" && shouldMirrorCashAsOperatingExpense(category)
        ? await fallbackExpenseAccount(tx, category)
        : null;
      const ledgerAccount = await cashLedgerAccount(tx, existing.bankTransactionId);
      const counterAccount = await journalCounterAccount(tx, input.type, category, cashAccount);
      const replacement = existing.journalEntryId
        ? await journalNeedsReplacement(tx, existing, input, counterAccount, ledgerAccount!.id)
        : false;
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
        await tx.insert(operatingExpensesTable).values({
          description: input.description.trim(),
          accountId: mirrorAccount!.id,
          date: input.date,
          amount: money(input.amount),
          paymentDate: input.date,
          paymentAmount: money(input.amount),
          cashTransactionId: id,
        });
      }
      let journalEntryId = existing.journalEntryId;
      const waitsForExplicitPayrollPosting = existing.journalEntryId === null
        && ["payroll", "payroll_advance"].includes(existing.sourceType ?? "");
      if ((!existing.journalEntryId && !waitsForExplicitPayrollPosting) || replacement) {
        if (existing.journalEntryId) {
          await voidJournalEntry(tx, { journalEntryId: existing.journalEntryId, voidedBy: null });
        }
        journalEntryId = await postCashJournal(tx, cash, counterAccount, ledgerAccount);
        const [linkedCash] = await tx.update(cashTransactionsTable)
          .set({ journalEntryId })
          .where(eq(cashTransactionsTable.id, id))
          .returning();
        return { cash: linkedCash, subcategory: mirrorAccount?.name ?? null, cashAccount };
      }
      return { cash: { ...cash, journalEntryId }, subcategory: mirrorAccount?.name ?? null, cashAccount };
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
      editable: transaction.sourceType === null,
      transactionKind: transaction.sourceType ?? "manual",
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      res.status(Number(error.status)).json({ error: error instanceof Error ? error.message : "Кассын гүйлгээ шинэчлэгдэхгүй байна" });
      return;
    }
    next(error);
  }
});

router.patch("/cash/transactions/:id/income-month", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin") {
      res.status(403).json({ error: "Кассын гүйлгээг зөвхөн админ засах эрхтэй" });
      return;
    }
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

router.post("/cash/transactions/:id/journal", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin" && session?.role !== "accountant") {
      res.status(403).json({ error: "Журнал бичих эрх хүрэлцэхгүй байна" });
      return;
    }
    const { id } = PostCashTransactionJournalParams.parse(req.params);
    const { accountId } = PostCashTransactionJournalBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [cashSnapshot] = await tx.select({ date: cashTransactionsTable.date })
        .from(cashTransactionsTable)
        .where(eq(cashTransactionsTable.id, id));
      if (!cashSnapshot) throw Object.assign(new Error("Кассын гүйлгээ олдсонгүй"), { status: 404 });
      await lockCashDate(tx, String(cashSnapshot.date));
      const [cash] = await tx.select().from(cashTransactionsTable)
        .where(eq(cashTransactionsTable.id, id))
        .for("update");
      if (!cash) throw Object.assign(new Error("Кассын гүйлгээ олдсонгүй"), { status: 404 });
      if (String(cash.date) !== String(cashSnapshot.date)) {
        throw Object.assign(new Error("Кассын гүйлгээний огноо өөрчлөгдсөн тул дахин оролдоно уу"), { status: 409 });
      }
      if (cash.journalEntryId !== null) {
        throw Object.assign(new Error("Энэ кассын гүйлгээнд журнал аль хэдийн бичигдсэн байна"), { status: 409 });
      }
      if (cash.bankTransactionId !== null || cash.bankVerifiedAt !== null || cash.sourceType === "bank_transaction") {
        throw Object.assign(new Error("Банктай холбоотой гүйлгээг банкны гүйлгээний цэснээс журналдана уу"), { status: 409 });
      }
      if (cash.sourceType !== null && !["payroll", "payroll_advance"].includes(cash.sourceType)) {
        throw Object.assign(new Error("Энэ автомат гүйлгээг эх үүсвэр цэснээс журналдана уу"), { status: 409 });
      }
      if (cash.unclearAt !== null) {
        throw Object.assign(new Error("Тодорхойгүй болгосон кассын гүйлгээнд журнал бичих боломжгүй"), { status: 409 });
      }
      const [closure] = await tx.select({ id: cashClosuresTable.id })
        .from(cashClosuresTable)
        .where(eq(cashClosuresTable.date, String(cash.date)));
      if (closure) {
        throw Object.assign(new Error("Өндөрлөсөн өдрийн гүйлгээнд журнал бичих боломжгүй"), { status: 409 });
      }
      const [counterAccount] = await tx.select().from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, accountId))
        .for("update");
      if (!counterAccount) throw Object.assign(new Error("Сонгосон данс олдсонгүй"), { status: 404 });
      if (!counterAccount.isActive) {
        throw Object.assign(new Error("Идэвхгүй дансаар журнал бичих боломжгүй"), { status: 409 });
      }
      if (counterAccount.code === "1200") {
        throw Object.assign(new Error("Авлагын 1200 дансыг авлагын цэснээс баримттайгаар журналдана уу"), { status: 409 });
      }
      const ledgerAccount = await cashLedgerAccount(tx);
      if (counterAccount.id === ledgerAccount.id) {
        throw Object.assign(new Error("Кассын 1000 дансыг эсрэг дансаар сонгох боломжгүй"), { status: 409 });
      }
      const journalEntryId = await postCashJournal(tx, cash, counterAccount, ledgerAccount, session.id);
      const [linkedCash] = await tx.update(cashTransactionsTable)
        .set({ journalEntryId })
        .where(and(
          eq(cashTransactionsTable.id, cash.id),
          isNull(cashTransactionsTable.journalEntryId),
        ))
        .returning({ id: cashTransactionsTable.id });
      if (!linkedCash) throw Object.assign(new Error("Кассын гүйлгээнд журнал аль хэдийн бичигдсэн байна"), { status: 409 });
      return { cashTransactionId: cash.id, journalEntryId };
    });
    res.json(PostCashTransactionJournalResponse.parse(result));
  } catch (error) {
    if (error instanceof JournalValidationError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error && typeof error === "object" && "status" in error) {
      res.status(Number(error.status)).json({ error: error instanceof Error ? error.message : "Журнал бичигдсэнгүй" });
      return;
    }
    next(error);
  }
});

router.get("/cash/transactions/:id/bank-suggestions", async (req, res, next) => {
  try {
    const { id } = ListCashTransactionBankSuggestionsParams.parse(req.params);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    if (!cash) {
      res.status(404).json({ error: "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    const date = String(cash.date);
    const from = calendarDateOffset(date, -7);
    const to = calendarDateOffset(date, 8);
    const candidates = await db.select().from(bankTransactionsTable).where(and(
      eq(bankTransactionsTable.type, cash.type),
      isNull(bankTransactionsTable.cashTransactionId),
      isNull(bankTransactionsTable.transferredAt),
      isNull(bankTransactionsTable.journalEntryId),
      isNull(bankTransactionsTable.unclearAt),
      gte(bankTransactionsTable.transactionAt, from),
      lt(bankTransactionsTable.transactionAt, to),
    ));
    const suggestions = candidates
      .filter((bank) => {
        const difference = Math.abs(Number(bank.amount) - Number(cash.amount));
        return difference === 0
          || (["payroll", "payroll_advance"].includes(cash.sourceType ?? "") && difference < 1);
      })
      .map((bank) => ({ bank, score: cashBankSuggestionScore(cash, bank) }))
      .sort((left, right) => right.score - left.score || left.bank.id - right.bank.id)
      .slice(0, 10)
      .map(({ bank, score }) => ({
        id: bank.id,
        transactionAt: bank.transactionAt.toISOString(),
        type: bank.type as "income" | "expense",
        amount: Number(bank.amount),
        account: bank.account,
        counterparty: bank.counterparty,
        description: bank.description,
        bankName: bank.bankName,
        bankAccountNumber: bank.bankAccountNumber,
        score,
      }));
    res.json(ListCashTransactionBankSuggestionsResponse.parse(suggestions));
  } catch (error) {
    next(error);
  }
});

router.delete("/cash/transactions/:id", async (req, res, next) => {
  try {
    const { id } = DeleteCashTransactionParams.parse(req.params);
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, id)).for("update");
      if (!existing) throw Object.assign(new Error("Кассын гүйлгээ олдсонгүй"), { status: 404 });
      if (existing.sourceType !== null) throw Object.assign(new Error("Автомат гүйлгээг эх үүсвэр цэснээс өөрчилнө үү"), { status: 409 });
      if (await isCashDateClosed(String(existing.date))) {
        throw Object.assign(new Error("Өндөрлөсөн өдрийн гүйлгээг устгах боломжгүй"), { status: 409 });
      }
      if (existing.journalEntryId) {
        await voidJournalEntry(tx, { journalEntryId: existing.journalEntryId, voidedBy: null });
      }
      await tx.delete(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, id));
      await tx.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, id));
    });
    res.status(204).send();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      res.status(Number(error.status)).json({ error: error instanceof Error ? error.message : "Кассын гүйлгээ устгагдсангүй" });
      return;
    }
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
    const saved = await db.transaction(async (tx) => {
      await lockCashDate(tx, date);
      const [created] = await tx
        .insert(cashClosuresTable)
        .values({ date })
        .onConflictDoNothing()
        .returning();
      return created ?? (await tx
        .select()
        .from(cashClosuresTable)
        .where(eq(cashClosuresTable.date, date)))[0];
    });
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
