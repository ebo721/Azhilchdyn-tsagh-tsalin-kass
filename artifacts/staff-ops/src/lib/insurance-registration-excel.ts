import ExcelJS from 'exceljs';
import type { Employee } from '@workspace/api-client-react';

function registrationRows(employees: Employee[]) {
  const activeEmployees = employees.filter(employee => employee.status === 'active');
  if (!activeEmployees.length) throw new Error('НДШ-д бүртгэх идэвхтэй ажилтан алга.');

  const missing = activeEmployees.flatMap(employee => {
    const profile = employee.socialInsuranceProfile;
    const fields = [
      !profile?.registrationNumber?.trim() && 'регистрийн дугаар',
      !profile?.givenName?.trim() && 'НДШ-ийн нэр',
      !profile?.parentName?.trim() && 'эцэг/эхийн нэр',
    ].filter((field): field is string => Boolean(field));
    return fields.length ? [`${employee.name}: ${fields.join(', ')}`] : [];
  });

  if (missing.length) {
    const sample = missing.slice(0, 8).join('\n');
    const remaining = missing.length > 8 ? `\n... болон өөр ${missing.length - 8} ажилтан` : '';
    throw new Error(`НДШ Excel бэлтгэхэд шаардлагатай мэдээлэл дутуу байна:\n${sample}${remaining}`);
  }

  return activeEmployees.map(employee => ({
    registrationNumber: employee.socialInsuranceProfile!.registrationNumber.trim(),
    givenName: employee.socialInsuranceProfile!.givenName!.trim(),
    parentName: employee.socialInsuranceProfile!.parentName.trim(),
  }));
}

/** Build the exact three-column employee-registration template used by the insurance system. */
export function buildInsuranceRegistrationWorkbook(employees: Employee[]) {
  const rows = registrationRows(employees);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('data');
  sheet.columns = [
    { header: 'Регистрийн дугаар', key: 'registrationNumber', width: 22 },
    { header: 'Нэр', key: 'givenName', width: 24 },
    { header: 'Овог', key: 'parentName', width: 24 },
  ];
  rows.forEach(row => sheet.addRow(row));
  return workbook;
}

export async function downloadInsuranceRegistrationExcel(employees: Employee[]) {
  const workbook = buildInsuranceRegistrationWorkbook(employees);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'NDaatgal-ajiltan-burtgel.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
