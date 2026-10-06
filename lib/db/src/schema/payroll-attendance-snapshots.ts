import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

// Derived earnings, never a replacement for attendance, payments or financial balances.
export const payrollAttendanceSnapshotsTable = pgTable("payroll_attendance_snapshots", {
  month: text("month").primaryKey(),
  payroll: jsonb("payroll").$type<Record<string, unknown>>().notNull(),
  advance: jsonb("advance").$type<Record<string, unknown>>().notNull(),
  pulledAt: timestamp("pulled_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("payroll_attendance_snapshots_month_check", sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]);
export const insertPayrollAttendanceSnapshotSchema = createInsertSchema(payrollAttendanceSnapshotsTable);
export type InsertPayrollAttendanceSnapshot = z.infer<typeof insertPayrollAttendanceSnapshotSchema>;
export type PayrollAttendanceSnapshot = typeof payrollAttendanceSnapshotsTable.$inferSelect;
