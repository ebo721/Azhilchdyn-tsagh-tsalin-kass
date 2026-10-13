import { date, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable, inventoryItemsTable, inventoryIssuesTable, usersTable } from "./index";

export const inventoryClosingBalancesTable = pgTable("inventory_closing_balances", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  bookQuantity: numeric("book_quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
  priceSource: text("price_source").notNull(),
  responsibleEmployeeId: integer("responsible_employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  responsibleUserId: integer("responsible_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  responsibleName: text("responsible_name").notNull(),
  issueId: integer("issue_id").references(() => inventoryIssuesTable.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("inventory_closing_balances_item_date_idx").on(table.inventoryItemId, table.date),
  uniqueIndex("inventory_closing_balances_issue_idx").on(table.issueId),
  check("inventory_closing_balances_values_check", sql`${table.quantity} >= 0 AND ${table.bookQuantity} >= 0 AND ${table.unitPrice} >= 0`),
  check("inventory_closing_balances_price_source_check", sql`${table.priceSource} IN ('purchase', 'opening')`),
]);
export const insertInventoryClosingBalanceSchema = createInsertSchema(inventoryClosingBalancesTable).omit({ id: true, createdAt: true });
export type InsertInventoryClosingBalance = z.infer<typeof insertInventoryClosingBalanceSchema>;
export type InventoryClosingBalance = typeof inventoryClosingBalancesTable.$inferSelect;
