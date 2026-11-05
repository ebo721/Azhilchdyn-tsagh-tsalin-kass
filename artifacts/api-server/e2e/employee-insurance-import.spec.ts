import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

test("employee insurance import asks for duplicates, supports skips, saves and reopens on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  const empty = { givenName: "", registrationNumber: "", clanName: "", parentName: "", insuranceTypeCode: "", occupationCode: "", citizenship: "", email: "" };
  const profile = { ...empty, givenName: "ТЕСТ", registrationNumber: "ТТ00123456", parentName: "ЭЦГИЙН", clanName: "УРГИЙН", insuranceTypeCode: "01001", occupationCode: "1120-11" };
  const roster = [1, 2, 3].map(id => ({ id, name: id === 3 ? "А.Нэг" : "Э.Тест", role: "Fixture", phone: "99000000",
    socialInsuranceProfile: null as null | typeof profile, employeeType: "office", status: "active", salaryType: "monthly",
    payFrequency: "twice", baseSalary: 2_500_000, socialInsuranceSalary: 1_000_000, joinedAt: "2026-09-01",
    payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, monthlyExpectedWorkDays: 0, bankAccountNumber: "" }));
  const rows = [
    { rowNumber: 2, name: "ТЕСТ", phone: "", profile, status: "ambiguous", suggestedEmployeeId: null, issues: ["Ижил овог нэртэй ажилтан байна."],
      candidates: roster.slice(0, 2).map(e => ({ employeeId: e.id, name: e.name, parentName: "", registrationNumber: "", role: e.role, status: e.status })) },
    { rowNumber: 3, name: "НЭГ", phone: "", profile: { ...profile, givenName: "НЭГ", registrationNumber: "АА00123456", parentName: "ААВ" },
      status: "matched", suggestedEmployeeId: 3, issues: [], candidates: [{ employeeId: 3, name: "А.Нэг", parentName: "", registrationNumber: "", role: "Fixture", status: "active" }] },
    { rowNumber: 4, name: "БУРУУ", phone: "", profile: { ...profile, registrationNumber: "BAD" }, status: "invalid", suggestedEmployeeId: null, issues: ["Регистр буруу"], candidates: [] },
    { rowNumber: 5, name: "ОЛДСОНГҮЙ", phone: "", profile: { ...empty, givenName: "ОЛДСОНГҮЙ" }, status: "unmatched", suggestedEmployeeId: null, issues: ["Тохирох ажилтан олдсонгүй"], candidates: [] },
  ];
  let applyCalls = 0;
  let stale = false;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, role: "admin", username: "fixture", menuPaths: null } });
    if (path === "/api/employees") return route.fulfill({ json: roster });
    if (path === "/api/employees/insurance-import/preview") {
      const input = route.request().postDataJSON();
      expect(input.fileName).toBe("fixture.xlsx");
      expect(input.contentBase64.length).toBeGreaterThan(100);
      return route.fulfill({ json: { previewToken: "fixture-token", totalRows: rows.length, rows } });
    }
    if (path === "/api/employees/insurance-import/apply") {
      applyCalls++;
      if (stale) return route.fulfill({ status: 409, json: { error: "Ажилтны мэдээлэл өөрчлөгдсөн. Файлыг дахин уншуулна уу." } });
      const input = route.request().postDataJSON();
      expect(input.selections).toEqual([{ rowNumber: 2, employeeId: 2 }, { rowNumber: 3, employeeId: 3 }, { rowNumber: 4, employeeId: null }, { rowNumber: 5, employeeId: null }]);
      for (const choice of input.selections) {
        const employee = roster.find(e => e.id === choice.employeeId);
        if (employee) employee.socialInsuranceProfile = rows.find(r => r.rowNumber === choice.rowNumber)!.profile;
      }
      return route.fulfill({ json: { updated: 2, skipped: 2, unchanged: 0 } });
    }
    return route.fulfill({ json: [] });
  });
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("data").addRow(["Нэр", "fixture"]);
  const file = { name: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
  async function preview() {
    await page.getByTestId("button-import-employee-insurance").click();
    await page.getByTestId("input-employee-insurance-file").setInputFiles(file);
    await page.getByTestId("button-preview-employee-insurance").click();
    await expect(page.getByTestId("status-import-row-2")).toHaveText("Олон нэр төстэй");
  }
  await page.goto("/employees");
  await preview();
  const save = page.getByTestId("button-apply-employee-insurance");
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("select-import-employee-2")).toHaveValue("");
  await page.getByTestId("select-import-employee-2").selectOption("3");
  await expect(page.getByTestId("employee-insurance-row-2").getByRole("alert")).toContainText("давхар");
  await page.getByTestId("select-import-employee-2").selectOption("2");
  await page.getByTestId("button-skip-import-row-4").click();
  await page.getByTestId("button-skip-import-row-5").click();
  await expect(save).toBeEnabled();
  await page.getByTestId("employee-insurance-row-2").scrollIntoViewIfNeeded();
  const rowBounds = (await page.getByTestId("employee-insurance-row-2").boundingBox())!;
  expect(rowBounds.x).toBeGreaterThanOrEqual(0);
  expect(rowBounds.x + rowBounds.width).toBeLessThanOrEqual(402);
  await page.screenshot({ path: "/tmp/employee-insurance-import-mobile.png" });
  await save.click();
  await expect(page.getByTestId("value-import-updated")).toHaveText("2");
  await expect(page.getByTestId("value-import-skipped")).toHaveText("2");
  await expect(page.getByTestId("input-employee-insurance-file")).toBeVisible();
  expect(applyCalls).toBe(1);
  await page.reload();
  await expect(page.getByTestId("row-employee-2")).toContainText("ТТ00123456");
  stale = true;
  await preview();
  await page.getByTestId("select-import-employee-2").selectOption("2");
  await page.getByTestId("button-skip-import-row-4").click();
  await page.getByTestId("button-skip-import-row-5").click();
  await save.click();
  await expect(page.getByTestId("error-employee-insurance-import")).toContainText("дахин уншуул");
  expect(applyCalls).toBe(2);
  expect(errors).toEqual([]);
});

test("read-only users cannot see insurance import controls", async ({ page }) => {
  await page.route("**/api/**", route => new URL(route.request().url()).pathname === "/api/auth/me"
    ? route.fulfill({ json: { authenticated: true, id: 4, role: "viewer", username: "fixture", menuPaths: null } })
    : route.fulfill({ json: [] }));
  await page.goto("/employees");
  await expect(page.getByTestId("input-search-employees")).toBeVisible();
  await expect(page.getByTestId("button-import-employee-insurance")).toHaveCount(0);
});
