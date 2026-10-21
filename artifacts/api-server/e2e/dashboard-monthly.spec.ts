import { test, expect } from "@playwright/test";

const amount = (value: number) => `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(value)} ₮`;
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.ADMIN_PASSWORD, "Requires the development admin secret");
  const response = await page.request.post("/api/auth/login", {
    data: { username: "admin", password: process.env.ADMIN_PASSWORD },
  });
  expect(response.status()).toBe(200);
});

test("monthly statistics use the selected API month and preserve payroll when navigating", async ({ page }, testInfo) => {
  const month = new Date().toISOString().slice(0, 7);
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && request.url().includes("/payroll")) writes.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByTestId("input-dashboard-month")).toHaveValue(month);
  const response = await page.request.get(`/api/dashboard?month=${month}`);
  expect(response.status()).toBe(200);
  const data = await response.json();
  for (const [id, value] of [
    ["sales", data.salesIncome], ["inventory", data.inventoryPurchaseTotal],
    ["supply", data.supplyPurchaseTotal], ["operating", data.operatingExpenseTotal],
  ] as const) await expect(page.getByTestId(`value-dashboard-${id}`)).toHaveText(amount(value));
  await expect(page.getByTestId("value-dashboard-payroll")).toHaveText(data.payrollGross === null ? "Тооцоогүй" : amount(data.payrollGross));
  await expect(page.getByTestId("value-dashboard-office-payroll")).toHaveText(data.officePayrollGross === null ? "Тооцоогүй" : amount(data.officePayrollGross));
  for (const shift of data.payrollByShift) {
    await expect(page.getByTestId(`row-dashboard-shift-${shift.shiftId ?? "unassigned"}`)).toContainText(amount(shift.gross));
  }
  await page.screenshot({ path: testInfo.outputPath("dashboard-desktop.png"), fullPage: true });
  await page.getByTestId("input-dashboard-month").fill("2099-12");
  await expect(page.getByTestId("value-dashboard-payroll")).toHaveText("Тооцоогүй");
  await expect(page.locator('a[href="/payroll?month=2099-12"]')).toBeVisible();
  await page.getByTestId("button-dashboard-next-month").click();
  await expect(page.getByTestId("input-dashboard-month")).toHaveValue("2100-01");
  await expect(page.getByTestId("value-dashboard-sales")).toHaveText(amount(0));
  await page.getByTestId("button-dashboard-previous-month").click();
  await expect(page.getByTestId("input-dashboard-month")).toHaveValue("2099-12");
  await expect(page.getByTestId("value-dashboard-payroll")).toHaveText("Тооцоогүй");
  await page.reload();
  await expect(page.getByTestId("input-dashboard-month")).toHaveValue(month);
  await expect(page.getByTestId("value-dashboard-payroll")).toHaveText(data.payrollGross === null ? "Тооцоогүй" : amount(data.payrollGross));
  expect(writes).toEqual([]);
});

test("phone layout has no horizontal overflow and keeps month controls usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("value-dashboard-sales")).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  await expect(page.getByTestId("button-dashboard-previous-month")).toBeVisible();
  await expect(page.getByTestId("button-dashboard-next-month")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dashboard-phone.png"), fullPage: true });
  const original = await page.getByTestId("input-dashboard-month").inputValue();
  await page.getByTestId("button-dashboard-previous-month").click();
  await expect(page.getByTestId("input-dashboard-month")).not.toHaveValue(original);
  await expect(page.getByTestId("value-dashboard-sales")).toBeVisible();
});

test("saved gross office and shift breakdown renders without recalculation, with stale and closed status", async ({ page }) => {
  const current = new Date().toISOString().slice(0, 7);
  const seed = await (await page.request.get(`/api/dashboard?month=${current}`)).json();
  let status = "stale";
  await page.route("**/api/dashboard?*", async route => {
    const month = new URL(route.request().url()).searchParams.get("month");
    await route.fulfill({ json: { ...seed, month, payrollGross: 1200, officePayrollGross: 800,
      payrollStatus: status, payrollByShift: [
        { shiftId: 1, shiftName: "1-р ээлж", gross: 300 },
        { shiftId: null, shiftName: "Ээлж тодорхойгүй", gross: 100 },
      ] } });
  });
  await page.goto("/");
  await expect(page.getByTestId("value-dashboard-payroll")).toHaveText(amount(1200));
  await expect(page.getByTestId("value-dashboard-office-payroll")).toHaveText(amount(800));
  await expect(page.getByTestId("row-dashboard-shift-1")).toContainText(amount(300));
  await expect(page.getByTestId("row-dashboard-shift-unassigned")).toContainText(amount(100));
  await expect(page.getByText("Шинэчлэх шаардлагатай", { exact: true })).toBeVisible();
  status = "closed";
  await page.reload();
  await expect(page.getByText("Сар хаагдсан", { exact: true })).toBeVisible();
});
