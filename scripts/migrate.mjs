import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const migrationFile = fileURLToPath(new URL('../release/migrations/001_fastwork_schema.sql', import.meta.url));
const sql = await readFile(migrationFile, 'utf8');

const client = new Client({ connectionString });
try {
  await client.connect();
  console.log('Running Fastwork schema migration...');
  await client.query(sql);
  console.log('Migration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
