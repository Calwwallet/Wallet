import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const DB_FILE = join(process.cwd(), 'database.sqlite');
const db = new Database(DB_FILE);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    agent_name TEXT,
    address TEXT UNIQUE,
    encrypted_key TEXT,
    chain TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    address TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    name TEXT,
    permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ens_registrations (
    name TEXT PRIMARY KEY,
    label TEXT,
    owner TEXT,
    chain TEXT,
    secret TEXT,
    data TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    chain TEXT,
    data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS erc8004_registrations (
    id TEXT PRIMARY KEY,
    name TEXT,
    address TEXT,
    uri TEXT,
    on_chain INTEGER DEFAULT 0,
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rate_limit_hits (
    key_id TEXT,
    timestamp INTEGER
  );
  
  CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_id ON rate_limit_hits(key_id);
  CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_timestamp ON rate_limit_hits(timestamp);
`);

/**
 * Migrate legacy JSON data to SQLite
 */
export function migrateLegacyData() {
  const jsonFiles = {
    'wallets.json': (data) => {
      const stmt = db.prepare('INSERT OR IGNORE INTO wallets (id, agent_name, address, encrypted_key, chain, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const [id, wallet] of Object.entries(data)) {
        stmt.run(id, wallet.agentName, wallet.address, wallet.privateKey, wallet.chain, wallet.createdAt);
      }
    },
    'api-keys.json': (data) => {
      const stmt = db.prepare('INSERT OR IGNORE INTO api_keys (key, name, permissions, created_at) VALUES (?, ?, ?, ?)');
      for (const keyObj of data) {
        stmt.run(keyObj.key, keyObj.name, JSON.stringify(keyObj.permissions), keyObj.createdAt);
      }
    },
    'agent-identities.json': (data) => {
      const stmt = db.prepare('INSERT OR IGNORE INTO identities (id, name, type, address, data, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      const entries = Array.isArray(data) ? data : Object.values(data);
      for (const idObj of entries) {
        stmt.run(idObj.agentId || idObj.id, idObj.name, idObj.type, idObj.address || idObj.wallet, JSON.stringify(idObj), idObj.createdAt || idObj.metadata?.createdAt || new Date().toISOString());
      }
    },
    'ens-registrations.json': (data) => {
      const stmt = db.prepare('INSERT OR IGNORE INTO ens_registrations (name, label, owner, chain, secret, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const entries = Array.isArray(data) ? data : Object.values(data);
      for (const reg of entries) {
        stmt.run(reg.name, reg.label, reg.owner, reg.chain, reg.secret, JSON.stringify(reg), reg.status, reg.createdAt);
      }
    }
  };

  for (const [file, migrate] of Object.entries(jsonFiles)) {
    const path = join(process.cwd(), file);
    if (existsSync(path)) {
      try {
        console.log(`📦 Migrating ${file}...`);
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        migrate(data);
        // Rename file instead of deleting to be safe
        // unlinkSync(path); 
        console.log(`✅ ${file} migrated.`);
      } catch (error) {
        console.error(`❌ Failed to migrate ${file}:`, error.message);
      }
    }
  }
}

export default db;
