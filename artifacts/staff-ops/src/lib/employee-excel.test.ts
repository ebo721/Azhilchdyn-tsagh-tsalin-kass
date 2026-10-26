import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import type { Employee } from '@workspace/api-client-react';
import { buildEmployeeWorkbook } from './employee-excel';

test('employee workbook round-trips all statuses, employee types, monthly shifts, and numeric salaries', async () => {
  const employees = [
    { id: 1, name: 'Оффис ажилтан', role: 'Нягтлан', status: 'active', employeeType: 'office',
      salaryType: 'monthly', baseSalary: 2200000, socialInsuranceSalary: 1500000,
      payFrequency: 'twice', joinedAt: '2026-01-01', inactiveAt: null, phone: '00123456' },
    { id: 2, name: '=HYPERLINK("https://invalid.example")', role: 'Ээлжийн ажилтан', status: 'inactive', employeeType: 'shift',
      salaryType: 'daily', baseSalary: 75000, socialInsuranceSalary: 0,
      payFrequency: 'once', joinedAt: '2025-02-01', inactiveAt: '2026-10-15', phone: '' },
    { id: 3, name: 'Хуваарьгүй ажилтан', role: 'Ажилтан', status: 'active', employeeType: 'shift',
      salaryType: 'monthly', baseSalary: 1000000, socialInsuranceSalary: 800000,
      payFrequency: 'once', joinedAt: '2026-10-01', inactiveAt: null, phone: '' },
  ] as Employee[];
  const workbook = buildEmployeeWorkbook(employees, [{ id: 1, name: 'А ээлж' }, { id: 2, name: 'Б ээлж' }],
    [{ employeeId: 2, shiftId: 1 }, { employeeId: 2, shiftId: 1 }, { employeeId: 2, shiftId: 2 }], '2026-10');
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = result.getWorksheet('Ажилчид')!;
  assert.equal(sheet.rowCount, 4);
  assert.equal(sheet.getCell('D2').value, 'Идэвхтэй');
  assert.equal(sheet.getCell('D3').value, 'Идэвхгүй');
  assert.equal(sheet.getCell('E2').value, 'Оффис');
  assert.equal(sheet.getCell('E3').value, 'Ээлж');
  assert.equal(sheet.getCell('F1').value, 'Ээлж (2026-10)');
  assert.equal(sheet.getCell('F2').value, 'Хамаарахгүй');
  assert.equal(sheet.getCell('F3').value, 'А ээлж, Б ээлж');
  assert.equal(sheet.getCell('F4').value, 'Хуваарьгүй');
  assert.equal(sheet.getCell('H2').value, 2200000);
  assert.equal(sheet.getCell('I2').value, 1500000);
  assert.equal(sheet.getCell('I3').value, 0);
  assert.equal(sheet.getCell('H3').numFmt, '#,##0.00');
  assert.equal(sheet.getCell('L3').value, '2026-10-15');
  assert.equal(sheet.getCell('M2').value, '00123456');
  assert.equal(sheet.getCell('B3').type, ExcelJS.ValueType.String);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.ok(sheet.autoFilter);
});
