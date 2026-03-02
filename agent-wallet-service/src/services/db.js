import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function getDb() {
  if (pool) return pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to use Postgres-backed features.');
  }

  pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX || 10)
  });

  return pool;
}

