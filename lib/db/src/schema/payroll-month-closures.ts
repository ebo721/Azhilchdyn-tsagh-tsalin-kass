import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// Immutable business records, not an attendance cache. Reopening is explicit.
export const payrollMonthClosuresTable = pgTable("payroll_month_closures", {
  month: text("month").primaryKey(),
  payroll: jsonb("payroll").$type<Record<string, unknown>>().notNull(),
  advance: jsonb("advance").$type<Record<string, unknown>>().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: integer("closed_by").notNull(),
});
