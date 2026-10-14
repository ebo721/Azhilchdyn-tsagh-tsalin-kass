import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, usersTable, employeesTable, chartOfAccountsTable, journalEntriesTable,
  receivablesTable, payablesTable, receivableAllocationsTable, payableAllocationsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/hr-session.js";

const prefix = `employee-debt-ui-${randomUUID()}`;
const password = "Fixture-password-123";
let actorId: number, employeeId: number, counterId: number;
test.beforeAll(async () => {
  const [user] = await db.insert(usersTable).values({
    username: prefix, normalizedUsername: prefix, role: "accountant", menuPaths: ["/ar-ap"], passwordHash: await hashPassword(password),
  }).returning();
  actorId = user.id;
  const [employee] = await db.insert(employeesTable).values({ name: `${prefix} worker`, role: "test", baseSalary: 0 }).returning();
  employeeId = employee.id;
  const [account] = await db.insert(chartOfAccountsTable).values({
    code: `${prefix}-counter`, name: "Test counter account", type: "asset", normalBalance: "debit",
  }).returning();
  counterId = account.id;
});
test.afterAll(async () => {
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.createdBy, actorId));
  if (entries.length) {
    const ids = entries.map(row => row.id);
    const r = await db.select().from(receivablesTable).where(inArray(receivablesTable.originJournalEntryId, ids));
    const p = await db.select().from(payablesTable).where(inArray(payablesTable.journalEntryId, ids));
    if (r.length) {
      const rids = r.map(row => row.id);
      await db.delete(receivableAllocationsTable).where(inArray(receivableAllocationsTable.receivableId, rids));
      await db.delete(receivablesTable).where(inArray(receivablesTable.id, rids));
    }
    if (p.length) {
      const pids = p.map(row => row.id);
      await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.payableId, pids));
      await db.delete(payablesTable).where(inArray(payablesTable.id, pids));
    }
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
  }
  if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  if (counterId) await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, counterId));
  if (actorId) await db.delete(usersTable).where(eq(usersTable.id, actorId));
  await pool.end();
});

test("real ar-ap-only accountant creates both employee balances and reloads the persisted records", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { username: prefix, password } })).status()).toBe(200);
  await page.goto("/ar-ap");
  await expect(page.getByRole("button", { name: "Журналаар бүртгэх", exact: true })).toHaveCount(0);
  for (const [tab, path, amount] of [["Авлага", "receivables", "31.25"], ["Өглөг", "payables", "42.50"]] as const) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByTestId("button-create-employee-balance").click();
    await page.getByTestId("input-ar-ap-employee-search").fill(prefix);
    await page.getByTestId("select-ar-ap-employee").selectOption(String(employeeId));
    await page.getByTestId("input-ar-ap-date").fill("2026-10-05");
    await page.getByTestId("input-ar-ap-amount").fill(amount);
    await page.getByTestId("input-ar-ap-description").fill(`${prefix} ${path}`);
    await page.getByTestId("select-ar-ap-counter-account").selectOption(String(counterId));
    await page.getByTestId("button-save-employee-balance").click();
    await expect(page.getByTestId("status-ar-ap-saved")).toContainText(prefix);
    const response = await page.request.get(`/api/journal/${path}?status=all`);
    expect(response.status()).toBe(200);
    const rows = await response.json();
    const row = rows.find((r: { partyId: number; description?: string }) => r.partyId === employeeId && r.description === `${prefix} ${path}`);
    expect(row.partyType).toBe("employee");
    expect(row.originalAmount).toBe(Number(amount));
    expect(row.date).toBe("2026-10-05");
    await expect(page.getByTestId(`row-ar-ap-${row.id}`)).toContainText(`${prefix} ${path}`);
    await page.reload();
    if (tab === "Өглөг") await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByTestId(`row-ar-ap-${row.id}`)).toContainText(`${prefix} worker`);
    await page.locator("#ar-ap-party").selectOption(`employee:${employeeId}`);
    await expect(page.getByTestId(`row-ar-ap-${row.id}`)).toBeVisible();
  }
});

