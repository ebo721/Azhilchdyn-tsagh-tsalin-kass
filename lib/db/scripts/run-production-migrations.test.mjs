import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertMigrationHasNoTransactionControl,
  discoverForwardMigrations,
  migrationChecksum,
  reconcileMigrationLedger,
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