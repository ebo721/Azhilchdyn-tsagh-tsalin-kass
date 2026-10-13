import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  db, usersTable, employeesTable, inventoryCustodianEmployeesTable, inventoryItemsTable,
  inventoryOpeningBalancesTable, inventoryClosingBalancesTable, inventoryIssuesTable,
  inventoryOpeningConsumptionsTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test("count entry, phone fast reopen, surplus warning and shortage confirmation", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  const suffix = randomUUID();
  const userIds: number[] = [];
  let employeeId: number | undefined;
  let itemId: number | undefined;
  const employeeName = `Тооллогын нярав ${suffix}`;
  try {
    for (const role of ["admin", "warehouse"]) {
      const username = `closing-ui-${role}-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "not-used" }).returning();
      userIds.push(user.id);
    }
    const [employee] = await db.insert(employeesTable).values({ name: employeeName, role: "Тест", baseSalary: 0 }).returning();
    employeeId = employee.id;
    await db.insert(inventoryCustodianEmployeesTable).values({ userId: userIds[1], employeeId });
    const [item] = await db.insert(inventoryItemsTable).values({
      name: `Closing UI ${suffix}`, normalizedName: `closing ui ${suffix}`, category: "Тест",
      unit: "ширхэг", materialType: "supply", quantity: 10,
    }).returning();
    itemId = item.id;
    await db.insert(inventoryOpeningBalancesTable).values({
      inventoryItemId: itemId, date: "2099-01-01", quantity: 10, remainingQuantity: 10, unitPrice: 15000,
    });
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, userIds[0]));
    await context.addCookies([{ name: hrCookie.name, value: createStaffSession({ ...admin, role: "admin" }), url: baseURL! }]);
    await page.goto("/inventory");
    await page.getByTestId("tab-inventory-stock").click();
    await page.getByTestId("tab-inventory-material-supply").click();
    await page.getByTestId("button-inventory-closing").click();
    await page.getByTestId("input-closing-date").fill("2099-01-02");
    await page.getByTestId("select-closing-item").selectOption(String(itemId));
    await page.getByTestId("select-closing-custodian").selectOption(String(employeeId));
    await page.getByTestId("input-closing-quantity").fill("11");
    await expect(page.getByTestId("text-closing-surplus-warning")).toBeVisible();
    await page.getByTestId("input-closing-quantity").fill("8");
    await expect(page.getByTestId("text-closing-book-quantity")).toContainText("10");
    await expect(page.getByTestId("text-closing-unit-price")).toContainText("15,000");
    await expect(page.getByTestId("text-closing-total")).toContainText("120,000");
    await expect(page.getByTestId("button-save-closing")).toBeEnabled();
    await page.screenshot({ path: "test-results/inventory-closing-desktop.png" });
    const saved = page.waitForResponse(res => res.request().method() === "POST" && res.url().endsWith("/inventory/closing-balances"));
    await page.getByTestId("button-save-closing").click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const count = await response.json() as { id: number; issueId: number };
    await expect(page.getByTestId("input-closing-date")).not.toBeVisible();
    await expect(page.getByTestId(`row-inventory-closing-${count.id}`)).toContainText(employeeName);
    await expect(page.getByTestId(`row-inventory-closing-${count.id}`)).toContainText("Баталгаажаагүй");

    await page.setViewportSize({ width: 402, height: 874 });
    const edit = page.getByTestId(`button-edit-closing-${count.id}`);
    await edit.click();
    await expect(page.getByTestId("input-closing-quantity")).toHaveValue("8");
    await expect(page.getByTestId("select-closing-custodian")).toContainText(employeeName);
    await page.getByTestId("input-closing-quantity").fill("6");
    await expect(page.getByTestId("button-save-closing")).toBeEnabled();
    await page.getByTestId("button-save-closing").click();
    await expect(page.getByTestId("input-closing-date")).not.toBeVisible();
    const bounds = await edit.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(874);
    await edit.click();
    await expect(page.getByTestId("input-closing-quantity")).toHaveValue("6");
    await expect(page.getByTestId("text-closing-difference")).toContainText("4");
    await page.screenshot({ path: "test-results/inventory-closing-mobile.png" });
    await page.getByRole("button", { name: "Болих", exact: true }).click();

    await page.getByTestId("tab-inventory-issues").click();
    await expect(page.getByTestId(`text-inventory-issue-status-${count.issueId}`)).toHaveText("Баталгаажаагүй");
    const stockBefore = await page.request.get("/api/inventory/items");
    expect((await stockBefore.json() as Array<{ id: number; quantity: number }>).find(row => row.id === itemId)!.quantity).toBe(10);
    page.once("dialog", dialog => dialog.accept());
    await page.getByTestId(`button-confirm-inventory-issue-${count.issueId}`).click();
    await expect(page.getByTestId(`text-inventory-issue-status-${count.issueId}`)).toHaveText("Баталгаажсан");
    const stockAfter = await page.request.get("/api/inventory/items");
    expect((await stockAfter.json() as Array<{ id: number; quantity: number }>).find(row => row.id === itemId)!.quantity).toBe(6);
    await page.getByTestId("tab-inventory-stock").click();
    await expect(page.getByTestId(`row-inventory-closing-${count.id}`)).toContainText("Баталгаажсан");
    await expect(page.getByTestId(`button-edit-closing-${count.id}`)).toHaveCount(0);
  } finally {
    if (itemId) {
      await db.delete(inventoryClosingBalancesTable).where(eq(inventoryClosingBalancesTable.inventoryItemId, itemId));
      const rows = await db.select({ id: inventoryIssuesTable.id }).from(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      if (rows.length) await db.delete(inventoryOpeningConsumptionsTable).where(inArray(inventoryOpeningConsumptionsTable.issueId, rows.map(row => row.id)));
      await db.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.inventoryItemId, itemId));
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, itemId));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    }
    if (employeeId) {
      await db.delete(inventoryCustodianEmployeesTable).where(eq(inventoryCustodianEmployeesTable.employeeId, employeeId));
      await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});
