import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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
  fullSalaryRegardlessAttendance: boolean("full_salary_regardless_attendance").notNull().default(false),
  payFrequency: text("pay_frequency").notNull().default("twice"),
  monthlyExpectedWorkDays: integer("monthly_expected_work_days").notNull().default(0),
  status: text("status").notNull().default("active"),
  joinedAt: date("joined_at", { mode: "string" }).notNull().defaultNow(),
  inactiveAt: date("inactive_at", { mode: "string" }),
});

export const employeeSalaryHistoryTable = pgTable("employee_salary_history", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  employeeType: text("employee_type").notNull(),
  salaryType: text("salary_type").notNull().default("monthly"),
  monthlyExpectedWorkDays: integer("monthly_expected_work_days").notNull().default(0),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2, mode: "number" }).notNull(),
  socialInsuranceSalary: numeric("social_insurance_salary", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  payrollTaxExempt: boolean("payroll_tax_exempt").notNull().default(false),
  fullSalaryRegardlessAttendance: boolean("full_salary_regardless_attendance").notNull().default(false),
  payFrequency: text("pay_frequency").notNull().default("twice"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("employee_salary_history_employee_effective_idx").on(table.employeeId, table.effectiveFrom),
]);

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

export const payrollScheduleSettingsTable = pgTable("payroll_schedule_settings", {
  id: serial("id").primaryKey(),
  effectiveFromMonth: text("effective_from_month").notNull().default("0001-01"),
  periodStartDay: integer("period_start_day").notNull().default(1),
  advanceCutoffDay: integer("advance_cutoff_day").notNull().default(15),
  periodEndDay: integer("period_end_day").notNull().default(31),
  advancePayDay: integer("advance_pay_day").notNull().default(15),
  finalPayDay: integer("final_pay_day").notNull().default(31),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("payroll_schedule_settings_effective_month_idx").on(table.effectiveFromMonth),
]);

export const chartOfAccountsTable = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  normalBalance: text("normal_balance").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: integer("voided_by").references(() => usersTable.id, { onDelete: "restrict" }),
}, (table) => [
  index("journal_entries_source_idx").on(table.sourceType, table.sourceId),
  index("journal_entries_date_idx").on(table.date),
]);

export const journalLinesTable = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "cascade" }),
  accountId: integer("account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  credit: numeric("credit", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  memo: text("memo"),
  allocation: jsonb("allocation"),
}, (table) => [
  index("journal_lines_entry_idx").on(table.journalEntryId),
  index("journal_lines_account_idx").on(table.accountId),
  check(
    "journal_lines_one_sided_check",
    sql`(${table.debit} > 0 AND ${table.credit} = 0) OR (${table.credit} > 0 AND ${table.debit} = 0)`,
  ),
]);

