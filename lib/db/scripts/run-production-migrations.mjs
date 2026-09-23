import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationPolicyPath = fileURLToPath(new URL("../production-migrations.json", import.meta.url));
const advisoryLockId = 2026092401;

export function migrationChecksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function maskSqlCommentsAndStrings(sql) {
  let masked = "";
  for (let index = 0; index < sql.length;) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      const stop = end === -1 ? sql.length : end;
      masked += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) throw new Error("Unterminated SQL block comment");
      masked += " ".repeat(end + 2 - index);
      index = end + 2;
      continue;
    }
    const quote = sql[index];
    if (quote === "'" || quote === "\"") {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === quote && sql[cursor + 1] === quote) {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (cursor > sql.length || sql[cursor - 1] !== quote) throw new Error("Unterminated SQL quoted value");
      masked += " ".repeat(cursor - index);
      index = cursor;
      continue;
    }
    if (quote === "$") {
      const tag = /^\$[a-zA-Z0-9_]*\$/.exec(sql.slice(index))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        if (end === -1) throw new Error("Unterminated SQL dollar-quoted value");
        const stop = end + tag.length;
        masked += " ".repeat(stop - index);
        index = stop;
        continue;
      }
    }
    masked += sql[index];
    index += 1;
  }
  return masked;
}

export function assertMigrationHasNoTransactionControl(filename, sql) {
  const masked = maskSqlCommentsAndStrings(sql);
  const transactionControl = /(?:^|;)\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\b/i.exec(masked);
  if (transactionControl) {
    throw new Error(`${filename} contains ${transactionControl[1]}; migrations must rely on the runner transaction`);
  }
}

