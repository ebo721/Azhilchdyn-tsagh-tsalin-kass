import {
  boolean,
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
  payrollTaxExempt: boolean("payroll_tax_exempt").notNull().default(false),
  monthlyExpectedWorkDays: integer("monthly_expected_work_days").notNull().default(0),
  status: text("status").notNull().default("active"),
  joinedAt: date("joined_at").notNull().defaultNow(),
});

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  normalizedUsername: text("normalized_username").notNull().unique(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  tokenVersion: integer("token_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const shiftTemplatesTable = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shift_templates_name_idx").on(table.name),
]);

export const employeeShiftPlansTable = pgTable("employee_shift_plans", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  shiftId: integer("shift_id").notNull().references(() => shiftTemplatesTable.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("employee_shift_plans_employee_date_idx").on(table.employeeId, table.date),
]);

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
  paymentDate: date("payment_date", { mode: "string" }),
  secondPaidAmount: numeric("second_paid_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  secondPaymentDate: date("second_payment_date", { mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("payroll_adjustments_employee_month_idx").on(table.employeeId, table.month),
]);

export const payrollAdvanceApprovalsTable = pgTable("payroll_advance_approvals", {
  id: serial("id").primaryKey(),
  month: text("month").notNull().unique(),
  lines: jsonb("lines").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  approvalDate: date("approval_date", { mode: "string" }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cashTransactionsTable = pgTable("cash_transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  date: date("date").notNull(),
  sourceType: text("source_type"),
  sourceKey: text("source_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cash_transactions_source_idx").on(table.sourceType, table.sourceKey),
]);

export const cashClosuresTable = pgTable("cash_closures", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryPurchasesTable = pgTable("inventory_purchases", {
  id: serial("id").primaryKey(),
  documentName: text("document_name").notNull().default("Худалдан авалтын баримт"),
  hasReceipt: boolean("has_receipt").notNull().default(false),
  date: date("date", { mode: "string" }).notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }),
  paymentAmount: numeric("payment_amount", { precision: 14, scale: 2, mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventorySuppliersTable = pgTable("inventory_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryPurchaseItemsTable = pgTable("inventory_purchase_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => inventoryPurchasesTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Бусад"),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
});

export const inventoryIssuesTable = pgTable("inventory_issues", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  purpose: text("purpose").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fixedAssetsTable = pgTable("fixed_assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
  quantity: integer("quantity").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  purchased: boolean("purchased").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deletionRequestsTable = pgTable("deletion_requests", {
  id: serial("id").primaryKey(),
  targetPath: text("target_path").notNull(),
  label: text("label").notNull(),
  requesterRole: text("requester_role").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
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
export type User = typeof usersTable.$inferSelect;
export type ShiftTemplate = typeof shiftTemplatesTable.$inferSelect;
export type EmployeeShiftPlan = typeof employeeShiftPlansTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type PayrollAdjustment = typeof payrollAdjustmentsTable.$inferSelect;
export type PayrollAdvanceApproval = typeof payrollAdvanceApprovalsTable.$inferSelect;
export type CashTransaction = typeof cashTransactionsTable.$inferSelect;
export type CashClosure = typeof cashClosuresTable.$inferSelect;
export type InventoryPurchase = typeof inventoryPurchasesTable.$inferSelect;
export type InventorySupplier = typeof inventorySuppliersTable.$inferSelect;
export type InventoryPurchaseItem = typeof inventoryPurchaseItemsTable.$inferSelect;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryIssue = typeof inventoryIssuesTable.$inferSelect;
export type FixedAsset = typeof fixedAssetsTable.$inferSelect;
export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;