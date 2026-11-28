import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, role = 'admin') {
  const writes: string[] = [];
  let fail = false;
  const line = (id: number) => ({
    employeeId: id, employeeName: id === 1 ? 'Болд Бат' : 'Оюун Сар',
    employeeType: id === 1 ? 'shift' : 'office', role: id === 1 ? 'Ажилтан' : 'Менежер',
    daysWorked: 20, hours: 160, gross: 1000000, deductions: 100000,
    paidAmount: id === 1 ? 200000 : 900000, carryoverAmount: id === 1 ? -50000 : 0,
    bankAccountNumber: 'MN000000000000000002', socialInsuranceSalary: 792000,
    socialInsurance: 91080, incomeTax: 8920, taxRelief: 0, advanceAmount: 0,
    manualDeduction: 0, paymentDate: '2026-11-20', secondPaidAmount: 0,
    secondPaymentDate: null, additionalPayments: [], calculationReady: true,
  });
  const advance = (id: number) => ({
    ...line(id), baseSalary: 1000000, dailySalary: 50000, totalSalary: 1000000,
    advanceAmount: 500000, paidAmount: id === 1 ? 100000 : 500000,
    remainingBalance: id === 1 ? 400000 : 0, paid: id === 2,
    payments: [{ sequence: 1, amount: id === 1 ? 100000 : 500000, date: '2026-11-15' }],
  });
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== 'GET') writes.push(path);
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { authenticated: true, id: 1, role, username: 'fixture' } });
    const month = url.searchParams.get('month') ?? '2026-11';
    const period = { month, periodStart: month + '-01', periodEnd: month + '-28',
      advancePeriodEnd: month + '-15', advancePaymentDate: month + '-15', finalPaymentDate: month + '-28' };
    if (path.endsWith('/payroll')) return fail
      ? route.fulfill({ status: 500, json: { error: 'Fixture error' } })
      : route.fulfill({ json: { ...period, lines: [line(1), line(2)], closedAt: null, openingBalanceMonth: '2026-01' } });
    if (path.endsWith('/payroll-advance')) return route.fulfill({ json: {
      ...period, lines: [advance(1), advance(2)], approved: true, approvalDate: month + '-15',
    } });
    if (path.endsWith('/attendance/shifts')) return route.fulfill({ json: [{ id: 1, name: 'Ээлж 1' }] });
    if (path.endsWith('/attendance/shift-plans')) return route.fulfill({ json: [{ employeeId: 1, shiftId: 1, date: month + '-05' }] });
    return route.fulfill({ json: [] });
  });
  return { writes, fail: () => { fail = true; } };
}

async function navigateSection(page: Page, section: 'advance' | 'final', phone = false) {
  if (phone) await page.getByTestId('button-open-navigation').click();
  await page.getByTestId('link-nav-payroll-' + section).click();
}

for (const width of [1360, 402]) {
  test(`submenus retain month, filters and browser history without pulling attendance: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 874 });
    const state = await setup(page);
    await page.goto('/payroll?month=2026-11');
    await expect(page.getByRole('heading', { name: 'Сүүл цалин', exact: true })).toBeVisible();
    await expect(page.getByTestId('row-payroll-1')).toContainText('650,000');
    await expect(page.locator('[data-testid="payroll-table"] thead th')).toHaveCount(7);
    await expect(page.getByTestId('button-close-payroll-month')).toBeVisible();
    await page.getByRole('textbox', { name: 'Ажилтан хайх' }).fill('болд');
    await expect(page.getByTestId('row-payroll-2')).toHaveCount(0);
    await page.getByTestId('button-payroll-previous-month').click();
    await navigateSection(page, 'advance', width < 1024);
    await expect(page).toHaveURL(/section=advance/);
    await expect(page.getByTestId('input-payroll-month')).toHaveValue('2026-10');
    await expect(page.getByRole('textbox', { name: 'Ажилтан хайх' })).toHaveValue('болд');
    await expect(page.getByTestId('row-advance-1')).toBeVisible();
    await expect(page.getByTestId('row-advance-2')).toHaveCount(0);
    await expect(page.getByTestId('payroll-table')).toHaveCount(0);
    await expect(page.getByTestId('button-close-payroll-month')).toHaveCount(0);
    await expect(page.getByTestId('button-reopen-payroll-month')).toHaveCount(0);
    await navigateSection(page, 'final', width < 1024);
    await expect(page.getByTestId('row-payroll-1')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Урьдчилгаа цалин', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('input-payroll-month')).toHaveValue('2026-10');
    if (width >= 1024) await expect(page.getByTestId('link-nav-payroll-advance')).toHaveAttribute('aria-current', 'page');
    expect(state.writes).toEqual([]);
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    await page.screenshot({ path: '../../generated-artifacts/payroll-advance-' + width + '.png', fullPage: true, animations: 'disabled' });
  });

  test(`search, employee/shift/status filters, details and saved payment modal: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 874 });
    const state = await setup(page);
    await page.goto('/payroll?month=2026-11&section=final');
    await page.getByLabel('Төлөвөөр шүүх').selectOption('paid');
    await expect(page.getByTestId('row-payroll-1')).toHaveCount(0);
    await expect(page.getByTestId('row-payroll-2')).toBeVisible();
    await page.getByLabel('Төлөвөөр шүүх').selectOption('pending');
    await expect(page.getByTestId('row-payroll-1')).toBeVisible();
    await page.getByTestId('select-payroll-advance-employee-filter').selectOption('office');
    await expect(page.getByTestId('empty-payroll-filter')).toBeVisible();
    await page.getByTestId('select-payroll-advance-employee-filter').selectOption('all');
    await page.getByTestId('select-payroll-advance-shift-filter').selectOption('1');
    await expect(page.getByTestId('row-payroll-1')).toBeVisible();
    await page.getByTestId('row-payroll-1').getByRole('button', { expanded: false }).click();
    await expect(page.getByTestId('value-payroll-insurance-salary-1')).toContainText('792,000');
    await expect(page.getByTestId('value-payroll-receivable-1')).toContainText('50,000');
    await page.getByTestId('button-payroll-adjustment-1').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('value-payroll-bank-account')).toHaveText('MN000000000000000002');
    await expect(page.getByTestId('input-payroll-paid-amount')).toHaveValue('200000');
    expect(state.writes).toEqual([]);
  });
}

