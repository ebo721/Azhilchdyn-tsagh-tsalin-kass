import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { buildInsuranceWorkbook } from "../src/lib/social-insurance-report";

// Do not retain login request bodies containing workspace credentials in traces.
test.use({ trace: "off" });

async function login(page: Page, username: string, secretName: string) {
  const password = process.env[secretName];
  if (!password) throw new Error(`${secretName} must be configured`);
  await page.goto("/");
  await page.getByTestId("input-login-username").fill(username);
  await page.getByTestId("input-login-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("navigation-sidebar")).toBeVisible();
}

test.beforeAll(() => {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error("Refusing to run fixture-writing tests against production");
  }
});

test("persists reporting metadata and expected days, downloads the selected month, and shows export errors", async ({ page }) => {
  const name = `E2E insurance fixture ${Date.now()}`;
  let employeeId: number | undefined;
  try {
    await login(page, "admin", "ADMIN_PASSWORD");
    await page.goto("/employees");
    await page.getByTestId("button-add-employee").click();
    await page.getByTestId("input-employee-name").fill(name);
    await page.getByTestId("input-employee-role").fill("Test");
    await page.getByTestId("select-employee-type").selectOption("shift");
    await page.getByTestId("select-employee-salary-type").selectOption("daily");
    await page.getByTestId("input-employee-salary").fill("100000");
    await page.getByTestId("input-employee-social-insurance-salary").fill("1200000");
    await page.getByTestId("input-employee-expected-work-days").fill("15");
    for (const [key, value] of Object.entries({
      registrationNumber: "ТТ00000000", clanName: "Fixture", parentName: "Example",
      insuranceTypeCode: "01001", occupationCode: "0000-00", citizenship: "Монгол", email: "fixture@example.com",
    })) await page.getByTestId(`input-employee-insurance-${key}`).fill(value);
    const saved = page.waitForResponse(response => response.url().endsWith("/api/employees") && response.request().method() === "POST");
    await page.getByTestId("button-save-employee").click();
    const response = await saved;
    expect(response.status()).toBe(201);
    employeeId = (await response.json()).id;
    await page.reload();
    const employees = await page.request.get("/api/employees");
    const employee = (await employees.json()).find((row: { id: number }) => row.id === employeeId);
    expect(employee.monthlyExpectedWorkDays).toBe(15);
    expect(employee.socialInsuranceProfile.insuranceTypeCode).toBe("01001");
    expect(employee.socialInsuranceProfile.email).toBe("fixture@example.com");

    // Isolate the download UI from unrelated real payroll history. Workbook generation uses the real exporter.
    const workbook = await buildInsuranceWorkbook([{ employeeId: employeeId!, socialInsuranceSalary: 800_000 }], [employee]);
    await page.route(/\/api\/payroll\?/, route => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      return route.fulfill({ json: { month, lines: [], totalGross: 0, totalDeductions: 0, totalNet: 0,
        periodStart: `${month}-01`, periodEnd: `${month}-28`, advancePeriodEnd: `${month}-15`,
        advancePaymentDate: `${month}-20`, finalPaymentDate: `${month}-28` } });
    });
    let requestedMonth: string | null = null;
    let invalid = false;
    await page.route(/\/api\/payroll\/social-insurance-report\?/, route => {
      requestedMonth = new URL(route.request().url()).searchParams.get("month");
      return invalid
        ? route.fulfill({ status: 422, json: { error: "Fixture: Регистрийн дугаарыг гүйцээнэ үү" } })
        : route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: workbook });
    });
    await page.goto("/payroll");
    await page.getByTestId("input-payroll-month").fill("2026-09");
    const downloadReady = page.waitForEvent("download");
    await page.getByTestId("button-download-insurance-report").click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe("NDSH-2026-09.xlsx");
    expect(requestedMonth).toBe("2026-09");
    await expect(page.getByTestId("button-download-insurance-report")).toBeEnabled();
    invalid = true;
    await page.getByTestId("button-download-insurance-report").click();
    await expect(page.getByTestId("error-insurance-report")).toContainText("Регистрийн дугаарыг гүйцээнэ үү");
  } finally {
    if (employeeId) await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    else await db.delete(employeesTable).where(eq(employeesTable.name, name));
  }
});

test("enforces report authorization and required month at the real API boundary", async ({ page, request }) => {
  expect((await request.get("/api/payroll/social-insurance-report?month=2026-10")).status()).toBe(401);
  for (const [username, secret, allowed] of [
    ["admin", "ADMIN_PASSWORD", true], ["saacc", "ACCOUNTANT_PASSWORD", true],
    ["sasta", "SASTA_PASSWORD", false], ["sahr", "HR_MANAGER_PASSWORD", false],
  ] as const) {
    await login(page, username, secret);
    const response = await page.request.get("/api/payroll/social-insurance-report?month=not-a-month");
    expect(response.status()).toBe(allowed ? 400 : 403);
    expect((await page.request.get("/api/payroll/social-insurance-report")).status()).toBe(allowed ? 400 : 403);
    await page.getByTestId("button-logout").click();
    await expect(page.getByTestId("button-login")).toBeVisible();
  }
});
