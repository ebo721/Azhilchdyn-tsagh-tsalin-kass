import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, mealsTable, mealScheduleSlotsTable, mealScheduleEntriesTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test("click meal to edit type; save several meals in one schedule and retain them after reload", async ({ page, context, baseURL }) => {
  const suffix = randomUUID();
  const names = [`Цэс UI ${suffix} нэг`, `Цэс UI ${suffix} хоёр`];
  const mealIds: number[] = [];
  let userId: number | undefined;
  let slotId: number | undefined;
  try {
    const username = `meal-ui-${suffix}`;
    const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role: "admin", passwordHash: "unused" }).returning();
    userId = user.id;
    await context.addCookies([{ name: hrCookie.name, value: createStaffSession({ ...user, role: "admin" }), url: baseURL! }]);
    for (const [index, name] of names.entries()) {
      const [meal] = await db.insert(mealsTable).values({ name, normalizedName: name.toLowerCase(), category: "1-р хоол", type: index === 0 ? "packed" : "set" }).returning();
      mealIds.push(meal.id);
    }
    const [slot] = await db.insert(mealScheduleSlotsTable).values({
      name: `Хуваарь UI ${suffix}`, startTime: "10:00", endTime: "10:30", sortOrder: 1000000000 + Math.floor(Math.random() * 1000000000),
    }).returning();
    slotId = slot.id;
    await page.goto("/meals");
    await page.getByTestId("input-search-meals").fill(suffix);
    await page.getByTestId(`row-meal-${mealIds[0]}`).click();
    await page.getByTestId("button-edit-selected-meal").click();
    await expect(page.getByTestId("select-meal-type")).toHaveValue("packed");
    await page.getByTestId("select-meal-type").selectOption("set");
    await page.getByTestId("button-save-meal").click();
    await expect(page.getByTestId(`row-meal-${mealIds[0]}`)).toContainText("Сет хоол");
    await page.reload();
    await page.getByTestId(`row-meal-${mealIds[0]}`).click();
    await page.getByTestId("button-edit-selected-meal").click();
    await expect(page.getByTestId("select-meal-type")).toHaveValue("set");
    await page.getByTestId("button-cancel-meal").click();

    await page.goto("/meal-schedule");
    const cell = page.locator(`[data-testid^="cell-"][data-testid$="-${slotId}"]`).first();
    const cellId = await cell.getAttribute("data-testid");
    await cell.click();
    await page.getByTestId(`checkbox-schedule-meal-${mealIds[0]}`).check();
    await page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`).check();
    await expect(page.getByTestId("text-schedule-selected-meals")).toContainText("Сонгосон 2 хоол");
    await page.getByTestId("button-save-entry").click();
    await expect(cell).toContainText(names[0]);
    await expect(cell).toContainText(names[1]);
    await page.reload();
    await page.getByTestId(cellId!).click();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[0]}`)).toBeChecked();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`)).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("text-schedule-selected-meals")).toContainText("Сонгосон 2 хоол");
    const saveBounds = await page.getByTestId("button-save-entry").boundingBox();
    expect(saveBounds).not.toBeNull();
    expect(saveBounds!.x + saveBounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "../../.agents/outputs/meal-multiple-mobile.png" });
    await page.getByTestId(`checkbox-schedule-meal-${mealIds[0]}`).uncheck();
    await expect(page.getByTestId("text-schedule-selected-meals")).toContainText("Сонгосон 1 хоол");
    await page.getByTestId("button-save-entry").click();
    await page.getByTestId(cellId!).click();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[0]}`)).not.toBeChecked();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`)).toBeChecked();
    await page.getByTestId("button-cancel-entry").click();

    await page.goto("/meals");
    await page.getByTestId("input-search-meals").fill(suffix);
    await page.getByTestId(`row-meal-${mealIds[1]}`).click();
    await page.getByTestId("button-edit-selected-meal").click();
    await page.getByTestId("select-meal-type").selectOption("packed");
    await page.getByTestId("button-save-meal").click();
    await expect(page.getByTestId("status-meal-save-error")).toContainText("хуваариас нь хасна уу");
  } finally {
    if (slotId) {
      await db.delete(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.slotId, slotId));
      await db.delete(mealScheduleSlotsTable).where(eq(mealScheduleSlotsTable.id, slotId));
    }
    if (mealIds.length) await db.delete(mealsTable).where(inArray(mealsTable.id, mealIds));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});
