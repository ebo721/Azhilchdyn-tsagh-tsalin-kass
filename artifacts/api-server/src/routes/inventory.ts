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
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";
import {
  cashAccountForCategory,
  isCanonicalCashCategory,
  shouldMirrorCashAsOperatingExpense,
} from "../lib/cash-account.js";
import * as shared from "../lib/route-shared.js";
import type { SalaryHistoryRow, PayrollCalculationData, Tx } from "../lib/route-shared.js";

const router: IRouter = Router();
const { dispatchApprovedDeletion, isCashDateClosed, operatingExpenseResponse, operatingExpenseAccountName, inventoryMaterialLabel, defaultChartOfAccounts, operatingExpenseAccountCodes, inventoryPurchaseAccountCodes, reservedAccountTypes, chartOfAccountResponse, ensureDefaultChartOfAccounts, inventoryPurchaseAccount, lockedExpenseAccount, fallbackExpenseAccount, today, currentMonth, money, InventoryBankPaymentConflictError, OperatingExpenseBankPaymentConflictError, calendarDateOffset, descriptionTokens, inventoryBankSuggestionScore, deletionTargetPatterns, roleCanRequestDeletion, deletionRequestResponse, monthlyIncomeTaxRelief, hoursBetween, previousMonth, nextMonth, daysInMonth, isValidCalendarDate, calendarDateText, weekdayCount, monthWeekdays, defaultPayrollSchedule, getPayrollSchedule, scheduleDate, payrollPeriod, selectPayrollScheduleVersion, scheduleVersionAffectsMonth, shiftDailyRate, weekdayDatesBetween, salaryAt, getPayrollSummary, getPayrollAdvanceSummary, calculatePayrollAdvanceLine, InventoryInsufficientStockError, planInventoryFifoConsumption, applyInventoryFifoConsumption, reverseInventoryFifoConsumption, inventoryPurchaseResponse } = shared;

async function postFixedAssetJournal(
  tx: Tx,
  input: { assetId: number; date: string; description: string; amount: number; },
) {
  const [fixedAssetAccount] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, "1800"),
    eq(chartOfAccountsTable.type, "asset"),
    eq(chartOfAccountsTable.normalBalance, "debit"),
    eq(chartOfAccountsTable.isActive, true),
  ));
  const [cashAccount] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, "1000"),
    eq(chartOfAccountsTable.type, "asset"),
    eq(chartOfAccountsTable.normalBalance, "debit"),
    eq(chartOfAccountsTable.isActive, true),
  ));
  if (!fixedAssetAccount) throw new Error("Fixed asset account 1800 is missing or inactive");
  if (!cashAccount) throw new Error("Cash account 1000 is missing or inactive");
  const result = await postJournalEntry(tx, {
    date: input.date,
    description: input.description,
    sourceType: "fixed_asset",
    sourceId: input.assetId,
    createdBy: null,
    lines: [
      { accountId: fixedAssetAccount.id, debit: input.amount, credit: 0 },
      { accountId: cashAccount.id, debit: 0, credit: input.amount },
    ],
  });
  if (result.status !== "posted") throw new Error("Fixed asset journal entry must be balanced");
  return result.journalEntryId;
}



