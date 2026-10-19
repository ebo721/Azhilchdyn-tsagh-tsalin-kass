import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, { role = "admin", initiallyClosed = false, failure = false } = {}) {
  const closed = new Set<string>();
  let initialMonth = "";
  const writes: string[] = [];
  const summary = (month: string) => ({
    month, periodStart: `${month}-01`, advancePeriodEnd: `${month}-15`, periodEnd: `${month}-28`,
    advancePaymentDate: `${month}-20`, finalPaymentDate: `${month}-28`,
    attendancePulledAt: "2026-10-07T02:00:00.000Z", attendanceNeedsRefresh: false,
    closedAt: closed.has(month) ? "2026-10-19T04:00:00.000Z" : null, closedBy: closed.has(month) ? 1 : null,
    schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 20, finalPayDay: 31 },
    totalGross: 100, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: 100,
    lines: [{ employeeId: 1, employeeName: "Closed payroll fixture", employeeType: "shift", role: "Fixture",
      daysWorked: 1, hours: 8, gross: 100, socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 0, calculatedIncomeTax: 0,
      taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0, receivableId: null, deductions: 0, carryoverAmount: 0,
      payable: 100, net: 100, paidAmount: 50, paymentDate: `${month}-05`, secondPaidAmount: 0, secondPaymentDate: null,
      remainingAmount: 50, overpaidAmount: 0, balanceAmount: 50 }],
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") writes.push(url.pathname);
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { authenticated: true, id: 1, role, username: "fixture" } });
    if (url.pathname.endsWith("/payroll")) {
      const month = url.searchParams.get("month")!;
      if (!initialMonth) {
        initialMonth = month;
        if (initiallyClosed) closed.add(month);
      }
      return route.fulfill({ json: summary(month) });
    }
    const action = /\/payroll\/(\d{4}-\d{2})\/(close|reopen)$/.exec(url.pathname);
    if (action) {
      if (failure) return route.fulfill({ status: 409, json: { error: "Эх бүртгэл өөрчлөгдсөн байна. «Цаг татах» дарна уу." } });
      if (action[2] === "close") closed.add(action[1]); else closed.delete(action[1]);
      return route.fulfill({ json: summary(action[1]) });
    }
    if (url.pathname.endsWith("/payroll-advance")) return route.fulfill({ json: {
      month: url.searchParams.get("month"), approved: false, totalAmount: 50,
      lines: [{ employeeId: 1, employeeName: "Closed payroll fixture", employeeType: "shift", baseSalary: 100,
        daysWorked: 1, dailySalary: 100, totalSalary: 100, advanceAmount: 50, paid: false, paymentDate: null }],
    } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/payroll");
  await expect(page.getByTestId("row-payroll-1")).toBeVisible();
  return { writes, month: () => initialMonth };
}

test("admin closes, reloads frozen state, and explicitly reopens without pulling attendance", async ({ page }) => {
  const state = await setup(page);
  page.on("dialog", dialog => dialog.accept());
  await page.getByTestId("button-close-payroll-month").click();
  await expect(page.getByTestId("status-payroll-closed")).toBeVisible();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toBeDisabled();
  await expect(page.getByTestId("button-payroll-adjustment-1")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("status-payroll-closed")).toBeVisible();
  await page.getByTestId("button-reopen-payroll-month").click();
  await expect(page.getByTestId("status-payroll-closed")).toHaveCount(0);
  await expect(page.getByTestId("button-close-payroll-month")).toBeVisible();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toBeEnabled();
  expect(state.writes).toEqual([`/api/payroll/${state.month()}/close`, `/api/payroll/${state.month()}/reopen`]);
});

test("accountant can close but cannot reopen a frozen month", async ({ page }) => {
  await setup(page, { role: "accountant" });
  page.on("dialog", dialog => dialog.accept());
  await page.getByTestId("button-close-payroll-month").click();
  await expect(page.getByTestId("status-payroll-closed")).toBeVisible();
  await expect(page.getByTestId("button-reopen-payroll-month")).toHaveCount(0);
});

test("closed month disables advance editing and clears line edit dialogs", async ({ page }) => {
  await setup(page, { initiallyClosed: true });
  await page.getByTestId("button-payroll-advance").click();
  await expect(page.getByTestId("input-advance-amount-1")).toBeDisabled();
  await expect(page.getByTestId("input-advance-payment-date-1")).toBeDisabled();
  await expect(page.getByTestId("button-refresh-advance-employee-1")).toBeDisabled();
  await expect(page.getByTestId("button-approve-payroll-advance")).toBeDisabled();
  await expect(page.getByTestId("button-payroll-adjustment-1")).toBeDisabled();
});

test("viewer cannot close/reopen and closure errors keep the month open", async ({ page }) => {
  await setup(page, { role: "viewer", initiallyClosed: true });
  await expect(page.getByTestId("status-payroll-closed")).toBeVisible();
  await expect(page.getByTestId("button-close-payroll-month")).toHaveCount(0);
  await expect(page.getByTestId("button-reopen-payroll-month")).toHaveCount(0);
});

test("server conflict is visible and does not falsely freeze the screen", async ({ page }) => {
  await setup(page, { failure: true });
  page.on("dialog", dialog => dialog.accept());
  await page.getByTestId("button-close-payroll-month").click();
  await expect(page.getByTestId("payroll-closure-error")).toContainText("Эх бүртгэл өөрчлөгдсөн");
  await expect(page.getByTestId("status-payroll-closed")).toHaveCount(0);
  await expect(page.getByTestId("button-payroll-adjustment-1")).toBeEnabled();
});

test("phone month navigation does not carry the closed state to another month", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await setup(page, { initiallyClosed: true });
  await expect(page.getByTestId("status-payroll-closed")).toBeVisible();
  await page.getByTestId("button-payroll-next-month").click();
  await expect(page.getByTestId("status-payroll-closed")).toHaveCount(0);
  await expect(page.getByTestId("button-close-payroll-month")).toBeVisible();
  await expect(page.getByTestId("button-pull-payroll-attendance")).toBeEnabled();
});
