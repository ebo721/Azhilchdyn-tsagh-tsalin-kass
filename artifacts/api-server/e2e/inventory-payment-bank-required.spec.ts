import { test, expect } from "@playwright/test";

for (const width of [402, 1440]) {
  test(`${width}px: payment requires bank selection and linking automatically marks paid`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const purchase = {
      id: 99300, documentNumber: "2098/06/14/001", materialType: "food",
      accountId: 1, accountCode: "1500", accountName: "Хүнс", supplierName: "Банкны баталгаа",
      hasReceipt: true, date: "2098-06-14", totalAmount: 100, paid: false,
      paymentDate: null as string | null, paymentAmount: null as number | null,
      paymentGroupBankTransactionId: null, bankConnection: null as unknown,
      createdAt: "2098-06-14T00:00:00Z", editable: false, items: [],
    };
    const bank = { id: 99301, transactionAt: "2098-06-15T09:00:00Z", amount: 100, description: "Хүнсний төлбөр", score: 100 };
    let requests = 0;
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/inventory/purchases/${purchase.id}/payment`) {
        expect(route.request().postDataJSON()).toEqual({ date: "2098-06-15", amount: 100, bankTransactionId: bank.id });
        requests++;
        purchase.paid = true;
        purchase.paymentDate = "2098-06-15";
        purchase.paymentAmount = 100;
        purchase.bankConnection = { ...bank, account: "Тест данс", kind: "single" };
        return route.fulfill({ json: purchase });
      }
      return route.fulfill({ json:
        path === "/api/auth/me" ? { authenticated: true, id: 1, username: "bank-required-ui", role: "admin" } :
        path === "/api/inventory/purchases" ? [purchase] :
        path.endsWith("/payment-bank-suggestions") ? [bank] : [],
      });
    });
    await page.goto("/inventory");
    await page.getByTestId("tab-inventory-purchases").click();
    await page.getByTestId("tab-inventory-material-food").click();
    await page.getByTestId("input-inventory-purchase-month").fill("2098-06");
    const row = page.getByTestId(`inventory-purchase-${width < 768 ? "mobile-" : ""}${purchase.id}`);
    await row.getByRole("checkbox").click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByTestId("button-confirm-inventory-payment");
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText("Банкны гүйлгээ заавал сонгоно");
    await expect(dialog.getByText("Банкгүйгээр батлах", { exact: true })).toHaveCount(0);
    for (const field of ["date", "amount"]) await expect(dialog.getByTestId(`input-inventory-payment-${field}`)).toHaveAttribute("readonly", "");
    expect(requests).toBe(0);
    await dialog.getByTestId(`button-select-inventory-bank-${bank.id}`).click();
    await expect(confirm).toBeEnabled();
    await expect(dialog.getByTestId("input-inventory-payment-date")).toHaveValue("2098-06-15");
    await expect(dialog.getByTestId("input-inventory-payment-amount")).toHaveValue("100");
    await dialog.getByRole("button", { name: "Сонголт арилгах" }).click();
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByTestId("input-inventory-payment-date")).toHaveValue("");
    await dialog.getByTestId(`button-select-inventory-bank-${bank.id}`).click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByRole("checkbox")).toBeChecked();
    await expect(row).toContainText("Банктай холбогдсон");
    expect(requests).toBe(1);
  });
}
