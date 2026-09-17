import { and, eq } from "drizzle-orm";
import { chartOfAccountsTable } from "@workspace/db";

const cashCategoryAccounts: Record<string, { code: string; type: string }> = {
  "Бараа материал": { code: "1500", type: "asset" },
  "Хангамжийн материал": { code: "1510", type: "asset" },
  "Хүнсний бараа материал": { code: "1500", type: "asset" },
  "Цалин": { code: "6000", type: "expense" },
  "Урьдчилгаа цалин": { code: "6000", type: "expense" },
  "Эд хөрөнгө": { code: "1800", type: "asset" },
  "Үйл ажиллагааны зардал": { code: "6900", type: "expense" },
  "Таван толгой ХХК": { code: "4000", type: "revenue" },
};

export const isCanonicalCashCategory = (category: string) =>
  Object.hasOwn(cashCategoryAccounts, category);

export const shouldMirrorCashAsOperatingExpense = (category: string) =>
  cashCategoryAccounts[category]?.code === "6900" || !isCanonicalCashCategory(category);

export async function cashAccountForCategory(tx: any, category: string) {
  const expected = cashCategoryAccounts[category];
  if (!expected) return null;
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, expected.code),
    eq(chartOfAccountsTable.type, expected.type),
  ));
  if (!account) {
    throw new Error(`Cash account ${expected.code} is missing or has an invalid type`);
  }
  return account;
}