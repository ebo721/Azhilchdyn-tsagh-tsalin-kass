import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, mealsTable, mealScheduleSlotsTable, mealScheduleEntriesTable, deletionRequestsTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test("click meal to edit type; save several meals in one schedule and retain them after reload", async ({ page, context, baseURL }) => {
  test.setTimeout(75_000);
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
    await expect(page.getByTestId("button-kind-meal")).toHaveCount(0);
    await expect(page.getByTestId("button-kind-break")).toHaveCount(0);
    await page.getByTestId(`checkbox-schedule-meal-${mealIds[0]}`).check();
    await page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`).check();
    await expect(page.getByTestId("text-schedule-selected-meals")).toContainText("Сонгосон 2 хоол");
    await page.getByTestId("button-save-entry").click();
    await expect(cell).toContainText(names[0]);
    await expect(cell).toContainText(names[1]);
    await page.reload();
    await page.getByTestId(cellId!).click();
    await expect(page.getByTestId("button-kind-meal")).toHaveCount(0);
    await expect(page.getByTestId("button-kind-break")).toHaveCount(0);
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
    await page.getByTestId("input-meal-name").fill(`${names[1]} зассан`);
    await page.getByTestId("input-meal-category").selectOption("хачир");
    await page.getByTestId("button-save-meal").click();
    await expect(page.getByTestId(`row-meal-${mealIds[1]}`)).toContainText("Боолтын хоол");
    await expect(page.getByTestId(`row-meal-${mealIds[1]}`)).toContainText("хачир");
    await page.reload();
    await page.getByTestId(`row-meal-${mealIds[1]}`).click();
    await page.getByTestId("button-edit-selected-meal").click();
    await expect(page.getByTestId("select-meal-type")).toHaveValue("packed");
    await expect(page.getByTestId("input-meal-name")).toHaveValue(`${names[1]} зассан`);
    await page.getByTestId("button-cancel-meal").click();
    await page.goto("/meal-schedule");
    await page.getByTestId(cellId!).click();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`)).toBeChecked();
    await expect(page.getByTestId("text-retained-schedule-meals")).toBeVisible();
    await page.screenshot({ path: "../../.agents/outputs/scheduled-meal-edit-mobile.png" });
    await page.getByTestId("button-save-entry").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    await page.getByTestId(cellId!).click();
    await expect(page.getByTestId(`checkbox-schedule-meal-${mealIds[1]}`)).toBeChecked();
    await page.getByTestId("button-cancel-entry").click();
    await page.goto("/meal-schedule");
    const oldBreakCell = page.locator(`[data-testid^="cell-"][data-testid$="-${slotId}"]`).nth(1);
    const oldBreakCellId = await oldBreakCell.getAttribute("data-testid");
    const oldBreakDate = oldBreakCellId!.slice(5, -(String(slotId).length + 1));
    await db.insert(mealScheduleEntriesTable).values({ date: oldBreakDate, slotId: slotId!, kind: "break", mealType: null });
    await page.reload();
    await page.getByTestId(oldBreakCellId!).click();
    await expect(page.getByTestId("modal")).toContainText("Өмнө бүртгэсэн завсарлагын хуваарь.");
    await expect(page.getByTestId("button-kind-break")).toHaveCount(0);
    await page.getByTestId("button-save-entry").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);
    const entries = await db.select().from(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.slotId, slotId!));
    expect(entries.find(entry => entry.date === oldBreakDate)?.kind).toBe("break");
  } finally {
    if (slotId) {
      await db.delete(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.slotId, slotId));
      await db.delete(mealScheduleSlotsTable).where(eq(mealScheduleSlotsTable.id, slotId));
    }
    if (mealIds.length) await db.delete(mealsTable).where(inArray(mealsTable.id, mealIds));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

for (const role of ["admin", "technologist"] as const) {
  test(`${role}: selected meal delete button confirms, cancels, and preserves deletion permissions`, async ({ page, context, baseURL }) => {
    const suffix = randomUUID();
    let userId: number | undefined;
    let mealId: number | undefined;
    try {
      const username = `meal-delete-${suffix}`;
      const [user] = await db.insert(usersTable).values({ username, normalizedUsername: username, role, passwordHash: "unused" }).returning();
      userId = user.id;
      await context.addCookies([{ name: hrCookie.name, value: createStaffSession({ ...user, role }), url: baseURL! }]);
      const [meal] = await db.insert(mealsTable).values({ name: `Устгах UI ${suffix}`, normalizedName: `устгах ui ${suffix}`, category: "1-р хоол", type: "set" }).returning();
      mealId = meal.id;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/meals");
      await page.getByTestId("input-search-meals").fill(suffix);
      await page.getByTestId(`row-meal-${meal.id}`).click();
      const button = page.getByTestId("button-delete-selected-meal");
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `../../.agents/outputs/meal-delete-${role}-mobile.png` });
      page.once("dialog", async dialog => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toContain(meal.name);
        await dialog.dismiss();
      });
      await button.click();
      await expect(page.getByTestId(`row-meal-${meal.id}`)).toBeVisible();
      page.on("dialog", async dialog => {
        await dialog.accept();
      });
      const responsePromise = page.waitForResponse(response => role === "admin"
        ? response.request().method() === "DELETE" && response.url().endsWith(`/api/meals/${meal.id}`)
        : response.request().method() === "POST" && response.url().endsWith("/api/deletion-requests"));
      await button.click();
      expect((await responsePromise).ok()).toBe(true);
      if (role === "admin") {
        await expect(page.getByTestId(`row-meal-${meal.id}`)).toHaveCount(0);
        await expect(button).toHaveCount(0);
      } else {
        const [queued] = await db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.targetPath, `/meals/${meal.id}`));
        expect(queued.status).toBe("pending");
        expect(queued.requesterRole).toBe(role);
      }
      await page.reload();
      if (role === "admin") await expect(page.getByTestId(`row-meal-${meal.id}`)).toHaveCount(0);
      else await expect(page.getByTestId(`row-meal-${meal.id}`)).toBeVisible();
    } finally {
      if (mealId) {
        await db.delete(deletionRequestsTable).where(eq(deletionRequestsTable.targetPath, `/meals/${mealId}`));
        await db.delete(mealsTable).where(eq(mealsTable.id, mealId));
      }
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });
}
