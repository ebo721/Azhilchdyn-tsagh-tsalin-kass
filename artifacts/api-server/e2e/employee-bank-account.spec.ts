import { expect, test } from "@playwright/test";

function employeeFixture() {
  return {
    id: 901, name: "Bank fixture", role: "Test", phone: "", employeeType: "office",
    salaryType: "monthly", payFrequency: "twice", baseSalary: 1000,
    socialInsuranceSalary: 0, payrollTaxExempt: true, fullSalaryRegardlessAttendance: false,
    monthlyExpectedWorkDays: 0, status: "active", joinedAt: "2026-01-01",
    inactiveAt: null, socialInsuranceProfile: null, bankAccountNumber: "MN000000000000000002",
  };
}

test("employee account persists after editing and the adjustment displays the whole number", async ({ page }) => {
  const employee = employeeFixture();
  let updates = 0;
  // All API requests are fixtures. The test cannot write to a real database.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "admin" } });
    if (path === "/api/employees" && request.method() === "GET") return route.fulfill({ json: [employee] });
    if (path === "/api/employees/901" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      expect(body.bankAccountNumber).toBe("001234567890");
      expect(body.salaryEffectiveDate).toBeUndefined();
      Object.assign(employee, body);
      updates += 1;
      return route.fulfill({ json: employee });
    }
    if (path === "/api/payroll") return route.fulfill({ json: {
      month: "2026-09", lines: [{
        employeeId: 901, employeeName: employee.name, role: "Test", employeeType: "office",
        bankAccountNumber: employee.bankAccountNumber, daysWorked: 20, hours: 160,
        gross: 1000, deductions: 0, socialInsuranceSalary: 0, socialInsurance: 0,
        taxableIncome: 0, calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0,
        advanceAmount: 0, manualDeduction: 0, receivableId: null, carryoverAmount: 0,
        payable: 1000, paidAmount: 0, paymentDate: null, secondPaidAmount: 0,
        secondPaymentDate: null, remainingAmount: 1000, overpaidAmount: 0,
        balanceAmount: 1000, net: 1000,
      }],
      totalGross: 1000, totalDeductions: 0, totalNet: 1000,
    } });
    if (path === "/api/payroll/advance") return route.fulfill({ json: { month: "2026-09", approved: false, lines: [] } });
    if (request.method() !== "GET") throw new Error(`Unexpected mutation: ${request.method()} ${path}`);
    return route.fulfill({ json: [] });
  });
  await page.goto("/employees");
  await expect(page.getByTestId("value-employee-bank-account-901")).toHaveText(employee.bankAccountNumber);
  await page.getByTestId("button-edit-employee-901").click();
  await expect(page.getByTestId("input-employee-bank-account")).toHaveValue(employee.bankAccountNumber);
  await page.getByTestId("input-employee-bank-account").fill("001234567890");
  await page.getByTestId("button-save-employee").click();
  await expect(page.getByTestId("input-employee-bank-account")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("value-employee-bank-account-901")).toHaveText("001234567890");
  expect(updates).toBe(1);
  await page.goto("/payroll");
  await page.getByTestId("button-payroll-adjustment-901").click();
  await expect(page.getByTestId("value-payroll-bank-account")).toHaveText("001234567890");
});

for (const mode of ["empty", "replace", "cancel", "missing", "invalid"] as const) {
  test(`pulling a salary recipient account: ${mode}`, async ({ page }) => {
    const employee = employeeFixture();
    if (mode === "empty") employee.bankAccountNumber = "";
    const original = employee.bankAccountNumber;
    const recipient = "001234567890";
    let reads = 0;
    let saves = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { authenticated: true, id: 1, username: "fixture", role: "accountant" } });
      if (path === "/api/employees" && request.method() === "GET") return route.fulfill({ json: [employee] });
      if (path === "/api/employees/901/salary-bank-account") {
        expect(request.method()).toBe("GET");
        reads++;
        if (mode === "missing" || mode === "invalid") return route.fulfill({
          status: mode === "missing" ? 404 : 422,
          json: { error: mode === "missing" ? "Холбогдсон цалингийн гүйлгээ олдсонгүй." : "Хүлээн авагчийн данс дутуу байна." },
        });
        return route.fulfill({ json: { bankAccountNumber: recipient, bankTransactionId: 123 } });
      }
      if (path === "/api/employees/901" && request.method() === "PATCH") {
        const body = request.postDataJSON();
        expect(body.bankAccountNumber).toBe(recipient);
        expect(body.baseSalary).toBeUndefined();
        Object.assign(employee, body);
        saves++;
        return route.fulfill({ json: employee });
      }
      if (request.method() !== "GET") throw new Error(`Unexpected mutation ${request.method()} ${path}`);
      return route.fulfill({ json: [] });
    });
    page.on("dialog", (dialog) => mode === "cancel" ? dialog.dismiss() : dialog.accept());
    await page.goto("/employees");
    await page.getByTestId("button-edit-employee-901").click();
    expect(reads).toBe(0);
    await page.getByTestId("button-pull-employee-bank-account").click();
    const message = page.getByTestId("message-employee-bank-account");
    await expect(message).toBeVisible();
    expect(reads).toBe(1);
    expect(saves).toBe(0);
    if (mode === "empty" || mode === "replace") {
      await expect(page.getByTestId("input-employee-bank-account")).toHaveValue(recipient);
      await expect(message).toContainText("Гүйлгээ #123");
      await page.getByTestId("button-save-employee").click();
      await expect(page.getByTestId("form-employee")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("value-employee-bank-account-901")).toHaveText(recipient);
      expect(saves).toBe(1);
    } else {
      await expect(page.getByTestId("input-employee-bank-account")).toHaveValue(original);
      await expect(message).toHaveAttribute("role", mode === "cancel" ? "status" : "alert");
      expect(employee.bankAccountNumber).toBe(original);
    }
  });
}
