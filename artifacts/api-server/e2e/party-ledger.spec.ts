import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, role = "accountant") {
  const requests: URL[] = [], mutations: string[] = [];
  let error = false;
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== "GET") mutations.push(path);
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role, menuPaths: ["/ar-ap"] } });
    if (path === "/api/employees") return route.fulfill({ json: [{ id: 1, name: "Тайлан ажилтан" }] });
    if (path === "/api/journal/suppliers") return route.fulfill({ json: [{ id: 2, name: "Тайлан харилцагч" }] });
    if (path === "/api/ar-ap/party-ledger") {
      requests.push(url);
      if (error) return route.fulfill({ status: 500, json: { error: "Fixture report error" } });
      const supplier = url.searchParams.get("partyType") === "supplier";
      const balance = supplier ? -150 : 80;
      return route.fulfill({ json: {
        partyType: supplier ? "supplier" : "employee", partyId: supplier ? 2 : 1,
        partyName: supplier ? "Тайлан харилцагч" : "Тайлан ажилтан",
        from: url.searchParams.get("from"), to: url.searchParams.get("to"),
        openingBalance: supplier ? 0 : 100, totalDebit: supplier ? 50 : 20, totalCredit: supplier ? 200 : 40,
        closingBalance: balance, conclusion: supplier ? "payable" : "receivable",
        warnings: ["Үлдэгдэлд зөвхөн 1200, 2000 орно."],
        lines: [{ id: 4, date: "2026-02-10", sourceType: "bank_transaction", description: "Тайлангийн хөдөлгөөн",
          accountCode: supplier ? "2000" : "1200", accountName: supplier ? "Өглөг" : "Авлага",
          debit: supplier ? 50 : 0, credit: supplier ? 0 : 40, balance, affectsBalance: true,
          journalEntryId: 22, bankTransactionId: 33 }],
        payroll: supplier ? null : { month: "2026-02", available: true, openingBalance: 0, payable: 1000,
          paidAmount: 300, advanceAmount: 0, balanceAmount: 700, difference: 780, note: "Хадгалсан сарын тооцоо, дэвтэртэй нэгтгээгүй." },
        unmatchedBankTransactions: supplier ? [] : [{ id: 44, date: "2026-02-11", amount: 25, type: "expense", description: "Холбогдоогүй" }],
      } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/ar-ap");
  return { requests, mutations, setError(value: boolean) { error = value; } };
}

for (const width of [1440, 402]) {
  test(`party ledger report is read-only, searchable and separate from payroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    await page.getByTestId("tab-ar-ap-ledger").click();
    await expect(page.getByTestId("button-create-employee-balance")).toHaveCount(0);
    await expect(page.getByTestId("button-create-journal-entry")).toHaveCount(0);
    expect(f.requests).toHaveLength(0);
    await page.getByTestId("input-party-ledger-search").fill("Тайлан ажилтан");
    await page.getByTestId("option-party-ledger-1").click();
    await page.getByTestId("input-party-ledger-from").fill("2026-02-01");
    await page.getByTestId("input-party-ledger-to").fill("2026-02-28");
    expect(f.requests).toHaveLength(0);
    await page.getByTestId("button-party-ledger-search").click();
    await expect(page.getByTestId("text-party-ledger-closing")).toContainText("80.00");
    await expect(page.getByTestId("text-party-ledger-conclusion")).toContainText("Авлагатай");
    await expect(page.getByTestId("section-party-ledger-payroll")).toContainText("700.00");
    await expect(page.getByTestId("text-party-ledger-payroll-difference")).toContainText("780.00");
    await expect(page.getByTestId("row-party-ledger-unmatched-44")).toBeVisible();
    await expect(page.getByTestId("link-party-ledger-journal-4")).toHaveAttribute("href", "/journal?entryId=22");
    await expect(page.getByTestId("link-party-ledger-bank-4")).toHaveAttribute("href", "/bank-transactions?transactionId=33");
    await page.screenshot({ path: `/tmp/party-ledger-${width}.png`, fullPage: true });
    await page.getByTestId("select-party-ledger-type").selectOption("supplier");
    await expect(page.getByTestId("text-party-ledger-closing")).toHaveCount(0);
    await page.getByTestId("input-party-ledger-search").fill("Тайлан харилцагч");
    await page.getByTestId("option-party-ledger-2").click();
    await page.getByTestId("button-party-ledger-search").click();
    await expect(page.getByTestId("text-party-ledger-conclusion")).toContainText("Өглөгтэй");
    await expect(page.getByTestId("section-party-ledger-payroll")).toHaveCount(0);
    await expect(page.getByTestId("section-party-ledger-unmatched")).toHaveCount(0);
    expect(f.requests.at(-1)?.searchParams.get("partyType")).toBe("supplier");
    expect(f.mutations).toEqual([]);
  });
}

test("invalid calendar dates do not query, errors can be retried, and old tabs remain available", async ({ page }) => {
  const f = await fixture(page);
  await page.getByTestId("tab-ar-ap-ledger").click();
  await page.getByTestId("option-party-ledger-1").click();
  await page.getByTestId("input-party-ledger-from").fill("2026-03-11");
  await page.getByTestId("input-party-ledger-to").fill("2026-03-10");
  await page.getByTestId("button-party-ledger-search").click();
  await expect(page.getByTestId("error-party-ledger-form")).toBeVisible();
  expect(f.requests).toHaveLength(0);
  await page.getByTestId("input-party-ledger-from").fill("2026-02-01");
  f.setError(true);
  await page.getByTestId("button-party-ledger-search").click();
  await expect(page.getByTestId("error-party-ledger")).toBeVisible();
  f.setError(false);
  await page.getByTestId("button-party-ledger-search").click();
  await expect(page.getByTestId("text-party-ledger-closing")).toContainText("80.00");
  await page.getByRole("tab", { name: "Авлага", exact: true }).click();
  await expect(page.getByTestId("button-create-employee-balance")).toBeVisible();
  await expect(page.getByTestId("section-party-ledger")).toHaveCount(0);
  expect(f.mutations).toEqual([]);
});
