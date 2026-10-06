import { expect, test } from "@playwright/test";

// UI regression fixtures only: no employee or attendance data is written.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({
    json: { authenticated: true, id: 1, role: "admin", username: "fixture" },
  }));
  await page.route("**/api/employees", route => route.fulfill({ json: [
    { id: 901, name: "Former office", role: "Test", employeeType: "office",
      status: "inactive", joinedAt: "2025-01-01", inactiveAt: "2026-09-05" },
    { id: 902, name: "Former shift", role: "Test", employeeType: "shift",
      status: "inactive", joinedAt: "2025-01-01", inactiveAt: "2026-09-30" },
    { id: 903, name: "Current employee", role: "Test", employeeType: "office",
      status: "active", joinedAt: "2025-01-01", inactiveAt: null },
    { id: 904, name: "Old unrelated employee", role: "Test", employeeType: "office",
      status: "inactive", joinedAt: "2024-01-01", inactiveAt: "2024-12-31" },
  ] }));
  await page.route("**/api/attendance/shifts", route => route.fulfill({ json: [
    { id: 1, name: "Day shift", startTime: "08:00", endTime: "16:00", hours: 8 },
  ] }));
  await page.route("**/api/attendance/shift-plans?*", route => {
    const month = new URL(route.request().url()).searchParams.get("month");
    return route.fulfill({ json: month === "2026-09"
      ? [{ id: 1, employeeId: 902, date: "2026-09-30", shiftId: 1 }] : [] });
  });
  await page.route("**/api/attendance?*", route => {
    const month = new URL(route.request().url()).searchParams.get("month");
    return route.fulfill({ json: month === "2026-09" ? [
      { id: 1, employeeId: 901, date: "2026-09-05", status: "present", hours: 8 },
      // Keep actual history visible even when the employment dates were corrected.
      { id: 2, employeeId: 904, date: "2026-09-03", status: "leave", hours: 0 },
    ] : [] });
  });
  await page.goto("/attendance");
});

test("shows inactive employees' history and preserves the shift filter after reload", async ({ page }) => {
  await page.getByTestId("input-attendance-month").fill("2026-09");
  await expect(page.getByTestId("select-attendance-901-2026-09-05")).toHaveValue("worked");
  await expect(page.getByTestId("select-attendance-904-2026-09-03")).toHaveValue("leave");
  await expect(page.getByTestId("row-attendance-calendar-902")).toBeVisible();
  await expect(page.getByTestId("row-attendance-calendar-903")).toBeVisible();
  for (const id of [901, 902, 904]) {
    const row = page.getByTestId(`row-attendance-calendar-${id}`);
    await expect(row.getByText("Идэвхгүй", { exact: true })).toBeVisible();
    await expect(row).toHaveClass(/bg-muted\/50/);
  }
  const activeRow = page.getByTestId("row-attendance-calendar-903");
  await expect(activeRow.getByText("Идэвхгүй", { exact: true })).toHaveCount(0);
  await expect(activeRow).not.toHaveClass(/bg-muted\/50/);
  await page.getByTestId("select-attendance-shift-filter").selectOption("1");
  await expect(page.getByTestId("row-attendance-calendar-902")).toBeVisible();
  await expect(page.getByTestId("row-attendance-calendar-901")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("input-attendance-month").fill("2026-09");
  await expect(page.getByTestId("select-attendance-901-2026-09-05")).toHaveValue("worked");
  await expect(page.getByTestId("row-attendance-calendar-901").getByText("Идэвхгүй", { exact: true })).toBeVisible();
});

test("shows the employment end month without records, but hides former employees in later months", async ({ page }) => {
  await page.getByTestId("input-attendance-month").fill("2026-08");
  await expect(page.getByTestId("row-attendance-calendar-901")).toBeVisible();
  await expect(page.getByTestId("row-attendance-calendar-902")).toBeVisible();
  await expect(page.getByTestId("row-attendance-calendar-904")).toHaveCount(0);
  await page.getByTestId("input-attendance-month").fill("2026-10");
  await expect(page.getByTestId("row-attendance-calendar-901")).toHaveCount(0);
  await expect(page.getByTestId("row-attendance-calendar-902")).toHaveCount(0);
  await expect(page.getByTestId("row-attendance-calendar-903")).toBeVisible();
});
