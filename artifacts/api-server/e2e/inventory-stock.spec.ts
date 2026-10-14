import { test, expect } from "@playwright/test";

test("stock list hides empty items without removing them from purchase choices", async ({ page }) => {
  const items = [
    { id: 91001, name: "Үлдэгдэлтэй хүнс", materialType: "food", quantity: 0.001 },
    { id: 91002, name: "Худалдан аваагүй хүнс", materialType: "food", quantity: 0 },
    { id: 91003, name: "Дууссан хүнс", materialType: "food", quantity: 0 },
    { id: 91004, name: "Үлдэгдэлтэй материал", materialType: "supply", quantity: 3 },
    { id: 91005, name: "Худалдан аваагүй материал", materialType: "supply", quantity: 0 },
  ].map(item => ({ ...item, category: "Тест", unit: "кг", totalValue: item.quantity * 100, createdAt: "2026-10-13T00:00:00Z" }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path === "/api/auth/me"
        ? { authenticated: true, id: 1, username: "stock-ui-test", role: "admin" }
        : path === "/api/inventory/items" ? items : [],
    });
  });
  await page.goto("/inventory");
  await page.getByTestId("tab-inventory-stock").click();
  await page.getByTestId("tab-inventory-material-food").click();
  await expect(page.getByTestId("row-inventory-stock-91001")).toBeVisible();
  await expect(page.getByTestId("row-inventory-stock-91002")).toHaveCount(0);
  await expect(page.getByTestId("row-inventory-stock-91003")).toHaveCount(0);
  await page.getByTestId("input-search-inventory-stock").fill("Худалдан аваагүй");
  await expect(page.getByTestId("row-inventory-stock-91002")).toHaveCount(0);
  await expect(page.getByText("Бараа материал олдсонгүй", { exact: true })).toBeVisible();
  await page.getByTestId("input-search-inventory-stock").fill("");
  await page.getByTestId("tab-inventory-material-supply").click();
  await expect(page.getByTestId("row-inventory-stock-91004")).toBeVisible();
  await expect(page.getByTestId("row-inventory-stock-91005")).toHaveCount(0);
  await page.getByTestId("tab-inventory-purchases").click();
  await page.getByTestId("button-add-inventory-purchase").click();
  await expect(page.locator("#inventory-catalog-options option[value='Худалдан аваагүй материал']")).toHaveCount(1);
});
