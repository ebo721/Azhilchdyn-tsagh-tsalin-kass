import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";

type MappingEntry = {
  value: string;
  accountCode: string;
  accountType: string;
};

type ClassifierConfig = {
  name: string;
  mappings: MappingEntry[];
};

type AllowedAccountConfig = {
  name: string;
  allowedAccounts: Array<Omit<MappingEntry, "value">>;
};

const environment = process.argv
  .find((argument) => argument.startsWith("--env="))
  ?.slice("--env=".length);

if (environment !== "development" && environment !== "production") {
  console.error("Usage: pnpm --filter @workspace/scripts run validate-mapping -- --env=development|production");
  process.exit(2);
}

const connectionString = environment === "production"
  ? process.env.PRODUCTION_DATABASE_URL
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    environment === "production"
      ? "PRODUCTION_DATABASE_URL is required for --env=production"
      : "DATABASE_URL is required for --env=development",
  );
  process.exit(2);
}

process.env.DATABASE_URL = connectionString;

const loadJson = async <T>(fileName: string): Promise<T> =>
  JSON.parse(await readFile(
    new URL(`../../lib/db/mappings/${fileName}`, import.meta.url),
    "utf8",
  )) as T;

const [inventoryConfig, cashConfig, operatingConfig] = await Promise.all([
  loadJson<ClassifierConfig>("inventory-purchase-material-types.json"),
  loadJson<ClassifierConfig>("cash-transaction-categories.json"),
  loadJson<AllowedAccountConfig>("operating-expense-account-codes.json"),
]);

const {
  cashTransactionsTable,
  chartOfAccountsTable,
  db,
  inventoryPurchasesTable,
  operatingExpensesTable,
  pool,
} = await import("@workspace/db");

const errors: string[] = [];
const passes: string[] = [];

function validateConfig(
  config: ClassifierConfig,
  accountsByCode: Map<string, { type: string }>,
) {
  const mappings = new Map<string, MappingEntry>();
  for (const mapping of config.mappings) {
    if (mappings.has(mapping.value)) {
      errors.push(`${config.name}: config-д "${mapping.value}" давхар бүртгэгдсэн`);
    }
    mappings.set(mapping.value, mapping);
    const account = accountsByCode.get(mapping.accountCode);
    if (!account) {
      errors.push(`${config.name}: account code ${mapping.accountCode} chart_of_accounts-д байхгүй`);
    } else if (account.type !== mapping.accountType) {
      errors.push(`${config.name}: account ${mapping.accountCode} төрөл ${account.type}, expected ${mapping.accountType}`);
    }
  }
  return mappings;
}

try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);

    const accounts = await tx.select({
      code: chartOfAccountsTable.code,
      type: chartOfAccountsTable.type,
    }).from(chartOfAccountsTable);
    const accountsByCode = new Map(accounts.map((account) => [account.code, account]));

    const inventoryMappings = validateConfig(inventoryConfig, accountsByCode);
    const inventoryRows = await tx.select({
      id: inventoryPurchasesTable.id,
      classifier: inventoryPurchasesTable.materialType,
      accountCode: chartOfAccountsTable.code,
    }).from(inventoryPurchasesTable)
      .leftJoin(chartOfAccountsTable, sql`${inventoryPurchasesTable.accountId} = ${chartOfAccountsTable.id}`);
    for (const row of inventoryRows) {
      const expected = inventoryMappings.get(row.classifier);
      if (!expected) {
        errors.push(`${inventoryConfig.name}: mapping-гүй утга "${row.classifier}" (row id ${row.id})`);
      } else if (row.accountCode !== expected.accountCode) {
        errors.push(`${inventoryConfig.name}: row id ${row.id}, "${row.classifier}" → ${row.accountCode ?? "NULL"}, expected ${expected.accountCode}`);
      }
    }
    if (!errors.some((error) => error.startsWith(`${inventoryConfig.name}:`))) {
      passes.push(`${inventoryConfig.name}: ${inventoryRows.length} мөр зөв`);
    }

    const cashMappings = validateConfig(cashConfig, accountsByCode);
    const cashRows = await tx.select({
      id: cashTransactionsTable.id,
      classifier: cashTransactionsTable.category,
      accountCode: chartOfAccountsTable.code,
    }).from(cashTransactionsTable)
      .leftJoin(chartOfAccountsTable, sql`${cashTransactionsTable.accountId} = ${chartOfAccountsTable.id}`);
    for (const row of cashRows) {
      const expected = cashMappings.get(row.classifier);
      if (!expected) {
        errors.push(`${cashConfig.name}: mapping-гүй утга "${row.classifier}" (row id ${row.id})`);
      } else if (row.accountCode !== expected.accountCode) {
        errors.push(`${cashConfig.name}: row id ${row.id}, "${row.classifier}" → ${row.accountCode ?? "NULL"}, expected ${expected.accountCode}`);
      }
    }
    if (!errors.some((error) => error.startsWith(`${cashConfig.name}:`))) {
      passes.push(`${cashConfig.name}: ${cashRows.length} мөр зөв`);
    }

    const allowedOperatingAccounts = new Map(
      operatingConfig.allowedAccounts.map((account) => [account.accountCode, account]),
    );
    for (const expected of operatingConfig.allowedAccounts) {
      const account = accountsByCode.get(expected.accountCode);
      if (!account) {
        errors.push(`${operatingConfig.name}: account code ${expected.accountCode} chart_of_accounts-д байхгүй`);
      } else if (account.type !== expected.accountType) {
        errors.push(`${operatingConfig.name}: account ${expected.accountCode} төрөл ${account.type}, expected ${expected.accountType}`);
      }
    }
    const operatingRows = await tx.select({
      id: operatingExpensesTable.id,
      accountCode: chartOfAccountsTable.code,
      accountType: chartOfAccountsTable.type,
    }).from(operatingExpensesTable)
      .leftJoin(chartOfAccountsTable, sql`${operatingExpensesTable.accountId} = ${chartOfAccountsTable.id}`);
    for (const row of operatingRows) {
      if (!row.accountCode) {
        errors.push(`${operatingConfig.name}: row id ${row.id} дансгүй`);
      } else {
        const expected = allowedOperatingAccounts.get(row.accountCode);
        if (!expected) {
          errors.push(`${operatingConfig.name}: row id ${row.id} зөвшөөрөөгүй account ${row.accountCode}`);
        } else if (row.accountType !== expected.accountType) {
          errors.push(`${operatingConfig.name}: row id ${row.id}, account ${row.accountCode} төрөл ${row.accountType ?? "NULL"}, expected ${expected.accountType}`);
        }
      }
    }
    if (!errors.some((error) => error.startsWith(`${operatingConfig.name}:`))) {
      passes.push(`${operatingConfig.name}: ${operatingRows.length} мөр зөв`);
    }
  });
} finally {
  await pool.end();
}

console.log(`Account mapping validation (${environment}, read-only)`);
for (const pass of passes) console.log(`PASS  ${pass}`);
if (errors.length) {
  for (const error of errors) console.error(`FAIL  ${error}`);
  console.error(`Result: FAIL (${errors.length} алдаа)`);
  process.exit(1);
}
console.log("Result: PASS");