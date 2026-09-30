import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const root = new URL('../', import.meta.url);
const ddlPath = fileURLToPath(new URL('release/FixTech-demo-v1.8.database.sql', root));
const connectionString = process.env.SCHEMA_TEST_DATABASE_URL;

if (!connectionString) {
  console.error('Set SCHEMA_TEST_DATABASE_URL to a PostgreSQL migration connection. No database was changed.');
  process.exit(2);
}
if (process.env.FIXTECH_SCHEMA_TEST_ALLOW_CREATE !== 'yes') {
  console.error('Set FIXTECH_SCHEMA_TEST_ALLOW_CREATE=yes to authorize a disposable database create/drop test.');
  process.exit(2);
}

const databaseName = `fixtech_schema_verify_${process.pid}_${randomBytes(6).toString('hex')}`;
const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
let created = false;
let target;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;

  target = new Client({
    connectionString,
    database: databaseName,
    connectionTimeoutMillis: 5000,
  });
  await target.connect();
  const ddl = await readFile(ddlPath, 'utf8');
  await target.query(ddl);

  const checks = await target.query(`
    SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r') AS tables,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public') AS columns,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.contype = 'f') AS foreign_keys,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.contype = 'p') AS primary_keys,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.contype = 'u') AS unique_constraints,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.contype = 'c') AS check_constraints,
      (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public') AS indexes
  `);
  const result = checks.rows[0];
  if (result.tables !== 26 || result.primary_keys !== 26 || result.foreign_keys < 1 ||
      result.unique_constraints < 1 || result.check_constraints < 1 || result.indexes < 26) {
    throw new Error(`Unexpected schema catalog counts: ${JSON.stringify(result)}`);
  }

  await target.query('BEGIN');
  await target.query('CREATE TABLE public.__rollback_probe (id integer PRIMARY KEY)');
  await target.query('ROLLBACK');
  const probe = await target.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '__rollback_probe'
  `);
  if (probe.rows[0].n !== 0) throw new Error('Rollback probe table unexpectedly remains.');

  console.log(`PostgreSQL DDL install passed in a disposable database: ${JSON.stringify(result)}`);
  console.log('Rollback probe passed. The disposable database will be dropped.');
} catch (error) {
  console.error(`PostgreSQL schema verification failed (${error.code ?? 'no-code'}): ${error.message}`);
  process.exitCode = 1;
} finally {
  if (target) await target.end().catch(() => {});
  if (created) {
    try {
      await admin.query(`DROP DATABASE "${databaseName}"`);
      console.log('Disposable database dropped.');
    } catch (error) {
      console.error(`Could not drop disposable database ${databaseName}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  await admin.end().catch(() => {});
}
