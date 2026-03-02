/**
 * ApiKeyRepository
 *
 * Central storage for API keys. Today this is a JSON file,
 * but the interface is intentionally small so we can later
 * plug in a database or secrets manager.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';

export const API_KEYS_FILE = join(process.cwd(), 'api-keys.json');
const HAS_DB = Boolean(process.env.DATABASE_URL);

let cachedKeys = null;

export function loadApiKeysRaw() {
  if (cachedKeys) return cachedKeys;

  if (!existsSync(API_KEYS_FILE)) {
    cachedKeys = [];
    return cachedKeys;
  }

  const raw = JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'));
  cachedKeys = Array.isArray(raw) ? raw : [];

  if (HAS_DB) {
    const db = getDb();
    const text = `
      insert into api_keys (key, name, created_at, permissions)
      values ($1, $2, $3, $4)
      on conflict (key) do nothing
    `;
    cachedKeys.forEach(k => {
      db.query(text, [k.key, k.name, k.createdAt, JSON.stringify(k.permissions || [])]).catch(err => {
        console.error('Failed to sync API key to Postgres:', err.message);
      });
    });
  }

  return cachedKeys;
}

export function saveApiKeys(keys) {
  cachedKeys = Array.isArray(keys) ? keys : [];
  writeFileSync(API_KEYS_FILE, JSON.stringify(cachedKeys, null, 2));

  if (HAS_DB) {
    const db = getDb();
    const text = `
      insert into api_keys (key, name, created_at, permissions)
      values ($1, $2, $3, $4)
      on conflict (key) do update set
        name = excluded.name,
        created_at = excluded.created_at,
        permissions = excluded.permissions
    `;
    cachedKeys.forEach(k => {
      db.query(text, [k.key, k.name, k.createdAt, JSON.stringify(k.permissions || [])]).catch(err => {
        console.error('Failed to persist API key to Postgres:', err.message);
      });
    });
  }
}

