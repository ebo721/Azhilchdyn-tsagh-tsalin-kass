import { expect, test } from "@playwright/test";

for (const width of [1440, 402]) {
  test(`advance shift filter uses period plans without losing drafts or limiting approval: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const month = "2026-11";
    const schedule = { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 26, advanceCutoffDay: 10,
      periodEndDay: 25, advancePayDay: 15, finalPayDay: 30 };
    const period = { month, periodStart: "2026-10-26", periodEnd: "2026-11-25",
      advancePeriodEnd: "2026-11-10", advancePaymentDate: "2026-11-15",
      finalPaymentDate: "2026-11-30", schedule };
    const lines = ["Previous month shift", "Current month shift", "Other shift", "Later assignment"].map((name, index) => ({
      employeeId: index + 1, employeeName: name, employeeType: "shift", baseSalary: 100000,
      bankAccountNumber: index === 0 ? "MN000000000000000002" : "",
      daysWorked: 5, dailySalary: 100000, totalSalary: 500000, advanceAmount: 250000,
      paid: false, paymentDate: null,
    }));
    const writes: Array<{ path: string; data: { lines?: Array<{ employeeId: number; advanceAmount: number }> } }> = [];
    const planMonths = new Set<string>();
    const advance = { ...period, approved: false, totalAmount: 1000000, lines };
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (request.method() !== "GET") {
        writes.push({ path, data: request.postDataJSON() });
        return route.fulfill({ json: { ...advance, approved: true, approvalDate: "2026-11-15" } });
      }
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, role: "admin", username: "fixture" } });
      if (path === "/api/payroll") return route.fulfill({ json: { ...period, totalGross: 0, totalSocialInsurance: 0,
        totalIncomeTax: 0, totalDeductions: 0, totalNet: 0, lines: [], closedAt: null } });
      if (path === "/api/payroll-advance") return route.fulfill({ json: advance });
      if (path === "/api/attendance/shifts") return route.fulfill({ json: [
        { id: 1, name: "Ээлж 1", startTime: "08:00", endTime: "20:00" },
        { id: 2, name: "Ээлж 2", startTime: "20:00", endTime: "08:00" },
      ] });
      if (path === "/api/attendance/shift-plans") {
        const planMonth = url.searchParams.get("month")!;
        planMonths.add(planMonth);
        const plans = [
          { employeeId: 1, shiftId: 1, date: "2026-10-26" },
          { employeeId: 2, shiftId: 1, date: "2026-11-10" },
          { employeeId: 3, shiftId: 2, date: "2026-11-09" },
          { employeeId: 4, shiftId: 1, date: "2026-11-11" },
        ].filter(plan => plan.date.startsWith(planMonth));
        return route.fulfill({ json: plans });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(`/payroll?month=${month}`);
    await page.getByTestId("button-payroll-advance").click();
    await expect(page.getByTestId("value-advance-bank-account-1")).toHaveText("MN000000000000000002");
    await expect(page.getByTestId("value-advance-bank-account-2")).toHaveText("Бүртгээгүй");
    await page.getByTestId("input-advance-amount-1").fill("300000");
    const filter = page.getByTestId("select-payroll-advance-shift-filter");
    await filter.selectOption("1");
    await expect(page.getByTestId("input-advance-amount-1")).toBeVisible();
    await expect(page.getByTestId("input-advance-amount-2")).toBeVisible();
    await expect(page.getByTestId("input-advance-amount-3")).toHaveCount(0);
    await expect(page.getByTestId("input-advance-amount-4")).toHaveCount(0);
    await expect(page.getByTestId("value-total-payroll-advance")).toContainText("550,000");
    expect([...planMonths].sort()).toEqual(["2026-10", "2026-11"]);
    await filter.selectOption("2");
    await expect(page.getByTestId("input-advance-amount-3")).toBeVisible();
    await expect(page.getByTestId("input-advance-amount-1")).toHaveCount(0);
    await page.getByTestId("select-payroll-advance-employee-filter").selectOption("office");
    await expect(page.getByTestId("empty-payroll-advance-filter")).toBeVisible();
    await page.getByTestId("select-payroll-advance-employee-filter").selectOption("all");
    await filter.selectOption("all");
    await expect(page.getByTestId("input-advance-amount-1")).toHaveValue("300000");
    await expect(page.getByTestId("input-advance-amount-4")).toBeVisible();
    expect(writes).toHaveLength(0);
    await filter.selectOption("1");
    page.once("dialog", dialog => dialog.accept());
    await page.getByTestId("button-approve-payroll-advance").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].data.lines?.map(line => line.employeeId)).toEqual([1, 2, 3, 4]);
    expect(writes[0].data.lines?.[0].advanceAmount).toBe(300000);
  });
}
