import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEmployeeInsuranceRowPresentation } from './employee-insurance-import-view.js';

const duplicateWarning = 'Ижил мэдээлэлтэй олон ажилтан байна. Аль ажилтан болохыг сонгоно уу.';

test('an unresolved ambiguous employee keeps the prompt', () => {
  const result = getEmployeeInsuranceRowPresentation('ambiguous', [duplicateWarning], undefined);
  assert.equal(result.label, 'Олон нэр төстэй');
  assert.deepEqual(result.issues, [duplicateWarning]);
});

test('choosing an employee clears the duplicate prompt and confirms the choice', () => {
  const result = getEmployeeInsuranceRowPresentation('ambiguous', [duplicateWarning], 12);
  assert.equal(result.label, 'Сонгосон');
  assert.deepEqual(result.issues, []);
});

test('skipping an ambiguous row also clears the employee-selection prompt', () => {
  const result = getEmployeeInsuranceRowPresentation('ambiguous', [duplicateWarning], null);
  assert.equal(result.label, 'Алгасахаар сонгосон');
  assert.deepEqual(result.issues, []);
});

test('selection does not hide a real invalid-row error', () => {
  const result = getEmployeeInsuranceRowPresentation('invalid', ['Регистрийн дугаар буруу байна.'], null);
  assert.equal(result.label, 'Буруу мөр');
  assert.deepEqual(result.issues, ['Регистрийн дугаар буруу байна.']);
});
