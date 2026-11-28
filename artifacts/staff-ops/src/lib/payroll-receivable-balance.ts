type EmployeeReceivable = { partyType: string; partyId: number; openAmount: number };

export function payrollReceivableBalance(rows: EmployeeReceivable[], employeeId: number, savedDeduction = 0) {
  const open = Math.round(rows.filter(row => row.partyType === 'employee' && row.partyId === employeeId)
    .reduce((sum, row) => sum + row.openAmount, 0) * 100) / 100;
  return { open, available: Math.round((open + savedDeduction) * 100) / 100 };
}