export async function discoverForwardMigrations(directory = migrationsDirectory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{8}_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function loadMigrations() {
  const policy = JSON.parse(await readFile(migrationPolicyPath, "utf8"));
  const discovered = (await discoverForwardMigrations())
    .filter((filename) => filename >= policy.managedStart);
  const policyFilenames = policy.migrations.map(({ filename }) => filename);
  if (JSON.stringify(discovered) !== JSON.stringify(policyFilenames)) {
    throw new Error("Managed migration files must exactly match production-migrations.json in filename order");
  }
  if (policy.migrations.some(({ releaseMode }) => releaseMode !== "expand")) {
    throw new Error("Vercel build may only run migrations reviewed as releaseMode=expand");
  }
  const migrations = await Promise.all(policyFilenames.map(async (filename) => {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    return { filename, sql, checksum: migrationChecksum(sql) };
  }));
  return { migrations, schemaFingerprint: policy.schemaFingerprint };
}

export function reconcileMigrationLedger(migrations, appliedRows) {
  const files = new Map(migrations.map((migration) => [migration.filename, migration]));
  const applied = new Map(appliedRows.map((row) => [row.filename, row.checksum]));

  for (const row of appliedRows) {
    const migration = files.get(row.filename);
    if (!migration) {
      throw new Error(`Applied migration file is missing or renamed: ${row.filename}`);
    }
    if (migration.checksum !== row.checksum) {
      throw new Error(`Applied migration checksum changed: ${row.filename}`);
    }
  }

  const pending = [];
  let foundPending = false;
  for (const migration of migrations) {
    if (applied.has(migration.filename)) {
      if (foundPending) {
        throw new Error(`Applied migrations are out of order at ${migration.filename}`);
      }
    } else {
      foundPending = true;
      pending.push(migration);
    }
  }
  return pending;
}

export async function managedSchemaFingerprint(client) {
  const result = await client.query(`
    WITH managed_columns(table_name, column_name) AS (
      VALUES
        ('chart_of_accounts', 'normal_balance'),
        ('chart_of_accounts', 'is_active'),
        ('cash_transactions', 'journal_entry_id'),
        ('bank_transactions', 'journal_entry_id'),
        ('bank_transactions', 'rejected_account_ids'),
        ('inventory_purchases', 'journal_entry_id'),
          ('inventory_material_requests', 'requested_date'),
          ('inventory_material_requests', 'requester_id'),
          ('inventory_material_requests', 'meal_schedule_entry_id'),
          ('inventory_material_requests', 'note'),
          ('inventory_material_requests', 'status'),
          ('inventory_material_requests', 'created_at'),
          ('inventory_material_requests', 'updated_at'),
          ('inventory_material_request_items', 'request_id'),
          ('inventory_material_request_items', 'inventory_item_id'),
          ('inventory_material_request_items', 'item_name'),
          ('inventory_material_request_items', 'unit'),
          ('inventory_material_request_items', 'quantity'),
         ('payroll_adjustments', 'journal_entry_id'),
         ('payroll_adjustments', 'receivable_id')
    ),
    managed_indexes(index_name) AS (
      VALUES
        ('journal_entries_source_idx'),
        ('journal_entries_date_idx'),
        ('journal_lines_entry_idx'),
         ('journal_lines_account_idx'),
         ('receivables_origin_line_idx'),
         ('receivables_open_idx'),
         ('receivable_allocations_settlement_line_idx'),
         ('receivable_allocations_receivable_idx'),
         ('meal_schedule_slots_name_idx'),
         ('meal_schedule_slots_sort_order_idx'),
         ('meal_schedule_entries_date_slot_idx'),
         ('meal_schedule_entries_date_idx'),
         ('meal_schedule_entries_meal_id_idx')
          ,('inventory_material_requests_requester_id_idx')
          ,('inventory_material_requests_requested_date_idx')
          ,('inventory_material_request_items_request_item_unique')
    ),
    signature AS (
      SELECT
        'column' AS kind,
        columns.table_name AS object_name,
        columns.ordinal_position::text AS item_name,
        concat_ws('|', columns.column_name, columns.data_type, columns.udt_name, columns.is_nullable, columns.column_default) AS definition
      FROM information_schema.columns columns
      WHERE columns.table_schema = 'public'
        AND (
           columns.table_name IN ('journal_entries', 'journal_lines', 'receivables', 'receivable_allocations', 'meal_schedule_slots', 'meal_schedule_entries', 'inventory_material_requests', 'inventory_material_request_items')
          OR (columns.table_name, columns.column_name) IN (SELECT * FROM managed_columns)
        )
      UNION ALL
      SELECT
        'constraint',
        relation.relname,
        constraint_row.conname,
        concat_ws('|', constraint_row.contype, constraint_row.convalidated, pg_get_constraintdef(constraint_row.oid, true))
      FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND (
            relation.relname IN ('journal_entries', 'journal_lines', 'receivables', 'receivable_allocations', 'meal_schedule_slots', 'meal_schedule_entries', 'inventory_material_requests', 'inventory_material_request_items')
          OR constraint_row.conname IN (
            'chart_of_accounts_type_check',
            'chart_of_accounts_normal_balance_check',
            'cash_transactions_journal_entry_id_fkey',
            'bank_transactions_journal_entry_id_fkey',
            'inventory_purchases_journal_entry_id_fkey',
             'payroll_adjustments_journal_entry_id_fkey',
             'payroll_adjustments_receivable_id_receivables_id_fk',
             'receivables_exactly_one_party_check',
             'receivables_amounts_check',
             'receivables_status_balance_check',
             'receivables_status_check',
             'receivable_allocations_amount_check',
             'inventory_material_requests_status_check',
             'inventory_material_request_items_quantity_check',
             'inventory_material_request_items_request_item_unique'
          )
        )
      UNION ALL
      SELECT
        'index',
        indexes.tablename,
        indexes.indexname,
        concat_ws('|', pg_index.indisvalid, pg_get_indexdef(pg_index.indexrelid))
      FROM pg_indexes indexes
      JOIN pg_class index_relation ON index_relation.relname = indexes.indexname
      JOIN pg_namespace index_namespace
        ON index_namespace.oid = index_relation.relnamespace AND index_namespace.nspname = indexes.schemaname
      JOIN pg_index ON pg_index.indexrelid = index_relation.oid
      WHERE indexes.schemaname = 'public'
        AND indexes.indexname IN (SELECT index_name FROM managed_indexes)
      UNION ALL
      SELECT
        'trigger',
        relation.relname,
        trigger.tgname,
        concat_ws('|', trigger.tgenabled, pg_get_triggerdef(trigger.oid, true))
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND NOT trigger.tgisinternal
        AND trigger.tgname IN (
          'receivables_journal_line_parent_trigger',
          'receivable_allocations_journal_line_parent_trigger'
        )
      UNION ALL
      SELECT
        'function',
        namespace.nspname,
        procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')',
        pg_get_functiondef(procedure.oid)
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname IN (
          'validate_receivable_journal_line_links',
          'validate_receivable_settlement_line_links'
        )
    )
    SELECT kind, object_name, item_name, definition
    FROM signature
    ORDER BY kind, object_name, item_name
  `);
  return migrationChecksum(JSON.stringify(result.rows));
}

async function applyMigrations(client, migrations, expectedSchemaFingerprint) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path TO public");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query(
      "SELECT filename, checksum FROM public.app_schema_migrations ORDER BY filename",
    );
    const pending = reconcileMigrationLedger(migrations, appliedResult.rows);

    for (const migration of pending) {
      assertMigrationHasNoTransactionControl(migration.filename, migration.sql);
      console.log(`[db-migrate] Applying ${migration.filename}`);
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO public.app_schema_migrations (filename, checksum) VALUES ($1, $2)",
        [migration.filename, migration.checksum],
      );
    }
    const actualSchemaFingerprint = await managedSchemaFingerprint(client);
    if (actualSchemaFingerprint !== expectedSchemaFingerprint) {
      throw new Error(`Managed production schema fingerprint mismatch: ${actualSchemaFingerprint}`);
    }
    await client.query("COMMIT");
    console.log("[db-migrate] Production schema is current");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function runCommand(command) {
  if (!command.length) return;
  console.log(`[db-migrate] Running protected build command: ${command.join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Build command failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function run() {
  const separator = process.argv.indexOf("--");
  const buildCommand = separator === -1 ? [] : process.argv.slice(separator + 1);
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[db-migrate] Skipped for VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}`);
    await runCommand(buildCommand);
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for production migrations");
  }

  const { migrations, schemaFingerprint } = await loadMigrations();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryLockId]);
    await applyMigrations(client, migrations, schemaFingerprint);
    await runCommand(buildCommand);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [advisoryLockId]).catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`[db-migrate] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}