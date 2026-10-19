import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, pool, usersTable, employeesTable, inventoryCustodianEmployeesTable, inventoryItemsTable,
  inventoryPurchasesTable, inventorySuppliersTable, bankTransactionsTable, cashTransactionsTable,
  chartOfAccountsTable, journalEntriesTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test.afterAll(async () => { await pool.end(); });
for (const phone of [false, true]) {
  test(`${phone ? "phone" : "desktop"} bank purchase can be completed without duplicate accounting`, async ({ page, context, baseURL }) => {
    const prefix = `pending-ui-${randomUUID()}`;
    let bankId = 0, employeeId = 0;
    const users: number[] = [];
    try {
      for (const role of ["admin", "warehouse"] as const) {
        const [user] = await db.insert(usersTable).values({ username: `${prefix}-${role}`, normalizedUsername: `${prefix}-${role}`, passwordHash: "unused", role }).returning();
        users.push(user.id);
      }
      const [employee] = await db.insert(employeesTable).values({ name: prefix, role: "Нярав", baseSalary: 0 }).returning();
      employeeId = employee.id;
      await db.insert(inventoryCustodianEmployeesTable).values({ userId: users[1], employeeId });
      const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, users[0]));
      await context.addCookies([{ name: hrCookie.name, value: createStaffSession(admin), url: baseURL! }]);
      const code = phone ? "1510" : "1500", type = phone ? "supply" : "food";
      const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, code));
      const [bank] = await db.insert(bankTransactionsTable).values({
        type: "expense", amount: 83.45, transactionAt: new Date("2098-07-15T08:00:00Z"),
        account: prefix, counterparty: "", description: prefix, accountId: account.id, fingerprint: randomUUID(),
      }).returning();
      bankId = bank.id;
      if (phone) await page.setViewportSize({ width: 402, height: 874 });
      await page.goto("/bank-transactions/journal-review");
      await page.getByTestId(`button-post-pending-purchase-${bank.id}`).click();
      await expect(page.getByTestId(`button-post-pending-purchase-${bank.id}`)).toHaveCount(0);
      const [posted] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      expect(posted.journalEntryId).toBeTruthy();
      expect(posted.cashTransactionId).toBeTruthy();
      await page.goto("/inventory");
      await page.getByTestId("tab-inventory-purchases").click();
      await page.getByTestId(`tab-inventory-material-${type}`).click();
      await page.getByTestId("input-inventory-purchase-month").fill("2098-07");
      await expect(page.getByTestId(`pending-purchase-${bank.id}`)).toContainText("83.45");
      await page.getByTestId("filter-purchase-registration").selectOption("registered");
      await expect(page.getByTestId(`pending-purchase-${bank.id}`)).toHaveCount(0);
      await page.getByTestId("filter-purchase-registration").selectOption("unregistered");
      await page.getByTestId(`register-pending-purchase-${bank.id}`).click();
      await expect(page.getByTestId("pending-purchase-facts")).toContainText(prefix);
      await page.getByTestId("input-inventory-supplier-name").fill(prefix);
      await page.getByTestId("select-inventory-purchase-custodian-search").fill(prefix);
      await page.getByTestId("select-inventory-purchase-custodian").selectOption(String(employeeId));
      await page.getByTestId("input-inventory-name-0").fill(prefix);
      await page.getByTestId("input-inventory-category-0").fill("Туршилт");
      await page.getByTestId("input-inventory-price-0").fill("83.44");
      await expect(page.getByTestId("button-save-inventory-purchase")).toBeDisabled();
      await page.getByTestId("input-inventory-price-0").fill("83.45");
      const path = `**/api/inventory/pending-purchases/${bank.id}/register`;
      await page.route(path, route => route.fulfill({ status: 503, json: { error: "Fixture completion failure" } }));
      await page.getByTestId("button-save-inventory-purchase").click();
      await expect(page.getByTestId("pending-purchase-error")).toContainText("Fixture completion failure");
      await expect(page.getByTestId("input-inventory-supplier-name")).toHaveValue(prefix);
      await page.unroute(path);
      await page.getByTestId("button-save-inventory-purchase").click();
      await expect(page.getByTestId("pending-purchase-facts")).toHaveCount(0);
      await expect(page.getByTestId(`pending-purchase-${bank.id}`)).toHaveCount(0);
      await page.getByTestId("filter-purchase-registration").selectOption("registered");
      await expect(page.getByText(prefix, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await page.reload();
      await page.getByTestId("tab-inventory-purchases").click();
      await page.getByTestId(`tab-inventory-material-${type}`).click();
      await page.getByTestId("input-inventory-purchase-month").fill("2098-07");
      await expect(page.getByTestId(`pending-purchase-${bank.id}`)).toHaveCount(0);
      const cash = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      expect(cash).toHaveLength(1);
      expect(cash[0].id).toBe(posted.cashTransactionId);
      expect(cash[0].journalEntryId).toBe(posted.journalEntryId);
      const [stock] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, prefix));
      expect(Number(stock.quantity)).toBe(1);
    } finally {
      const cash = bankId ? await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bankId)) : [];
      const journalIds = cash.flatMap(row => row.journalEntryId ? [row.journalEntryId] : []);
      if (bankId) await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
      if (cash.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cash.map(row => row.id)));
      await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.documentName, prefix));
      if (journalIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.name, prefix));
      await db.delete(inventorySuppliersTable).where(like(inventorySuppliersTable.name, `${prefix}%`));
      if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
      if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    }
  });
}
