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
import { createHash } from 'crypto';

export const API_KEYS_FILE = join(process.cwd(), 'api-keys.json');
const HAS_DB = Boolean(process.env.DATABASE_URL);

let cachedKeys = null;

function hashApiKey(rawKey) {
  return createHash('sha256').update(String(rawKey)).digest('hex');
}

function normalizeKeyRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const createdAt = record.createdAt || new Date().toISOString();
  const permissions = Array.isArray(record.permissions) ? record.permissions : [];

  if (typeof record.keyHash === 'string' && record.keyHash.length > 0) {
    return {
      keyHash: record.keyHash,
      keyPrefix: record.keyPrefix || 'sk_unknown',
      name: record.name || 'unnamed',
      createdAt,
      permissions
    };
  }

  if (typeof record.key === 'string' && record.key.length > 0) {
    return {
      keyHash: hashApiKey(record.key),
      keyPrefix: record.key.slice(0, 12),
      name: record.name || 'unnamed',
      createdAt,
      permissions
    };
  }

  return null;
}

export function loadApiKeysRaw() {
  if (cachedKeys) return cachedKeys;

  if (!existsSync(API_KEYS_FILE)) {
    cachedKeys = [];
    return cachedKeys;
  }

  const raw = JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'));
  const parsed = Array.isArray(raw) ? raw : [];
  const normalized = parsed.map(normalizeKeyRecord).filter(Boolean);
  cachedKeys = normalized;

  if (normalized.length !== parsed.length || parsed.some((entry) => 'key' in (entry || {}))) {
    writeFileSync(API_KEYS_FILE, JSON.stringify(cachedKeys, null, 2));
  }

  if (HAS_DB) {
    const db = getDb();
    const text = `
      insert into api_keys (id, tenant_id, key_hash, key_prefix, name, permissions)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (key_hash) do nothing
    `;
    cachedKeys.forEach(k => {
      db.query(text, [`ak_json_${k.keyHash.slice(0, 24)}`, 'tenant_default', k.keyHash, k.keyPrefix, k.name, JSON.stringify(k.permissions || [])]).catch(err => {
        console.error('Failed to sync API key to Postgres:', err.message);
      });
    });
  }

  return cachedKeys;
}

export function saveApiKeys(keys) {
  const parsed = Array.isArray(keys) ? keys : [];
  cachedKeys = parsed.map(normalizeKeyRecord).filter(Boolean);
  writeFileSync(API_KEYS_FILE, JSON.stringify(cachedKeys, null, 2));

  if (HAS_DB) {
    const db = getDb();
    const text = `
      insert into api_keys (id, tenant_id, key_hash, key_prefix, name, permissions)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (key_hash) do update set
        name = excluded.name,
        key_prefix = excluded.key_prefix,
        permissions = excluded.permissions
    `;
    cachedKeys.forEach(k => {
      db.query(text, [`ak_json_${k.keyHash.slice(0, 24)}`, 'tenant_default', k.keyHash, k.keyPrefix, k.name, JSON.stringify(k.permissions || [])]).catch(err => {
        console.error('Failed to persist API key to Postgres:', err.message);
      });
    });
  }
}
