export const today = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => today().slice(0, 7);
export const money = (value: number) => Math.round(value * 100) / 100;

export function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function isValidCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function hoursBetween(clockIn: string, clockOut: string) {
  const [inHour, inMinute] = clockIn.split(":").map(Number);
  const [outHour, outMinute] = clockOut.split(":").map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  return Math.max(0, money((end - start) / 60));
}

export function weekdayCount(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) count += 1;
  }
  return count;
}

export function monthWeekdays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) dates.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}