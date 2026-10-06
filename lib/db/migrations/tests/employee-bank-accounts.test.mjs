import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

test("bank account backfill uses the latest verified salary recipient and never the funding account", async () => {
  const host = (url) => new URL(url).hostname.replace("-pooler", "");
  if (!process.env.DATABASE_URL) throw new Error("Development DATABASE_URL is required");
  if (process.env.PRODUCTION_DATABASE_URL && host(process.env.DATABASE_URL) === host(process.env.PRODUCTION_DATABASE_URL)) {
    throw new Error("Refusing to run against production");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `bank_account_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`
      CREATE TABLE "${schema}".employees (id integer PRIMARY KEY);
      CREATE TABLE "${schema}".cash_transactions (
        id integer PRIMARY KEY, source_key text, source_type text, type text,
        bank_transaction_id integer, bank_verified_at timestamptz);
      CREATE TABLE "${schema}".bank_transactions (
        id integer PRIMARY KEY, cash_transaction_id integer, account text,
        bank_account_number text, type text, executed_at timestamptz, transaction_at timestamptz);
      INSERT INTO "${schema}".employees SELECT generate_series(1,8);
      INSERT INTO "${schema}".cash_transactions VALUES
        (1,'2026-08:1','payroll','expense',1,now()),
        (2,'2026-09:1:2','payroll','expense',2,now()),
        (3,'2026-09:2','payroll_advance','expense',3,now()),
        (4,'2026-09:3','payroll','expense',99,now()),
        (5,'2026-09:4','payroll','expense',5,NULL),
        (6,'2026-08:5','payroll','expense',6,now()),
        (7,'2026-09:5','payroll','expense',7,now()),
        (8,'2026-09:6','payroll','expense',8,now()),
        (9,'2026-09:7','payroll','expense',9,now());
      INSERT INTO "${schema}".bank_transactions VALUES
        (1,1,'MN000000000000000001','MN999999999999999999','expense',NULL,'2026-08-05'),
        (2,2,'MN00 0000 0000 0000 0002','MN999999999999999999','expense',NULL,'2026-09-05'),
        (3,3,'MN000000000000000003','MN999999999999999999','expense',NULL,'2026-09-05'),
        (4,4,'MN000000000000000004','MN999999999999999999','expense',NULL,'2026-09-05'),
        (5,5,'MN000000000000000005','MN999999999999999999','expense',NULL,'2026-09-05'),
        (6,6,'MN000000000000000006','MN999999999999999999','expense',NULL,'2026-08-05'),
        (7,7,'MN00********00000007','MN999999999999999999','expense',NULL,'2026-09-05'),
        (8,8,'001234567890','MN999999999999999999','expense',NULL,'2026-09-05'),
        (9,9,'MN000000000000000009','MN999999999999999999','income',NULL,'2026-09-05');
    `);
    const migration = (await readFile(new URL("../20261009_employee_bank_accounts.sql", import.meta.url), "utf8"))
      .replaceAll("public.", `"${schema}".`);
    await client.query(migration);
    const accounts = async () => (await client.query(`SELECT bank_account_number FROM "${schema}".employees ORDER BY id`))
      .rows.map((row) => row.bank_account_number);
    assert.deepEqual(await accounts(), ["MN000000000000000002", "", "", "", "", "001234567890", "", ""]);
    await client.query(`UPDATE "${schema}".employees SET bank_account_number = '009999999999' WHERE id=1`);
    await client.query(migration);
    assert.equal((await accounts())[0], "009999999999", "reruns must preserve manually entered accounts");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
