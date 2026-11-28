export const payrollSections = [
  { value: 'advance', label: 'Урьдчилгаа цалин' },
  { value: 'final', label: 'Сүүл цалин' },
] as const;
export type PayrollSection = typeof payrollSections[number]['value'];

export function parsePayrollSection(search: string): PayrollSection {
  return new URLSearchParams(search).get('section') === 'advance' ? 'advance' : 'final';
}

export function payrollSectionHref(section: PayrollSection, search = '') {
  const params = new URLSearchParams(search);
  params.set('section', section);
  return `/payroll?${params}`;
}

export function payrollMonth(search: string, fallback: string) {
  const value = new URLSearchParams(search).get('month') ?? '';
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}
