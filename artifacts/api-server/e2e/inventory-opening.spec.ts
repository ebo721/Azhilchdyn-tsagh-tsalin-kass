import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryOpeningBalancesTable, usersTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test("opening stock form saves and issue options omit zero stock", async ({ page, context, baseURL }) => {
  const suffix = randomUUID();
  const name = `UI opening ${suffix}`;
  const [user] = await db.insert(usersTable).values({
    username: `ui-stock-${suffix}`, normalizedUsername: `ui-stock-${suffix}`, role: "admin", passwordHash: "not-used",
  }).returning();
  let itemId: number | undefined;
  try {
    await context.addCookies([{ name: hrCookie.name, value: createStaffSession({ ...user, role: "admin" }), url: baseURL! }]);
    await page.goto("/inventory");
    await expect(page.getByTestId("section-inventory-opening")).toBeVisible();
    await page.getByTestId("button-add-inventory-opening").click();
    await page.getByRole("button", { name: "Шинэ бараа", exact: true }).click();
    await page.getByTestId("input-inventory-opening-name").fill(name);
    await page.getByTestId("input-inventory-opening-category").fill("Тест");
    await page.getByTestId("input-inventory-opening-quantity").fill("2");
    await page.getByTestId("input-inventory-opening-price").fill("1500");
    await page.screenshot({ path: "../../.agents/outputs/inventory-opening-form.png" });
    await page.getByTestId("button-save-inventory-opening").click();
    const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, name));
    itemId = item?.id;
    await expect(page.getByTestId("section-inventory-opening").getByRole("row").filter({ hasText: name })).toBeVisible();
    if (!itemId) {
      const [saved] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, name));
      itemId = saved.id;
    }
    await expect(page.getByTestId(`row-inventory-stock-${itemId}`)).toContainText("3,000");
    await page.reload();
    await expect(page.getByTestId(`row-inventory-stock-${itemId}`)).toBeVisible();
    await page.getByTestId("tab-inventory-issues").click();
    await page.getByTestId("button-add-inventory-issue").click();
    await expect(page.getByTestId("select-inventory-issue-item").locator(`option[value="${itemId}"]`)).toHaveCount(1);
    const options = await page.getByTestId("select-inventory-issue-item").locator("option:not([value=''])").allTextContents();
    expect(options.every((label) => !/үлдэгдэл\s+0(?:\s|$)/i.test(label))).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("select-inventory-issue-item")).toBeVisible();
  } finally {
    if (itemId) {
      await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, itemId));
      await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    } else {
      const [saved] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, name));
      if (saved) {
        await db.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.inventoryItemId, saved.id));
        await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, saved.id));
      }
    }
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
});
