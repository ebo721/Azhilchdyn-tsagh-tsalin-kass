import { inArray } from "drizzle-orm";
import { chartOfAccountsTable } from "./schema/index.js";
import { db, pool } from "./index.js";

export const defaultJournalAccounts = [
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

export async function seedJournalAccounts() {
  await db.transaction(async (tx) => {
    await tx.insert(chartOfAccountsTable).values([...defaultJournalAccounts]).onConflictDoNothing({
      target: chartOfAccountsTable.code,
    });

    const codes = defaultJournalAccounts.map((account) => account.code);
    const rows = await tx.select({
      code: chartOfAccountsTable.code,
      type: chartOfAccountsTable.type,
      normalBalance: chartOfAccountsTable.normalBalance,
    }).from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, codes));
    const expected = new Map<string, typeof defaultJournalAccounts[number]>(
      defaultJournalAccounts.map((account) => [account.code, account]),
    );
    const conflicts = rows.filter((row) => {
      const account = expected.get(row.code);
      return !account || row.type !== account.type || row.normalBalance !== account.normalBalance;
    });
    const missing = codes.filter((code) => !rows.some((row) => row.code === code));
    if (missing.length || conflicts.length) {
      const details = [
        ...missing.map((code) => `${code} is missing after insert`),
        ...conflicts.map((row) => {
          const account = expected.get(row.code);
          return `${row.code} has type=${row.type}, normalBalance=${row.normalBalance}; expected type=${account?.type}, normalBalance=${account?.normalBalance}`;
        }),
      ];
      throw new Error(`Journal account seed validation failed: ${details.join("; ")}`);
    }
  });
}

try {
  await seedJournalAccounts();
  console.log(`Ensured ${defaultJournalAccounts.length} default journal accounts`);
} finally {
  await pool.end();
}