import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertMigrationHasNoTransactionControl,
  discoverForwardMigrations,
  migrationChecksum,
  reconcileMigrationLedger,
  managedSchemaFingerprint,
} from "./run-production-migrations.mjs";

describe("production migration runner", () => {
  it("discovers only forward migrations in deterministic order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "db-migrations-"));
    await Promise.all([
      writeFile(path.join(directory, "20260925_second.sql"), "SELECT 2;"),
      writeFile(path.join(directory, "20260924_first.sql"), "SELECT 1;"),
      writeFile(path.join(directory, "20260924_first.rollback.sql"), "SELECT 0;"),
      writeFile(path.join(directory, "README.md"), "ignored"),
    ]);
    assert.deepEqual(await discoverForwardMigrations(directory), [
      "20260924_first.sql",
      "20260925_second.sql",
    ]);
  });

  it("keeps the production manifest, forward SQL, and rollback SQL in parity", async () => {
    const policy = JSON.parse(await readFile(new URL("../production-migrations.json", import.meta.url), "utf8"));
    const discovered = (await discoverForwardMigrations()).filter((name) => name >= policy.managedStart);
    assert.deepEqual(discovered, policy.migrations.map((migration) => migration.filename));
    for (const filename of discovered) {
      const rollback = filename.replace(/\.sql$/, ".rollback.sql");
      await assert.doesNotReject(readFile(new URL(`../migrations/${rollback}`, import.meta.url)));
    }
    const forward = await readFile(new URL("../migrations/20260924_receivable_allocations.sql", import.meta.url), "utf8");
    const rollback = await readFile(new URL("../migrations/20260924_receivable_allocations.rollback.sql", import.meta.url), "utf8");
    for (const marker of ["receivables", "receivable_allocations", "receivables_status_balance_check", "origin_journal_line_id", "settlement_journal_line_id"]) {
      assert.match(forward, new RegExp(marker));
    }
    for (const marker of ["DROP TABLE IF EXISTS receivable_allocations", "DROP TABLE IF EXISTS receivables", "DROP COLUMN IF EXISTS allocation"]) {
      assert.match(rollback, new RegExp(marker));
    }
  });

  it("fingerprints receivable tables, constraints, indexes, triggers, and functions", async () => {
    let fingerprintQuery = "";
    const client = { query: async (query) => {
      fingerprintQuery = query;
      return { rows: [] };
    } };
    await managedSchemaFingerprint(client);
    for (const marker of [
      "receivables", "receivable_allocations", "receivables_status_balance_check",
      "receivables_journal_line_parent_trigger", "validate_receivable_journal_line_links",
      "pg_get_triggerdef", "pg_get_functiondef",
    ]) assert.match(fingerprintQuery, new RegExp(marker));
  });

  it("rejects transaction control inside a migration", () => {
    assert.throws(
      () => assertMigrationHasNoTransactionControl("unsafe.sql", "SELECT 1; COMMIT; SELECT 2;"),
      /contains COMMIT/,
    );
    assert.doesNotThrow(
      () => assertMigrationHasNoTransactionControl("safe.sql", "SELECT 'COMMIT'; -- ROLLBACK\nALTER TABLE example ADD COLUMN value text;"),
    );
  });

  it("rejects transaction control after another statement", () => {
    assert.throws(
      () => assertMigrationHasNoTransactionControl("unsafe.sql", "SELECT 1; COMMIT; SELECT 2;"),
      /contains COMMIT/,
    );
  });

  it("produces stable checksums and detects content changes", () => {
    assert.equal(migrationChecksum("SELECT 1;"), migrationChecksum("SELECT 1;"));
    assert.notEqual(migrationChecksum("SELECT 1;"), migrationChecksum("SELECT 2;"));
  });

  it("rejects changed, missing, and out-of-order applied migrations", () => {
    const migrations = [
      { filename: "20260921_first.sql", checksum: "one" },
      { filename: "20260922_second.sql", checksum: "two" },
    ];
    assert.deepEqual(reconcileMigrationLedger(migrations, [
      { filename: "20260921_first.sql", checksum: "one" },
    ]), [migrations[1]]);
    assert.throws(
      () => reconcileMigrationLedger(migrations, [{ filename: "missing.sql", checksum: "x" }]),
      /missing or renamed/,
    );
    assert.throws(
      () => reconcileMigrationLedger(migrations, [{ filename: "20260921_first.sql", checksum: "changed" }]),
      /checksum changed/,
    );
    assert.throws(
      () => reconcileMigrationLedger(migrations, [{ filename: "20260922_second.sql", checksum: "two" }]),
      /out of order/,
    );
  });
});