for (const role of ['accountant', 'viewer']) {
  test(`${role} does not gain month-closure rights from either submenu`, async ({ page }) => {
    await setup(page, role);
    for (const section of ['advance', 'final']) {
      await page.goto('/payroll?month=2026-11&section=' + section);
      await expect(page.getByRole('heading', { name: section === 'advance' ? 'Урьдчилгаа цалин' : 'Сүүл цалин', exact: true })).toBeVisible();
      await expect(page.getByTestId('button-close-payroll-month')).toHaveCount(0);
      await expect(page.getByTestId('button-reopen-payroll-month')).toHaveCount(0);
      if (role === 'viewer') {
        await expect(page.getByTestId('button-payroll-adjustment-1')).toHaveCount(0);
        await expect(page.getByTestId('button-advance-paid-1')).toHaveCount(0);
      }
    }
  });
}

for (const role of ['warehouse', 'hr']) test(`${role} cannot expose payroll child menus beyond existing role ceiling`, async ({ page }) => {
  await setup(page, role);
  await page.goto('/payroll?section=advance');
  await expect(page.getByTestId('button-toggle-nav-payroll')).toHaveCount(0);
  await expect(page.getByTestId('link-nav-payroll-advance')).toHaveCount(0);
  await expect(page.getByTestId('section-payroll-advance')).toHaveCount(0);
});

test('both submenus export the selected month and retain the existing schedule editor', async ({ page }) => {
  const state = await setup(page);
  const downloads: string[] = [];
  await page.route(/\/api\/payroll\/(export|social-insurance-report)\?/, async route => {
    downloads.push(route.request().url().split('/api/')[1]);
    return route.fulfill({ body: 'fixture-workbook', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  });
  for (const section of ['advance', 'final']) {
    await page.goto('/payroll?month=2026-09&section=' + section);
    await page.getByLabel('Цалингийн тайлан экспортлох').click();
    for (const [id, filename] of [['button-download-payroll-workbook', 'Payroll'], ['button-download-insurance-report', 'NDSH']]) {
      const pending = page.waitForEvent('download');
      await page.getByTestId(id).click();
      expect((await pending).suggestedFilename()).toBe(filename + '-2026-09.xlsx');
    }
    await page.getByTestId('button-payroll-schedule-settings').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  expect(downloads).toEqual(['payroll/export?month=2026-09', 'payroll/social-insurance-report?month=2026-09',
    'payroll/export?month=2026-09', 'payroll/social-insurance-report?month=2026-09']);
  expect(state.writes).toEqual([]);
});

test('saved-data failure offers retry rather than showing an empty paid register', async ({ page }) => {
  const state = await setup(page);
  state.fail();
  await page.goto('/payroll?section=final');
  await expect(page.getByTestId('button-retry')).toBeVisible();
  await expect(page.getByTestId('payroll-table')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