router.get("/fixed-assets", async (_req, res, next) => {
  try {
    const [rows, purchaseCashRows] = await Promise.all([
      db.select().from(fixedAssetsTable).orderBy(desc(fixedAssetsTable.date), desc(fixedAssetsTable.id)),
      db.select({
        sourceKey: cashTransactionsTable.sourceKey,
        bankTransactionId: cashTransactionsTable.bankTransactionId,
      }).from(cashTransactionsTable).where(eq(cashTransactionsTable.sourceType, "fixed_asset_purchase")),
    ]);
    const bankTransactionBySourceKey = new Map(
      purchaseCashRows.map((cash) => [cash.sourceKey, cash.bankTransactionId]),
    );
    res.json(ListFixedAssetsResponse.parse(rows.map((asset) => ({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount: money(Number(asset.unitPrice) * Number(asset.quantity)),
      bankTransactionId: bankTransactionBySourceKey.get(`fixed-asset:${asset.id}`) ?? null,
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
        const account = await cashAccountForCategory(tx, "Эд хөрөнгө");
        const [cash] = await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          accountId: account?.id ?? null,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey: `fixed-asset:${created.id}`,
        }).returning({ id: cashTransactionsTable.id });
        const journalEntryId = await postFixedAssetJournal(tx, {
          assetId: created.id,
          date: input.date,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
        });
        await tx.update(cashTransactionsTable)
          .set({ journalEntryId })
          .where(eq(cashTransactionsTable.id, cash.id));
      }
      return created;
    });
    res.status(201).json(CreateFixedAssetResponse.parse({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount,
      bankTransactionId: null,
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
      const [lockedExisting] = await tx.select().from(fixedAssetsTable)
        .where(eq(fixedAssetsTable.id, id))
        .for("update");
      if (!lockedExisting) return { kind: "missing" as const };
      const affectedDates = new Set<string>();
      if (lockedExisting.purchased) affectedDates.add(lockedExisting.date);
      if (input.purchased) affectedDates.add(input.date);
      if (affectedDates.size) {
        const closures = await tx.select({ date: cashClosuresTable.date }).from(cashClosuresTable);
        if (closures.some(({ date }) => affectedDates.has(date))) return { kind: "cash_closed" as const };
      }

      const sourceKey = `fixed-asset:${id}`;
      const [oldCash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, sourceKey),
      )).for("update");
      if (oldCash?.bankTransactionId !== null && oldCash?.bankTransactionId !== undefined) {
        return { kind: "bank_linked" as const };
      }
      const oldDescription = oldCash?.description;
      const oldAmount = oldCash ? Number(oldCash.amount) : null;
      const oldDate = oldCash?.date;
      const [updated] = await tx.update(fixedAssetsTable).set({
        name,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        date: input.date,
        purchased: input.purchased,
      }).where(eq(fixedAssetsTable.id, id)).returning();
      if (input.purchased) {
        const account = await cashAccountForCategory(tx, "Эд хөрөнгө");
        const [cash] = await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          accountId: account?.id ?? null,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            accountId: account?.id ?? null,
            description: `${name} (${input.quantity} ширхэг)`,
            amount: totalAmount,
            date: input.date,
          },
        }).returning();
        const description = `${name} (${input.quantity} ширхэг)`;
        const changed = !oldCash
          || oldAmount !== totalAmount
          || oldDate !== input.date
          || oldDescription !== description;
        if (!lockedExisting.purchased || (cash.journalEntryId !== null && changed)) {
          if (cash.journalEntryId !== null && changed) {
            await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
          }
          const journalEntryId = await postFixedAssetJournal(tx, {
            assetId: id,
            date: input.date,
            description,
            amount: totalAmount,
          });
          await tx.update(cashTransactionsTable).set({ journalEntryId })
            .where(eq(cashTransactionsTable.id, cash.id));
        }
      } else {
        if (oldCash?.journalEntryId !== null && oldCash?.journalEntryId !== undefined) {
          await voidJournalEntry(tx, { journalEntryId: oldCash.journalEntryId, voidedBy: null });
        }
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
          eq(cashTransactionsTable.sourceKey, sourceKey),
        ));
      }
      return { kind: "updated" as const, asset: updated };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    if (result.kind === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг засах боломжгүй" });
      return;
    }
    if (result.kind === "bank_linked") {
      res.status(409).json({ error: "Банкны гүйлгээтэй холбогдсон эд хөрөнгийг засах боломжгүй" });
      return;
    }
    res.json(UpdateFixedAssetResponse.parse({
      ...result.asset,
      unitPrice: Number(result.asset.unitPrice),
      quantity: Number(result.asset.quantity),
      totalAmount,
      bankTransactionId: null,
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
      const [lockedExisting] = await tx.select().from(fixedAssetsTable)
        .where(eq(fixedAssetsTable.id, id))
        .for("update");
      if (!lockedExisting) return "missing" as const;
      if (lockedExisting.purchased) {
        const [closure] = await tx.select({ id: cashClosuresTable.id })
          .from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, lockedExisting.date));
        if (closure) return "cash_closed" as const;
      }
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${id}`),
      )).for("update");
      if (cash?.bankTransactionId !== null && cash?.bankTransactionId !== undefined) {
        return "bank_linked" as const;
      }
      if (cash?.journalEntryId !== null && cash?.journalEntryId !== undefined) {
        await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
      }
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${id}`),
      ));
      await tx.delete(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
      return "deleted" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    if (result === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг устгах боломжгүй" });
      return;
    }
    if (result === "bank_linked") {
      res.status(409).json({ error: "Банкны гүйлгээтэй холбогдсон эд хөрөнгийг устгах боломжгүй" });
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
      db.select({
        purchase: inventoryPurchasesTable,
        accountCode: chartOfAccountsTable.code,
        accountName: chartOfAccountsTable.name,
      }).from(inventoryPurchasesTable)
        .leftJoin(chartOfAccountsTable, eq(inventoryPurchasesTable.accountId, chartOfAccountsTable.id))
        .orderBy(desc(inventoryPurchasesTable.date), desc(inventoryPurchasesTable.id)),
      db.select().from(inventoryPurchaseItemsTable).orderBy(inventoryPurchaseItemsTable.id),
      db.select({ date: cashClosuresTable.date }).from(cashClosuresTable),
    ]);
    const closedDates = new Set(closures.map((closure) => closure.date));
    res.json(ListInventoryPurchasesResponse.parse(purchases.map((row) => ({
      id: row.purchase.id,
      materialType: row.purchase.materialType,
      accountId: row.purchase.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      supplierName: row.purchase.documentName,
      hasReceipt: row.purchase.hasReceipt,
      date: row.purchase.date,
      totalAmount: Number(row.purchase.totalAmount),
      paid: row.purchase.paymentDate !== null,
      paymentDate: row.purchase.paymentDate,
      paymentAmount: row.purchase.paymentAmount === null ? null : Number(row.purchase.paymentAmount),
      createdAt: row.purchase.createdAt.toISOString(),
      editable: !closedDates.has(row.purchase.date),
      items: items
        .filter((item) => item.purchaseId === row.purchase.id)
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
      const account = await inventoryPurchaseAccount(tx, input.materialType);
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
        .values({ materialType: input.materialType, accountId: account.id, documentName: supplier.name, hasReceipt: input.hasReceipt, date: input.date, totalAmount })
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
      return { purchase, savedItems, account };
    });
    res.status(201).json(CreateInventoryPurchaseResponse.parse({
      id: result.purchase.id,
      materialType: result.purchase.materialType,
      accountId: result.purchase.accountId,
      accountCode: result.account.code,
      accountName: result.account.name,
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
      const account = await inventoryPurchaseAccount(tx, input.materialType);
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
        accountId: account.id,
        documentName: supplier.name,
        hasReceipt: input.hasReceipt,
        date: input.date,
        totalAmount,
      }).where(eq(inventoryPurchasesTable.id, id)).returning();
      if (existing.paymentDate) {
        const cashCategory = inventoryMaterialLabel(input.materialType);
        const cashAccount = await cashAccountForCategory(tx, cashCategory);
        await tx.update(cashTransactionsTable)
          .set({ category: cashCategory, accountId: cashAccount?.id ?? null, description: supplier.name })
          .where(and(
            eq(cashTransactionsTable.sourceType, "inventory_purchase"),
            eq(cashTransactionsTable.sourceKey, `purchase:${id}`),
          ));
      }
      return { kind: "updated" as const, purchase, savedItems, account };
    });
    if (result.kind === "consumed") {
      res.status(409).json({ error: "Энэ худалдан авалтын бараа аль хэдийн зарлагдсан тул засах боломжгүй" });
      return;
    }
    res.json(UpdateInventoryPurchaseResponse.parse({
      id: result.purchase.id,
      materialType: result.purchase.materialType,
      accountId: result.purchase.accountId,
      accountCode: result.account.code,
      accountName: result.account.name,
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
      const cashCategory = inventoryMaterialLabel(currentPurchase.materialType);
      const cashAccount = await cashAccountForCategory(tx, cashCategory);
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense",
        category: cashCategory,
        accountId: cashAccount?.id ?? null,
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
          category: cashCategory,
          accountId: cashAccount?.id ?? null,
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
      if (currentPurchase.accountId === null) {
        throw new Error("Inventory purchase account is missing");
      }
      const [inventoryAccount] = await tx.select().from(chartOfAccountsTable).where(and(
        eq(chartOfAccountsTable.id, currentPurchase.accountId),
        eq(chartOfAccountsTable.isActive, true),
      ));
      if (!inventoryAccount) {
        throw new Error("Inventory purchase account is missing or inactive");
      }
      const creditCode = bank ? "1010" : "1000";
      const [creditAccount] = await tx.select().from(chartOfAccountsTable).where(and(
        eq(chartOfAccountsTable.code, creditCode),
        eq(chartOfAccountsTable.isActive, true),
      ));
      if (!creditAccount) {
        throw new Error(`Settlement account ${creditCode} is missing or inactive`);
      }
      const posting = await postJournalEntry(tx, {
        date: input.date,
        description: currentPurchase.documentName,
        sourceType: "inventory_purchase",
        sourceId: currentPurchase.id,
        createdBy: null,
        lines: [
          { accountId: inventoryAccount.id, debit: input.amount, credit: 0 },
          { accountId: creditAccount.id, debit: 0, credit: input.amount },
        ],
      });
      if (posting.status !== "posted") {
        throw new Error("Inventory purchase journal entry must be balanced");
      }
      await tx.update(cashTransactionsTable)
        .set({ journalEntryId: posting.journalEntryId })
        .where(eq(cashTransactionsTable.id, cash!.id));
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
      if (cash?.journalEntryId) {
        await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
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
      const account = await lockedExpenseAccount(tx, input.accountId);
      if (!account) return { kind: "invalid_account" as const };
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
        accountId: account.id,
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
        const cashAccount = await cashAccountForCategory(tx, "Үйл ажиллагааны зардал");
        await tx.update(cashTransactionsTable).set({
          category: "Үйл ажиллагааны зардал",
          accountId: cashAccount?.id ?? null,
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
      return { kind: "reclassified" as const, expense: savedExpense, accountName: account.name };
    });
    if (result.kind === "consumed") {
      res.status(409).json({ error: "Энэ худалдан авалтын бараа аль хэдийн зарлагдсан тул шилжүүлэх боломжгүй" });
      return;
    }
    if (result.kind === "invalid_account") {
      res.status(400).json({ error: "Зардлын хүчинтэй данс сонгоно уу" });
      return;
    }
    res.status(201).json(ReclassifyInventoryPurchaseAsExpenseResponse.parse(operatingExpenseResponse(result.expense, result.accountName)));
  } catch (error) {
    next(error);
  }
});

export default router;
