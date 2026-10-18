import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, employeesTable, inventorySuppliersTable, chartOfAccountsTable, bankTransactionsTable,
  journalEntriesTable, receivablesTable, payablesTable, receivableAllocationsTable, payableAllocationsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/hr-session.js";
import { postJournalEntry } from "../src/lib/journal-posting.js";

const prefix = `bank-settle-ui-${randomUUID()}`;
const password = "Fixture-password-123";
const users: number[] = [], banks: number[] = [];
const account = new Map<string, number>(), targets: Record<string, number> = {};
let employeeId: number, supplierId: number;

test.beforeAll(async () => {
  for (const role of ["accountant", "viewer"] as const) {
    const [actor] = await db.insert(usersTable).values({
      username: `${prefix}-${role}`, normalizedUsername: `${prefix}-${role}`,
      passwordHash: await hashPassword(password), role, menuPaths: ["/bank-transactions"],
    }).returning();
    users.push(actor.id);
  }
  const [employee] = await db.insert(employeesTable).values({ name: prefix, role: "test", baseSalary: 0 }).returning();
  employeeId = employee.id;
  const [supplier] = await db.insert(inventorySuppliersTable).values({ name: prefix, normalizedName: prefix }).returning();
  supplierId = supplier.id;
  for (const row of await db.select().from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, ["1010", "1200", "2000"]))) account.set(row.code, row.id);
  for (const [name, payable, amount, date] of [
    ["receivable", false, 100.25, "2099-04-01"],
    ["payable", true, 100.25, "2099-04-01"],
    ["retry", false, 100.25, "2099-04-01"],
    ["little", false, 5.25, "2099-04-01"],
    ["future", false, 100.25, "2099-04-20"],
  ] as const) {
    const allocation = payable ? { kind: "create" as const, partyType: "supplier" as const, supplierId }
      : { kind: "create" as const, partyType: "employee" as const, employeeId };
    const entry = await db.transaction(tx => postJournalEntry(tx, {
      date, description: `${prefix} ${name}`, sourceType: "manual", sourceId: null, createdBy: users[0],
      lines: payable
        ? [{ accountId: account.get("1010")!, debit: amount, credit: 0 }, { accountId: account.get("2000")!, debit: 0, credit: amount, allocation }]
        : [{ accountId: account.get("1200")!, debit: amount, credit: 0, allocation }, { accountId: account.get("1010")!, debit: 0, credit: amount }],
    }));
    const [debt] = payable
      ? await db.select({ id: payablesTable.id }).from(payablesTable).where(eq(payablesTable.journalEntryId, entry.journalEntryId))
      : await db.select({ id: receivablesTable.id }).from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, entry.journalEntryId));
    targets[name] = debt.id;
  }
  for (const [type, amount] of [
    ["income", 40.25], ["expense", 100.25], ["income", 30.25],
    ["income", 10], ["income", 10], ["income", 20],
  ] as const) {
    const [bank] = await db.insert(bankTransactionsTable).values({
      type, amount, transactionAt: new Date("2099-04-13T08:23:00Z"),
      account: prefix, counterparty: prefix, description: `${prefix} bank${banks.length}`, fingerprint: randomUUID(),
    }).returning();
    banks.push(bank.id);
  }
});

test.afterAll(async () => {
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(inArray(journalEntriesTable.createdBy, users));
  const ids = entries.map(e => e.id);
  if (banks.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
  if (ids.length) {
    await db.delete(receivableAllocationsTable).where(inArray(receivableAllocationsTable.settlementJournalEntryId, ids));
    await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.settlementJournalEntryId, ids));
    await db.delete(receivablesTable).where(inArray(receivablesTable.originJournalEntryId, ids));
    await db.delete(payablesTable).where(inArray(payablesTable.journalEntryId, ids));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
  }
  if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  if (supplierId) await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, supplierId));
  if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
  await pool.end();
});

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
});

