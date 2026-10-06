import { test, expect } from "@playwright/test";

for (const mode of ["restore", "unlink", "cancel", "error"] as const) {
  test(`bank-cash correction UI: ${mode}`, async ({ page }) => {
    const date = new Date().toISOString().slice(0, 10);
    const row = {
      id: 851, type: "expense", amount: 1000, date, incomeMonth: null,
      category: "salary", description: "Linked salary fixture", accountId: 6,
      accountCode: "6900", accountName: "Бусад", subcategory: null,
      sourceType: "payroll", sourceKey: `${date.slice(0, 7)}:99`, transactionKind: "payroll",
      editable: false, bankTransactionId: 15 as number | null,
      bankVerifiedAt: `${date}T00:00:00Z` as string | null,
      journalEntryId: (mode === "restore" ? null : 77) as number | null,
      createdAt: `${date}T00:00:00Z`,
    };
    let actions = 0;
    const alerts: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "accountant" } });
      if (path === "/api/cash/transactions") return route.fulfill({ json: [row] });
      if (path === "/api/chart-of-accounts") return route.fulfill({ json: [{ id: 6, code: "6900", name: "Бусад", type: "expense", isActive: true }] });
      if (path === "/api/cash/summary") return route.fulfill({ json: { balance: -1000, income: 0, expense: 1000, todayIncome: 0, todayExpense: 1000 } });
      if (path === "/api/bank-transactions/15/restore-cash-journal") {
        expect(mode).toBe("restore");
        expect(request.method()).toBe("POST");
        expect(request.postDataJSON()).toEqual({ accountId: 6 });
        actions++;
        row.journalEntryId = 78;
        return route.fulfill({ json: { bankTransactionId: 15, cashTransactionId: 851, journalEntryId: 78 } });
      }
      if (path === "/api/bank-transactions/15/unlink-cash") {
        expect(request.method()).toBe("POST");
        actions++;
        if (mode === "error") return route.fulfill({ status: 409, json: { error: "Өндөрлөсөн өдрийн холбоос өөрчлөх боломжгүй." } });
        row.bankTransactionId = null;
        row.bankVerifiedAt = null;
        row.journalEntryId = null;
        return route.fulfill({ json: { bankTransactionId: 15, cashTransactionId: 851, voidedJournalEntryId: 77, reversalJournalEntryId: 79 } });
      }
      if (request.method() !== "GET") throw new Error(`Unexpected mutation ${request.method()} ${path}`);
      return route.fulfill({ json: [] });
    });
    page.on("dialog", (dialog) => {
      if (dialog.type() === "alert") alerts.push(dialog.message());
      return mode === "cancel" && dialog.type() === "confirm" ? dialog.dismiss() : dialog.accept();
    });
    await page.goto("/cash");
    if (mode === "restore") {
      await page.getByTestId("button-post-cash-journal-851").click();
      await expect(page.getByTestId("form-post-cash-journal")).toBeVisible();
      await expect(page.getByText("Тохирох банкны гүйлгээ", { exact: true })).toHaveCount(0);
      await page.getByTestId("select-cash-journal-account").selectOption("6");
      await page.getByTestId("button-confirm-cash-journal").click();
      await expect(page.getByTestId("form-post-cash-journal")).toHaveCount(0);
      await expect(page.getByTestId("badge-cash-journal-851")).toContainText("#78");
      expect(row.bankTransactionId).toBe(15);
      await page.reload();
      await expect(page.getByTestId("badge-cash-journal-851")).toContainText("#78");
      await expect(page.getByTestId("button-unlink-bank-cash-851")).toBeVisible();
    } else {
      await page.getByTestId("button-unlink-bank-cash-851").click();
      if (mode === "unlink") {
        await expect(page.getByTestId("button-unlink-bank-cash-851")).toHaveCount(0);
        await expect(page.getByTestId("button-post-cash-journal-851")).toHaveText("Журнал бичих");
        await page.reload();
        await expect(page.getByTestId("button-unlink-bank-cash-851")).toHaveCount(0);
        expect(row.sourceKey).toBe(`${date.slice(0, 7)}:99`);
      } else if (mode === "error") {
        await expect.poll(() => alerts.length).toBe(1);
        await expect(page.getByTestId("badge-cash-journal-851")).toContainText("#77");
      } else {
        expect(actions).toBe(0);
        expect(row.bankTransactionId).toBe(15);
      }
    }
    expect(actions).toBe(mode === "cancel" ? 0 : 1);
    expect(row.amount).toBe(1000);
  });
}
