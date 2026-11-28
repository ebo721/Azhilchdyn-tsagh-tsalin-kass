import { test, expect } from "@playwright/test";

for (const width of [402, 1440]) {
  test(`${width}px: pending purchase suggests existing records and links without new stock input`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let linked = false;
    let fail = true;
    let requests = 0;
    const pending = { id: 99101, date: "2098-06-15", amount: 83.45, description: "Санал шалгах худалдан авалт", bankAccount: "Тест", accountCode: "1500", accountName: "Хүнс", materialType: "food" };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/inventory/pending-purchases/${pending.id}/register`) {
        expect(route.request().postDataJSON()).toEqual({ inventoryPurchaseId: 99102 });
        requests++;
        if (fail) {
          fail = false;
          return route.fulfill({ status: 409, json: { error: "Бүртгэл өөрчлөгдсөн. Дахин сонгоно уу." } });
        }
        linked = true;
        return route.fulfill({ json: { bankTransactionId: pending.id, inventoryPurchaseId: 99102, cashTransactionId: 99103, journalEntryId: 99104 } });
      }
      return route.fulfill({ json:
        path === "/api/auth/me" ? { authenticated: true, id: 1, username: "suggestions-ui", role: "admin" } :
        path === "/api/inventory/pending-purchases" ? linked ? [] : [pending] :
        path.endsWith("/suggestions") ? [
          { id: 99102, documentName: "Ижил дүн, төрөл", date: "2098-06-14", totalAmount: 83.45, materialType: "food", sameAmount: true, sameType: true, linkable: true },
          { id: 99105, documentName: "Зөвхөн ижил төрөл", date: "2098-06-14", totalAmount: 25, materialType: "food", sameAmount: false, sameType: true, linkable: false },
          { id: 99106, documentName: "Зөвхөн ижил дүн", date: "2098-06-14", totalAmount: 83.45, materialType: "supply", sameAmount: true, sameType: false, linkable: false },
        ] : [],
      });
    });
    await page.goto("/inventory?section=purchases");
    await page.getByTestId("tab-inventory-material-food").click();
    await page.getByTestId("input-inventory-purchase-month").fill("2098-06");
    await page.getByTestId("button-open-pending-purchases").click();
    await page.getByTestId(`register-pending-purchase-${pending.id}`).click();
    const section = page.getByRole("region", { name: "Холбох худалдан авалтын санал" });
    await expect(section).toBeVisible();
    await expect(section.getByRole("radio", { name: "Худалдан авалт #99105", exact: true })).toBeDisabled();
    await expect(section.getByRole("radio", { name: "Худалдан авалт #99106", exact: true })).toBeDisabled();
    const button = section.getByRole("button", { name: "Сонгосон худалдан авалттай холбох" });
    await expect(button).toBeDisabled();
    await section.getByRole("radio", { name: "Худалдан авалт #99102", exact: true }).check();
    await button.click();
    await expect(section.getByRole("alert")).toContainText("Бүртгэл өөрчлөгдсөн");
    await expect(section).toBeVisible();
    await button.click();
    await expect(section).toHaveCount(0);
    await expect(page.getByTestId(`pending-purchase-${pending.id}`)).toHaveCount(0);
    await expect(page.getByTestId("pending-inventory-purchases")).toBeVisible();
    await expect(page.getByTestId("pending-purchases-empty")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByTestId("value-pending-purchases-count")).toHaveText("0");
    expect(requests).toBe(2);
  });
}
