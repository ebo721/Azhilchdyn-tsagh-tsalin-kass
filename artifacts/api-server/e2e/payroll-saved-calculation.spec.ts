import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { missing?: boolean; role?: string; secondPaid?: number; saveError?: string } = {}) {
  let pulls = 0;
  let firstPaid = 50;
  let secondPaid = options.secondPaid ?? 0;
  const adjustments: Array<{ paidAmount: number; secondPaidAmount: number }> = [];
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
      paidAmount: firstPaid + secondPaid, paymentDate: "2026-10-05", secondPaidAmount: secondPaid, secondPaymentDate: secondPaid ? "2026-10-06" : null,
      remainingAmount: (pulls ? 200 : 100) - firstPaid - secondPaid, overpaidAmount: 0, balanceAmount: (pulls ? 200 : 100) - firstPaid - secondPaid }],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { authenticated: loggedIn, role: options.role ?? "admin", username: "fixture" } });
    if (path.endsWith("/auth/logout")) { loggedIn = false; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith("/auth/login")) { loggedIn = true; return route.fulfill({ json: { authenticated: true, role: "admin", username: "fixture" } }); }
    if (path.endsWith("/payroll-adjustments")) {
      const body = route.request().postDataJSON() as { paidAmount: number; secondPaidAmount: number };
      adjustments.push(body);
      if (options.saveError) return route.fulfill({ status: 409, json: { error: options.saveError } });
      firstPaid = body.paidAmount;
      secondPaid = body.secondPaidAmount;
      return route.fulfill({ json: body });
    }
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
  return { pulls: () => pulls, adjustments };
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

test("partial second payment allows cents and survives immediate reopening and reload without adding it to the first payment", async ({ page }) => {
  const state = await fixture(page, { secondPaid: 10 });
  await page.goto("/payroll");
  const edit = page.getByTestId("button-payroll-adjustment-1");
  await edit.click();
  await expect(page.getByTestId("input-payroll-paid-amount")).toHaveValue("50");
  await page.getByTestId("input-payroll-second-paid-amount").fill("20.25");
  await page.getByTestId("button-save-payroll-adjustment").click();
  await expect(page.getByTestId("form-payroll-adjustment")).toHaveCount(0);
  await expect(page.getByTestId("value-payroll-remaining-1")).toContainText("30");
  expect(state.adjustments[0]).toMatchObject({ paidAmount: 50, secondPaidAmount: 20.25 });
  await edit.click();
  await expect(page.getByTestId("input-payroll-paid-amount")).toHaveValue("50");
  await expect(page.getByTestId("input-payroll-second-paid-amount")).toHaveValue("20.25");
  await page.getByTestId("button-save-payroll-adjustment").click();
  await expect(page.getByTestId("form-payroll-adjustment")).toHaveCount(0);
  await page.reload();
  await edit.click();
  await expect(page.getByTestId("input-payroll-paid-amount")).toHaveValue("50");
  await expect(page.getByTestId("input-payroll-second-paid-amount")).toHaveValue("20.25");
  expect(state.adjustments).toHaveLength(2);
  expect(state.adjustments[1]).toMatchObject({ paidAmount: 50, secondPaidAmount: 20.25 });
  expect(state.pulls()).toBe(0);
});

test("payment save errors are shown inside the open dialog and preserve entered amounts", async ({ page }) => {
  const state = await fixture(page, { saveError: "Банкны хуулгаар баталгаажсан цалингийн гүйлгээний дүн, огноог өөрчлөх боломжгүй" });
  await page.goto("/payroll");
  await page.getByTestId("button-payroll-adjustment-1").click();
  await page.getByTestId("input-payroll-second-paid-amount").fill("20");
  await page.getByTestId("button-save-payroll-adjustment").click();
  await expect(page.getByTestId("error-payroll-adjustment")).toContainText("Банкны хуулгаар баталгаажсан");
  await expect(page.getByTestId("input-payroll-second-paid-amount")).toHaveValue("20");
  expect(state.adjustments).toHaveLength(1);
});
