import { expect, test } from "@playwright/test";

for (const width of [1440, 402]) {
  test(`bank direction filter combines with month and resets to all: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const month = new Date().toISOString().slice(0, 7);
    const previousDate = new Date(`${month}-01T00:00:00Z`);
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previous = previousDate.toISOString().slice(0, 7);
    const bank = (id: number, type: "income" | "expense", period = month) => ({
      id, type, amount: 123.45, transactionAt: `${period}-13T08:00:00Z`,
      description: `fixture-bank-${id}`, counterparty: "Туршилт",
      accountId: null, accountCode: null, accountName: null,
      bankAccountId: 1, bankName: "Fixture", bankAccountNumber: "0000",
      cashTransactionId: null, journalEntryId: null,
    });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") throw new Error(`Unexpected write: ${path}`);
      if (path === "/api/auth/me") return route.fulfill({ json: {
        authenticated: true, id: 1, username: "fixture", role: "accountant",
      } });
      if (path === "/api/bank-transactions") return route.fulfill({ json: [
        bank(91, "income"), bank(92, "expense"), bank(93, "expense", previous),
      ] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/bank-transactions");
    const filter = page.getByTestId("select-bank-type-filter");
    const table = page.getByTestId("table-bank-transactions");
    await expect(table).toContainText("fixture-bank-91");
    await expect(table).toContainText("fixture-bank-92");
    await expect(table).not.toContainText("fixture-bank-93");
    await filter.selectOption("income");
    await expect(table).toContainText("fixture-bank-91");
    await expect(table).not.toContainText("fixture-bank-92");
    await filter.selectOption("expense");
    await expect(table).not.toContainText("fixture-bank-91");
    await expect(table).toContainText("fixture-bank-92");
    await page.getByTestId("button-bank-previous-month").click();
    await expect(filter).toHaveValue("expense");
    await expect(table).toContainText("fixture-bank-93");
    await expect(table).not.toContainText("fixture-bank-92");
    await filter.selectOption("income");
    await expect(table).toHaveCount(0);
    await filter.selectOption("all");
    await expect(table).toContainText("fixture-bank-93");
    await page.getByTestId("button-bank-next-month").click();
    await expect(table).toContainText("fixture-bank-91");
    await expect(table).toContainText("fixture-bank-92");
    const bounds = await filter.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  });
}

for (const width of [1440, 402]) {
  for (const path of ["/bank-transactions", "/bank-transactions/journal-review"]) {
    test(`bank payable employee suggestions stay visible and select the correct person: ${width} ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 960 });
      const month = new Date().toISOString().slice(0, 7);
      let posted = false;
      let fail = true;
      const writes: unknown[] = [];
      const bank = {
        id: 91, type: "income", amount: 123.45, transactionAt: `${month}-13T08:00:00Z`,
        description: "Өглөгийн хайлтын туршилт", counterparty: "Туршилт",
        accountId: null, accountCode: null, accountName: null,
        bankAccountId: 1, bankName: "Fixture", bankAccountNumber: "0000",
        cashTransactionId: null, journalEntryId: null, suggestedAccountId: null,
      };
      await page.route("**/api/**", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
          authenticated: true, id: 1, username: "fixture", role: "accountant",
        } });
        if (url.pathname === "/api/chart-of-accounts") return route.fulfill({ json: [
          { id: 20, code: "2000", name: "Өглөг", type: "liability", isActive: true },
        ] });
        if (url.pathname === "/api/employees") return route.fulfill({ json: [
          { id: 11, name: "Бат", role: "Нягтлан", status: "active" },
          { id: 12, name: "Бат", role: "Жолооч", status: "active" },
          { id: 13, name: "Сараа", role: "Тогооч", status: "active" },
          { id: 14, name: "Бат inactive", role: "Хуучин", status: "inactive" },
        ] });
        if (url.pathname === "/api/bank-transactions" || url.pathname === "/api/bank-transactions/journal-review") {
          return route.fulfill({ json: posted ? [] : [bank] });
        }
        if (url.pathname === "/api/bank-transactions/91/post-journal") {
          writes.push(request.postDataJSON());
          if (fail) return route.fulfill({ status: 503, json: { error: "Fixture failure" } });
          posted = true;
          return route.fulfill({ json: { bankTransactionId: 91, journalEntryId: 99 } });
        }
        if (request.method() !== "GET") throw new Error(`Unexpected write: ${request.method()} ${url.pathname}`);
        return route.fulfill({ json: [] });
      });
      await page.goto(path);
      await page.getByTestId("button-create-bank-debt-91").click();
      const search = page.getByTestId("input-bank-ar-ap-employee-search");
      const results = page.getByTestId("select-bank-ar-ap-employee");
      await search.fill("  бА  ");
      await expect(results).toHaveAttribute("size", "4");
      await expect(results.getByRole("option", { name: "Бат - Нягтлан", exact: true })).toBeVisible();
      await expect(results.getByRole("option", { name: "Бат - Жолооч", exact: true })).toBeVisible();
      await expect(results.getByRole("option", { name: "Бат inactive - Хуучин · Идэвхгүй", exact: true })).toBeVisible();
      await expect(results.getByRole("option")).toHaveCount(4);
      const bounds = await results.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await results.selectOption("11");
      await search.fill("Байхгүй ажилтан");
      await expect(results).toHaveValue("");
      await expect(page.getByTestId("text-bank-ar-ap-employee-empty")).toBeVisible();
      await page.getByTestId("button-submit-bank-ar-ap").click();
      await expect(page.getByTestId("text-bank-ar-ap-party-error")).toBeVisible();
      expect(writes).toHaveLength(0);
      await search.fill("бА");
      await results.selectOption("14");
      await page.getByTestId("button-submit-bank-ar-ap").click();
      await expect(page.getByTestId("text-bank-ar-ap-error")).toContainText("Fixture failure");
      await expect(results).toHaveValue("14");
      await expect(search).toHaveValue("бА");
      fail = false;
      await page.getByTestId("button-submit-bank-ar-ap").click();
      await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
      expect(writes).toEqual([1, 2].map(() => ({
        accountId: 20, allocation: { kind: "create", partyType: "employee", employeeId: 14 },
      })));
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("button-create-bank-debt-91")).toHaveCount(0);
    });
  }
}
