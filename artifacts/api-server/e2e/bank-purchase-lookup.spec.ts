import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable, chartOfAccountsTable, bankTransactionsTable, inventoryPurchasesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "../src/lib/hr-session.js";

const prefix = `bank-purchase-ui-${randomUUID()}`;
const password = "Fixture-password-123";
let userId: number, bankId: number, eligibleIds: number[];
let purchaseIds: number[] = [];

test.beforeAll(async () => {
  const [user] = await db.insert(usersTable).values({
    username: prefix, normalizedUsername: prefix, passwordHash: await hashPassword(password),
    role: "accountant", menuPaths: ["/bank-transactions"],
  }).returning();
  userId = user.id;
  const [transport] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6200"));
  const [inventory] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
  const [bank] = await db.insert(bankTransactionsTable).values({
    transactionAt: new Date("2099-10-08T10:00:00Z"), type: "expense", amount: 300,
    accountId: transport.id, account: prefix, counterparty: prefix,
    description: `${prefix} бараа материал`, fingerprint: prefix,
  }).returning();
  bankId = bank.id;
  const purchases = await db.insert(inventoryPurchasesTable).values([
    { documentName: `${prefix} first`, materialType: "food", accountId: inventory.id, date: "2099-10-01", totalAmount: 100 },
    { documentName: `${prefix} second`, materialType: "food", accountId: inventory.id, date: "2099-10-08", totalAmount: 200 },
    { documentName: `${prefix} future`, materialType: "food", accountId: inventory.id, date: "2099-10-09", totalAmount: 100 },
    { documentName: `${prefix} paid`, materialType: "food", accountId: inventory.id, date: "2099-10-01", totalAmount: 100, paymentDate: "2099-10-01", paymentAmount: 100 },
  ]).returning();
  purchaseIds = purchases.map(p => p.id);
  eligibleIds = purchaseIds.slice(0, 2);
});

test.afterAll(async () => {
  if (purchaseIds.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchaseIds));
  if (bankId) await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
  if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("bank-only accountant can select purchases despite an old transport classification", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: prefix, password } })).status()).toBe(200);
  for (const path of ["/inventory/purchases", "/operating-expenses", "/fixed-assets"]) {
    expect((await page.request.get(`/api${path}`)).status()).toBe(200);
    expect((await page.request.post(`/api${path}`, { data: {} })).status()).toBe(403);
  }
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`button-select-bank-purchases-${bankId}`).click();
  const panel = page.getByTestId(`bank-document-link-panel-${bankId}`);
  for (const id of eligibleIds) {
    await expect(panel.getByTestId(`checkbox-link-purchase-${bankId}-${id}`)).toBeVisible();
    await panel.getByTestId(`checkbox-link-purchase-${bankId}-${id}`).check();
  }
  await expect(panel).toContainText(`${prefix} first`);
  for (const id of purchaseIds.slice(2)) {
    await expect(panel.getByTestId(`checkbox-link-purchase-${bankId}-${id}`)).toHaveCount(0);
  }
  await expect(panel.getByTestId(`button-link-selected-purchases-${bankId}`)).toBeEnabled();
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
  expect(bank.journalEntryId).toBeNull();
  expect(bank.cashTransactionId).toBeNull();
});

test("phone shows lookup failure rather than false empty purchases and retry restores the list", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  expect((await page.request.post("/api/auth/login", { data: { username: prefix, password } })).status()).toBe(200);
  await page.route("**/api/inventory/purchases", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture lookup failure" }),
  }));
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`button-select-bank-purchases-${bankId}`).click();
  const panel = page.getByTestId(`bank-document-link-panel-${bankId}`);
  await expect(panel.getByRole("alert")).toContainText("баримт байхгүй гэсэн үг биш");
  await page.unroute("**/api/inventory/purchases");
  await panel.getByRole("button", { name: "Дахин оролдох", exact: true }).click();
  await expect(panel.getByTestId(`checkbox-link-purchase-${bankId}-${eligibleIds[0]}`)).toBeVisible();
});
