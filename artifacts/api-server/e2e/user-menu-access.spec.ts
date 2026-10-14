import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, usersTable, inventoryCustodianEmployeesTable } from "@workspace/db";
import type { User } from "@workspace/api-zod";
import { hashPassword } from "../src/lib/hr-session.js";

const prefix = `user-menu-ui-${randomUUID()}`;
const password = "Fixture-password-123";
let actorId: number;
test.beforeAll(async () => {
  const [actor] = await db.insert(usersTable).values({
    username: `${prefix}-admin`, normalizedUsername: `${prefix}-admin`, role: "admin",
    menuPaths: ["/users"], passwordHash: await hashPassword(password),
  }).returning();
  actorId = actor.id;
});
test.afterAll(async () => {
  const owned = await db.select({ id: usersTable.id }).from(usersTable)
    .where(like(usersTable.normalizedUsername, `${prefix}%`));
  if (owned.length) {
    const ids = owned.map(user => user.id);
    await db.delete(inventoryCustodianEmployeesTable).where(inArray(inventoryCustodianEmployeesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
  await pool.end();
});

test("real account creation, menu selection, login, forbidden links and edits work together", async ({ page, browser }) => {
  const login = await page.request.post("/api/auth/login", { data: { username: `${prefix}-admin`, password } });
  expect(login.status()).toBe(200);
  await page.goto("/users");
  await page.getByTestId("button-create-user").click();
  const username = `${prefix}-new`;
  await page.getByTestId("input-user-username").fill(username);
  await page.getByTestId("input-user-full-name").fill("UI fixture");
  await page.getByTestId("select-user-role").selectOption("hr");
  await expect(page.getByTestId("checkbox-user-menu-cash")).toHaveCount(0);
  for (const menu of ["employees", "attendance", "attendance-devices", "hour-balance"]) {
    await page.getByTestId(`checkbox-user-menu-${menu}`).uncheck();
  }
  await page.getByTestId("input-user-new-password").fill(password);
  await page.getByTestId("button-save-user").click();
  await expect(page.getByTestId("status-user-saved")).toContainText(username);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.normalizedUsername, username));
  expect(user.menuPaths).toEqual(["/meal-counts"]);
  await expect(page.getByTestId(`row-user-${user.id}`)).toContainText("Цэс: 1/18");

  const staff = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await staff.request.post("/api/auth/login", { data: { username, password } })).status()).toBe(200);
    const staffPage = await staff.newPage();
    await staffPage.goto("/cash");
    await expect(staffPage).toHaveURL(/\/meal-counts$/);
    await expect(staffPage.getByTestId("navigation-main").locator("a")).toHaveCount(1);
    await expect(staffPage.getByTestId("link-nav-Хоолны тоо")).toBeVisible();
    expect((await staff.request.get("/api/cash")).status()).toBe(403);

    await page.getByTestId(`button-edit-user-${user.id}`).click();
    await expect(page.getByTestId("checkbox-user-menu-meal-counts")).toBeChecked();
    await expect(page.getByTestId("input-user-new-password")).toHaveValue("");
    await page.getByTestId("checkbox-user-menu-meal-counts").uncheck();
    await page.getByTestId("checkbox-user-menu-employees").check();
    await page.getByTestId("button-save-user").click();
    await expect(page.getByTestId("status-user-saved")).toContainText("хадгалагдлаа");
    expect((await staff.request.get("/api/meal-counts?dateFrom=2026-10-01&dateTo=2026-10-14")).status()).toBe(401);
    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(updated.menuPaths).toEqual(["/employees"]);
    await staffPage.reload();
    await expect(staffPage.getByTestId("input-login-username")).toBeVisible();
    await page.getByTestId(`button-edit-user-${user.id}`).click();
    await expect(page.getByTestId("checkbox-user-menu-employees")).toBeChecked();
    await expect(page.getByTestId("checkbox-user-menu-meal-counts")).not.toBeChecked();
  } finally { await staff.close(); }
});

test("phone form retains input on duplicate errors and admin settings cannot be unchecked", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  let duplicate = true;
  let submittedMenus: unknown;
  const users: User[] = [{ id: actorId, username: "UI admin", role: "admin", menuPaths: null }];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: actorId, username: "UI admin", role: "admin", menuPaths: null } });
    if (path === "/api/users" && route.request().method() === "POST") {
      submittedMenus = route.request().postDataJSON().menuPaths;
      if (duplicate) return route.fulfill({ status: 409, json: { error: "Энэ хэрэглэгчийн нэр ашиглагдаж байна" } });
      const input = route.request().postDataJSON();
      const user: User = { id: 99002, username: input.username, role: input.role, fullName: input.fullName, menuPaths: input.menuPaths };
      users.push(user);
      return route.fulfill({ status: 201, json: user });
    }
    return route.fulfill({ json: path === "/api/users" ? users : [] });
  });
  await page.goto("/users");
  await page.getByTestId("button-create-user").click();
  await page.getByTestId("input-user-username").fill("duplicate-name");
  await page.getByTestId("select-user-role").selectOption("admin");
  await expect(page.getByTestId("checkbox-user-menu-users")).toBeChecked();
  await expect(page.getByTestId("checkbox-user-menu-users")).toBeDisabled();
  await page.getByTestId("checkbox-user-menu-home").uncheck();
  await page.getByTestId("button-reset-user-menus").click();
  await expect(page.getByTestId("checkbox-user-menu-home")).toBeChecked();
  await page.getByTestId("input-user-new-password").fill(password);
  await page.getByTestId("button-save-user").click();
  await expect(page.getByTestId("text-user-form-error")).toContainText("бүртгэлтэй");
  expect(submittedMenus).toBeNull();
  await expect(page.getByTestId("input-user-username")).toHaveValue("duplicate-name");
  await expect(page.getByTestId("select-user-role")).toHaveValue("admin");
  duplicate = false;
  await page.getByTestId("input-user-username").fill("different-name");
  await page.getByTestId("button-save-user").click();
  await expect(page.getByTestId("status-user-saved")).toContainText("different-name");
  await expect(page.getByTestId("row-user-99002")).toBeVisible();
});

test("no-menu account loads no protected page and can still sign out", async ({ page }) => {
  let authenticated = true;
  const calls: string[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/api/auth/logout") {
      authenticated = false;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: path === "/api/auth/me"
      ? { authenticated, id: authenticated ? 99100 : null, username: authenticated ? "no-menu" : null, role: authenticated ? "viewer" : null, menuPaths: [] }
      : [] });
  });
  await page.goto("/cash");
  await expect(page.getByTestId("no-accessible-menus")).toBeVisible();
  await expect(page.getByTestId("navigation-main").locator("a")).toHaveCount(0);
  expect(calls.every(path => path === "/api/auth/me")).toBe(true);
  await page.getByTestId("button-logout").click();
  await expect(page.getByTestId("input-login-username")).toBeVisible();
});
