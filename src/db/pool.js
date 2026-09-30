import pg from 'pg';

const { Pool } = pg;

export function createPool(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const max = Number(env.DB_POOL_MAX ?? 5);
  if (!Number.isInteger(max) || max < 1 || max > 10) {
    throw new Error('DB_POOL_MAX must be an integer from 1 to 10 for the student demo');
  }

  return new Pool({
    connectionString: env.DATABASE_URL,
    max,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: false
  });
}