test("bank list applies income to an existing receivable, persists partial balance and hides the action on reload", async ({ page }) => {
  await page.goto("/bank-transactions");
  await page.locator('input[type="month"]').fill("2099-04");
  await page.getByTestId(`settle-bank-debt-${banks[0]}`).click();
  await expect(page.getByTestId("section-bank-ar-ap-fixed").locator("input")).toHaveCount(0);
  await expect(page.getByTestId("text-bank-ar-ap-amount")).toContainText("40.25");
  await page.getByTestId("input-bank-settlement-search").fill(prefix);
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.receivable));
  await expect(page.getByTestId("text-bank-settlement-balance")).toContainText("60 ₮");
  await page.getByTestId("button-submit-bank-settlement").click();
  await expect(page.getByTestId("form-bank-settlement")).toHaveCount(0);
  const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, targets.receivable));
  expect(Number(debt.openAmount)).toBe(60);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[0]));
  const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId!));
  expect(entry.date).toBe("2099-04-13");
  expect(bank.cashTransactionId).toBeNull();
  await page.reload();
  await page.locator('input[type="month"]').fill("2099-04");
  await expect(page.getByTestId(`settle-bank-debt-${banks[0]}`)).toHaveCount(0);
});

test("journal review applies expense to a supplier payable and closes it", async ({ page }) => {
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`settle-bank-debt-${banks[1]}`).click();
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.payable));
  await expect(page.getByTestId("text-bank-settlement-balance")).toContainText("0 ₮");
  await page.getByTestId("button-submit-bank-settlement").click();
  await expect(page.getByTestId("form-bank-settlement")).toHaveCount(0);
  const [debt] = await db.select().from(payablesTable).where(eq(payablesTable.id, targets.payable));
  expect(Number(debt.remainingBalance)).toBe(0);
  expect(debt.status).toBe("closed");
  await page.reload();
  await expect(page.getByTestId(`settle-bank-debt-${banks[1]}`)).toHaveCount(0);
});

test("over-balance and future-origin targets cannot be submitted", async ({ page }) => {
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`settle-bank-debt-${banks[3]}`).click();
  await expect(page.getByTestId("select-bank-settlement-target").locator(`option[value="${targets.future}"]`)).toBeDisabled();
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.little));
  await expect(page.getByTestId("text-bank-settlement-error")).toContainText("их байна");
  await expect(page.getByTestId("button-submit-bank-settlement")).toBeDisabled();
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[3]));
  expect(bank.journalEntryId).toBeNull();
});

test("phone retains selected debt on failure, and retry reduces the balance once", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`settle-bank-debt-${banks[2]}`).click();
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.retry));
  const submit = page.getByTestId("button-submit-bank-settlement");
  const box = await submit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(402);
  const path = `**/api/bank-transactions/${banks[2]}/post-journal`;
  await page.route(path, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture failure" }) }));
  await submit.click();
  await expect(page.getByTestId("text-bank-settlement-server-error")).toContainText("Fixture failure");
  await expect(page.getByTestId("select-bank-settlement-target")).toHaveValue(String(targets.retry));
  await page.unroute(path);
  await submit.click();
  await expect(page.getByTestId("form-bank-settlement")).toHaveCount(0);
  const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, targets.retry));
  expect(Number(debt.openAmount)).toBe(70);
});

test("fast reopen hides cached balances until current debt data arrives", async ({ page }) => {
  await page.goto("/bank-transactions/journal-review");
  const open = page.getByTestId(`settle-bank-debt-${banks[4]}`);
  await open.click();
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.receivable));
  await expect(page.getByTestId("text-bank-settlement-balance")).toBeVisible();
  await page.getByTestId("button-cancel-bank-settlement").click();
  const paid = await page.request.post(`/api/bank-transactions/${banks[5]}/post-journal`, {
    data: { accountId: account.get("1200"), allocation: { kind: "settle", receivableId: targets.receivable } },
  });
  expect(paid.status()).toBe(200);
  const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.id, targets.receivable));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const path = "**/api/journal/receivables**";
  await page.route(path, async route => { await gate; await route.continue(); });
  await open.click();
  await expect(page.getByTestId("select-bank-settlement-target")).toHaveCount(0);
  await expect(page.getByTestId("text-bank-settlement-balance")).toHaveCount(0);
  await expect(page.getByTestId("button-submit-bank-settlement")).toBeDisabled();
  release();
  await page.getByTestId("select-bank-settlement-target").selectOption(String(targets.receivable));
  const current = new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 2 }).format(Number(debt.openAmount));
  await expect(page.getByTestId("text-bank-settlement-balance")).toContainText(`Одоогийн үлдэгдэл: ${current} ₮`);
  await page.unroute(path);
});

test("viewer has no creation or settlement actions on either bank screen", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-viewer`, password } })).status()).toBe(200);
  for (const path of ["/bank-transactions", "/bank-transactions/journal-review"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[data-testid^="settle-bank-debt-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="button-create-bank-debt-"]')).toHaveCount(0);
  }
});
