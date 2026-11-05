import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { GetPayrollResponse } from "@workspace/api-zod";
import { buildPayrollWorkbook } from "../src/lib/payroll-workbook";

test.use({ trace: "off" });

test("downloads selected-month payroll Excel, shows server errors, and fits the mobile toolbar", async ({ page }) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD must be configured");
  await page.goto("/");
  await page.getByTestId("input-login-username").fill("admin");
  await page.getByTestId("input-login-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("navigation-sidebar")).toBeVisible();
  const summary = GetPayrollResponse.parse({
    month: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31", advancePeriodEnd: "2026-10-15",
    advancePaymentDate: "2026-10-20", finalPaymentDate: "2026-11-05",
    schedule: { id: 1, effectiveFromMonth: "0001-01", periodStartDay: 1, periodEndDay: 31, advanceCutoffDay: 15, advancePayDay: 20, finalPayDay: 5 },
    totalGross: 1000, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 100, totalNet: 900,
    lines: [{
      employeeId: 1, employeeName: "Excel шалгалт", employeeType: "office", role: "Жолооч",
      daysWorked: 19, hours: 152, gross: 1000, socialInsuranceSalary: 1200000, socialInsurance: 0,
      taxableIncome: 0, calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 100,
      manualDeduction: 0, receivableId: null, deductions: 100, carryoverAmount: 0, payable: 900,
      paidAmount: 0, paymentDate: null, secondPaidAmount: 0, secondPaymentDate: null,
      remainingAmount: 900, overpaidAmount: 0, balanceAmount: 900, net: 900,
    }],
  });
  const buffer = await buildPayrollWorkbook(summary, [], []);
  await page.route(/\/api\/payroll\?/, route => route.fulfill({ json: summary }));
  let requestedMonth: string | null = null;
  let fail = false;
  await page.route(/\/api\/payroll\/export\?/, route => {
    requestedMonth = new URL(route.request().url()).searchParams.get("month");
    return fail
      ? route.fulfill({ status: 409, json: { error: "Шалгалт: цалингийн бодолтыг шинэчилнэ үү" } })
      : route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buffer });
  });
  await page.goto("/payroll?month=2026-10");
  const insuranceSalary = `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(1200000)} ₮`;
  await expect(page.getByRole("columnheader", { name: "НДШ бодох цалин", exact: true })).toBeVisible();
  await expect(page.getByTestId("value-payroll-insurance-salary-1")).toHaveText(insuranceSalary);
  await expect(page.getByTestId("value-payroll-total-insurance-salary")).toHaveText(insuranceSalary);
  const button = page.getByTestId("button-download-payroll-workbook");
  await expect(button).toBeEnabled();
  await expect(page.getByTestId("button-download-insurance-report")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await button.click();
  const download = await downloaded;
  expect(requestedMonth).toBe("2026-10");
  expect(download.suggestedFilename()).toBe("Payroll-2026-10.xlsx");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as never);
  expect(workbook.worksheets[0].getCell("D5").value).toBe("Excel шалгалт");
  expect(workbook.worksheets[0].getCell("T5").value).toBe(900);
  fail = true;
  await button.click();
  await expect(page.getByTestId("error-insurance-report")).toContainText("цалингийн бодолтыг шинэчилнэ үү");
  await expect(button).toBeEnabled();
  await page.getByTestId("input-payroll-month").fill("2026-09");
  await expect(page.getByTestId("error-insurance-report")).toHaveCount(0);
  fail = false;
  const previous = page.waitForEvent("download");
  await button.click();
  expect((await previous).suggestedFilename()).toBe("Payroll-2026-09.xlsx");
  expect(requestedMonth).toBe("2026-09");
  await page.screenshot({ path: "../../generated-artifacts/payroll-workbook-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../generated-artifacts/payroll-workbook-phone.png" });
});
