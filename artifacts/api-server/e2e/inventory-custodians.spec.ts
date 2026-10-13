import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, employeesTable, inventoryItemsTable, inventoryIssuesTable, inventoryOpeningBalancesTable,
  inventoryOpeningConsumptionsTable, inventoryIssueConsumptionsTable, inventoryPurchasesTable,
  inventoryPurchaseItemsTable, inventorySuppliersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test("search/select multiple employee custodians in settings, choose independently on documents and persist after reload", async ({ page, context, baseURL }) => {
  const suffix = randomUUID();
  const fullName = "Шалгалтын нярав";
  const secondName = "Шалгалтын хоёрдугаар нярав";
  const employeeIds: number[] = [];
  const itemName = `Custodian UI ${suffix}`;
  const supplierName = `Custodian UI supplier ${suffix}`;
  const ids: number[] = [];
  let itemId: number | undefined;
  let purchaseId: number | undefined;
  let issueId: number | undefined;
  try {
    for (const role of ["admin", "warehouse"]) {
      const username = `ui-custodian-${role}-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "not-used" }).returning();
      ids.push(user.id);
    }
    for (const name of [fullName, secondName]) {
      const [employee] = await db.insert(employeesTable).values({ name, role: "Тест", baseSalary: 0 }).returning();
      employeeIds.push(employee.id);
    }
    const signIn = async (id: number) => {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
      await context.clearCookies();
      await context.addCookies([{ name: hrCookie.name, value: createStaffSession({ ...user, role: user.role as "admin" }), url: baseURL! }]);
    };
    await signIn(ids[0]);
    await page.goto("/users");
    await page.getByTestId(`button-edit-user-${ids[1]}`).click();
    await page.getByTestId("input-custodian-employee-search").fill(fullName);
    await page.getByTestId(`checkbox-custodian-employee-${employeeIds[0]}`).check();
    await page.getByTestId("input-custodian-employee-search").fill(secondName);
    await page.getByTestId(`checkbox-custodian-employee-${employeeIds[1]}`).check();
    await expect(page.getByTestId(`button-remove-custodian-${employeeIds[0]}`)).toBeVisible();
    await page.getByTestId("button-save-user").click();
    await expect(page.getByTestId(`text-user-custodians-${ids[1]}`)).toContainText(fullName);
    await expect(page.getByTestId(`text-user-custodians-${ids[1]}`)).toContainText(secondName);
    await page.reload();
    await page.getByTestId(`button-edit-user-${ids[1]}`).click();
    await expect(page.getByTestId(`checkbox-custodian-employee-${employeeIds[0]}`)).toBeChecked();
    await expect(page.getByTestId(`checkbox-custodian-employee-${employeeIds[1]}`)).toBeChecked();
    await page.getByTestId(`button-remove-custodian-${employeeIds[0]}`).click();
    await expect(page.getByTestId(`checkbox-custodian-employee-${employeeIds[0]}`)).not.toBeChecked();
    await page.getByTestId(`checkbox-custodian-employee-${employeeIds[0]}`).check();
    await page.getByTestId("button-save-user").click();
    await expect(page.getByTestId(`text-user-custodians-${ids[1]}`)).toContainText(fullName);
    const opening = await context.request.post(`${baseURL}/api/inventory/opening-balances`, { data: {
      materialType: "food", name: itemName, category: "Тест", unit: "ширхэг", date: new Date().toISOString().slice(0, 10), quantity: 4, unitPrice: 100,
    } });
    expect(opening.status()).toBe(201);
    itemId = (await opening.json()).inventoryItemId;
    await signIn(ids[1]);
    await page.goto("/inventory");
    await page.getByTestId("tab-inventory-purchases").click();
    await page.getByTestId("button-add-inventory-purchase").click();
    await expect(page.getByTestId("select-inventory-purchase-custodian")).toHaveValue("");
    await page.getByTestId("select-inventory-purchase-custodian-search").fill(fullName);
    await page.getByTestId("select-inventory-purchase-custodian").selectOption(String(employeeIds[0]));
    await page.getByTestId("input-inventory-supplier-name").fill(supplierName);
    await page.getByTestId("input-inventory-name-0").fill(itemName);
    await page.getByTestId("input-inventory-category-0").fill("Тест");
    await page.getByTestId("input-inventory-quantity-0").fill("2");
    await page.getByTestId("input-inventory-price-0").fill("150");
    const createdPurchase = page.waitForResponse((response) => response.url().endsWith("/api/inventory/purchases") && response.request().method() === "POST");
    await page.getByTestId("button-save-inventory-purchase").click();
    const purchaseResponse = await createdPurchase;
    expect(purchaseResponse.status()).toBe(201);
    purchaseId = (await purchaseResponse.json()).id;
    await expect(page.getByTestId(`text-purchase-custodian-${purchaseId}`)).toContainText(fullName);
    await page.getByTestId("tab-inventory-issues").click();
    await page.getByTestId("button-add-inventory-issue").click();
    await expect(page.getByTestId("select-inventory-issue-custodian")).toHaveValue("");
    await page.getByTestId("select-inventory-issue-custodian-search").fill(secondName);
    await page.getByTestId("select-inventory-issue-custodian").selectOption(String(employeeIds[1]));
    await page.getByTestId("select-inventory-issue-item").selectOption(String(itemId));
    await page.getByTestId("input-inventory-issue-quantity").fill("1");
    await page.getByTestId("select-inventory-issue-purpose").selectOption("Бусад");
    const createdIssue = page.waitForResponse((response) => response.url().endsWith("/api/inventory/issues") && response.request().method() === "POST");
    await page.getByTestId("button-save-inventory-issue").click();
    const issueResponse = await createdIssue;
    expect(issueResponse.status()).toBe(201);
    issueId = (await issueResponse.json()).id;
    await expect(page.getByTestId(`text-issue-custodian-${issueId}`)).toHaveText(secondName);
    await page.reload();
    await page.getByTestId("tab-inventory-issues").click();
    await expect(page.getByTestId(`text-issue-custodian-${issueId}`)).toHaveText(secondName);
    await page.getByTestId(`button-edit-inventory-issue-${issueId}`).click();
    await expect(page.getByTestId("select-inventory-issue-custodian")).toHaveValue(String(employeeIds[1]));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("select-inventory-issue-custodian")).toBeVisible();
    await page.screenshot({ path: "../../.agents/outputs/inventory-custodian-mobile.png" });
  } finally {
    // Discover by owned keys even if the browser fails before returning IDs.
    if (!itemId) {
      const [row] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, itemName));
      itemId = row?.id;
    }
    const purchases = await db.select({ id: inventoryPurchasesTable.id }).from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.documentName, supplierName));
    if (itemId) {
      const issueIds = db.select({ id: inventoryIssuesTable.id }).from(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      await db.delete(inventoryOpeningConsumptionsTable).where(inArray(inventoryOpeningConsumptionsTable.issueId, issueIds));
      await db.delete(inventoryIssueConsumptionsTable).where(inArray(inventoryIssueConsumptionsTable.issueId, issueIds));
      await db.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      await db.delete(inventoryPurchaseItemsTable).where(eq(inventoryPurchaseItemsTable.inventoryItemId, itemId));
      if (purchases.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchases.map((row) => row.id)));
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, itemId));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    }
    await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.name, supplierName));
    if (ids.length) await db.delete(usersTable).where(inArray(usersTable.id, ids));
    if (employeeIds.length) await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
  }
});
