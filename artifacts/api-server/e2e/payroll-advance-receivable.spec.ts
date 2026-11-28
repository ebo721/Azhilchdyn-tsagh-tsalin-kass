import { expect, test } from "@playwright/test";

for (const width of [1440, 402]) {
  test(`advance deduction selection, reload, edit and reversal: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const month = "2026-11";
    let amount = 0;
    let selected: number | null = null;
    const writes: unknown[] = [];
    const schedule = { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15,
      periodEndDay: 31, advancePayDay: 15, finalPayDay: 31 };
    const period = { month, periodStart: `${month}-01`, periodEnd: `${month}-30`, advancePeriodEnd: `${month}-15`,
      advancePaymentDate: `${month}-15`, finalPaymentDate: `${month}-30`, schedule };
    const advance = () => ({ ...period, approved: true, approvalDate: `${month}-15`, totalAmount: 500000,
      lines: [{ employeeId: 2, employeeName: "Урьдчилгаа ажилтан", employeeType: "shift", baseSalary: 50000,
        daysWorked: 10, dailySalary: 50000, totalSalary: 500000, advanceAmount: 500000,
        paid: false, paymentDate: null, paidAmount: 0, remainingBalance: 500000 - amount,
        netAdvanceAmount: 500000 - amount, receivableDeduction: amount, receivableId: selected,
        receivableDate: amount ? `${month}-15` : null }] });
    await page.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, role: "admin", username: "fixture" } });
      if (path === "/api/payroll") return route.fulfill({ json: { ...period, totalGross: 0, totalSocialInsurance: 0,
        totalIncomeTax: 0, totalDeductions: 0, totalNet: 0, lines: [], closedAt: null } });
      if (path === "/api/payroll-advance") return route.fulfill({ json: advance() });
      if (path === "/api/journal/receivables") return route.fulfill({ json: [
        { id: 71, partyType: "employee", partyId: 2, status: "open", openAmount: 150000 - amount },
        { id: 72, partyType: "employee", partyId: 3, status: "open", openAmount: 900000 },
      ] });
      if (path === "/api/payroll-advance/receivable" && req.method() === "PUT") {
        const data = req.postDataJSON();
        writes.push(data);
        amount = data.amount;
        selected = data.receivableId;
        return route.fulfill({ json: advance() });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(`/payroll?month=${month}`);
    await page.getByTestId("button-payroll-advance").click();
    await page.getByTestId("button-advance-receivable-2").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("select-advance-receivable").locator("option")).toHaveCount(2);
    await page.getByTestId("select-advance-receivable").selectOption("71");
    await page.getByTestId("input-advance-receivable-amount").fill("200000");
    await expect(page.getByTestId("button-save-advance-receivable")).toBeDisabled();
    await page.getByTestId("input-advance-receivable-amount").fill("100000");
    await page.getByTestId("input-advance-receivable-date").fill("2026-11-15");
    await expect(page.getByTestId("advance-receivable-net-preview")).toContainText("400,000");
    await page.getByTestId("button-save-advance-receivable").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("advance-net-2")).toContainText("400,000");
    await expect(page.getByTestId("advance-history-2")).toContainText("Олгосон: 0");
    await expect(page.getByTestId("advance-history-2")).toContainText("Үлдэгдэл: 400,000");
    await page.reload();
    await page.getByTestId("button-payroll-advance").click();
    await expect(page.getByTestId("advance-receivable-deduction-2")).toContainText("100,000");
    await page.getByTestId("button-advance-receivable-2").click();
    await expect(page.getByTestId("input-advance-receivable-amount")).toHaveValue("100000");
    await expect(page.getByTestId("button-save-advance-receivable")).toBeEnabled();
    page.on("dialog", d => d.accept());
    await page.getByTestId("button-remove-advance-receivable").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("advance-net-2")).toContainText("500,000");
    expect(writes).toEqual([
      { month, employeeId: 2, receivableId: 71, amount: 100000, date: "2026-11-15" },
      { month, employeeId: 2, receivableId: null, amount: 0, date: "2026-11-15" },
    ]);
  });
}
