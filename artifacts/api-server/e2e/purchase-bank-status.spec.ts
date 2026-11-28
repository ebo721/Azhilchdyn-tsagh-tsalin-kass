import { test, expect } from "@playwright/test";

for (const width of [402, 1440]) {
  test(`${width}px: distinguish bank links from paid status, filter and inspect details`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const connection = (id: number, kind: string) => ({
      id, kind, transactionAt: "2098-06-15T09:00:00Z", amount: 900,
      description: "Банкны төлбөрийн утга", account: "Тест банкны данс",
    });
    const purchases = Array.from({ length: 24 }, (_, i) => ({
      id: 99200 + i, documentNumber: `2098/06/14/${String(i + 1).padStart(3, "0")}`,
      materialType: "food", accountId: 1, accountCode: "1500", accountName: "Хүнс",
      supplierName: i === 0 ? "Банк шууд" : i === 1 ? "Банк багц" : i === 2 ? "Бэлнээр төлсөн" : `Холбоогүй ${i}`,
      hasReceipt: true, date: "2098-06-14", totalAmount: 100, paid: i < 3,
      paymentDate: i < 3 ? "2098-06-15" : null, paymentAmount: i < 3 ? 100 : null,
      paymentGroupBankTransactionId: i === 1 ? 99101 : null,
      bankConnection: i < 2 ? connection(99100 + i, i === 0 ? "single" : "group") : null,
      createdAt: "2098-06-14T00:00:00Z", editable: false, items: [],
    }));
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json:
        path === "/api/auth/me" ? { authenticated: true, id: 1, username: "bank-status-ui", role: "admin" } :
        path === "/api/inventory/purchases" ? purchases : [],
      });
    });
    await page.goto("/inventory?section=purchases");
    await page.getByTestId("tab-inventory-material-food").click();
    await page.getByTestId("input-inventory-purchase-month").fill("2098-06");
    const row = (id: number) => page.getByTestId(`inventory-purchase-${width < 768 ? "mobile-" : ""}${id}`);
    await expect(row(99200)).toContainText("Банктай холбогдсон");
    await expect(row(99201)).toContainText("Багц төлбөр");
    await expect(row(99202)).toContainText("Банктай холбогдоогүй");
    await expect(row(99202).getByTestId("status-inventory-payment-99202")).toHaveText("Төлсөн");
    await page.getByTestId("button-inventory-purchases-next").click();
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
    const filter = page.getByTestId("filter-purchase-bank-link");
    await page.getByTestId("button-inventory-purchase-filters").click();
    await filter.selectOption("linked");
    await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
    await expect(row(99200)).toBeVisible();
    await expect(row(99201)).toBeVisible();
    await expect(row(99202)).toHaveCount(0);
    await expect(page.getByTestId("value-inventory-purchase-total")).toContainText("200");
    await row(99201).getByTestId("button-actions-inventory-99201").click();
    await page.getByTestId("button-view-inventory-99201").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Банк #99101");
    await expect(dialog).toContainText("Банкны нийт дүн");
    await expect(dialog).toContainText("900");
    await expect(dialog).toContainText("Банкны төлбөрийн утга");
    await expect(dialog).toContainText("Тест банкны данс");
    await page.keyboard.press("Escape");
    await filter.selectOption("unlinked");
    await expect(row(99200)).toHaveCount(0);
    await expect(row(99201)).toHaveCount(0);
    await expect(row(99202)).toBeVisible();
    await expect(page.getByTestId("value-inventory-purchase-total")).toContainText("2,200");
    await row(99202).getByTestId("button-actions-inventory-99202").click();
    await page.getByTestId("button-view-inventory-99202").click();
    await expect(dialog).toContainText("Өмнө нь банкны холбоосгүй баталсан төлбөр");
    await page.keyboard.press("Escape");
    // Pending registrations remain available independently of the main list filter.
    await page.getByTestId("button-open-pending-purchases").click();
    await expect(page.getByTestId("pending-purchases-empty")).toBeVisible();
  });
}