export const receivablesTable = pgTable("receivables", {
  id: serial("id").primaryKey(),
  originJournalEntryId: integer("origin_journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  originJournalLineId: integer("origin_journal_line_id").notNull().references(() => journalLinesTable.id, { onDelete: "restrict" }),
  employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
  supplierId: integer("supplier_id").references(() => inventorySuppliersTable.id, { onDelete: "restrict" }),
  originalAmount: numeric("original_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  openAmount: numeric("open_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("receivables_origin_line_idx").on(table.originJournalLineId),
  index("receivables_open_idx").on(table.status, table.openAmount),
  check("receivables_exactly_one_party_check", sql`(${table.employeeId} IS NOT NULL)::integer + (${table.supplierId} IS NOT NULL)::integer = 1`),
  check("receivables_amounts_check", sql`${table.originalAmount} > 0 AND ${table.openAmount} >= 0 AND ${table.openAmount} <= ${table.originalAmount}`),
  check("receivables_status_balance_check", sql`(${table.status} = 'open' AND ${table.openAmount} > 0) OR (${table.status} = 'settled' AND ${table.openAmount} = 0)`),
  check("receivables_status_check", sql`${table.status} IN ('open', 'settled')`),
]);

export const receivableAllocationsTable = pgTable("receivable_allocations", {
  id: serial("id").primaryKey(),
  receivableId: integer("receivable_id").notNull().references(() => receivablesTable.id, { onDelete: "restrict" }),
  settlementJournalEntryId: integer("settlement_journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  settlementJournalLineId: integer("settlement_journal_line_id").notNull().references(() => journalLinesTable.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("receivable_allocations_settlement_line_idx").on(table.settlementJournalLineId),
  index("receivable_allocations_receivable_idx").on(table.receivableId),
  check("receivable_allocations_amount_check", sql`${table.amount} > 0`),
]);

export const payablesTable = pgTable("payables", {
  id: serial("id").primaryKey(),
  partyType: text("party_type").notNull(),
  partyId: integer("party_id").notNull(),
  originalAmount: numeric("original_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  remainingBalance: numeric("remaining_balance", { precision: 14, scale: 2, mode: "number" }).notNull(),
  status: text("status").notNull().default("open"),
  journalEntryId: integer("journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payables_party_status_idx").on(table.partyType, table.partyId, table.status),
  index("payables_journal_entry_idx").on(table.journalEntryId),
  check("payables_party_type_check", sql`${table.partyType} IN ('employee', 'supplier')`),
  check("payables_party_id_check", sql`${table.partyId} > 0`),
  check("payables_amounts_check", sql`${table.originalAmount} > 0 AND ${table.remainingBalance} >= 0 AND ${table.remainingBalance} <= ${table.originalAmount}`),
  check("payables_status_balance_check", sql`(${table.status} = 'open' AND ${table.remainingBalance} > 0) OR (${table.status} = 'closed' AND ${table.remainingBalance} = 0)`),
  check("payables_status_check", sql`${table.status} IN ('open', 'closed')`),
]);

export const payableAllocationsTable = pgTable("payable_allocations", {
  id: serial("id").primaryKey(),
  payableId: integer("payable_id").notNull().references(() => payablesTable.id, { onDelete: "restrict" }),
  settlementJournalEntryId: integer("settlement_journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  settlementJournalLineId: integer("settlement_journal_line_id").notNull().references(() => journalLinesTable.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payable_allocations_settlement_line_idx").on(table.settlementJournalLineId),
  index("payable_allocations_payable_idx").on(table.payableId),
  check("payable_allocations_amount_check", sql`${table.amount} > 0`),
]);

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

export const officeAttendanceNetworkTable = pgTable("office_attendance_network", {
  id: integer("id").primaryKey(),
  officeIp: text("office_ip").notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("office_attendance_network_singleton_check", sql`${table.id} = 1`),
]);

export const attendanceDeviceEnrollmentsTable = pgTable("attendance_device_enrollments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("attendance_device_enrollments_employee_idx").on(table.employeeId),
]);

export const attendanceDevicesTable = pgTable("attendance_devices", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "restrict" }),
  publicKey: jsonb("public_key").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("attendance_devices_employee_idx").on(table.employeeId),
]);

export const officeAttendancePunchesTable = pgTable("office_attendance_punches", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "restrict" }),
  deviceId: integer("device_id").notNull().references(() => attendanceDevicesTable.id, { onDelete: "restrict" }),
  officeDate: date("office_date", { mode: "string" }).notNull(),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull(),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  attendanceId: integer("attendance_id").references(() => attendanceTable.id, { onDelete: "restrict" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: integer("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("office_attendance_punches_employee_date_idx").on(table.employeeId, table.officeDate),
  uniqueIndex("office_attendance_punches_pending_employee_idx").on(table.employeeId)
    .where(sql`${table.checkedOutAt} IS NULL AND ${table.cancelledAt} IS NULL`),
  check(
    "office_attendance_punches_cancellation_check",
    sql`(${table.cancelledAt} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL)`,
  ),
]);

export const officeAttendanceNoncesTable = pgTable("office_attendance_nonces", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull().references(() => attendanceDevicesTable.id, { onDelete: "cascade" }),
  nonceHash: text("nonce_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("office_attendance_nonces_device_nonce_idx").on(table.deviceId, table.nonceHash),
]);

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
  receivableId: integer("receivable_id").references(() => receivablesTable.id, { onDelete: "restrict" }),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "set null" }),
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
  accountId: integer("account_id").references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  date: date("date").notNull(),
  incomeMonth: text("income_month"),
  sourceType: text("source_type"),
  sourceKey: text("source_key"),
  // This intentionally has no FK because bankTransactionsTable is declared below.
  // bank_transactions.cash_transaction_id remains the referential link.
  bankTransactionId: integer("bank_transaction_id"),
  bankVerifiedAt: timestamp("bank_verified_at", { withTimezone: true }),
  unclearAt: timestamp("unclear_at", { withTimezone: true }),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cash_transactions_source_idx").on(table.sourceType, table.sourceKey),
  uniqueIndex("cash_transactions_bank_transaction_idx").on(table.bankTransactionId),
  index("cash_transactions_account_id_idx").on(table.accountId),
]);

