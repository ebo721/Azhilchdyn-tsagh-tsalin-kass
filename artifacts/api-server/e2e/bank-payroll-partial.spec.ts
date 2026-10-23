import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, options: { remaining?: number; reuse?: boolean; fail?: boolean; advance?: boolean } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  let remaining = options.remaining ?? 1000;
  const writes: Array<{path: string; body: any}> = [];
  let rows = (options.advance ? [300, 200, 500] : [300, 700]).map((amount, i) => ({
    id: 101 + i, bankAccountId: 1, type: "expense", amount, transactionAt: `${month}-20T10:00:00Z`,
    description: `Цалингийн төлөлт ${i + 1}`, counterparty: "Цалин ажилтан", accountId: 6,
    accountCode: "6000", accountName: "Цалин", cashTransactionId: null, journalEntryId: null,
    transferredAt: null, unclearAt: null, createdAt: `${month}-20T10:00:00Z`,
  }));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "accountant" } });
    if (path === "/api/bank-accounts") return route.fulfill({ json: [{ id: 1, bankName: "Fixture bank", accountNumber: "1234567890" }] });
    if (path === "/api/chart-of-accounts") return route.fulfill({ json: [{ id: 6, code: "6000", name: "Цалин", type: "expense", isActive: true }] });
    if (path === "/api/bank-transactions") return route.fulfill({ json: rows });
    if (/\/(?:payroll|advance)-targets\//.test(path)) return route.fulfill({ json: [{
      employeeId: 2, employeeName: "Цалин ажилтан", month: path.split("/").at(-1),
      payable: 1000, paidAmount: 1000 - remaining, remainingBalance: remaining,
      existingCashId: options.reuse ? 15 : null,
    }] });
    if (/\/link-payroll$/.test(path)) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (options.fail) return route.fulfill({ status: 409, json: { error: "Банкны гүйлгээ аль хэдийн холбогдсон байна" } });
      const bankId = Number(path.split("/").at(-2));
      const bank = rows.find(row => row.id === bankId)!;
      if (!options.reuse) remaining -= bank.amount;
      rows = rows.filter(row => row.id !== bankId);
      return route.fulfill({ json: { bankTransactionId: bankId, cashTransactionId: 15,
        employeeId: 2, month: body.month, paidAmount: 1000 - remaining, remainingBalance: remaining, reusedPayment: Boolean(options.reuse) } });
    }
    if (request.method() !== "GET") {
      writes.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 409, json: { error: "Unexpected generic cash creation" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/bank-transactions");
  await expect(page.getByTestId("button-transfer-bank-transaction-101")).toBeVisible();
  return { writes, month };
}

for (const width of [1440, 402]) {
  test(`approved advance can be paid with three bank transfers: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { writes, month } = await setup(page, { advance: true });
    for (const [id, before, after] of [[101, "1,000 ₮", "700 ₮"], [102, "700 ₮", "500 ₮"], [103, "500 ₮", "0 ₮"]]) {
      await page.getByTestId(`button-transfer-bank-transaction-${id}`).click();
      await page.getByTestId("select-bank-payroll-kind").selectOption("advance");
      await expect(page.getByTestId("input-bank-payroll-amount")).toHaveJSProperty("readOnly", true);
      await expect(page.getByTestId("input-bank-payroll-date")).toHaveJSProperty("readOnly", true);
      await page.getByTestId("button-bank-payroll-target-2").click();
      await expect(page.getByTestId("checkbox-bank-payroll-confirm").locator("..")).toContainText("урьдчилгаатай");
      await expect(page.getByTestId("text-bank-payroll-before")).toHaveText(String(before));
      await expect(page.getByTestId("text-bank-payroll-after")).toHaveText(String(after));
      const button = page.getByTestId("button-bank-payroll-link");
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.getByTestId("checkbox-bank-payroll-confirm").check();
      await button.click();
      await expect(page.getByTestId("text-bank-payroll-success")).toContainText(String(after));
      await expect(page.getByTestId("section-bank-payroll-link")).toHaveCount(0);
    }
    expect(writes).toEqual([101, 102, 103].map(id => ({
      path: `/api/bank-transactions/${id}/link-payroll`, body: { employeeId: 2, month, paymentKind: "advance" },
    })));
  });
  test(`smaller bank payment leaves payroll debt and next payment closes it: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { writes, month } = await setup(page);
    for (const [id, before, after] of [[101, "1,000 ₮", "700 ₮"], [102, "700 ₮", "0 ₮"]]) {
      await page.getByTestId(`button-transfer-bank-transaction-${id}`).click();
      await expect(page.getByTestId("input-bank-payroll-amount")).toHaveJSProperty("readOnly", true);
      await page.getByTestId("button-bank-payroll-target-2").click();
      await expect(page.getByTestId("text-bank-payroll-before")).toHaveText(String(before));
      await expect(page.getByTestId("text-bank-payroll-after")).toHaveText(String(after));
      await expect(page.getByTestId("button-bank-payroll-link")).toBeDisabled();
      await page.getByTestId("checkbox-bank-payroll-confirm").check();
      await page.getByTestId("button-bank-payroll-link").click();
      await expect(page.getByTestId("text-bank-payroll-success")).toContainText(String(after));
      await expect(page.getByTestId("section-bank-payroll-link")).toHaveCount(0);
    }
    expect(writes).toEqual([
      { path: "/api/bank-transactions/101/link-payroll", body: { employeeId: 2, month } },
      { path: "/api/bank-transactions/102/link-payroll", body: { employeeId: 2, month } },
    ]);
    await expect(page.getByTestId("row-bank-transaction-102")).toHaveCount(0);
  });
}

test("prevents excessive payments and resets employee/confirmation when month changes", async ({ page }) => {
  const { writes } = await setup(page, { remaining: 200 });
  await page.getByTestId("button-transfer-bank-transaction-101").click();
  await page.getByTestId("button-bank-payroll-target-2").click();
  await expect(page.getByTestId("error-bank-payroll-excess")).toBeVisible();
  await page.getByTestId("checkbox-bank-payroll-confirm").check();
  await expect(page.getByTestId("button-bank-payroll-link")).toBeDisabled();
  await page.getByTestId("input-bank-payroll-month").fill("2026-01");
  await expect(page.getByTestId("panel-bank-payroll-preview")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("reuses an existing salary payment, while server conflicts keep the selected target visible", async ({ page }) => {
  const { writes } = await setup(page, { remaining: 0, reuse: true, fail: true });
  await page.getByTestId("button-transfer-bank-transaction-101").click();
  await page.getByTestId("button-bank-payroll-target-2").click();
  await expect(page.getByTestId("text-bank-payroll-mode")).toContainText("нэмэгдэхгүй");
  await page.getByTestId("checkbox-bank-payroll-confirm").check();
  await page.getByTestId("button-bank-payroll-link").click();
  await expect(page.getByTestId("error-bank-payroll-save")).toContainText("холбогдсон");
  await expect(page.getByTestId("panel-bank-payroll-preview")).toBeVisible();
  expect(writes).toHaveLength(1);
});
