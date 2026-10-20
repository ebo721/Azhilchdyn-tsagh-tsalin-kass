import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, bankAccountsTable, bankTransactionsTable, bankInternalTransfersTable, cashTransactionsTable } from "@workspace/db";
import { createStaffSession, hrCookie } from "../src/lib/hr-session.js";

test.afterAll(async () => { await pool.end(); });
for (const phone of [false, true]) {
  test(`${phone ? "phone bank list" : "desktop journal review"} pairs and unpairs an internal transfer without accounting`, async ({ page, context, baseURL }) => {
    const prefix = `transfer-ui-${randomUUID()}`;
    const banks: number[] = [], accounts: number[] = [];
    let userId = 0;
    try {
      const [user] = await db.insert(usersTable).values({
        username: prefix, normalizedUsername: prefix, passwordHash: "unused", role: "accountant",
      }).returning();
      userId = user.id;
      await context.addCookies([{ name: hrCookie.name, value: createStaffSession(user), url: baseURL! }]);
      for (const suffix of ["out", "in"]) {
        const [account] = await db.insert(bankAccountsTable).values({ bankName: prefix, accountNumber: `${prefix}-${suffix}` }).returning();
        accounts.push(account.id);
      }
      for (const [index, type] of ["expense", "income"].entries()) {
        const [bank] = await db.insert(bankTransactionsTable).values({
          type, amount: 123.45, transactionAt: new Date("2097-09-15T09:00:00Z"),
          bankAccountId: accounts[index], description: prefix, fingerprint: randomUUID(),
        }).returning();
        banks.push(bank.id);
      }
      if (phone) await page.setViewportSize({ width: 402, height: 874 });
      await page.goto(phone ? "/bank-transactions" : "/bank-transactions/journal-review");
      if (phone) await page.getByTestId("input-bank-filter-month").fill("2097-09");
      await page.getByTestId(`button-internal-transfer-${banks[0]}`).click();
      await expect(page.getByTestId("dialog-internal-transfer")).toBeVisible();
      await page.getByTestId(`option-transfer-suggestion-${banks[1]}`).click();
      await expect(page.getByTestId("text-transfer-confirm")).toContainText(String(banks[1]));
      // Explicit confirmation, plus a retry that leaves the chosen peer intact.
      const pairPath = `**/api/bank-transactions/${banks[0]}/pair-transfer`;
      await page.route(pairPath, route => route.fulfill({ status: 409, json: { error: "Туршилтын хослолын алдаа" } }));
      await page.getByTestId("button-confirm-internal-transfer").click();
      await expect(page.getByTestId("text-transfer-error")).toContainText("Туршилтын хослолын алдаа");
      await page.unroute(pairPath);
      await page.getByTestId("button-confirm-internal-transfer").click();
      await expect(page.getByTestId("dialog-internal-transfer")).toHaveCount(0);
      await expect(page.getByTestId(`button-internal-transfer-${banks[0]}`)).toHaveCount(0);
      await page.goto(`/bank-transactions?view=paired&transferPeerId=${banks[0]}`);
      await expect(page.getByTestId(`badge-internal-transfer-${banks[0]}`)).toBeVisible();
      await expect(page.getByTestId(`row-bank-transaction-${banks[0]}`)).not.toContainText("Журналд шивэх");
      await page.reload();
      await expect(page.getByTestId(`badge-internal-transfer-${banks[0]}`)).toBeVisible();
      await page.getByTestId(`link-transfer-peer-${banks[0]}`).click();
      await expect(page.getByTestId(`badge-internal-transfer-${banks[1]}`)).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await page.getByTestId(`button-unpair-transfer-${banks[1]}`).click();
      await expect(page.getByTestId(`badge-internal-transfer-${banks[1]}`)).toHaveCount(0);
      await page.goto("/bank-transactions/journal-review");
      await expect(page.getByTestId(`button-internal-transfer-${banks[0]}`)).toBeVisible();
      const persisted = await db.select().from(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
      expect(persisted.every(row => row.cashTransactionId === null && row.journalEntryId === null && row.transferredAt === null)).toBeTruthy();
      expect(await db.select().from(cashTransactionsTable).where(inArray(cashTransactionsTable.bankTransactionId, banks))).toHaveLength(0);
    } finally {
      if (banks.length) {
        await db.delete(bankInternalTransfersTable).where(inArray(bankInternalTransfersTable.outBankTransactionId, banks));
        await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
      }
      if (accounts.length) await db.delete(bankAccountsTable).where(inArray(bankAccountsTable.id, accounts));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });
}
