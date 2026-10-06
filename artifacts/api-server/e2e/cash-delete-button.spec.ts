import { expect, test } from "@playwright/test";

for (const mode of ["delete", "cancel", "request", "closed"] as const) {
  test(`manual cash delete button: ${mode}`, async ({ page }) => {
    const date = new Date().toISOString().slice(0, 10);
    const manual = {
      id: 801, type: "expense", category: "Бусад", description: "Manual cash fixture",
      amount: 1000, date, incomeMonth: null, sourceType: null, sourceKey: null,
      accountId: null, accountCode: null, accountName: null, subcategory: "Бусад",
      editable: true, transactionKind: "manual", bankTransactionId: null,
      bankVerifiedAt: null, journalEntryId: null, createdAt: `${date}T00:00:00Z`,
    };
    const rows = [
      manual,
      { ...manual, id: 802, description: "Salary fixture", editable: false, transactionKind: "payroll", sourceType: "payroll" },
      { ...manual, id: 803, description: "Bank fixture", editable: false, transactionKind: "bank_transaction", bankTransactionId: 303 },
    ];
    let deletes = 0;
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: mode === "request" ? "accountant" : "admin" } });
      if (path === "/api/cash/transactions/801" && request.method() === "DELETE") {
        expect(mode).toBe("delete");
        deletes++;
        rows.splice(rows.findIndex((row) => row.id === 801), 1);
        return route.fulfill({ status: 204 });
      }
      if (path === "/api/deletion-requests" && request.method() === "POST") {
        expect(mode).toBe("request");
        expect(request.postDataJSON().targetPath).toBe("/cash/transactions/801");
        requests++;
        return route.fulfill({ status: 201, json: { id: 1, status: "pending", targetPath: "/cash/transactions/801" } });
      }
      if (path === "/api/cash/transactions" && request.method() === "GET") return route.fulfill({ json: rows });
      if (path === "/api/cash/closures") return route.fulfill({ json: mode === "closed" ? [{ id: 1, date, closedAt: `${date}T00:00:00Z` }] : [] });
      if (path === "/api/cash/summary") return route.fulfill({ json: { balance: -3000, income: 0, expense: 3000, todayIncome: 0, todayExpense: 3000 } });
      if (request.method() !== "GET") throw new Error(`Unexpected mutation ${request.method()} ${path}`);
      return route.fulfill({ json: [] });
    });
    page.on("dialog", (dialog) => mode === "cancel" && dialog.type() === "confirm" ? dialog.dismiss() : dialog.accept());
    await page.goto("/cash");
    const button = page.getByTestId("button-delete-cash-801");
    await expect(button).toHaveText("Устгах");
    await expect(page.getByTestId("button-delete-cash-802")).toHaveCount(0);
    await expect(page.getByTestId("button-delete-cash-803")).toHaveCount(0);
    if (mode === "closed") {
      await expect(button).toBeDisabled();
    } else {
      await button.click();
      if (mode === "delete") {
        await expect(page.getByTestId("row-cash-801")).toHaveCount(0);
        expect(deletes).toBe(1);
        await page.reload();
        await expect(page.getByTestId("row-cash-801")).toHaveCount(0);
      } else if (mode === "request") {
        await expect.poll(() => requests).toBe(1);
        await expect(page.getByTestId("row-cash-801")).toBeVisible();
      } else {
        await expect(page.getByTestId("row-cash-801")).toBeVisible();
      }
    }
    if (mode !== "delete") expect(deletes).toBe(0);
    if (mode !== "request") expect(requests).toBe(0);
  });
}
