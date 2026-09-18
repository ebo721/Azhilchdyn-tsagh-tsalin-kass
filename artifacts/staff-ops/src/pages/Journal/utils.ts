import { format } from 'date-fns';

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return '-';
  if (amount === 0) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  try {
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    return format(parsed, 'yyyy-MM-dd');
  } catch {
    return dateStr;
  }
}
