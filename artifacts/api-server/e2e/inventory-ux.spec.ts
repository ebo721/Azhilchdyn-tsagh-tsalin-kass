import { test, expect } from "@playwright/test";
import { mockInventoryUx } from "./inventory-ux-fixtures";
import { selectInventorySection } from "./inventory-navigation";

for (const width of [402, 1440]) {
  test(`${width}px: inventory sections survive reload and browser back`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockInventoryUx(page);
    await page.goto("/inventory?section=purchases");
    await expect(page.getByTestId("inventory-purchase-toolbar")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("inventory-purchase-toolbar")).toBeVisible();
    await selectInventorySection(page, "issues");
    await expect(page).toHaveURL(/section=issues/);
    await expect(page.getByTestId("button-add-inventory-issue")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("inventory-purchase-toolbar")).toBeVisible();
    await selectInventorySection(page, "stock");
    await expect(page.getByTestId("input-search-inventory-stock")).toBeVisible();
    if (width > 1024) {
      await page.getByTestId("button-toggle-nav-inventory").click();
      await expect(page.getByTestId("nav-inventory-children")).toHaveCount(0);
      await page.getByTestId("button-toggle-nav-inventory").click();
      await expect(page.getByTestId("nav-inventory-children").getByRole("link")).toHaveCount(5);
    }
  });

  test(`${width}px: compact purchase list filters, totals, pager and pending drawer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockInventoryUx(page);
    await page.goto("/inventory?section=purchases");
    await page.getByTestId("input-inventory-purchase-month").fill("2098-06");
    const pager = page.getByTestId("inventory-purchase-pager");
    const viewport = async () => {
      expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")).toBe(true);
      const bounds = await pager.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 2")).toBe(true);
    };
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("42");
    await expect(page.getByTestId("value-inventory-purchase-total")).toContainText("4,200");
    await expect(page.getByTestId("pending-inventory-purchases")).toHaveCount(0);
    await expect(page.getByTestId("value-pending-purchases-count")).toHaveText("2");
    await viewport();
    await page.screenshot({ path: `../../generated-artifacts/inventory-ux-${width}.png`, fullPage: true });
    await page.getByTestId("button-inventory-purchases-next").click();
    await expect(pager).toContainText("2 / 3");
    await page.getByTestId("button-open-pending-purchases").click();
    const drawer = page.getByTestId("pending-inventory-purchases");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(drawer).toContainText("Банкаар төлсөн");
    await expect(drawer.getByTestId("pending-purchase-98700")).toBeVisible();
    await expect(drawer.getByTestId("pending-purchase-98702")).toHaveCount(0);
    await expect(drawer.getByTestId("pending-purchase-98703")).toHaveCount(0);
    await expect(drawer.getByTestId("value-pending-purchases-total")).toContainText("300");
    await page.screenshot({ path: `../../generated-artifacts/inventory-pending-${width}.png`, fullPage: true });
    await drawer.getByTestId("register-pending-purchase-98700").click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByTestId("pending-purchase-facts")).toBeVisible();
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.getByTestId("button-close-pending-purchases").click();
    await expect(pager).toContainText("2 / 3");
    const search = page.getByTestId("input-search-inventory-purchases");
    await search.fill("Онцгой харилцагч");
    await expect(pager).toContainText("1 / 1");
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("1 бүртгэл");
    await search.fill("Онцгой будаа");
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("1 бүртгэл");
    await search.fill("2098/06/14/004");
    await expect(page.getByTestId("value-inventory-purchase-total")).toContainText("100");
    await search.clear();
    await page.getByTestId("button-inventory-purchase-filters").click();
    await page.getByTestId("filter-purchase-payment").selectOption("paid");
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("2 бүртгэл");
    await page.getByTestId("filter-purchase-receipt").selectOption("with");
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("1 бүртгэл");
    await page.getByTestId("filter-purchase-bank-link").selectOption("unlinked");
    await expect(page.getByText("Худалдан авалт олдсонгүй", { exact: true })).toBeVisible();
    await page.getByTestId("button-reset-inventory-purchase-filters").click();
    await expect(page.getByTestId("text-inventory-purchase-count")).toContainText("42 бүртгэл");
    await page.getByTestId("button-inventory-purchase-filters").click();
    await viewport();
    await page.getByTestId("tab-inventory-material-supply").click();
    await expect(page.getByTestId("value-pending-purchases-count")).toHaveText("1");
    await page.getByTestId("button-open-pending-purchases").click();
    await expect(drawer.getByTestId("pending-purchase-98703")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("input-inventory-purchase-month").fill("2098-04");
    await page.getByTestId("button-open-pending-purchases").click();
    await expect(page.getByTestId("pending-purchases-empty")).toBeVisible();
    await page.keyboard.press("Escape");
  });
}

test("viewer cannot expose purchase mutation actions through a portalled menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await mockInventoryUx(page);
  await page.route("**/api/auth/me", route => route.fulfill({ json: { authenticated: true, id: 2, username: "readonly", role: "viewer" } }));
  await page.route("**/api/inventory/purchases", route => route.fulfill({ json: fixture.purchases.map(p => ({ ...p, editable: true })) }));
  await page.goto("/inventory?section=purchases");
  await page.getByTestId("input-inventory-purchase-month").fill("2098-06");
  const row = page.getByTestId("inventory-purchase-98500");
  await expect(row.getByTestId("checkbox-inventory-payment-98500")).toHaveCount(0);
  await row.getByTestId("button-actions-inventory-98500").click();
  await expect(page.getByTestId("button-view-inventory-98500")).toBeVisible();
  for (const action of ["edit", "delete", "reclassify"]) await expect(page.getByTestId(`button-${action}-inventory-98500`)).toHaveCount(0);
});
