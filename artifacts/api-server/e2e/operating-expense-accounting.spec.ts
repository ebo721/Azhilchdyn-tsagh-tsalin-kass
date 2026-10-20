import { expect, test } from "@playwright/test";

for (const device of ["desktop", "phone-viewer"] as const) {
  test(`expense posting badges, counts, combined filters and reload: ${device}`, async ({ page }) => {
    await page.setViewportSize(device === "desktop" ? { width: 1440, height: 960 } : { width: 402, height: 874 });
    const month = new Date().toISOString().slice(0, 7);
    const [year, monthNumber] = month.split("-").map(Number);
    const monthAt = (offset: number) => new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
    const states = ["missing_both", "missing_journal", "missing_cash", "complete"];
    const rows = states.map((accountingStatus, i) => ({
      id: 91001 + i, description: `Posting status fixture ${i}`, accountId: i === 3 ? 902 : 901,
      category: "Туршилтын зардал", amount: 1000 * (i + 1), date: `${month}-${["20", "03", "10", "03"][i]}`,
      paymentDate: i > 0 ? "2026-09-01" : null, paymentAmount: i > 0 ? 1000 * (i + 1) : null,
      bankTransactionId: null, cashTransactionId: i === 1 || i === 3 ? i + 1 : null,
      createdAt: "2026-09-01T00:00:00Z", accountingStatus,
    }));
    rows.push(
      { ...rows[0], id: 91005, date: `${monthAt(-1)}-28`, amount: 55000 },
      { ...rows[3], id: 91006, date: `${monthAt(1)}-01`, amount: 66000 },
    );
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
    await expect(page.getByTestId("input-expense-filter-month")).toHaveValue(month);
    await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(4);
    expect(await page.getByTestId("table-expenses").locator("tbody tr td:first-child").allTextContents())
      .toEqual([`${month}-03`, `${month}-03`, `${month}-10`, `${month}-20`]);
    expect(await Promise.all((await page.getByTestId("table-expenses").locator("tbody tr").all()).map(row => row.getAttribute("data-testid"))))
      .toEqual(["row-expense-91002", "row-expense-91004", "row-expense-91003", "row-expense-91001"]);
    await page.getByTestId("button-expense-previous-month").click();
    await expect(page.getByTestId("input-expense-filter-month")).toHaveValue(monthAt(-1));
    await expect(page.getByTestId("row-expense-91005")).toHaveCount(1);
    await expect(page.getByTestId("row-expense-91001")).toHaveCount(0);
    await expect(page.getByTestId("count-accounting-complete")).toHaveText("0 зардал");
    await expect(page.getByTestId("filter-accounting-all")).toHaveText("Бүгд (1)");
    await page.getByTestId("button-expense-next-month").click();
    await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(4);
    await page.getByTestId("button-expense-next-month").click();
    await expect(page.getByTestId("row-expense-91006")).toHaveCount(1);
    await expect(page.getByTestId("row-expense-91004")).toHaveCount(0);
    await page.getByTestId("input-expense-filter-month").fill("2095-12");
    await expect(page.getByText("Сонгосон сар, данс болон бичилтийн төлөвт тохирох зардал алга.")).toBeVisible();
    await page.getByTestId("button-expense-next-month").click();
    await expect(page.getByTestId("input-expense-filter-month")).toHaveValue("2096-01");
    await page.getByTestId("button-expense-previous-month").click();
    await expect(page.getByTestId("input-expense-filter-month")).toHaveValue("2095-12");
    await page.getByTestId("input-expense-filter-month").fill(month);
    for (const status of states) {
      await expect(page.getByTestId(`count-accounting-${status}`)).toHaveText("1 зардал");
      await page.getByTestId(`filter-accounting-${status}`).click();
      await expect(page.getByTestId("table-expenses").locator("tbody tr")).toHaveCount(1);
      await expect(page.getByTestId(`accounting-badge-${status}`)).toHaveCount(1);
    }
    await page.getByTestId("select-operating-expense-category").selectOption("901");
    await expect(page.getByText("Сонгосон сар, данс болон бичилтийн төлөвт тохирох зардал алга.")).toBeVisible();
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