test("phone form validates fields, retains employee selection after a failed save, and retries", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  let fail = true;
  const rows: unknown[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 99001, username: "test", role: "accountant", menuPaths: ["/ar-ap"] } });
    if (path === "/api/employees") return route.fulfill({ json: [
      { id: 99001, name: "Туршилтын ажилтан", role: "test", status: "active" },
      { id: 99002, name: "Архив ажилтан", role: "test", status: "inactive" },
    ] });
    if (path === "/api/chart-of-accounts") return route.fulfill({ json: [
      { id: 1, code: "1200", name: "Авлага", isActive: true },
      { id: 2, code: "2000", name: "Өглөг", isActive: true },
      { id: 3, code: "5100", name: "Харьцсан данс", isActive: true },
      { id: 4, code: "5200", name: "Идэвхгүй", isActive: false },
    ] });
    if (path === "/api/journal/receivables" && route.request().method() === "POST") {
      if (fail) return route.fulfill({ status: 400, json: { error: "Туршилтын алдаа" } });
      const body = route.request().postDataJSON();
      expect(body.employeeId).toBe(99001);
      expect(body.counterAccountId).toBe(3);
      const row = { id: 99100, partyId: 99001, partyType: "employee", partyLabel: "Туршилтын ажилтан", originalAmount: body.amount, openAmount: body.amount, status: "open", date: body.date, description: body.description, createdAt: "2026-10-14T00:00:00Z" };
      rows.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    return route.fulfill({ json: path === "/api/journal/receivables" ? rows : [] });
  });
  await page.goto("/ar-ap");
  await page.getByTestId("button-create-employee-balance").click();
  await page.getByTestId("button-save-employee-balance").click();
  await expect(page.getByText("Ажилтан сонгоно уу.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("select-ar-ap-employee").locator("option")).toHaveCount(2);
  await expect(page.getByTestId("select-ar-ap-counter-account").locator("option")).toHaveCount(2);
  await page.getByTestId("select-ar-ap-employee").selectOption("99001");
  await page.getByTestId("input-ar-ap-amount").fill("1.001");
  await page.getByTestId("input-ar-ap-description").fill("Ажилтны авлага");
  await page.getByTestId("select-ar-ap-counter-account").selectOption("3");
  await page.getByTestId("button-save-employee-balance").click();
  await expect(page.getByTestId("text-ar-ap-form-error")).toHaveCount(0);
  await page.getByTestId("input-ar-ap-amount").fill("20.50");
  await page.getByTestId("button-save-employee-balance").click();
  await expect(page.getByTestId("text-ar-ap-form-error")).toContainText("Туршилтын алдаа");
  await expect(page.getByTestId("select-ar-ap-employee")).toHaveValue("99001");
  await expect(page.getByTestId("input-ar-ap-amount")).toHaveValue("20.50");
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  fail = false;
  await page.getByTestId("button-save-employee-balance").click();
  await expect(page.getByTestId("row-ar-ap-99100")).toContainText("Ажилтны авлага");
});

test("viewer sees existing employee and supplier balances with no creation controls", async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/auth/me"
      ? { authenticated: true, id: 99001, username: "viewer", role: "viewer", menuPaths: ["/ar-ap"] }
      : path === "/api/journal/receivables" ? [
        { id: 1, partyType: "employee", partyId: 1, partyLabel: "Ажилтан", originalAmount: 10, openAmount: 5, status: "open", createdAt: "2026-10-14T00:00:00Z" },
        { id: 2, partyType: "supplier", partyId: 2, partyLabel: "Нийлүүлэгч", originalAmount: 20, openAmount: 0, status: "settled", createdAt: "2026-10-14T00:00:00Z" },
      ] : [] });
  });
  await page.goto("/ar-ap");
  await expect(page.getByTestId("button-create-employee-balance")).toHaveCount(0);
  await expect(page.getByTestId("row-ar-ap-1")).toContainText("Ажилтан");
  await expect(page.getByTestId("row-ar-ap-2")).toContainText("Нийлүүлэгч");
  await page.locator("#ar-ap-party").selectOption("supplier:2");
  await expect(page.getByTestId("row-ar-ap-1")).toHaveCount(0);
  await expect(page.getByTestId("row-ar-ap-2")).toBeVisible();
});