export const cashClosuresTable = pgTable("cash_closures", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankAccountsTable = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bank_accounts_bank_number_idx").on(table.bankName, table.accountNumber),
]);

export const bankTransactionsTable = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  transactionAt: timestamp("transaction_at", { withTimezone: true, precision: 0 }).notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  accountId: integer("account_id").references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  rejectedAccountIds: integer("rejected_account_ids").array().notNull().default(sql`ARRAY[]::integer[]`),
  account: text("account").notNull().default(""),
  counterparty: text("counterparty").notNull().default(""),
  balance: numeric("balance", { precision: 14, scale: 2, mode: "number" }),
  description: text("description").notNull().default(""),
  executedAt: timestamp("executed_at", { withTimezone: true, precision: 0 }),
  fingerprint: text("fingerprint").notNull(),
  bankAccountId: integer("bank_account_id").references(() => bankAccountsTable.id, { onDelete: "restrict" }),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  transferredAt: timestamp("transferred_at", { withTimezone: true, precision: 0 }),
  cashTransactionId: integer("cash_transaction_id").references(() => cashTransactionsTable.id, { onDelete: "restrict" }),
  unclearAt: timestamp("unclear_at", { withTimezone: true }),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bank_transactions_fingerprint_idx").on(table.fingerprint),
  uniqueIndex("bank_transactions_cash_transaction_idx").on(table.cashTransactionId),
  index("bank_transactions_account_id_idx").on(table.accountId),
]);

export const inventoryPurchasesTable = pgTable("inventory_purchases", {
  id: serial("id").primaryKey(),
  materialType: text("material_type").notNull().default("supply"),
  accountId: integer("account_id").references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  documentName: text("document_name").notNull().default("Худалдан авалтын баримт"),
  hasReceipt: boolean("has_receipt").notNull().default(false),
  date: date("date", { mode: "string" }).notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }),
  paymentAmount: numeric("payment_amount", { precision: 14, scale: 2, mode: "number" }),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("inventory_purchases_account_id_idx").on(table.accountId),
]);

export const inventoryPurchasePaymentGroupsTable = pgTable("inventory_purchase_payment_groups", {
  id: serial("id").primaryKey(),
  // Preserve the bank ID as audit history even if the now-unlinked bank row is deleted.
  bankTransactionId: integer("bank_transaction_id").notNull(),
  cashTransactionId: integer("cash_transaction_id").references(() => cashTransactionsTable.id, { onDelete: "set null" }),
  journalEntryId: integer("journal_entry_id").notNull().references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  index("inventory_purchase_payment_groups_bank_idx").on(table.bankTransactionId),
  check("inventory_purchase_payment_groups_status_check", sql`${table.status} IN ('active', 'cancelled')`),
  check("inventory_purchase_payment_groups_cancelled_check", sql`(${table.status} = 'active' AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL)`),
]);

export const inventoryPurchasePaymentGroupMembersTable = pgTable("inventory_purchase_payment_group_members", {
  groupId: integer("group_id").notNull().references(() => inventoryPurchasePaymentGroupsTable.id, { onDelete: "cascade" }),
  // Intentionally no purchase FK: cancelled groups retain their exact purchase IDs
  // while allowing each purchase to be edited or deleted independently afterward.
  purchaseId: integer("purchase_id").notNull(),
}, (table) => [
  index("inventory_purchase_payment_group_members_purchase_idx").on(table.purchaseId),
  index("inventory_purchase_payment_group_members_group_idx").on(table.groupId),
  uniqueIndex("inventory_purchase_payment_group_members_group_purchase_idx").on(table.groupId, table.purchaseId),
]);

