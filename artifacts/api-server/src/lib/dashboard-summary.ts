import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { GetPayrollResponse } from "@workspace/api-zod";
import {
  attendanceTable, bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, db, employeesTable, employeeShiftPlansTable,
  fixedAssetsTable, inventoryPurchasesTable, operatingExpensesTable,
  payrollAttendanceSnapshotsTable, payrollMonthBalancesTable, payrollMonthClosuresTable, shiftTemplatesTable,
} from "@workspace/db";
import { money, nextMonth } from "./date-utils.js";
import { summarizeDashboardPayroll } from "./dashboard-payroll.js";

export async function readDashboardSummary(month: string) {
  const start = `${month}-01`;
  const end = `${nextMonth(month)}-01`;
  // One consistent, read-only snapshot; opening statistics cannot pull payroll,
  // reconcile cash, create defaults, or change a closed month's calculations.
  return db.transaction(async tx => {
    const [sales, purchases, pendingPurchases, expenses, employees, saved, closed, dirty, shifts, recentCash, recentPurchases, recentAssets] = await Promise.all([
      tx.select({ total: sql<number>`coalesce(sum(${cashTransactionsTable.amount}), 0)::float8` })
        .from(cashTransactionsTable).where(and(eq(cashTransactionsTable.type, "income"),
          eq(cashTransactionsTable.incomeMonth, month), isNull(cashTransactionsTable.unclearAt))),
      tx.select({ materialType: inventoryPurchasesTable.materialType,
        total: sql<number>`coalesce(sum(${inventoryPurchasesTable.totalAmount}), 0)::float8` })
        .from(inventoryPurchasesTable).where(and(gte(inventoryPurchasesTable.date, start), lt(inventoryPurchasesTable.date, end)))
        .groupBy(inventoryPurchasesTable.materialType),
      tx.select({ code: chartOfAccountsTable.code, total: sql<number>`sum(${bankTransactionsTable.amount})::float8` })
        .from(bankTransactionsTable).innerJoin(cashTransactionsTable, and(
          eq(bankTransactionsTable.cashTransactionId, cashTransactionsTable.id),
          eq(cashTransactionsTable.bankTransactionId, bankTransactionsTable.id),
          eq(cashTransactionsTable.sourceType, "bank_transaction"),
          sql`${cashTransactionsTable.sourceKey} = 'pending-purchase:' || ${bankTransactionsTable.id}::text`,
        )).innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, bankTransactionsTable.accountId))
        .where(and(gte(bankTransactionsTable.transactionAt, new Date(`${start}T00:00:00Z`)),
          lt(bankTransactionsTable.transactionAt, new Date(`${end}T00:00:00Z`)), isNull(cashTransactionsTable.unclearAt)))
        .groupBy(chartOfAccountsTable.code),
      tx.select({ total: sql<number>`coalesce(sum(${operatingExpensesTable.amount}), 0)::float8` })
        .from(operatingExpensesTable).leftJoin(cashTransactionsTable, eq(operatingExpensesTable.cashTransactionId, cashTransactionsTable.id))
        .where(and(gte(operatingExpensesTable.date, start), lt(operatingExpensesTable.date, end), isNull(cashTransactionsTable.unclearAt))),
      tx.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
        .where(and(lt(employeesTable.joinedAt, end), sql`(${employeesTable.inactiveAt} is null or ${employeesTable.inactiveAt} >= ${start})`)),
      tx.select().from(payrollAttendanceSnapshotsTable).where(eq(payrollAttendanceSnapshotsTable.month, month)),
      tx.select().from(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, month)),
      tx.select({ dirty: payrollMonthBalancesTable.dirty }).from(payrollMonthBalancesTable).where(eq(payrollMonthBalancesTable.month, month)),
      tx.select({ id: shiftTemplatesTable.id, name: shiftTemplatesTable.name }).from(shiftTemplatesTable).orderBy(asc(shiftTemplatesTable.id)),
      tx.select().from(cashTransactionsTable).where(and(gte(cashTransactionsTable.date, start), lt(cashTransactionsTable.date, end),
        isNull(cashTransactionsTable.unclearAt))).orderBy(desc(cashTransactionsTable.createdAt)).limit(5),
      tx.select().from(inventoryPurchasesTable).where(and(gte(inventoryPurchasesTable.date, start), lt(inventoryPurchasesTable.date, end)))
        .orderBy(desc(inventoryPurchasesTable.createdAt)).limit(5),
      tx.select().from(fixedAssetsTable).where(and(gte(fixedAssetsTable.date, start), lt(fixedAssetsTable.date, end),
        eq(fixedAssetsTable.purchased, true))).orderBy(desc(fixedAssetsTable.createdAt)).limit(5),
    ]);
    const payroll = closed[0]?.payroll ?? saved[0]?.payroll;
    let salary = { payrollGross: null as number | null, officePayrollGross: null as number | null,
      payrollByShift: [] as ReturnType<typeof summarizeDashboardPayroll>["payrollByShift"] };
    if (payroll) {
      const parsed = GetPayrollResponse.parse(payroll);
      const [plans, worked] = await Promise.all([
        tx.select({ employeeId: employeeShiftPlansTable.employeeId, date: employeeShiftPlansTable.date, shiftId: employeeShiftPlansTable.shiftId })
          .from(employeeShiftPlansTable).where(and(gte(employeeShiftPlansTable.date, parsed.periodStart), lte(employeeShiftPlansTable.date, parsed.periodEnd))),
        tx.select({ employeeId: attendanceTable.employeeId, date: attendanceTable.date, status: attendanceTable.status })
          .from(attendanceTable).where(and(gte(attendanceTable.date, parsed.periodStart), lte(attendanceTable.date, parsed.periodEnd))),
      ]);
      salary = summarizeDashboardPayroll(parsed.lines, plans, worked, shifts);
    }
    const recentActivity = [
      ...recentCash.map(row => ({ id: `cash-${row.id}`, type: "cash",
        title: row.type === "income" ? "Орлого бүртгэгдлээ" : "Зарлага бүртгэгдлээ",
        detail: `${row.description} · ${money(Number(row.amount)).toLocaleString()}₮`, createdAt: row.createdAt.toISOString() })),
      ...recentPurchases.map(row => ({ id: `inventory-purchase-${row.id}`, type: "inventory_purchase",
        title: row.materialType === "food" ? "Бараа материал худалдан авлаа" : "Хангамжийн материал худалдан авлаа",
        detail: `${row.documentName} · ${money(Number(row.totalAmount)).toLocaleString()}₮`, createdAt: row.createdAt.toISOString() })),
      ...recentAssets.map(row => ({ id: `fixed-asset-${row.id}`, type: "fixed_asset_purchase", title: "Эд хөрөнгө худалдан авлаа",
        detail: `${row.name} · ${money(Number(row.unitPrice) * row.quantity).toLocaleString()}₮`, createdAt: row.createdAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    return {
      month, employeeCount: employees[0].count, salesIncome: money(sales[0].total), ...salary,
      payrollStatus: closed[0] ? "closed" as const : !payroll ? "missing" as const : dirty[0]?.dirty ? "stale" as const : "saved" as const,
      payrollPulledAt: saved[0]?.pulledAt.toISOString() ?? null,
      inventoryPurchaseTotal: money((purchases.find(row => row.materialType === "food")?.total ?? 0)
        + (pendingPurchases.find(row => row.code === "1500")?.total ?? 0)),
      supplyPurchaseTotal: money((purchases.find(row => row.materialType === "supply")?.total ?? 0)
        + (pendingPurchases.find(row => row.code === "1510")?.total ?? 0)),
      operatingExpenseTotal: money(expenses[0].total), recentActivity,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
