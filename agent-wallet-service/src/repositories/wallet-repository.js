/**
 * WalletRepository
 *
 * Thin abstraction over JSON-backed wallet storage.
 * Encapsulates file I/O so we can swap storage backends later
 * (e.g. Postgres, Redis) without touching business logic.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';

const WALLET_FILE = join(process.cwd(), 'wallets.json');
const USE_DB = process.env.STORAGE_BACKEND === 'db';

function loadWalletStore() {
  if (!existsSync(WALLET_FILE)) {
    return new Map();
  }

  const raw = JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
  return new Map(Object.entries(raw));
}

function saveWalletStore(wallets) {
  const obj = Object.fromEntries(wallets);
  writeFileSync(WALLET_FILE, JSON.stringify(obj, null, 2));
}

// In-memory wallet store (process-local). For now this remains the
// primary read model, with optional dual-write to Postgres.
const wallets = loadWalletStore();

/**
 * Get the mutable wallet store (Map keyed by wallet id).
 * Consumers should treat this as an in-memory view and call
 * persistWalletStore() after mutating.
 */
export function getWalletStore() {
  return wallets;
}

/**
 * Persist current wallet state to disk.
 */
export function persistWalletStore() {
  saveWalletStore(wallets);
}

/**
 * Find a wallet by address (case-insensitive).
 */
export function findWalletByAddress(address) {
  const target = (address || '').toLowerCase();
  if (!target) return null;

  if (USE_DB) {
    throw new Error('findWalletByAddress requires tenantId in DB mode. Use findWalletByAddressDb().');
  }

  return (
    Array.from(wallets.values()).find((w) => w.address && w.address.toLowerCase() === target) ||
    null
  );
}

export async function findWalletByAddressDb(address, { tenantId }) {
  const target = (address || '').toLowerCase();
  if (!tenantId) throw new Error('tenantId is required for DB wallet lookups');
  if (!target) return null;

  const db = getDb();
  const res = await db.query(
    `select w.id, w.agent_name, w.address, w.chain, w.imported, w.created_at, s.enc_private_key
     from wallets w
     left join wallet_secrets s on s.wallet_id = w.id and s.tenant_id = w.tenant_id
     where w.tenant_id = $1 and lower(w.address) = $2
     limit 1`,
    [tenantId, target]
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    agentName: row.agent_name,
    address: row.address,
    privateKey: row.enc_private_key,
    chain: row.chain,
    imported: row.imported,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  };
}

/**
 * Get a wallet by id.
 */
export function findWalletById(id) {
  return wallets.get(id) || null;
}

/**
 * Upsert a wallet record and persist it.
 */
export function upsertWallet(wallet) {
  if (!wallet || !wallet.id) {
    throw new Error('wallet with id is required');
  }

  if (USE_DB) {
    throw new Error('upsertWallet requires tenantId in DB mode. Use upsertWalletDb().');
  }

  wallets.set(wallet.id, wallet);
  persistWalletStore();

  return wallet;
}

export async function upsertWalletDb(wallet, { tenantId }) {
  if (!wallet || !wallet.id) throw new Error('wallet with id is required');
  if (!tenantId) throw new Error('tenantId is required for DB wallet writes');

  const db = getDb();
  const createdAt = wallet.createdAt || new Date().toISOString();

  await db.query(
    `insert into wallets (id, tenant_id, agent_name, address, chain, imported, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set
       agent_name = excluded.agent_name,
       address = excluded.address,
       chain = excluded.chain,
       imported = excluded.imported,
       created_at = excluded.created_at`,
    [
      wallet.id,
      tenantId,
      wallet.agentName || null,
      wallet.address,
      wallet.chain || null,
      Boolean(wallet.imported),
      createdAt
    ]
  );

  // Legacy until KeyVault is implemented: store encrypted private key directly.
  if (wallet.privateKey) {
    await db.query(
      `insert into wallet_secrets (wallet_id, tenant_id, enc_private_key, kms_key_id, wrapped_data_key)
       values ($1, $2, $3, $4, $5)
       on conflict (wallet_id) do update set
         enc_private_key = excluded.enc_private_key,
         kms_key_id = excluded.kms_key_id,
         wrapped_data_key = excluded.wrapped_data_key`,
      [wallet.id, tenantId, wallet.privateKey, null, 'legacy-global-key']
    );
  }

  return wallet;
}

/**
 * Return all wallets as an array (read-only snapshot).
 */
export function getAllWallets() {
  if (USE_DB) {
    throw new Error('getAllWallets requires tenantId in DB mode. Use getAllWalletsDb().');
  }
  return Array.from(wallets.values());
}

export async function getAllWalletsDb({ tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB wallet listing');
  const db = getDb();
  const res = await db.query(
    `select id, agent_name, address, chain, imported, created_at
     from wallets
     where tenant_id = $1
     order by created_at desc`,
    [tenantId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    agentName: row.agent_name,
    address: row.address,
    chain: row.chain,
    imported: row.imported,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  }));
}