export const inventorySuppliersTable = pgTable("inventory_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  materialType: text("material_type").notNull().default("supply"),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mealsTable = pgTable("meals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  category: text("category").notNull(),
  type: text("type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  totalCalories: numeric("total_calories", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Explicit approval queue for technologist name/category edits. */
export const mealEditRequestsTable = pgTable("meal_edit_requests", {
  id: serial("id").primaryKey(),
  mealId: integer("meal_id").notNull().references(() => mealsTable.id, { onDelete: "cascade" }),
  requesterId: integer("requester_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  previousName: text("previous_name").notNull(),
  previousCategory: text("previous_category").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedCategory: text("proposed_category").notNull(),
  status: text("status").notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => [
  check("meal_edit_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  uniqueIndex("meal_edit_requests_pending_meal_idx").on(table.mealId).where(sql`${table.status} = 'pending'`),
]);

export const mealIngredientsTable = pgTable("meal_ingredients", {
  id: serial("id").primaryKey(),
  mealId: integer("meal_id").notNull().references(() => mealsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  unit: text("unit").notNull(),
  caloriesPerUnit: numeric("calories_per_unit", { precision: 14, scale: 3, mode: "number" }).notNull(),
  totalCalories: numeric("total_calories", { precision: 14, scale: 3, mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("meal_ingredients_meal_id_idx").on(table.mealId),
  index("meal_ingredients_inventory_item_id_idx").on(table.inventoryItemId),
]);

export const mealScheduleSlotsTable = pgTable("meal_schedule_slots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("meal_schedule_slots_name_idx").on(table.name),
  uniqueIndex("meal_schedule_slots_sort_order_idx").on(table.sortOrder),
  check("meal_schedule_slots_sort_order_check", sql`${table.sortOrder} >= 0`),
]);

export const mealScheduleEntriesTable = pgTable("meal_schedule_entries", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  slotId: integer("slot_id").notNull().references(() => mealScheduleSlotsTable.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  mealType: text("meal_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("meal_schedule_entries_date_slot_idx").on(table.date, table.slotId),
  index("meal_schedule_entries_date_idx").on(table.date),
  check("meal_schedule_entries_kind_check", sql`${table.kind} IN ('meal', 'break')`),
  check("meal_schedule_entries_meal_check", sql`(${table.kind} = 'meal' AND ${table.mealType} IN ('set', 'packed', 'therapeutic')) OR (${table.kind} = 'break' AND ${table.mealType} IS NULL)`),
]);

export const mealScheduleEntryMealsTable = pgTable("meal_schedule_entry_meals", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => mealScheduleEntriesTable.id, { onDelete: "cascade" }),
  mealId: integer("meal_id").notNull().references(() => mealsTable.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  uniqueIndex("meal_schedule_entry_meals_entry_meal_idx").on(table.entryId, table.mealId),
  uniqueIndex("meal_schedule_entry_meals_entry_order_idx").on(table.entryId, table.sortOrder),
  index("meal_schedule_entry_meals_meal_idx").on(table.mealId),
]);

export const mealCountsTable = pgTable("meal_counts", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  mealType: text("meal_type").notNull(),
  normalizedMealType: text("normalized_meal_type").notNull(),
  count: integer("count").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meal_counts_date_normalized_meal_type_idx").on(table.date, table.normalizedMealType),
  check("meal_counts_count_check", sql`${table.count} >= 0`),
  check("meal_counts_meal_type_check", sql`${table.mealType} <> '' AND ${table.normalizedMealType} <> ''`),
]);

export const inventoryPurchaseItemsTable = pgTable("inventory_purchase_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => inventoryPurchasesTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Бусад"),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
  // FIFO lot tracking: how much of this purchase line hasn't been consumed by an
  // inventory issue yet. Starts equal to `quantity` and is drawn down as issues
  // consume from this lot (oldest lots first, see inventoryIssueConsumptionsTable).
  remainingQuantity: numeric("remaining_quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
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

export const inventoryMaterialRequestsTable = pgTable("inventory_material_requests", {
  id: serial("id").primaryKey(),
  requestedDate: date("requested_date", { mode: "string" }).notNull(),
  requesterId: integer("requester_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  mealScheduleEntryId: integer("meal_schedule_entry_id").references(() => mealScheduleEntriesTable.id, { onDelete: "set null" }),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("inventory_material_requests_requester_id_idx").on(table.requesterId),
  index("inventory_material_requests_requested_date_idx").on(table.requestedDate),
  check("inventory_material_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected', 'fulfilled')`),
]);

export const inventoryMaterialRequestItemsTable = pgTable("inventory_material_request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => inventoryMaterialRequestsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  itemName: text("item_name").notNull(),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("inventory_material_request_items_request_item_unique").on(table.requestId, table.inventoryItemId),
  check("inventory_material_request_items_quantity_check", sql`${table.quantity} > 0`),
]);

// Records exactly which purchase lot(s) an issue drew stock from, and at what
// unit cost -- this is the FIFO consumption ledger. One issue can span multiple
// lots if the oldest lot didn't have enough quantity left. Editing or deleting
// an issue reverses these rows (adds the quantity back to remainingQuantity)
// before recomputing, so lots never lose track of what's actually left.
export const inventoryIssueConsumptionsTable = pgTable("inventory_issue_consumptions", {
  id: serial("id").primaryKey(),
  issueId: integer("issue_id").notNull().references(() => inventoryIssuesTable.id, { onDelete: "cascade" }),
  purchaseItemId: integer("purchase_item_id").notNull().references(() => inventoryPurchaseItemsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
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

export const operatingExpensesTable = pgTable("operating_expenses", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  accountId: integer("category_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }),
  paymentAmount: numeric("payment_amount", { precision: 14, scale: 2, mode: "number" }),
  bankTransactionId: integer("bank_transaction_id").references(() => bankTransactionsTable.id, { onDelete: "restrict" }),
  cashTransactionId: integer("cash_transaction_id").references(() => cashTransactionsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("operating_expenses_bank_transaction_idx").on(table.bankTransactionId),
  uniqueIndex("operating_expenses_cash_transaction_idx").on(table.cashTransactionId),
]);

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
export type EmployeeSalaryHistory = typeof employeeSalaryHistoryTable.$inferSelect;
export type PayrollScheduleSettings = typeof payrollScheduleSettingsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type ChartOfAccount = typeof chartOfAccountsTable.$inferSelect;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type JournalLine = typeof journalLinesTable.$inferSelect;
export type Receivable = typeof receivablesTable.$inferSelect;
export type ReceivableAllocation = typeof receivableAllocationsTable.$inferSelect;
export type Payable = typeof payablesTable.$inferSelect;
export type PayableAllocation = typeof payableAllocationsTable.$inferSelect;
export type ShiftTemplate = typeof shiftTemplatesTable.$inferSelect;
export type EmployeeShiftPlan = typeof employeeShiftPlansTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type AttendanceDeviceEnrollment = typeof attendanceDeviceEnrollmentsTable.$inferSelect;
export type AttendanceDevice = typeof attendanceDevicesTable.$inferSelect;
export type OfficeAttendancePunch = typeof officeAttendancePunchesTable.$inferSelect;
export type PayrollAdjustment = typeof payrollAdjustmentsTable.$inferSelect;
export type PayrollAdvanceApproval = typeof payrollAdvanceApprovalsTable.$inferSelect;
export type CashTransaction = typeof cashTransactionsTable.$inferSelect;
export type CashClosure = typeof cashClosuresTable.$inferSelect;
export type BankTransaction = typeof bankTransactionsTable.$inferSelect;
export type InventoryPurchase = typeof inventoryPurchasesTable.$inferSelect;
export type InventorySupplier = typeof inventorySuppliersTable.$inferSelect;
export type InventoryPurchaseItem = typeof inventoryPurchaseItemsTable.$inferSelect;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryIssue = typeof inventoryIssuesTable.$inferSelect;
export type InventoryIssueConsumption = typeof inventoryIssueConsumptionsTable.$inferSelect;
export type InventoryMaterialRequest = typeof inventoryMaterialRequestsTable.$inferSelect;
export type InventoryMaterialRequestItem = typeof inventoryMaterialRequestItemsTable.$inferSelect;
export type FixedAsset = typeof fixedAssetsTable.$inferSelect;
export type OperatingExpense = typeof operatingExpensesTable.$inferSelect;
export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;
export type MealEditRequest = typeof mealEditRequestsTable.$inferSelect;