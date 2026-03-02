/**
 * PolicyRepository
 *
 * Centralizes storage for wallet policies and policy usage.
 * Backed by JSON today, with a clear seam for DB-backed impls later.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';

const POLICIES_FILE = join(process.cwd(), 'policies.json');
const POLICY_USAGE_FILE = join(process.cwd(), 'policy-usage.json');
const USE_DB = process.env.STORAGE_BACKEND === 'db';

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function saveJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

const policies = loadJson(POLICIES_FILE, {});
const policyUsage = loadJson(POLICY_USAGE_FILE, {});

export function getPolicyStore() {
  if (USE_DB) {
    throw new Error('getPolicyStore is not available in DB mode. Use getPolicyDb().');
  }
  return policies;
}

export function getPolicyUsageStore() {
  if (USE_DB) {
    throw new Error('getPolicyUsageStore is not available in DB mode. Use getPolicyUsageDb().');
  }
  return policyUsage;
}

export function persistPolicies() {
  if (USE_DB) {
    throw new Error('persistPolicies is not available in DB mode. Use setPolicyDb().');
  }
  saveJson(POLICIES_FILE, policies);
}

export function persistPolicyUsage() {
  if (USE_DB) {
    throw new Error('persistPolicyUsage is not available in DB mode. Use setPolicyUsageDb().');
  }
  saveJson(POLICY_USAGE_FILE, policyUsage);
}

export async function getPolicyDb(walletAddress, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB policy reads');
  const db = getDb();
  const res = await db.query(
    `select policy from wallet_policies where tenant_id = $1 and wallet_address = $2 limit 1`,
    [tenantId, (walletAddress || '').toLowerCase()]
  );
  return res.rowCount ? res.rows[0].policy : null;
}

export async function setPolicyDb(walletAddress, policy, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB policy writes');
  const db = getDb();
  await db.query(
    `insert into wallet_policies (tenant_id, wallet_address, policy, updated_at)
     values ($1, $2, $3, now())
     on conflict (tenant_id, wallet_address) do update set
       policy = excluded.policy,
       updated_at = now()`,
    [tenantId, (walletAddress || '').toLowerCase(), JSON.stringify(policy)]
  );
  return policy;
}

export async function getPolicyUsageDb(walletAddress, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB policy usage reads');
  const db = getDb();
  const res = await db.query(
    `select usage from wallet_policy_usage where tenant_id = $1 and wallet_address = $2 limit 1`,
    [tenantId, (walletAddress || '').toLowerCase()]
  );
  return res.rowCount ? res.rows[0].usage : null;
}

export async function setPolicyUsageDb(walletAddress, usage, { tenantId }) {
  if (!tenantId) throw new Error('tenantId is required for DB policy usage writes');
  const db = getDb();
  await db.query(
    `insert into wallet_policy_usage (tenant_id, wallet_address, usage, updated_at)
     values ($1, $2, $3, now())
     on conflict (tenant_id, wallet_address) do update set
       usage = excluded.usage,
       updated_at = now()`,
    [tenantId, (walletAddress || '').toLowerCase(), JSON.stringify(usage)]
  );
  return usage;
}

