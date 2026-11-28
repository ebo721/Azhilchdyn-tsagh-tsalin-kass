import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import type { Employee } from '@workspace/api-client-react';
import { buildInsuranceRegistrationWorkbook } from './insurance-registration-excel';

const employee = (
  id: number,
  status: 'active' | 'inactive',
  profile: NonNullable<Employee['socialInsuranceProfile']>,
  changes: Partial<Employee> = {},
) => ({
  id, name: `Ажилтан ${id}`, role: 'Ажилтан', status, socialInsuranceProfile: profile,
  socialInsuranceSalary: 1_000_000, payrollTaxExempt: false, ...changes,
}) as Employee;

test('insurance registration workbook matches the supplied template and exports only active insured employees', async () => {
  const workbook = buildInsuranceRegistrationWorkbook([
    employee(1, 'active', { registrationNumber: '00123456', givenName: 'НЭР', parentName: 'ЭЦГИЙН НЭР' }),
    employee(2, 'inactive', { registrationNumber: '00234567', givenName: 'ХУУЧИН', parentName: 'ЭЦГИЙН НЭР' }),
    employee(3, 'active', { registrationNumber: '', givenName: '', parentName: '' }, { payrollTaxExempt: true }),
    employee(4, 'active', { registrationNumber: '', givenName: '', parentName: '' }, { socialInsuranceSalary: 0 }),
  ]);
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(result.worksheets.map(sheet => sheet.name), ['data']);
  const sheet = result.getWorksheet('data')!;
  assert.equal(sheet.rowCount, 2);
  assert.deepEqual([sheet.getCell('A1').value, sheet.getCell('B1').value, sheet.getCell('C1').value],
    ['Регистрийн дугаар', 'Нэр', 'Овог']);
  assert.deepEqual([sheet.getCell('A2').value, sheet.getCell('B2').value, sheet.getCell('C2').value],
    ['00123456', 'НЭР', 'ЭЦГИЙН НЭР']);
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String);
});

test('registration export fails explicitly when active employee identity fields are incomplete', () => {
  assert.throws(() => buildInsuranceRegistrationWorkbook([
    employee(1, 'active', { registrationNumber: '', givenName: 'НЭР', parentName: '' }),
  ]), /регистрийн дугаар, эцэг\/эхийн нэр/);
});

test('registration export reports when no active employees owe social insurance', () => {
  assert.throws(() => buildInsuranceRegistrationWorkbook([
    employee(1, 'inactive', { registrationNumber: '00123456', givenName: 'НЭР', parentName: 'ЭЦГИЙН НЭР' }),
    employee(2, 'active', { registrationNumber: '00234567', givenName: 'ЧӨЛӨӨЛСӨН', parentName: 'ЭЦГИЙН НЭР' }, { payrollTaxExempt: true }),
    employee(3, 'active', { registrationNumber: '00345678', givenName: 'ТЭГ ЦАЛИН', parentName: 'ЭЦГИЙН НЭР' }, { socialInsuranceSalary: 0 }),
  ]), /НДШ төлөх идэвхтэй ажилтан алга/);
});
