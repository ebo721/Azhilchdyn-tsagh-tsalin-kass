import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { missing?: boolean; role?: string } = {}) {
  let pulls = 0;
  let saved = !options.missing;
  let loggedIn = true;
  const summary = (month: string) => ({
    month, periodStart: `${month}-01`, advancePeriodEnd: `${month}-15`, periodEnd: `${month}-28`,
    advancePaymentDate: `${month}-20`, finalPaymentDate: `${month}-28`,
    attendancePulledAt: "2026-10-07T02:00:00.000Z", attendanceNeedsRefresh: false,
    schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 20, finalPayDay: 31 },
    totalGross: pulls ? 200 : 100, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: pulls ? 200 : 100,
    lines: [{ employeeId: 1, employeeName: "Хадгалсан тооцоо", employeeType: "shift", role: "Test", bankAccountNumber: "1234567890123456",
      daysWorked: pulls ? 2 : 1, hours: pulls ? 16 : 8, gross: pulls ? 200 : 100, socialInsuranceSalary: 0, socialInsurance: 0,
      taxableIncome: 0, calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0, receivableId: null,
      deductions: 0, carryoverAmount: 0, payable: pulls ? 200 : 100, net: pulls ? 200 : 100,
      paidAmount: 50, paymentDate: "2026-10-05", secondPaidAmount: 0, secondPaymentDate: null,
      remainingAmount: pulls ? 150 : 50, overpaidAmount: 0, balanceAmount: pulls ? 150 : 50 }],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { authenticated: loggedIn, role: options.role ?? "admin", username: "fixture" } });
    if (path.endsWith("/auth/logout")) { loggedIn = false; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith("/auth/login")) { loggedIn = true; return route.fulfill({ json: { authenticated: true, role: "admin", username: "fixture" } }); }
    if (path.endsWith("/payroll/pull-attendance")) {
      pulls++;
      saved = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const { month } = route.request().postDataJSON() as { month: string };
      const payroll = summary(month);
      return route.fulfill({ json: { payroll, advance: { ...payroll, approved: false, approvalDate: null, totalAmount: 0, lines: [] } } });
    }
    if (path.endsWith("/payroll")) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return saved ? route.fulfill({ json: summary(url.searchParams.get("month")!) })
        : route.fulfill({ status: 409, json: { error: "Хадгалсан цалингийн тооцоо алга. «Цаг татах» товчийг дарна уу." } });
    }
    if (path.endsWith("/payroll-advance")) return route.fulfill({ json: { lines: [], approved: false } });
    return route.fulfill({ json: [] });
  });
  return { pulls: () => pulls };
}

test("opening, refreshing and a fresh login use saved calculations; only the button posts a pull", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/payroll");
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toHaveText("Цаг татах");
  expect(state.pulls()).toBe(0);
  await page.reload();
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  expect(state.pulls()).toBe(0);
  await page.getByTestId("button-logout").click();
  await expect(page.getByTestId("input-login-username")).toBeVisible();
  await page.getByTestId("input-login-username").fill("fixture");
  await page.getByTestId("input-login-password").fill("fixture-only");
  await page.getByTestId("button-login").click();
  await page.goto("/payroll");
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  expect(state.pulls()).toBe(0);
  await page.getByTestId("button-pull-payroll-attendance").click();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toHaveText("Татаж байна...");
  await expect(page.getByTestId("button-pull-payroll-attendance")).toHaveText("Цаг татах");
  expect(state.pulls()).toBe(1);
  await expect(page.getByTestId("value-payroll-remaining-1")).toContainText("150");
  await page.reload();
  await expect(page.getByTestId("value-payroll-remaining-1")).toContainText("150");
  expect(state.pulls()).toBe(1);
});

test("missing snapshot is not confused with historical balance repair and is created only by the button", async ({ page }) => {
  const state = await fixture(page, { missing: true });
  await page.goto("/payroll");
  await expect(page.getByText(/Хадгалсан цалингийн тооцоо алга/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("payroll-balances-required")).toHaveCount(0);
  expect(state.pulls()).toBe(0);
  await page.getByTestId("button-pull-payroll-attendance").click();
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  await expect(page.getByTestId("payroll-attendance-status")).toContainText("Хадгалсан тооцоог харуулж байна");
  expect(state.pulls()).toBe(1);
});

test("read-only role sees saved payroll without a pull button", async ({ page }) => {
  const state = await fixture(page, { role: "viewer" });
  await page.goto("/payroll");
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toHaveCount(0);
  expect(state.pulls()).toBe(0);
});
