type BankCandidate = {
  transactionAt: Date;
  amount: number | string;
  description: string;
  counterparty: string;
};

type DocumentCandidate = {
  date: string;
  amount: number | string;
  description: string;
};

export const descriptionTokens = (value: string) =>
  new Set(value.toLocaleLowerCase("mn-MN").match(/[\p{L}\p{N}]+/gu) ?? []);

/** One ranking policy for bank-to-cash, cash-to-bank, and bank-to-purchase suggestions. */
export function bankSuggestionScore(bank: BankCandidate, document: DocumentCandidate): number {
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  const distance = Math.abs((Date.parse(`${document.date}T00:00:00Z`) - Date.parse(`${bankDate}T00:00:00Z`)) / 86_400_000);
  const bankAmount = Number(bank.amount);
  const documentAmount = Number(document.amount);
  const amountCloseness = Math.max(0, 1 - Math.abs(bankAmount - documentAmount) / Math.max(bankAmount, documentAmount, 1));
  const bankTokens = descriptionTokens(`${bank.description} ${bank.counterparty}`);
  const documentTokens = descriptionTokens(document.description);
  const overlap = [...bankTokens].filter((token) => documentTokens.has(token)).length;
  const tokenOverlap = overlap / Math.max(new Set([...bankTokens, ...documentTokens]).size, 1);
  return Math.round((0.4 * (1 - distance / 7) + 0.35 * amountCloseness + 0.25 * tokenOverlap) * 10_000) / 100;
}