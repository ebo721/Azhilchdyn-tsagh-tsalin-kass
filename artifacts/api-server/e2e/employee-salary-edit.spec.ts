import { expect, test } from "@playwright/test";

for (const currentRow of [false, true]) {
 for (const initiallyExempt of [false, true]) {
  test(`${currentRow ? "current" : "initial"} salary correction toggles ${initiallyExempt ? "exempt to taxable" : "taxable to exempt"} without appending a new salary`, async ({ page }) => {
    const employee = {
      id: 902, name: "Salary fixture", role: "Test", phone: "", bankAccountNumber: "",
      employeeType: "office", salaryType: "monthly", payFrequency: "twice",
      baseSalary: 2000000, socialInsuranceSalary: 1000000, payrollTaxExempt: initiallyExempt,
      fullSalaryRegardlessAttendance: false, monthlyExpectedWorkDays: 0,
      status: "active", joinedAt: "2026-01-01", inactiveAt: null, socialInsuranceProfile: null,
    };
    const histories = [
      { id: 12, employeeId: 902, effectiveFrom: "2026-09-01", baseSalary: 2000000 },
      { id: 11, employeeId: 902, effectiveFrom: "2026-01-01", baseSalary: 1000000 },
    ].map((row) => ({ ...employee, ...row, createdAt: "2026-01-01T00:00:00Z" }));
    const rowId = currentRow ? 12 : 11;
    let corrections = 0;
    let profileSaves = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "admin" } });
      if (path === "/api/employees" && request.method() === "GET") return route.fulfill({ json: [employee] });
      if (path === "/api/employees/902/salary-history" && request.method() === "GET") return route.fulfill({ json: histories });
      if (path === `/api/employees/902/salary-history/${rowId}` && request.method() === "PATCH") {
        const row = histories.find((value) => value.id === rowId)!;
        expect(request.postDataJSON().payrollTaxExempt).toBe(!initiallyExempt);
        Object.assign(row, request.postDataJSON());
        if (currentRow) Object.assign(employee, { baseSalary: row.baseSalary,
          payrollTaxExempt: row.payrollTaxExempt, socialInsuranceSalary: row.socialInsuranceSalary });
        corrections += 1;
        return route.fulfill({ json: row });
      }
      if (path === "/api/employees/902" && request.method() === "PATCH") {
        const body = request.postDataJSON();
        expect(body.baseSalary).toBeUndefined();
        expect(body.salaryEffectiveDate).toBeUndefined();
        Object.assign(employee, body);
        profileSaves += 1;
        return route.fulfill({ json: employee });
      }
      if (request.method() !== "GET") throw new Error(`Unexpected mutation ${request.method()} ${path}`);
      return route.fulfill({ json: [] });
    });
    await page.goto("/employees");
    await page.getByTestId("button-edit-employee-902").click();
    await expect(page.getByTestId("input-employee-salary")).toHaveValue("");
    await expect(page.getByTestId("input-employee-salary-effective-date")).toHaveCount(0);
    await page.getByTestId("input-employee-salary").fill("0");
    await expect(page.getByTestId("input-employee-salary-effective-date")).toBeVisible();
    await page.getByTestId("input-employee-salary-effective-date").fill("2026-10-01");
    await page.getByTestId("input-employee-salary").fill("");
    await expect(page.getByTestId("input-employee-salary-effective-date")).toHaveCount(0);
    await page.getByTestId(`button-edit-salary-history-${rowId}`).click();
    await expect(page.getByTestId(`select-salary-history-tax-${rowId}`)).toHaveValue(String(initiallyExempt));
    await page.getByTestId(`select-salary-history-tax-${rowId}`).selectOption(String(!initiallyExempt));
    await page.getByTestId(`input-salary-history-base-${rowId}`).fill(currentRow ? "2400000" : "1200000");
    await page.getByTestId(`button-save-salary-history-${rowId}`).click();
    await expect(page.getByTestId(`input-salary-history-base-${rowId}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-salary-history-${rowId}`)).toContainText(initiallyExempt ? "Тооцно" : "Чөлөөлсөн");
    // A cancelled draft must never reappear when reopening the editor.
    await page.getByTestId(`button-edit-salary-history-${rowId}`).click();
    await page.getByTestId(`select-salary-history-tax-${rowId}`).selectOption(String(initiallyExempt));
    await page.getByTestId(`row-salary-history-${rowId}`).getByRole("button", { name: "Болих", exact: true }).click();
    await page.getByTestId(`button-edit-salary-history-${rowId}`).click();
    await expect(page.getByTestId(`select-salary-history-tax-${rowId}`)).toHaveValue(String(!initiallyExempt));
    await page.getByTestId(`row-salary-history-${rowId}`).getByRole("button", { name: "Болих", exact: true }).click();
    await expect(page.getByTestId("input-employee-salary")).toHaveValue("");
    await expect(page.getByTestId("input-employee-salary-effective-date")).toHaveCount(0);
    await expect(page.getByTestId("value-employee-current-salary")).toContainText(currentRow ? "2,400,000" : "2,000,000");
    await page.getByTestId("button-save-employee").click();
    await expect(page.getByTestId("form-employee")).toHaveCount(0);
    expect(corrections).toBe(1);
    expect(profileSaves).toBe(1);
    expect(histories).toHaveLength(2);
    expect(histories[1].baseSalary).toBe(currentRow ? 1000000 : 1200000);
    expect(employee.baseSalary).toBe(currentRow ? 2400000 : 2000000);
    expect(employee.payrollTaxExempt).toBe(currentRow ? !initiallyExempt : initiallyExempt);
    // Reloading must show the persisted correction rather than a local draft.
    await page.reload();
    await page.getByTestId("button-edit-employee-902").click();
    await expect(page.getByTestId(`row-salary-history-${rowId}`)).toContainText(initiallyExempt ? "Тооцно" : "Чөлөөлсөн");
  });
 }
}
