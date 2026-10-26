import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

test('downloads all employees, not just search matches, with selected-month shift names and salaries', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, id: 1, role: 'admin', username: 'fixture', menuPaths: null } });
    if (path === '/api/employees') return route.fulfill({ json: [
      { id: 1, name: 'Оффис ажилтан', role: 'Нягтлан', phone: '', employeeType: 'office', status: 'active',
        salaryType: 'monthly', payFrequency: 'twice', baseSalary: 2200000, socialInsuranceSalary: 1500000 },
      { id: 2, name: 'Ээлж ажилтан', role: 'Ажилтан', phone: '', employeeType: 'shift', status: 'inactive',
        salaryType: 'daily', payFrequency: 'once', baseSalary: 75000, socialInsuranceSalary: 0 },
    ] });
    if (path === '/api/attendance/shifts') return route.fulfill({ json: [{ id: 5, name: 'Б ээлж' }] });
    if (path === '/api/attendance/shift-plans') return route.fulfill({ json: [{ id: 1, employeeId: 2, shiftId: 5 }] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/employees');
  const button = page.getByTestId('button-export-employees');
  await expect(button).toBeEnabled();
  await page.getByTestId('input-search-employees').fill('Оффис');
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^Ajilchdiin-jagsaalt-\d{4}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await readFile((await download.path())!)).buffer);
  const sheet = workbook.getWorksheet('Ажилчид')!;
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getCell('D3').value).toBe('Идэвхгүй');
  expect(sheet.getCell('F3').value).toBe('Б ээлж');
  expect(sheet.getCell('H2').value).toBe(2200000);
  expect(sheet.getCell('I2').value).toBe(1500000);
  await page.screenshot({ path: '/tmp/employee-excel-button.png', fullPage: true });
});
