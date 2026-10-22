import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type PayrollOpeningEntry = { employeeId: number; employeeName: string; balanceAmount: number };

// Append-only financial confirmations. A revision never erases an older confirmation.
export const payrollOpeningBalancesTable = pgTable("payroll_opening_balances", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  lines: jsonb("lines").$type<PayrollOpeningEntry[]>().notNull(),
  note: text("note").notNull(),
  confirmedBy: integer("confirmed_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  reviewEmployeeIds: jsonb("review_employee_ids").$type<number[]>().notNull().default([]),
});

export const payrollRefreshRevisionTable = pgTable("payroll_refresh_revision", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
});
