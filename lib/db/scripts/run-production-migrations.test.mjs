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
    const forward = await readFile(new URL("../migrations/20260929_inventory_material_requests.sql", import.meta.url), "utf8");
    const rollback = await readFile(new URL("../migrations/20260929_inventory_material_requests.rollback.sql", import.meta.url), "utf8");
    const mealEditForward = await readFile(new URL("../migrations/20260930_meal_edit_requests.sql", import.meta.url), "utf8");
    const mealEditRollback = await readFile(new URL("../migrations/20260930_meal_edit_requests.rollback.sql", import.meta.url), "utf8");
    for (const marker of ["inventory_material_requests", "inventory_material_request_items", "requested_date", "quantity", "request_item_unique"]) {
      assert.match(forward, new RegExp(marker));
    }
    for (const marker of ["inventory_material_request_items", "inventory_material_requests"]) {
      assert.match(rollback, new RegExp(marker));
    }
    for (const marker of [
      "meal_edit_requests", "previous_name", "previous_category", "proposed_name", "proposed_category",
      "meal_edit_requests_status_check", "pending", "approved", "rejected",
    ]) assert.match(mealEditForward, new RegExp(marker));
    assert.match(mealEditForward, /CREATE UNIQUE INDEX IF NOT EXISTS meal_edit_requests_pending_meal_idx/);
    assert.match(mealEditRollback, /DROP TABLE IF EXISTS meal_edit_requests/);
    const mealCountsForward = await readFile(new URL("../migrations/20261001_reader_meal_counts.sql", import.meta.url), "utf8");
    const mealCountsRollback = await readFile(new URL("../migrations/20261001_reader_meal_counts.rollback.sql", import.meta.url), "utf8");
    for (const marker of ["meal_counts", "normalized_meal_type", "meal_counts_count_check", "meal_counts_date_normalized_meal_type_idx"]) {
      assert.match(mealCountsForward, new RegExp(marker));
    }
    assert.match(mealCountsRollback, /DROP TABLE IF EXISTS meal_counts/);
    const payablesForward = await readFile(new URL("../migrations/20261002_payables.sql", import.meta.url), "utf8");
    const payablesRollback = await readFile(new URL("../migrations/20261002_payables.rollback.sql", import.meta.url), "utf8");
    for (const marker of ["CREATE TABLE IF NOT EXISTS payables", "CREATE TABLE IF NOT EXISTS payable_allocations", "payables_status_balance_check", "payable_allocations_settlement_line_idx", "validate_payable_party", "validate_payable_settlement_line_links"]) {
      assert.match(payablesForward, new RegExp(marker));
    }
    for (const marker of ["DROP TABLE IF EXISTS payable_allocations", "DROP TABLE IF EXISTS payables", "DROP FUNCTION IF EXISTS validate_payable_party", "DROP FUNCTION IF EXISTS validate_payable_settlement_line_links"]) {
      assert.match(payablesRollback, new RegExp(marker));
    }
    const groupedForward = await readFile(new URL("../migrations/20261005_inventory_purchase_payment_groups.sql", import.meta.url), "utf8");
    const groupedRollback = await readFile(new URL("../migrations/20261005_inventory_purchase_payment_groups.rollback.sql", import.meta.url), "utf8");
    for (const marker of [
      "inventory_purchase_payment_groups", "inventory_purchase_payment_group_members",
      "inventory_purchase_payment_groups_status_check", "inventory_purchase_payment_groups_cancelled_check",
      "inventory_purchase_payment_groups_bank_idx", "inventory_purchase_payment_group_members_purchase_idx",
      "inventory_purchase_payment_group_members_group_purchase_idx",
    ]) assert.match(groupedForward, new RegExp(marker));
    assert.match(groupedRollback, /DROP TABLE IF EXISTS inventory_purchase_payment_group_members/);
    assert.match(groupedRollback, /DROP TABLE IF EXISTS inventory_purchase_payment_groups/);
  });

  it("fingerprints receivable, payable, and grouped purchase schema definitions", async () => {
    const fingerprintQueries = [];
    const memberTable = "inventory_purchase_payment_group_members";
    const groupTable = "inventory_purchase_payment_groups";
    const groupedSchemaRows = [
      { kind: "column", object_name: memberTable, item_name: "0001:group_id", definition: "integer|int4|NO" },
      { kind: "column", object_name: memberTable, item_name: "0002:purchase_id", definition: "integer|int4|NO" },
      { kind: "column", object_name: groupTable, item_name: "0001:id", definition: "integer|int4|NO|nextval('inventory_purchase_payment_groups_id_seq'::regclass)" },
      { kind: "column", object_name: groupTable, item_name: "0002:bank_transaction_id", definition: "integer|int4|NO" },
      { kind: "column", object_name: groupTable, item_name: "0003:cash_transaction_id", definition: "integer|int4|YES" },
      { kind: "column", object_name: groupTable, item_name: "0004:journal_entry_id", definition: "integer|int4|NO" },
      { kind: "column", object_name: groupTable, item_name: "0005:status", definition: "text|text|NO|'active'::text" },
      { kind: "column", object_name: groupTable, item_name: "0006:created_at", definition: "timestamp with time zone|timestamptz|NO|now()" },
      { kind: "column", object_name: groupTable, item_name: "0007:cancelled_at", definition: "timestamp with time zone|timestamptz|YES" },
      { kind: "constraint", object_name: memberTable, item_name: "inventory_purchase_payment_group_members_group_id_fkey", definition: "FOREIGN KEY (group_id) REFERENCES inventory_purchase_payment_groups(id) ON DELETE CASCADE" },
      { kind: "constraint", object_name: groupTable, item_name: "inventory_purchase_payment_groups_cancelled_check", definition: "CHECK ((((status = 'active'::text) AND (cancelled_at IS NULL)) OR ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL))))" },
      { kind: "constraint", object_name: groupTable, item_name: "inventory_purchase_payment_groups_cash_transaction_id_fkey", definition: "FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id) ON DELETE SET NULL" },
      { kind: "constraint", object_name: groupTable, item_name: "inventory_purchase_payment_groups_journal_entry_id_fkey", definition: "FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE RESTRICT" },
      { kind: "constraint", object_name: groupTable, item_name: "inventory_purchase_payment_groups_pkey", definition: "PRIMARY KEY (id)" },
      { kind: "constraint", object_name: groupTable, item_name: "inventory_purchase_payment_groups_status_check", definition: "CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))" },
      { kind: "index", object_name: memberTable, item_name: "inventory_purchase_payment_group_members_group_idx", definition: "CREATE INDEX inventory_purchase_payment_group_members_group_idx ON public.inventory_purchase_payment_group_members USING btree (group_id)" },
      { kind: "index", object_name: memberTable, item_name: "inventory_purchase_payment_group_members_group_purchase_idx", definition: "CREATE UNIQUE INDEX inventory_purchase_payment_group_members_group_purchase_idx ON public.inventory_purchase_payment_group_members USING btree (group_id, purchase_id)" },
      { kind: "index", object_name: memberTable, item_name: "inventory_purchase_payment_group_members_purchase_idx", definition: "CREATE INDEX inventory_purchase_payment_group_members_purchase_idx ON public.inventory_purchase_payment_group_members USING btree (purchase_id)" },
      { kind: "index", object_name: groupTable, item_name: "inventory_purchase_payment_groups_bank_idx", definition: "CREATE INDEX inventory_purchase_payment_groups_bank_idx ON public.inventory_purchase_payment_groups USING btree (bank_transaction_id)" },
      { kind: "index", object_name: groupTable, item_name: "inventory_purchase_payment_groups_pkey", definition: "CREATE UNIQUE INDEX inventory_purchase_payment_groups_pkey ON public.inventory_purchase_payment_groups USING btree (id)" },
    ];
    let signatureChanged = false;
    const client = { query: async (query) => {
      fingerprintQueries.push(query);
      return fingerprintQueries.length % 2 === 1
        ? { rows: [] }
        : { rows: groupedSchemaRows.map((row, index) => signatureChanged && index === 0
          ? { ...row, definition: `${row.definition}|changed` }
          : row) };
    } };
    const firstFingerprint = await managedSchemaFingerprint(client);
    signatureChanged = true;
    const changedFingerprint = await managedSchemaFingerprint(client);
    assert.notEqual(firstFingerprint, changedFingerprint, "managed group schema definitions contribute to the fingerprint");
    for (const marker of [
       "receivables", "receivable_allocations", "inventory_material_requests", "inventory_material_request_items",
       "meal_edit_requests", "meal_edit_requests_pending_meal_idx", "meal_counts", "meal_counts_date_normalized_meal_type_idx",
       "inventory_material_requests_status_check", "inventory_material_request_items_quantity_check",
       "meal_edit_requests_status_check",
       "inventory_material_requests_requester_id_idx", "inventory_material_request_items_request_item_unique",
      "receivables_journal_line_parent_trigger", "validate_receivable_journal_line_links",
       "payables", "payable_allocations", "payables_party_status_idx", "payable_allocations_settlement_line_idx",
       "payables_party_trigger", "payable_allocations_journal_line_parent_trigger", "validate_payable_party",
      "pg_get_triggerdef", "pg_get_functiondef",
     ]) assert.match(fingerprintQueries[0], new RegExp(marker));
    for (const marker of [
      "inventory_purchase_payment_groups", "inventory_purchase_payment_group_members",
       "information_schema.columns", "pg_get_constraintdef", "pg_indexes", "indexdef",
       "constraint_row.contype <> 'n'",
    ]) assert.match(fingerprintQueries[1], new RegExp(marker));
    const groupedSignature = migrationChecksum(JSON.stringify(groupedSchemaRows));
    assert.equal(groupedSignature, "276f4ae5b26053faa3106ac1ed7e844ffa470543cb11169a65050cbc015e2577");
    const policy = JSON.parse(await readFile(new URL("../production-migrations.json", import.meta.url), "utf8"));
    assert.equal(policy.schemaFingerprint, migrationChecksum(
      `845d92ac5359140216c6b427ccf68a147354ceca3e1a0fedef208b7fab83c1b9:${groupedSignature}`,
    ));
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