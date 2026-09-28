export const today = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => today().slice(0, 7);
export const money = (value: number) => Math.round(value * 100) / 100;