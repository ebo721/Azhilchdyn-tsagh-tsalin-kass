import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import {
  bankTransactionsTable,
  cashTransactionsTable,
  db,
  operatingExpensesTable,
} from "@workspace/db";

const roles = [
  { username: "admin", passwordVariable: "ADMIN_PASSWORD", canSeeExpenseMenu: true },
  { username: "saacc", passwordVariable: "ACCOUNTANT_PASSWORD", canSeeExpenseMenu: true },
  { username: "sahr", passwordVariable: "HR_MANAGER_PASSWORD", canSeeExpenseMenu: false },
  { username: "satre", passwordVariable: "WAREHOUSE_PASSWORD", canSeeExpenseMenu: false },
  { username: "sasta", passwordVariable: "SASTA_PASSWORD", canSeeExpenseMenu: false },
] as const;

async function login(page: Page, username: string, passwordVariable: string) {
  const password = process.env[passwordVariable];
  if (!password) throw new Error(`${passwordVariable} must be configured to run operating-expenses e2e tests`);

  await page.goto("/");
  await page.getByTestId("input-login-username").fill(username);
  await page.getByTestId("input-login-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("navigation-sidebar")).toBeVisible();
}

async function logout(page: Page) {
  await page.getByTestId("button-logout").click();
  await expect(page.getByTestId("button-login")).toBeVisible();
}

test.describe("operating expense payments", () => {
  test("shows the menu only to permitted roles", async ({ page }) => {
    for (const role of roles) {
      await login(page, role.username, role.passwordVariable);
      const menu = page.getByTestId("link-nav-Үйл ажиллагааны зардал");
      if (role.canSeeExpenseMenu) await expect(menu).toBeVisible();
      else await expect(menu).toHaveCount(0);
      await logout(page);
    }
  });

  test("creates, edits, pays from a bank suggestion, and cancels payment", async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalDescription = `E2E expense ${suffix}`;
    const updatedDescription = `E2E expense updated ${suffix}`;
    const bankFingerprint = `operating-expense-e2e-${suffix}`;
    const bankDate = "2099-08-17";
    const bankAmount = 987_654;
    let expenseId: number | undefined;
    let bankId: number | undefined;

    try {
      const [bank] = await db.insert(bankTransactionsTable).values({
        transactionAt: new Date(`${bankDate}T09:30:00.000Z`),
        type: "expense",
        amount: bankAmount,
        counterparty: `E2E vendor ${suffix}`,
        description: updatedDescription,
        fingerprint: bankFingerprint,
      }).returning({ id: bankTransactionsTable.id });
      bankId = bank.id;

      await login(page, "admin", "ADMIN_PASSWORD");
      await page.getByTestId("link-nav-Үйл ажиллагааны зардал").click();
      await expect(page.getByTestId("heading-page")).toHaveText("Үйл ажиллагааны зардал");

      await page.getByTestId("button-add-expense").click();
      await page.getByTestId("input-expense-description").fill(originalDescription);
      await page.getByTestId("input-expense-category").fill("E2E ангилал");
      await page.getByTestId("input-expense-date").fill(bankDate);
      await page.getByTestId("input-expense-amount").fill(String(bankAmount));
      await page.getByTestId("button-save-expense").click();
      await expect(page.getByText(originalDescription, { exact: true })).toBeVisible();

      const [created] = await db.select({ id: operatingExpensesTable.id })
        .from(operatingExpensesTable)
        .where(eq(operatingExpensesTable.description, originalDescription));
      expect(created).toBeTruthy();
      expenseId = created.id;

      await page.getByTestId(`button-edit-expense-${expenseId}`).click();
      await page.getByTestId("input-expense-description").fill(updatedDescription);
      await page.getByTestId("button-save-expense").click();
      await expect(page.getByText(updatedDescription, { exact: true })).toBeVisible();

      await page.getByTestId(`button-pay-expense-${expenseId}`).click();
      await page.getByTestId(`radio-expense-bank-suggestion-${bankId}`).click();

      const paymentDate = page.getByTestId("input-expense-payment-date");
      const paymentAmount = page.getByTestId("input-expense-payment-amount");
      await expect(paymentDate).toHaveValue(bankDate);
      await expect(paymentAmount).toHaveValue(String(bankAmount));
      await expect(paymentDate).toBeDisabled();
      await expect(paymentAmount).toBeDisabled();

      await page.getByTestId("button-confirm-expense-payment").click();
      await expect(page.getByTestId(`status-paid-expense-${expenseId}`)).toBeVisible();

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByTestId(`button-cancel-payment-expense-${expenseId}`).click();
      await expect(page.getByTestId(`status-unpaid-expense-${expenseId}`)).toBeVisible();
      await expect(page.getByTestId(`button-pay-expense-${expenseId}`)).toBeVisible();
    } finally {
      if (expenseId) {
        await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.sourceKey, `expense:${expenseId}`));
        await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, expenseId));
      } else {
        await db.delete(operatingExpensesTable).where(like(operatingExpensesTable.description, `%${suffix}`));
      }
      if (bankId) {
        await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null })
          .where(and(eq(bankTransactionsTable.id, bankId), eq(bankTransactionsTable.fingerprint, bankFingerprint)));
        await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
      }
    }
  });
});