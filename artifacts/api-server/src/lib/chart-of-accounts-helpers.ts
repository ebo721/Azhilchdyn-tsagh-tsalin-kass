import { and, eq, inArray, sql } from "drizzle-orm";
import { chartOfAccountsTable } from "@workspace/db";
import { inventoryPurchaseAccountCodes, operatingExpenseAccountCodes, type DbClient } from "./route-shared.js";

export const defaultChartOfAccounts = [
  { code: "1000", name: "Бэлэн мөнгө (касс)", type: "asset", normalBalance: "debit" },
  { code: "1010", name: "Банкны данс", type: "asset", normalBalance: "debit" },
  { code: "1200", name: "Авлага", type: "asset", normalBalance: "debit" },
  { code: "1500", name: "Бараа материалын үлдэгдэл", type: "asset", normalBalance: "debit" },
  { code: "1510", name: "Хангамжийн материалын үлдэгдэл", type: "asset", normalBalance: "debit" },
  { code: "1800", name: "Үндсэн хөрөнгө", type: "asset", normalBalance: "debit" },
  { code: "1810", name: "Хуримтлагдсан элэгдэл", type: "asset", normalBalance: "credit" },
  { code: "2000", name: "Өглөг", type: "liability", normalBalance: "credit" },
  { code: "2100", name: "Цалингийн өглөг", type: "liability", normalBalance: "credit" },
  { code: "2200", name: "Татварын өглөг", type: "liability", normalBalance: "credit" },
  { code: "2300", name: "Банкны зээл", type: "liability", normalBalance: "credit" },
  { code: "3000", name: "Хувь нийлүүлэгчийн хөрөнгө", type: "equity", normalBalance: "credit" },
  { code: "3900", name: "Хуримтлагдсан ашиг/алдагдал", type: "equity", normalBalance: "credit" },
  { code: "4000", name: "Хоолны үйлчилгээний орлого", type: "revenue", normalBalance: "credit" },
  { code: "4900", name: "Бусад орлого", type: "revenue", normalBalance: "credit" },
  { code: "5000", name: "Бараа материалын зардал (COGS)", type: "expense", normalBalance: "debit" },
  { code: "6000", name: "Цалингийн зардал", type: "expense", normalBalance: "debit" },
  { code: "6010", name: "Нийгмийн даатгалын зардал", type: "expense", normalBalance: "debit" },
  { code: "6100", name: "Түрээсийн зардал", type: "expense", normalBalance: "debit" },
  { code: "6200", name: "Тээврийн зардал", type: "expense", normalBalance: "debit" },
  { code: "6300", name: "Цахилгаан, дулаан, ус", type: "expense", normalBalance: "debit" },
  { code: "6400", name: "Харилцаа холбоо, интернэт", type: "expense", normalBalance: "debit" },
  { code: "6500", name: "Засвар үйлчилгээ", type: "expense", normalBalance: "debit" },
  { code: "6600", name: "Элэгдлийн зардал", type: "expense", normalBalance: "debit" },
  { code: "6900", name: "Бусад үйл ажиллагааны зардал", type: "expense", normalBalance: "debit" },
] as const;

export async function ensureDefaultChartOfAccounts(tx: DbClient) {
  await tx.insert(chartOfAccountsTable).values([...defaultChartOfAccounts]).onConflictDoNothing({
    target: chartOfAccountsTable.code,
  });
  const conflicting = await tx.select({ code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable)
    .where(and(inArray(chartOfAccountsTable.code, [...operatingExpenseAccountCodes]), sql`${chartOfAccountsTable.type} <> 'expense'`));
  if (conflicting.length) {
    throw new Error(`Reserved operating expense account codes have a non-expense type: ${conflicting.map((row: { code: string }) => row.code).join(", ")}`);
  }
  const conflictingInventoryAccounts = await tx.select({ code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable)
    .where(and(inArray(chartOfAccountsTable.code, [...inventoryPurchaseAccountCodes]), sql`${chartOfAccountsTable.type} <> 'asset'`));
  if (conflictingInventoryAccounts.length) {
    throw new Error(`Reserved inventory account codes have a non-asset type: ${conflictingInventoryAccounts.map((row: { code: string }) => row.code).join(", ")}`);
  }
}

export async function inventoryPurchaseAccount(tx: DbClient, materialType: string) {
  await ensureDefaultChartOfAccounts(tx);
  const code = materialType === "food" ? "1500" : "1510";
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, code),
    eq(chartOfAccountsTable.type, "asset"),
  ));
  if (!account) throw new Error(`Inventory account ${code} is missing or has an invalid type`);
  return account;
}

export async function fallbackExpenseAccount(tx: DbClient, category: string) {
  await ensureDefaultChartOfAccounts(tx);
  const normalized = category.toLocaleLowerCase("mn-MN");
  const preferredCode = normalized.includes("түрээс") ? "6100"
    : normalized.includes("тээвэр") || normalized.includes("шатахуун") ? "6200"
      : normalized.includes("цахилгаан") || normalized.includes("дулаан") || normalized.includes("ус") ? "6300"
        : normalized.includes("интернет") || normalized.includes("холбоо") ? "6400"
          : normalized.includes("засвар") ? "6500"
            : "6900";
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, preferredCode),
    eq(chartOfAccountsTable.type, "expense"),
  ));
  if (!account) throw new Error(`Expense account ${preferredCode} is missing or has an invalid type`);
  return account;
}