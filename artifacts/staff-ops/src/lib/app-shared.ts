export const money = (value = 0) => `${new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 0 }).format(value)} ₮`;

export const dateLabel = (value: string) => {
  const calendarDate = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) {
    const [year, month, day] = value.split('-').map(Number);
    return `${year} оны ${month}-р сарын ${day}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()} оны ${date.getMonth() + 1}-р сарын ${date.getDate()}`;
};

export const today = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => new Date().toISOString().slice(0, 7);
export const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
export const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};