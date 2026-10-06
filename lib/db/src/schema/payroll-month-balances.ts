import { sql } from "drizzle-orm";
import { pgTable, text, date, jsonb, boolean, timestamp, check, index } from "drizzle-orm/pg-core";

export type PayrollBalanceEntry = {
  employeeId: number;
  /** Current month's gross minus deductions and recorded payments, excluding opening balance. */
  movement: number;
  balanceAmount: number;
};

// Derived financial records only. Attendance and recorded payments remain the source of truth.
export const payrollMonthBalancesTable = pgTable("payroll_month_balances", {
  month: text("month").primaryKey(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  lines: jsonb("lines").$type<PayrollBalanceEntry[]>().notNull(),
  dirty: boolean("dirty").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("payroll_month_balances_month_check", sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("payroll_month_balances_period_check", sql`${table.periodStart} <= ${table.periodEnd}`),
  index("payroll_month_balances_dirty_idx").on(table.dirty, table.month),
]);
