import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, bankTransactionsTable, employeesTable, inventorySuppliersTable,
  journalEntriesTable, receivablesTable, payablesTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/hr-session.js";

const prefix = `bank-debt-ui-${randomUUID()}`;
const password = "Fixture-password-123";
const users: number[] = [], banks: number[] = [];
const newParties: number[] = [];
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
  for (const type of ["expense", "income", "expense", "expense", "income"] as const) {
    const [bank] = await db.insert(bankTransactionsTable).values({
      type, amount: 83.45, transactionAt: new Date("2099-04-13T08:23:00Z"),
      account: prefix, counterparty: prefix, description: `${prefix} ${banks.length}`, fingerprint: randomUUID(),
    }).returning();
    banks.push(bank.id);
  }
});
test.afterAll(async () => {
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(inArray(journalEntriesTable.createdBy, users));
  const ids = entries.map(e => e.id);
  if (banks.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
  if (ids.length) {
    await db.delete(receivablesTable).where(inArray(receivablesTable.originJournalEntryId, ids));
    await db.delete(payablesTable).where(inArray(payablesTable.journalEntryId, ids));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
  }
  if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  if (supplierId) await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, supplierId));
  if (newParties.length) await db.delete(inventorySuppliersTable).where(inArray(inventorySuppliersTable.id, newParties));
  if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
  await pool.end();
});

test("bank list creates an employee receivable with fixed bank date/amount and hides the posted action after reload", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
  await page.goto("/bank-transactions");
  await page.locator('input[type="month"]').fill("2099-04");
  await page.getByTestId(`button-create-bank-debt-${banks[0]}`).click();
  await expect(page.getByTestId("text-bank-ar-ap-date")).toContainText("2099");
  await expect(page.getByTestId("text-bank-ar-ap-amount")).toContainText("83.45");
  await expect(page.getByTestId("section-bank-ar-ap-fixed").locator("input")).toHaveCount(0);
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("text-bank-ar-ap-party-error")).toBeVisible();
  await page.getByTestId("input-bank-ar-ap-employee-search").fill(prefix);
  await page.getByTestId("select-bank-ar-ap-employee").selectOption(String(employeeId));
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[0]));
  const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, bank.journalEntryId!));
  const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId!));
  expect(debt.employeeId).toBe(employeeId);
  expect(Number(debt.originalAmount)).toBe(83.45);
  expect(entry.date).toBe("2099-04-13");
  await page.reload();
  await page.locator('input[type="month"]').fill("2099-04");
  await expect(page.getByTestId(`button-create-bank-debt-${banks[0]}`)).toHaveCount(0);
});

test("journal review creates supplier payable from bank income and persists its party", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`button-create-bank-debt-${banks[1]}`).click();
  await page.getByTestId("button-bank-ar-ap-party-supplier").click();
  await page.getByTestId("select-bank-ar-ap-supplier").selectOption(String(supplierId));
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[1]));
  const [debt] = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, bank.journalEntryId!));
  expect(debt.partyType).toBe("supplier");
  expect(debt.partyId).toBe(supplierId);
  expect(Number(debt.remainingBalance)).toBe(83.45);
  await page.reload();
  await expect(page.getByTestId(`button-create-bank-debt-${banks[1]}`)).toHaveCount(0);
});

test("phone preserves selected employee after server failure and retry creates one debt", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`button-create-bank-debt-${banks[2]}`).click();
  await page.getByTestId("select-bank-ar-ap-employee").selectOption(String(employeeId));
  const route = `**/api/bank-transactions/${banks[2]}/post-journal`;
  await page.route(route, r => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture failure" }) }));
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("text-bank-ar-ap-error")).toContainText("Fixture failure");
  await expect(page.getByTestId("select-bank-ar-ap-employee")).toHaveValue(String(employeeId));
  await page.unroute(route);
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[2]));
  expect((await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, bank.journalEntryId!))).length).toBe(1);
});

