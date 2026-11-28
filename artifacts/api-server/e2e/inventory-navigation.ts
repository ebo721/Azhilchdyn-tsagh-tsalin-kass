import type { Page } from "@playwright/test";

export async function selectInventorySection(page: Page, section: string) {
  const compactSelector = page.getByTestId("select-inventory-section");
  if (await compactSelector.isVisible()) {
    await compactSelector.selectOption(section);
  } else {
    const link = page.getByTestId(`link-nav-inventory-${section}`);
    if (!(await link.isVisible())) await page.getByTestId("button-toggle-nav-inventory").click();
    await link.click();
  }
}
