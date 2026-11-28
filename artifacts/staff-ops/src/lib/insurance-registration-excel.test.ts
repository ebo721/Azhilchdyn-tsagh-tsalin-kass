import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import type { Employee } from '@workspace/api-client-react';
import { buildInsuranceRegistrationWorkbook } from './insurance-registration-excel';

const employee = (id: number, status: 'active' | 'inactive', profile: NonNullable<Employee['socialInsuranceProfile']>) => ({
  id, name: `Ажилтан ${id}`, role: 'Ажилтан', status, socialInsuranceProfile: profile,
}) as Employee;

test('insurance registration workbook matches the supplied three-column template and exports active employees only', async () => {
  const workbook = buildInsuranceRegistrationWorkbook([
    employee(1, 'active', { registrationNumber: '00123456', givenName: 'НЭР', parentName: 'ЭЦГИЙН НЭР' }),
    employee(2, 'inactive', { registrationNumber: '00234567', givenName: 'ХУУЧИН', parentName: 'ЭЦГИЙН НЭР' }),
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

test('registration export reports when no active employees exist', () => {
  assert.throws(() => buildInsuranceRegistrationWorkbook([
    employee(1, 'inactive', { registrationNumber: '00123456', givenName: 'НЭР', parentName: 'ЭЦГИЙН НЭР' }),
  ]), /идэвхтэй ажилтан алга/);
});
