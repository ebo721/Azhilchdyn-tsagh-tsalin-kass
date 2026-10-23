import { expect, test } from "@playwright/test";

for (const width of [1440, 402]) {
  test(`advance payment history survives reload and cannot be overwritten as one payment: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const month = "2026-11";
    let payments = [
      { sequence: 1, amount: 300, date: "2026-11-15" },
      { sequence: 3, amount: 200, date: "2026-11-17" },
    ];
    const writes: string[] = [];
    const schedule = { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 15, finalPayDay: 31 };
    const period = { month, periodStart: `${month}-01`, periodEnd: `${month}-30`, advancePeriodEnd: `${month}-15`,
      advancePaymentDate: `${month}-15`, finalPaymentDate: `${month}-30`, schedule };
    const advance = () => {
      const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      return { ...period, approved: true, approvalDate: `${month}-15`, totalAmount: 1000,
        lines: [{ employeeId: 2, employeeName: "Урьдчилгаа ажилтан", employeeType: "shift", baseSalary: 100,
          daysWorked: 10, dailySalary: 100, totalSalary: 1000, advanceAmount: 1000,
          paid: false, paymentDate: payments[0]?.date ?? null, paidAmount, remainingBalance: 1000 - paidAmount, payments }] };
    };
    await page.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, role: "admin", username: "fixture" } });
      if (path === "/api/payroll") return route.fulfill({ json: { ...period, totalGross: 0, totalSocialInsurance: 0,
        totalIncomeTax: 0, totalDeductions: 0, totalNet: 0, lines: [], closedAt: null } });
      if (path === "/api/payroll-advance") return route.fulfill({ json: advance() });
      if (req.method() === "DELETE") {
        writes.push(path);
        payments = payments.filter(p => p.sequence !== Number(path.split("/").at(-1)));
        return route.fulfill({ json: advance() });
      }
      if (req.method() !== "GET") {
        writes.push(path);
        return route.fulfill({ status: 409, json: { error: "Unexpected overwrite" } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(`/payroll?month=${month}`);
    await page.getByTestId("button-payroll-advance").click();
    const history = page.getByTestId("advance-history-2");
    await expect(history).toContainText("Олгосон: 500 ₮");
    await expect(history).toContainText("Үлдэгдэл: 500 ₮");
    await expect(history).toContainText("3-р олголт");
    await expect(page.getByTestId("button-advance-paid-2")).toHaveText("Хэсэгчлэн олгосон");
    await expect(page.getByTestId("button-advance-paid-2")).toBeDisabled();
    await expect(page.getByTestId("input-advance-amount-2")).toBeDisabled();
    await page.reload();
    await page.getByTestId("button-payroll-advance").click();
    await expect(history).toContainText("Олгосон: 500 ₮");
    page.on("dialog", dialog => dialog.accept());
    await page.getByTestId("delete-advance-2-3").click();
    await expect(history).toContainText("Олгосон: 300 ₮");
    await expect(history).toContainText("Үлдэгдэл: 700 ₮");
    await expect(history).not.toContainText("3-р олголт");
    expect(writes).toEqual(["/api/payroll-advance/2026-11/2/transactions/3"]);
  });
}
