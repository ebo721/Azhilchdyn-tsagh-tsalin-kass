import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, options: { closedExtra?: boolean; failSave?: boolean; role?: string } = {}) {
  const month = "2026-08";
  let first = 600000, second = 300000;
  let extras = [{ sequence: 3, amount: 100000, date: "2026-08-20" }];
  const writes: Array<{ path: string; body: any }> = [];
  const summary = () => {
    const paidAmount = first + second + extras.reduce((total, payment) => total + payment.amount, 0);
    return {
      month, periodStart: `${month}-01`, advancePeriodEnd: `${month}-15`, periodEnd: `${month}-31`,
      advancePaymentDate: `${month}-15`, finalPaymentDate: `${month}-31`,
      attendancePulledAt: "2026-08-20T00:00:00Z", attendanceNeedsRefresh: false, closedAt: null,
      schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 15, finalPayDay: 31 },
      totalGross: 1500000, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: 1500000,
      lines: [{ employeeId: 1, employeeName: "Хуваасан цалин", employeeType: "shift", role: "Fixture", calculationReady: true,
        daysWorked: 20, hours: 160, gross: 1500000, socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 0,
        calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0, receivableId: null,
        deductions: 0, carryoverAmount: 0, payable: 1500000, net: 1500000, paidAmount,
        paymentDate: `${month}-10`, secondPaidAmount: second, secondPaymentDate: `${month}-15`,
        additionalPayments: extras, remainingAmount: 1500000 - paidAmount, overpaidAmount: 0,
        balanceAmount: 1500000 - paidAmount }],
    };
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, role: options.role ?? "admin", username: "fixture" } });
    if (path === "/api/payroll") return route.fulfill({ json: summary() });
    if (path === "/api/payroll-advance") return route.fulfill({ json: { month, approved: false, lines: [], totalAmount: 0 } });
    if (path === "/api/cash/closures") return route.fulfill({ json: options.closedExtra ? [{ id: 1, date: "2026-08-20", closedAt: "2026-08-21T00:00:00Z" }] : [] });
    if (path === "/api/payroll-adjustments") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (options.failSave) return route.fulfill({ status: 409, json: { error: "Банкны хуулгаар баталгаажсан цалингийн гүйлгээний дүн, огноог өөрчлөх боломжгүй" } });
      first = body.paidAmount;
      second = body.secondPaidAmount;
      extras = body.additionalPayments;
      return route.fulfill({ json: { ...body, taxRelief: 0 } });
    }
    if (request.method() === "DELETE") {
      writes.push({ path, body: null });
      extras = extras.filter(payment => payment.sequence !== Number(path.split("/").at(-1)));
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/deletion-requests" && request.method() === "POST") {
      writes.push({ path, body: request.postDataJSON() });
      return route.fulfill({ json: { id: 10, status: "pending" } });
    }
    return route.fulfill({ json: [] });
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`/payroll?month=${month}`);
  await expect(page.getByTestId("button-payroll-adjustment-1")).toBeVisible();
  return { writes };
}

for (const width of [1440, 402]) {
  test(`additional payments create/edit/reload/delete keep stable slots at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { writes } = await setup(page);
    await page.getByTestId("button-payroll-adjustment-1").click();
    await expect(page.getByTestId("input-payroll-paid-amount")).toHaveValue("600000");
    await expect(page.getByTestId("input-payroll-extra-amount-3")).toHaveValue("100000");
    await page.getByTestId("input-payroll-extra-amount-3").fill("125000");
    await page.getByTestId("button-add-payroll-payment").click();
    await page.getByTestId("input-payroll-extra-amount-4").fill("200000");
    await page.getByTestId("input-payroll-extra-date-4").fill("2026-08-25");
    await page.getByTestId("button-add-payroll-payment").click();
    await page.getByTestId("button-delete-payroll-payment-5").click();
    await expect(page.getByTestId("input-payroll-extra-amount-5")).toHaveCount(0);
    await page.getByTestId("button-save-payroll-adjustment").click();
    await expect(page.getByTestId("form-payroll-adjustment")).toHaveCount(0);
    expect(writes[0].body.paidAmount).toBe(600000);
    expect(writes[0].body.additionalPayments).toEqual([
      { sequence: 3, amount: 125000, date: "2026-08-20" },
      { sequence: 4, amount: 200000, date: "2026-08-25" },
    ]);
    // Reopen immediately, before any navigation or manual refresh.
    await page.getByTestId("button-payroll-adjustment-1").click();
    await expect(page.getByTestId("input-payroll-extra-amount-4")).toHaveValue("200000");
    await expect(page.getByTestId("input-payroll-paid-amount")).toHaveValue("600000");
    await page.reload();
    await page.getByTestId("button-payroll-adjustment-1").click();
    await expect(page.getByTestId("input-payroll-extra-amount-3")).toHaveValue("125000");
    await page.getByTestId("button-delete-payroll-payment-3").click();
    await expect(page.getByTestId("form-payroll-adjustment")).toHaveCount(0);
    expect(writes.at(-1)?.path).toBe("/api/payroll-adjustments/2026-08/1/transactions/3");
    await page.getByTestId("button-payroll-adjustment-1").click();
    await expect(page.getByTestId("input-payroll-extra-amount-3")).toHaveCount(0);
    await expect(page.getByTestId("input-payroll-extra-amount-4")).toHaveValue("200000");
    await page.getByTestId("button-add-payroll-payment").click();
    await expect(page.getByTestId("input-payroll-extra-amount-5")).toBeVisible();
  });
}

test("invalid extra stays visible, server conflicts keep edits, and closed extra dates lock editing", async ({ page }) => {
  const { writes } = await setup(page, { failSave: true });
  await page.getByTestId("button-payroll-adjustment-1").click();
  await page.getByTestId("input-payroll-extra-amount-3").fill("0");
  await page.getByTestId("button-save-payroll-adjustment").click();
  await expect(page.getByTestId("error-payroll-extra")).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByTestId("input-payroll-extra-amount-3").fill("125000");
  await page.getByTestId("button-save-payroll-adjustment").click();
  await expect(page.getByTestId("error-payroll-adjustment")).toBeVisible();
  await expect(page.getByTestId("input-payroll-extra-amount-3")).toHaveValue("125000");
  await setup(page, { closedExtra: true });
  await expect(page.getByTestId("button-payroll-adjustment-1")).toBeDisabled();
});

test("accountant deletion of an additional payment requests admin approval", async ({ page }) => {
  const { writes } = await setup(page, { role: "accountant" });
  await page.getByTestId("button-payroll-adjustment-1").click();
  await page.getByTestId("button-delete-payroll-payment-3").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toBe("/api/deletion-requests");
  expect(writes[0].body.targetPath).toBe("/payroll-adjustments/2026-08/1/transactions/3");
});
