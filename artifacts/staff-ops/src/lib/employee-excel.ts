import ExcelJS from 'exceljs';
import type { Employee } from '@workspace/api-client-react';

type Shift = { id: number; name: string };
type Plan = { employeeId: number; shiftId: number };

/** Export the saved employee roster, with assignments from the selected month only. */
export function buildEmployeeWorkbook(employees: Employee[], shifts: Shift[], plans: Plan[], month: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ажилчид', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '№', key: 'number', width: 6 },
    { header: 'Ажилтны нэр', key: 'name', width: 28 },
    { header: 'Албан тушаал', key: 'role', width: 24 },
    { header: 'Төлөв', key: 'status', width: 18 },
    { header: 'Ажилтны төрөл', key: 'type', width: 18 },
    { header: `Ээлж (${month})`, key: 'shifts', width: 32 },
    { header: 'Цалингийн төрөл', key: 'salaryType', width: 20 },
    { header: 'Үндсэн цалин', key: 'baseSalary', width: 20 },
    { header: 'НДШ төлөх цалин', key: 'socialInsuranceSalary', width: 22 },
    { header: 'Цалин олгох давтамж', key: 'payFrequency', width: 24 },
    { header: 'Ажилд орсон огноо', key: 'joinedAt', width: 22 },
    { header: 'Ажлаас гарсан огноо', key: 'inactiveAt', width: 24 },
    { header: 'Утас', key: 'phone', width: 18 },
  ];
  const shiftNames = new Map(shifts.map(shift => [shift.id, shift.name]));
  const assignments = new Map<number, Set<number>>();
  for (const plan of plans) {
    const assigned = assignments.get(plan.employeeId) ?? new Set<number>();
    assigned.add(plan.shiftId);
    assignments.set(plan.employeeId, assigned);
  }
  employees.forEach((employee, index) => {
    if (!Number.isFinite(employee.baseSalary) || !Number.isFinite(employee.socialInsuranceSalary)) {
      throw new Error('Ажилтны цалингийн мэдээлэл бүрэн биш байна. Жагсаалтыг дахин ачаална уу.');
    }
    const names = [...(assignments.get(employee.id) ?? [])]
      .map(id => shiftNames.get(id) ?? `Ээлж #${id}`).join(', ');
    // Strings are explicit string cells, never spreadsheet formulas.
    sheet.addRow({
      number: index + 1, name: employee.name, role: employee.role,
      status: employee.status === 'active' ? 'Идэвхтэй' : 'Идэвхгүй',
      type: employee.employeeType === 'office' ? 'Оффис' : 'Ээлж',
      shifts: employee.employeeType === 'office' ? 'Хамаарахгүй' : names || 'Хуваарьгүй',
      salaryType: employee.salaryType === 'monthly' ? 'Сарын' : 'Өдрийн',
      baseSalary: employee.baseSalary, socialInsuranceSalary: employee.socialInsuranceSalary,
      payFrequency: employee.payFrequency === 'twice' ? 'Сард 2 удаа' : 'Сард 1 удаа',
      joinedAt: employee.joinedAt ?? '', inactiveAt: employee.inactiveAt ?? '', phone: employee.phone ?? '',
    });
  });
  sheet.autoFilter = { from: 'A1', to: `M${Math.max(1, sheet.rowCount)}` };
  for (const column of ['baseSalary', 'socialInsuranceSalary']) sheet.getColumn(column).numFmt = '#,##0.00';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF285F54' } };
  sheet.getRow(1).height = 30;
  sheet.eachRow(row => { row.alignment = { vertical: 'middle', wrapText: true }; });
  return workbook;
}

export async function downloadEmployeeExcel(employees: Employee[], shifts: Shift[], plans: Plan[], month: string) {
  const workbook = buildEmployeeWorkbook(employees, shifts, plans, month);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Ajilchdiin-jagsaalt-${month}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the URL alive long enough for the browser's download to start.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
