/**
 * IdentityRepository
 *
 * Encapsulates storage for ERC-8004-inspired agent identities.
 * Currently backed by a JSON file, but designed so we can later
 * plug in a real database or on-chain registry adapter.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';

const IDENTITY_FILE = join(process.cwd(), 'agent-identities.json');
const USE_DB = process.env.STORAGE_BACKEND === 'db';

function loadIdentityStore() {
  if (!existsSync(IDENTITY_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
}

function saveIdentityStore(identities) {
  writeFileSync(IDENTITY_FILE, JSON.stringify(identities, null, 2));
}

// Process-local identity store
const identities = loadIdentityStore();

export function getIdentityStore() {
  return identities;
}

export function persistIdentityStore() {
  saveIdentityStore(identities);
}

export function getIdentityById(agentId) {
  if (USE_DB) {
    throw new Error('getIdentityById requires tenantId in DB mode. Use getIdentityByIdDb().');
  }
  return identities[agentId] || null;
}

export function setIdentity(agentId, identity) {
  if (!agentId) {
    throw new Error('agentId is required');
  }
  if (USE_DB) {
    throw new Error('setIdentity requires tenantId in DB mode. Use setIdentityDb().');
  }
  identities[agentId] = identity;
  persistIdentityStore();

  return identity;
}

export function getAllIdentities() {
  if (USE_DB) {
    throw new Error('getAllIdentities requires tenantId in DB mode. Use getAllIdentitiesDb().');
  }
  return Object.values(identities);
}

export async function getIdentityByIdDb(agentId, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB identity lookups');
  const db = getDb();
  const res = await db.query(
    `select agent_id, wallet_address, type, name, metadata, created_at, revoked_at
     from identities
     where tenant_id = $1 and agent_id = $2
     limit 1`,
    [tenantId, agentId]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  // Store full identity in metadata when available; otherwise reconstruct
  const meta = row.metadata || {};
  return meta.id ? meta : {
    id: row.agent_id,
    name: row.name,
    type: row.type,
    wallet: row.wallet_address,
    metadata: meta,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at
  };
}

export async function setIdentityDb(agentId, identity, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB identity writes');
  const db = getDb();
  const createdAt = identity?.metadata?.createdAt || new Date().toISOString();
  await db.query(
    `insert into identities (agent_id, tenant_id, wallet_address, type, name, metadata, created_at, revoked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (agent_id) do update set
       wallet_address = excluded.wallet_address,
       type = excluded.type,
       name = excluded.name,
       metadata = excluded.metadata,
       created_at = excluded.created_at,
       revoked_at = excluded.revoked_at`,
    [
      agentId,
      tenantId,
      identity.wallet,
      identity.type,
      identity.name,
      JSON.stringify(identity),
      createdAt,
      identity?.metadata?.revokedAt || null
    ]
  );
  return identity;
}

export async function getAllIdentitiesDb({ tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB identity listing');
  const db = getDb();
  const res = await db.query(
    `select metadata
     from identities
     where tenant_id = $1
     order by created_at desc`,
    [tenantId]
  );
  return res.rows.map((r) => r.metadata).filter(Boolean);
}

