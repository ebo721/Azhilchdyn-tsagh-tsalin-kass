export function formatMealSlotTimeRange(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}${endTime < startTime ? ' (дараагийн өдөр)' : ''}`;
}