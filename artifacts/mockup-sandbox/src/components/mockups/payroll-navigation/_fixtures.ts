// Fictional review data only. No employee records or financial services are queried.
export const demoEmployees = [
  { id: 1, name: 'Б. Энхжин', job: 'Нягтлан бодогч', employeeType: 'office', gross: 2800000, advance: 900000, advanceDeduction: 100000, advancePaid: 800000, deductions: 1394000, finalPaid: 600000 },
  { id: 2, name: 'Д. Тэмүүлэн', job: 'Ээлжийн ахлагч', employeeType: 'shift', gross: 2400000, advance: 800000, advanceDeduction: 0, advancePaid: 800000, deductions: 1212000, finalPaid: 0 },
  { id: 3, name: 'С. Номин', job: 'Оффисын ажилтан', employeeType: 'office', gross: 2200000, advance: 700000, advanceDeduction: 150000, advancePaid: 300000, deductions: 1076500, finalPaid: 1123500 },
  { id: 4, name: 'Г. Билгүүн', job: 'Үйлдвэрийн ажилтан', employeeType: 'shift', gross: 1950000, advance: 650000, advanceDeduction: 50000, advancePaid: 0, deductions: 981375, finalPaid: 0 },
  { id: 5, name: 'О. Саруул', job: 'Нярав', employeeType: 'office', gross: 2300000, advance: 750000, advanceDeduction: 0, advancePaid: 750000, deductions: 1144250, finalPaid: 400000 },
  { id: 6, name: 'М. Ананд', job: 'Үйлдвэрийн ажилтан', employeeType: 'shift', gross: 1800000, advance: 600000, advanceDeduction: 0, advancePaid: 0, deductions: 903750, finalPaid: 0 },
  { id: 7, name: 'А. Хүслэн', job: 'Ээлжийн ажилтан', employeeType: 'shift', gross: 2100000, advance: 700000, advanceDeduction: 100000, advancePaid: 600000, deductions: 1050250, finalPaid: 1049750 },
  { id: 8, name: 'Э. Мишээл', job: 'Оффисын ажилтан', employeeType: 'office', gross: 2600000, advance: 850000, advanceDeduction: 0, advancePaid: 400000, deductions: 1309500, finalPaid: 0 },
];
export const payrollLines = demoEmployees.map(e => ({
  employeeId: e.id, employeeName: e.name, employeeType: e.employeeType, role: e.job,
  gross: e.gross, baseSalary: e.gross, totalSalary: e.gross, dailySalary: e.gross / 21,
  daysWorked: 21, socialInsuranceSalary: e.gross, socialInsurance: e.gross * .115,
  incomeTax: e.deductions - e.advance - e.gross * .115, taxRelief: 0,
  advanceAmount: e.advance, manualDeduction: 0, deductions: e.deductions,
  paidAmount: e.finalPaid, paymentDate: e.finalPaid ? '2026-12-05' : null,
  secondPaidAmount: 0, secondPaymentDate: null, additionalPayments: [],
  carryoverAmount: 0, calculationReady: true, attendanceNeedsRefresh: false,
  openingBalanceReviewRequired: false, bankAccountNumber: null,
}));
export const advanceLines = demoEmployees.map(e => ({
  employeeId: e.id, employeeName: e.name, employeeType: e.employeeType, role: e.job,
  baseSalary: e.gross, daysWorked: 11, dailySalary: e.gross / 21, totalSalary: e.gross * 11 / 21,
  advanceAmount: e.advance, paidAmount: e.advancePaid, receivableDeduction: e.advanceDeduction,
  paid: e.advancePaid >= e.advance - e.advanceDeduction,
  remainingBalance: e.advance - e.advanceDeduction - e.advancePaid,
  paymentDate: e.advancePaid ? '2026-11-20' : null, bankAccountNumber: null,
  payments: e.advancePaid ? [{ sequence: 1, date: '2026-11-20', amount: e.advancePaid }] : [],
}));
export const demoPeriod = {
  month: '2026-11', periodStart: '2026-11-01', periodEnd: '2026-11-30',
  advancePeriodEnd: '2026-11-15', advancePaymentDate: '2026-11-20',
  finalPaymentDate: '2026-12-05', periodStartDay: 1, periodEndDay: 30,
  advanceCutoffDay: 15, advancePayDay: 20, finalPayDay: 5,
  closedAt: null, openingBalanceMonth: '2026-01',
  attendancePulledAt: '2026-11-28T10:42:00+08:00', attendanceNeedsRefresh: false,
};
