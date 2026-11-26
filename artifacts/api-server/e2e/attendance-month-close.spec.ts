import { expect, test, type Page } from "@playwright/test";

async function attendanceFixture(page: Page, fail = false) {
  let closed = true;
  const writes: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(url.pathname);
      return route.fulfill({ status: 409, json: { error: "Сар хаалттай" } });
    }
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
      authenticated: true, id: 1, role: "hr", username: "fixture", menuPaths: ["/attendance"],
    } });
    if (url.pathname === "/api/employees") return route.fulfill({ json: [{
      id: 1, name: "Fixture shift", role: "Test", employeeType: "shift",
      status: "active", joinedAt: "2024-01-01", inactiveAt: null,
    }] });
    if (url.pathname === "/api/attendance/closures") {
      if (fail) return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } });
      const month = url.searchParams.get("month");
      return route.fulfill({ json: closed && (month === "2026-08" || month === "2026-09") ? [{
        month: "2026-09", periodStart: "2026-08-21", periodEnd: "2026-09-20",
        closedAt: "2026-09-30T00:00:00Z",
      }] : [] });
    }
    if (url.pathname === "/api/attendance/shifts") return route.fulfill({ json: [{
      id: 1, name: "Day", startTime: "09:00", endTime: "17:00",
    }] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/attendance");
  await page.getByTestId("input-attendance-month").fill("2026-09");
  return { writes, reopen: () => { closed = false; } };
}

for (const width of [1440, 402]) {
  test(`payroll closure locks exactly its effective attendance dates: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 874 });
    const state = await attendanceFixture(page);
    await expect(page.getByTestId("attendance-closed-periods")).toContainText("2026-08-21");
    for (const day of ["01", "20"]) {
      await expect(page.getByTestId(`select-attendance-1-2026-09-${day}`)).toBeDisabled();
      await expect(page.getByTestId(`select-shift-plan-1-2026-09-${day}`)).toBeDisabled();
    }
    await expect(page.getByTestId("select-attendance-1-2026-09-21")).toBeEnabled();
    await expect(page.getByTestId("select-shift-plan-1-2026-09-21")).toBeEnabled();
    await expect(page.getByTestId("button-copy-previous-shift-plans")).toBeDisabled();
    await page.getByTestId("button-attendance-previous-month").click();
    await expect(page.getByTestId("select-attendance-1-2026-08-20")).toBeEnabled();
    await expect(page.getByTestId("select-attendance-1-2026-08-21")).toBeDisabled();
    await page.reload();
    await page.getByTestId("input-attendance-month").fill("2026-09");
    await expect(page.getByTestId("select-attendance-1-2026-09-01")).toBeDisabled();
    state.reopen();
    await page.reload();
    await page.getByTestId("input-attendance-month").fill("2026-09");
    await expect(page.getByTestId("attendance-closed-periods")).toHaveCount(0);
    await expect(page.getByTestId("select-attendance-1-2026-09-01")).toBeEnabled();
    await expect(page.getByTestId("select-shift-plan-1-2026-09-01")).toBeEnabled();
    await expect(page.getByTestId("button-copy-previous-shift-plans")).toBeEnabled();
    expect(state.writes).toEqual([]);
  });
}

test("closure lookup errors lock editing instead of assuming the month is open", async ({ page }) => {
  const state = await attendanceFixture(page, true);
  await expect(page.getByTestId("attendance-closure-error")).toBeVisible();
  await expect(page.getByTestId("select-attendance-1-2026-09-01")).toBeDisabled();
  await expect(page.getByTestId("select-shift-plan-1-2026-09-01")).toBeDisabled();
  await expect(page.getByTestId("button-copy-previous-shift-plans")).toBeDisabled();
  expect(state.writes).toEqual([]);
});
