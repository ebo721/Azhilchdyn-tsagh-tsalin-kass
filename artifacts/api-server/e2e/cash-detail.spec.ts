import { expect, test, type Page } from "@playwright/test";

const date = new Date().toISOString().slice(0, 10);
const cash = {
  id: 901, type: "expense", category: "Цалин", description: "Fixture salary cash",
  amount: 1234.56, date, incomeMonth: null, accountId: null, accountCode: null, accountName: null,
  subcategory: null, editable: false, transactionKind: "payroll", bankTransactionId: 902,
  bankVerifiedAt: `${date}T01:00:00Z`, journalEntryId: 903, createdAt: `${date}T00:00:00Z`,
};
const bank = {
  id: 902, type: "expense", transactionAt: `${date}T17:18:19Z`, executedAt: `${date}T17:18:20Z`,
  amount: 1234.56, accountId: null, accountCode: null, accountName: null,
  account: "Fixture recipient account", counterparty: "Fixture counterparty",
  description: "Fixture bank salary payment", balance: 0, transferredAt: `${date}T17:18:20Z`,
  cashTransactionId: 901, bankAccountId: null, bankName: "Fixture Bank",
  bankAccountNumber: "MN-FIXTURE-OWN-ACCOUNT-ONLY", createdAt: `${date}T00:00:00Z`,
};

async function setup(page: Page, mode: "linked" | "unlinked" | "retry" | "missing" | "reopen" = "linked") {
  let detailCalls = 0, writes = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const row = mode === "unlinked"
    ? { ...cash, type: "income", category: "Fixture income", description: "Fixture income cash", transactionKind: "manual", bankTransactionId: null, bankVerifiedAt: null, journalEntryId: null, incomeMonth: date.slice(0, 7) }
    : cash;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes++;
      return route.fulfill({ status: 405, json: { error: "Read-only fixture" } });
    }
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "viewer", menuPaths: ["/cash"] } });
    if (path === "/api/cash/transactions") return route.fulfill({ json: [row] });
    if (path === "/api/cash/closures") return route.fulfill({ json: [{ id: 1, date, closedAt: `${date}T02:00:00Z` }] });
    if (path === "/api/cash/transactions/901") {
      detailCalls++;
      if (mode === "retry" && detailCalls === 1) return route.fulfill({ status: 503, json: { error: "Fixture detail temporarily unavailable" } });
      if (mode === "missing") return route.fulfill({ status: 404, json: { error: "Холбогдсон банкны гүйлгээ олдсонгүй" } });
      if (mode === "reopen" && detailCalls === 2) {
        await gate;
        return route.fulfill({ json: { cashTransaction: { ...row, description: "Fresh cash after unlink", bankTransactionId: null, bankVerifiedAt: null }, bankTransaction: null } });
      }
      return route.fulfill({ json: { cashTransaction: row, bankTransaction: mode === "unlinked" ? null : bank } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/cash");
  await expect(page.getByTestId("button-view-cash-901")).toBeVisible();
  return { calls: () => detailCalls, writes: () => writes, release: () => release?.() };
}

test("read-only viewer can inspect closed payroll cash and complete bank facts without writes", async ({ page }) => {
  const state = await setup(page);
  await page.getByTestId("button-view-cash-901").click();
  const detail = page.getByTestId("cash-transaction-detail");
  await expect(detail).toContainText("Fixture salary cash");
  await expect(detail).toContainText("Журнал #903");
  const bankSection = page.getByTestId("cash-detail-bank");
  await expect(bankSection).toContainText("Fixture Bank");
  await expect(bankSection).toContainText("MN-FIXTURE-OWN-ACCOUNT-ONLY");
  await expect(bankSection).toContainText("Fixture recipient account");
  await expect(bankSection).toContainText("Fixture counterparty");
  await expect(bankSection).toContainText("Fixture bank salary payment");
  await expect(bankSection).toContainText(`${date} 17:18:19`);
  await expect(bankSection).toContainText("1,234.56");
  await expect(bankSection).toContainText("0.00 ₮");
  await expect(page.getByTestId("modal").getByRole("button", { name: /Журнал бичих|Устгах|Засах|Холбоос салгах/ })).toHaveCount(0);
  await page.getByTestId("button-close-cash-detail").click();
  await expect(detail).toHaveCount(0);
  expect(state.calls()).toBe(1);
  expect(state.writes()).toBe(0);
});

test("unlinked income shows its cash facts and explicit no-link state", async ({ page }) => {
  await setup(page, "unlinked");
  await page.getByTestId("button-view-cash-901").click();
  await expect(page.getByTestId("cash-transaction-detail")).toContainText("Хамаарах сар");
  await expect(page.getByTestId("cash-transaction-detail")).toContainText("Гараар оруулсан");
  await expect(page.getByTestId("cash-transaction-detail")).toContainText("Журналгүй");
  await expect(page.getByTestId("cash-detail-unlinked")).toBeVisible();
  await expect(page.getByTestId("cash-detail-bank")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("modal")).toHaveCount(0);
});

test("error is visible, retry loads facts and never sends mutations", async ({ page }) => {
  const state = await setup(page, "retry");
  await page.getByTestId("button-view-cash-901").click();
  await expect(page.getByTestId("cash-detail-error")).toContainText("Fixture detail temporarily unavailable");
  await page.getByTestId("button-retry-cash-detail").click();
  await expect(page.getByTestId("cash-detail-bank")).toBeVisible();
  expect(state.calls()).toBe(2);
  expect(state.writes()).toBe(0);
});

test("missing linked bank displays the actual error rather than stale or misleading cash facts", async ({ page }) => {
  await setup(page, "missing");
  await page.getByTestId("button-view-cash-901").click();
  await expect(page.getByTestId("cash-detail-error")).toContainText("Холбогдсон банкны гүйлгээ олдсонгүй");
  await expect(page.getByTestId("cash-transaction-detail")).toHaveCount(0);
  await expect(page.getByTestId("cash-detail-bank")).toHaveCount(0);
  await page.getByTestId("button-close-modal").click();
});

test("immediate reopening hides cached link until fresh details arrive", async ({ page }) => {
  const state = await setup(page, "reopen");
  await page.getByTestId("button-view-cash-901").click();
  await expect(page.getByTestId("cash-detail-bank")).toBeVisible();
  await page.getByTestId("button-close-cash-detail").click();
  await page.getByTestId("button-view-cash-901").click();
  await expect.poll(state.calls).toBe(2);
  await expect(page.getByTestId("cash-detail-loading")).toBeVisible();
  await expect(page.getByTestId("cash-detail-bank")).toHaveCount(0);
  await expect(page.getByTestId("cash-transaction-detail")).toHaveCount(0);
  state.release();
  await expect(page.getByTestId("cash-transaction-detail")).toContainText("Fresh cash after unlink");
  await expect(page.getByTestId("cash-detail-unlinked")).toBeVisible();
  expect(state.writes()).toBe(0);
});

test("402px phone keeps view action and all detail facts inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await setup(page);
  const button = page.getByTestId("button-view-cash-901");
  const buttonBox = await button.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(402);
  await button.click();
  await expect(page.getByTestId("cash-detail-bank")).toBeAttached();
  const modal = page.getByTestId("modal");
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByTestId("button-close-cash-detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/cash-details-phone.png" });
  await page.getByTestId("button-close-cash-detail").click();
  await expect(modal).toHaveCount(0);
});
