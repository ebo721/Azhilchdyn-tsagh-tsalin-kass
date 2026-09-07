import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone").notNull().default(""),
  salaryType: text("salary_type").notNull().default("monthly"),
  employeeType: text("employee_type").notNull().default("office"),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2, mode: "number" }).notNull(),
  socialInsuranceSalary: numeric("social_insurance_salary", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("active"),
  joinedAt: date("joined_at").notNull().defaultNow(),
});

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  clockIn: text("clock_in").notNull(),
  clockOut: text("clock_out").notNull(),
  hours: numeric("hours", { precision: 6, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("present"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payrollAdjustmentsTable = pgTable("payroll_adjustments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  advanceAmount: numeric("advance_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  taxRelief: numeric("tax_relief", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  manualDeduction: numeric("manual_deduction", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("payroll_adjustments_employee_month_idx").on(table.employeeId, table.month),
]);

export const payrollAdvanceApprovalsTable = pgTable("payroll_advance_approvals", {
  id: serial("id").primaryKey(),
  month: text("month").notNull().unique(),
  lines: jsonb("lines").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cashTransactionsTable = pgTable("cash_transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  date: date("date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  id: true,
  joinedAt: true,
});
export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  createdAt: true,
  hours: true,
});
export const insertCashTransactionSchema = createInsertSchema(cashTransactionsTable).omit({
  id: true,
  createdAt: true,
});

export type Employee = typeof employeesTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type PayrollAdjustment = typeof payrollAdjustmentsTable.$inferSelect;
export type PayrollAdvanceApproval = typeof payrollAdvanceApprovalsTable.$inferSelect;
export type CashTransaction = typeof cashTransactionsTable.$inferSelect;