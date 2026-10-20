import { expect, test } from "@playwright/test";

for (const device of ["desktop", "phone-viewer"] as const) {
  test(`expense posting badges, counts, combined filters and reload: ${device}`, async ({ page }) => {
    await page.setViewportSize(device === "desktop" ? { width: 1440, height: 960 } : { width: 402, height: 874 });
    const states = ["missing_both", "missing_journal", "missing_cash", "complete"];
    const rows = states.map((accountingStatus, i) => ({
      id: 91001 + i, description: `Posting status fixture ${i}`, accountId: i === 3 ? 902 : 901,
      category: "Туршилтын зардал", amount: 1000 * (i + 1), date: "2026-09-01",
      paymentDate: i > 0 ? "2026-09-01" : null, paymentAmount: i > 0 ? 1000 * (i + 1) : null,
      bankTransactionId: null, cashTransactionId: i === 1 || i === 3 ? i + 1 : null,
      createdAt: "2026-09-01T00:00:00Z", accountingStatus,
    }));
    const writes: string[] = [];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") writes.push(path);
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: device === "desktop" ? "admin" : "viewer" } });
      if (path === "/api/operating-expenses") return route.fulfill({ json: rows });
      if (path === "/api/chart-of-accounts") return route.fulfill({ json: [
        { id: 901, code: "6900", name: "Бусад", type: "expense", normalBalance: "debit", isActive: true },
        { id: 902, code: "6100", name: "Түрээс", type: "expense", normalBalance: "debit", isActive: true },
      ] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/operating-expenses");
    await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(4);
    for (const status of states) {
      await expect(page.getByTestId(`count-accounting-${status}`)).toHaveText("1 зардал");
      await page.getByTestId(`filter-accounting-${status}`).click();
      await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(1);
      await expect(page.getByTestId(`accounting-badge-${status}`)).toHaveCount(1);
    }
    await page.getByTestId("select-operating-expense-category").selectOption("901");
    await expect(page.getByText("Сонгосон данс болон бичилтийн төлөвт тохирох зардал алга.")).toBeVisible();
    await expect(page.getByTestId("count-accounting-complete")).toHaveText("0 зардал");
    await page.getByTestId("filter-accounting-all").click();
    await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(4);
    await page.screenshot({ path: `../../generated-artifacts/expense-accounting-${device}.png`, fullPage: true });
    if (device === "phone-viewer") await expect(page.getByTestId("button-add-expense")).toHaveCount(0);
    expect((await page.locator("body").boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(writes).toEqual([]);
  });
}
