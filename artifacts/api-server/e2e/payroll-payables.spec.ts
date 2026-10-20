import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { error?: boolean; payrollMenu?: boolean; role?: string } = {}) {
  let amount = 5000, requests = 0;
  const writes: string[] = [], months: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") writes.push(path);
    if (path === "/api/auth/me") return route.fulfill({ json: {
      authenticated: true, id: 1, username: "fixture", role: options.role ?? "accountant",
      menuPaths: options.payrollMenu === false ? ["/ar-ap"] : ["/ar-ap", "/payroll"],
    } });
    if (path === "/api/journal/payables/payroll-balances") {
      requests++;
      if (options.error) return route.fulfill({ status: 409, json: { error: "Өмнөх сарын цалингийн үлдэгдэл бэлтгэгдээгүй байна." } });
      const lines = [
        ...(amount > 1 ? [{ employeeId: 101, employeeName: "Цалин ажилтан", month: "2026-09", date: "2026-09-28", remainingBalance: amount, attendanceNeedsRefresh: true, closed: false }] : []),
        { employeeId: 102, employeeName: "Хаасан сарын ажилтан", month: "2026-08", date: "2026-08-28", remainingBalance: 300, attendanceNeedsRefresh: false, closed: true },
      ];
      return route.fulfill({ json: { asOfMonth: "2026-10", hasSavedCalculation: true, employeeCount: lines.length, totalOutstanding: amount + 300, lines } });
    }
    if (path === "/api/journal/payables") return route.fulfill({ json: [
      { id: 701, partyType: "employee", partyId: 202, partyLabel: "Гараар өглөг", originalAmount: 400, remainingBalance: 400, status: "open", description: "Журналын өглөг", date: "2026-09-01", createdAt: "2026-09-01T00:00:00Z" },
      { id: 702, partyType: "supplier", partyId: 303, partyLabel: "Харилцагч", originalAmount: 600, remainingBalance: 600, status: "open", description: "Харилцагчийн өглөг", date: "2026-09-01", createdAt: "2026-09-01T00:00:00Z" },
    ] });
    if (path === "/api/payroll") { months.push(url.searchParams.get("month") ?? ""); return route.fulfill({ status: 409, json: { error: "Хадгалсан бодолт нээх туршилт" } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto("/ar-ap");
  await expect(page.getByTestId("payroll-payables-section")).toHaveCount(0);
  await page.getByRole("tab", { name: "Өглөг", exact: true }).click();
  return { writes, months, setAmount: (value: number) => { amount = value; }, requests: () => requests };
}

for (const device of ["desktop", "phone-viewer"] as const) {
  test(`salary debts are separate, filterable and refreshed after payment/cancellation: ${device}`, async ({ page }) => {
    await page.setViewportSize(device === "desktop" ? { width: 1440, height: 960 } : { width: 402, height: 874 });
    const state = await fixture(page, { role: device === "desktop" ? "accountant" : "viewer" });
    await expect(page.getByTestId("total-payroll-payables")).toContainText("5,300.00");
    await expect(page.getByTestId("row-payroll-payable-101")).toBeVisible();
    await expect(page.getByTestId("status-payroll-stale-101")).toBeVisible();
    await expect(page.getByTestId("status-payroll-closed-102")).toBeVisible();
    await expect(page.getByTestId("row-ar-ap-701")).toBeVisible();
    await page.locator("#ar-ap-party").selectOption("employee:101");
    await expect(page.getByTestId("total-payroll-payables")).toContainText("5,000.00");
    await expect(page.getByTestId("row-payroll-payable-102")).toHaveCount(0);
    await page.locator("#ar-ap-party").selectOption("supplier:303");
    await expect(page.getByTestId("row-ar-ap-702")).toBeVisible();
    await expect(page.getByTestId("row-payroll-payable-101")).toHaveCount(0);
    await page.locator("#ar-ap-party").selectOption("");
    state.setAmount(4700);
    await page.getByTestId("button-refresh-payroll-payables").click();
    await expect(page.getByTestId("total-payroll-payables")).toContainText("5,000.00");
    state.setAmount(0);
    await page.getByTestId("button-refresh-payroll-payables").click();
    await expect(page.getByTestId("row-payroll-payable-101")).toHaveCount(0);
    state.setAmount(5000);
    await page.getByTestId("button-refresh-payroll-payables").click();
    await expect(page.getByTestId("total-payroll-payables")).toContainText("5,300.00");
    await page.reload();
    await page.getByRole("tab", { name: "Өглөг", exact: true }).click();
    await expect(page.getByTestId("total-payroll-payables")).toContainText("5,300.00");
    await page.screenshot({ path: `../../generated-artifacts/payroll-payables-${device}.png`, fullPage: true });
    expect((await page.locator("body").boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.locator('a[href="/payroll?month=2026-09"]').click();
    await expect(page.locator('input[type="month"]')).toHaveValue("2026-09");
    await expect.poll(() => state.months[0]).toBe("2026-09");
    expect(state.writes).toEqual([]);
  });
}

test("historical balance errors keep manual payables visible and can be retried", async ({ page }) => {
  const state = await fixture(page, { error: true });
  await expect(page.getByTestId("payroll-payables-section")).toContainText("Өмнөх сарын цалингийн үлдэгдэл бэлтгэгдээгүй байна.");
  await expect(page.getByTestId("row-ar-ap-701")).toBeVisible();
  await expect(page.getByTestId("total-payroll-payables")).toHaveCount(0);
  const before = state.requests();
  await page.getByTestId("button-refresh-payroll-payables").click();
  await expect.poll(state.requests).toBeGreaterThan(before);
  expect(state.writes).toEqual([]);
});

test("ar-ap-only accounts see balances without receiving a payroll navigation link", async ({ page }) => {
  const state = await fixture(page, { payrollMenu: false });
  await expect(page.getByTestId("row-payroll-payable-101")).toBeVisible();
  await expect(page.locator('a[href^="/payroll"]')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
