import { test, expect, type Page } from "@playwright/test";
import type { InventoryItem, InventoryOpeningBalance, InventoryPurchase } from "@workspace/api-zod";

const items: InventoryItem[] = [95001, 95002, 95003].map(id => ({
  id, name: `History item ${id}`, category: "Тест", materialType: "food",
  unit: "кг", quantity: 3, totalValue: 3000, purchaseDocumentNumbers: id === 95001 ? ["2098/12/02/001"] : [],
  createdAt: "2098-12-01T00:00:00Z",
}));
const purchase = (id: number, date: string, item = items[0]): InventoryPurchase => ({
  id, date, materialType: "food", supplierName: "Тест нийлүүлэгч",
  documentNumber: `${date.replaceAll("-", "/")}/${String(id - 96000 + 1).padStart(3, "0")}`,
  accountId: null, accountCode: null, accountName: null, hasReceipt: false,
  totalAmount: 30000, paid: false, paymentGroupBankTransactionId: null,
  createdAt: `${date}T00:00:00Z`, editable: true,
  items: [{ id, inventoryItemId: item.id, name: item.name, category: item.category,
    unit: item.unit, quantity: 2, unitPrice: 15000, totalAmount: 30000 }],
});
const purchases = [
  ...Array.from({ length: 16 }, (_, i) => purchase(96000 + i, "2099-01-02")),
  { ...purchase(96016, "2098-12-02"), materialType: "supply" as const },
  purchase(96017, "2099-01-02", items[2]),
];
const openings: InventoryOpeningBalance[] = items.slice(0, 2).map((item, i) => ({
  id: 97000 + i, inventoryItemId: item.id, materialType: "food", name: item.name,
  category: item.category, unit: item.unit, date: "2098-12-01",
  quantity: 10, remainingQuantity: 3, unitPrice: 1000, totalAmount: 10000,
  editable: false, createdAt: "2098-12-01T00:00:00Z",
}));

async function mockApi(page: Page, failOpening?: () => boolean) {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/inventory/opening-balances" && failOpening?.()) {
      return route.fulfill({ status: 503, json: { error: "Test unavailable" } });
    }
    return route.fulfill({ json: path === "/api/auth/me"
      ? { authenticated: true, id: 1, username: "history-ui-test", role: "admin" }
      : path === "/api/inventory/items" ? items
      : path === "/api/inventory/purchases" ? purchases
      : path === "/api/inventory/opening-balances" ? openings : [] });
  });
  await page.goto("/inventory");
  await page.getByTestId("tab-inventory-stock").click();
  await page.getByTestId("tab-inventory-material-food").click();
}

test("item history ignores purchase month, type and pagination; shows distinct opening entries", async ({ page }) => {
  await mockApi(page);
  await page.getByTestId("tab-inventory-purchases").click();
  await page.getByTestId("input-inventory-purchase-month").fill("2099-01");
  await expect(page.getByTestId("text-inventory-purchase-document-96000")).toHaveText("2099/01/02/001");
  await page.getByTestId("tab-inventory-stock").click();
  await page.getByTestId("row-inventory-stock-95001").click();
  const history = page.getByTestId("inventory-item-history");
  await expect(history.locator('[data-testid^="row-inventory-item-purchase-"]')).toHaveCount(17);
  await expect(history.getByTestId("row-inventory-item-purchase-96016").locator("time")).toHaveAttribute("datetime", "2098-12-02");
  await expect(history.getByTestId("row-inventory-item-purchase-96017")).toHaveCount(0);
  await expect(history.getByTestId("row-inventory-item-opening-97000")).toContainText("10,000");
  await expect(history.getByTestId("row-inventory-item-opening-97001")).toHaveCount(0);
  await expect(history.getByTestId("inventory-item-history-opening").getByRole("heading")).toHaveText("Эхний үлдэгдэл");
  await expect(history.getByTestId("inventory-item-history-purchase").getByRole("heading")).toContainText("бүх сар");
  await expect(history.getByTestId("row-inventory-item-purchase-96016")).toContainText("2098/12/02/017");
});

test("opening-only item on phone shows opening provenance without another item's purchases", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await mockApi(page);
  await expect(page.getByTestId("text-inventory-stock-documents-95001")).toHaveText("2098/12/02/001");
  await page.getByTestId("row-inventory-stock-95001").click();
  await expect(page.getByTestId("row-inventory-item-purchase-96016")).toBeVisible();
  await page.getByTestId("button-close-modal").click();
  await page.getByTestId("row-inventory-stock-95002").click();
  const history = page.getByTestId("inventory-item-history");
  await expect(history.getByTestId("row-inventory-item-opening-97001")).toBeVisible();
  await expect(history.locator('[data-testid^="row-inventory-item-purchase-"]')).toHaveCount(0);
  await expect(history.getByTestId("inventory-item-history-purchase")).toContainText("Худалдан авалт бүртгэгдээгүй.");
  await expect(history).toContainText("Эхний үлдэгдэл нь худалдан авалт биш.");
  await page.getByTestId("button-close-modal").click();
  await page.getByTestId("tab-inventory-purchases").click();
  await page.getByTestId("input-inventory-purchase-month").fill("2099-01");
  await expect(page.getByTestId("text-inventory-purchase-mobile-document-96000")).toHaveText("2099/01/02/001");
});

test("failed opening-history request shows retry, not a false empty history", async ({ page }) => {
  let failing = true;
  await mockApi(page, () => failing);
  await page.getByTestId("row-inventory-stock-95002").click();
  const openingSection = page.getByTestId("inventory-item-history-opening");
  await expect(openingSection.getByTestId("button-retry")).toBeVisible({ timeout: 20000 });
  await expect(openingSection).not.toContainText("Эхний үлдэгдэл бүртгэгдээгүй.");
  failing = false;
  await openingSection.getByTestId("button-retry").click();
  await expect(openingSection.getByTestId("row-inventory-item-opening-97001")).toBeVisible();
});
