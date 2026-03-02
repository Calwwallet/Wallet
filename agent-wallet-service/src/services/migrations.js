import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getDb } from './db.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

function listMigrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files;
}

async function ensureMigrationsTable(db) {
  await db.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedVersions(db) {
  const res = await db.query('select version from schema_migrations order by version asc');
  return new Set(res.rows.map((r) => r.version));
}

function versionFromFilename(filename) {
  // 001_init.sql -> 001
  const m = /^(\d+)_/.exec(filename);
  if (!m) return filename;
  return m[1];
}

export async function applyMigrations() {
  const db = getDb();
  await ensureMigrationsTable(db);

  const applied = await getAppliedVersions(db);
  const files = listMigrationFiles();

  for (const file of files) {
    const version = versionFromFilename(file);
    if (applied.has(version)) continue;

    const fullPath = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(fullPath, 'utf-8');

    // Run each migration in a transaction
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(version) values ($1)', [version]);
      await client.query('commit');
      console.log(`[migrations] applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration failed (${file}): ${err.message}`);
    } finally {
      client.release();
    }
  }
}