test("viewer cannot see creation actions on either bank screen", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-viewer`, password } })).status()).toBe(200);
  for (const path of ["/bank-transactions", "/bank-transactions/journal-review"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[data-testid^="button-create-bank-debt-"]')).toHaveCount(0);
  }
});

test("phone registers a non-employee individual inline, retains errors and uses the new party for a receivable", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
  await page.goto("/bank-transactions");
  await page.locator('input[type="month"]').fill("2099-04");
  await page.getByTestId(`button-create-bank-debt-${banks[3]}`).click();
  await page.getByTestId("button-bank-ar-ap-party-supplier").click();
  await page.getByTestId("button-add-bank-counterparty").click();
  await page.getByTestId("input-bank-counterparty-name").fill("   ");
  await page.getByTestId("button-save-bank-counterparty").click();
  await expect(page.getByTestId("error-bank-counterparty-name")).toBeVisible();
  const name = `${prefix} хувь хүн`;
  await page.getByTestId("input-bank-counterparty-name").fill(name);
  const path = "**/api/journal/suppliers";
  await page.route(path, async route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "Fixture registration failure" } }) : route.continue());
  await page.getByTestId("button-save-bank-counterparty").click();
  await expect(page.getByTestId("error-bank-counterparty-save")).toContainText("Fixture registration failure");
  await expect(page.getByTestId("input-bank-counterparty-name")).toHaveValue(name);
  await page.unroute(path);
  await page.getByTestId("input-bank-counterparty-name").press("Enter");
  await expect(page.getByTestId("form-bank-counterparty")).toHaveCount(0);
  const [party] = await db.select().from(inventorySuppliersTable).where(eq(inventorySuppliersTable.name, name));
  newParties.push(party.id);
  await expect(page.getByTestId("select-bank-ar-ap-supplier")).toHaveValue(String(party.id));
  expect((await db.select().from(employeesTable).where(eq(employeesTable.name, name))).length).toBe(0);
  const [before] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[3]));
  expect(before.journalEntryId).toBeNull();
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[3]));
  const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, bank.journalEntryId!));
  expect(debt.supplierId).toBe(party.id);
  expect(debt.employeeId).toBeNull();
  expect(Number(debt.originalAmount)).toBe(83.45);
  await page.reload();
  await page.locator('input[type="month"]').fill("2099-04");
  await expect(page.getByTestId(`button-create-bank-debt-${banks[3]}`)).toHaveCount(0);
});

test("journal review reuses an existing party when registering a duplicate name and creates a payable", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: `${prefix}-accountant`, password } })).status()).toBe(200);
  await page.goto("/bank-transactions/journal-review");
  await page.getByTestId(`button-create-bank-debt-${banks[4]}`).click();
  await page.getByTestId("button-bank-ar-ap-party-supplier").click();
  await page.getByTestId("input-bank-ar-ap-supplier-search").fill("not found fixture");
  await expect(page.getByTestId("text-bank-ar-ap-supplier-empty")).toBeVisible();
  await page.getByTestId("button-add-bank-counterparty").click();
  await page.getByTestId("input-bank-counterparty-name").fill(`  ${prefix.toUpperCase()}  `);
  await page.getByTestId("button-save-bank-counterparty").click();
  await expect(page.getByTestId("form-bank-counterparty")).toHaveCount(0);
  await expect(page.getByTestId("select-bank-ar-ap-supplier")).toHaveValue(String(supplierId));
  const postPath = `**/api/bank-transactions/${banks[4]}/post-journal`;
  await page.route(postPath, route => route.fulfill({ status: 503, json: { error: "Fixture debt failure" } }));
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("text-bank-ar-ap-error")).toContainText("Fixture debt failure");
  await expect(page.getByTestId("select-bank-ar-ap-supplier")).toHaveValue(String(supplierId));
  await page.unroute(postPath);
  await page.getByTestId("button-submit-bank-ar-ap").click();
  await expect(page.getByTestId("form-bank-ar-ap")).toHaveCount(0);
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, banks[4]));
  const [debt] = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, bank.journalEntryId!));
  expect(debt.partyId).toBe(supplierId);
  expect(Number(debt.remainingBalance)).toBe(83.45);
  await page.reload();
  await expect(page.getByTestId(`button-create-bank-debt-${banks[4]}`)).toHaveCount(0);
});
