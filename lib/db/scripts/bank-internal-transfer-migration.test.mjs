import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { managedSchemaFingerprint } from "./run-production-migrations.mjs";

test("internal-transfer expand migration and rollback preserve all bank/accounting data", { skip: !process.env.DATABASE_URL }, async () => {
  // Never run rollback DDL against public while the app or other suites are active.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const policy = JSON.parse(await readFile(new URL("../production-migrations.json", import.meta.url), "utf8"));
    assert.equal(await managedSchemaFingerprint(client), policy.schemaFingerprint);
    const schema = `transfer_migration_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`CREATE TABLE "${schema}".bank_transactions (id integer PRIMARY KEY);
      CREATE TABLE "${schema}".cash_transactions (id integer PRIMARY KEY);
      CREATE TABLE "${schema}".journal_entries (id integer PRIMARY KEY);
      INSERT INTO "${schema}".bank_transactions VALUES (1), (2);
      INSERT INTO "${schema}".cash_transactions VALUES (1);
      INSERT INTO "${schema}".journal_entries VALUES (1)`);
    const forward = (await readFile(new URL("../migrations/20261020_bank_internal_transfers.sql", import.meta.url), "utf8")).replaceAll("public.", `"${schema}".`);
    const rollback = (await readFile(new URL("../migrations/20261020_bank_internal_transfers.rollback.sql", import.meta.url), "utf8")).replaceAll("public.", `"${schema}".`);
    await client.query(forward);
    await client.query("INSERT INTO bank_internal_transfers (out_bank_transaction_id, in_bank_transaction_id) VALUES (1,2)");
    const pair = (await client.query("SELECT * FROM bank_internal_transfers")).rows[0];
    assert.equal(pair.fee_amount, "0.00");
    assert.equal(pair.created_by, null);
    assert.ok(pair.created_at instanceof Date);
    for (const [statement, code] of [
      ["INSERT INTO bank_internal_transfers (out_bank_transaction_id,in_bank_transaction_id) VALUES (1,2)", "23505"],
      ["DELETE FROM bank_transactions WHERE id=1", "23001"],
      ["DELETE FROM bank_transactions WHERE id=2", "23001"],
      ["UPDATE bank_internal_transfers SET fee_amount=-1", "23514"],
      ["UPDATE bank_internal_transfers SET in_bank_transaction_id=out_bank_transaction_id", "23514"],
    ]) {
      await client.query("SAVEPOINT constraint_check");
      await assert.rejects(client.query(statement), error => error.code === code || (code === "23001" && error.code === "23503"));
      await client.query("ROLLBACK TO SAVEPOINT constraint_check");
    }
    const counts = async () => (await client.query(`SELECT
      (SELECT count(*) FROM bank_transactions)::integer AS bank,
      (SELECT count(*) FROM cash_transactions)::integer AS cash,
      (SELECT count(*) FROM journal_entries)::integer AS journal`)).rows[0];
    const before = await counts();
    await client.query(rollback);
    assert.equal((await client.query("SELECT to_regclass($1) AS name", [`${schema}.bank_internal_transfers`])).rows[0].name, null);
    assert.deepEqual(await counts(), before);
    await client.query(forward);
    assert.deepEqual(await counts(), before);
    await client.query("SET LOCAL search_path TO public");
    assert.equal(await managedSchemaFingerprint(client), policy.schemaFingerprint);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
