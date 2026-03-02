/**
 * TransactionRepository
 *
 * Encapsulates storage for transaction history.
 * Currently writes to a local JSON file with a bounded history.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';

const TX_FILE = join(process.cwd(), 'transactions.json');
const USE_DB = process.env.STORAGE_BACKEND === 'db';

function loadTransactionStore() {
  if (!existsSync(TX_FILE)) {
    return [];
  }
  return JSON.parse(readFileSync(TX_FILE, 'utf-8'));
}

function saveTransactionStore(txs) {
  writeFileSync(TX_FILE, JSON.stringify(txs, null, 2));
}

let transactions = loadTransactionStore();

export function getTransactionStore() {
  return transactions;
}

export function persistTransactionStore() {
  saveTransactionStore(transactions);
}

export function appendTransaction(record, max = 100) {
  if (USE_DB) {
    throw new Error('appendTransaction requires tenantId in DB mode. Use appendTransactionDb().');
  }
  transactions.unshift(record);
  if (transactions.length > max) {
    transactions = transactions.slice(0, max);
  }
  persistTransactionStore();
  return record;
}

export async function appendTransactionDb(record, { tenantId }, max = 100) {
  if (!tenantId) throw new Error('tenantId is required for DB transaction writes');

  // Keep JSON file updated in dev if desired
  if (process.env.ALLOW_JSON_FALLBACK === 'true') {
    transactions.unshift(record);
    if (transactions.length > max) transactions = transactions.slice(0, max);
    persistTransactionStore();
  }

  const db = getDb();
  await db.query(
    `
    insert into wallet_transactions
      (hash, tenant_id, from_address, to_address, value_eth, timestamp, chain, policy, meta)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (hash) do nothing
    `,
    [
      record.hash,
      tenantId,
      record.from,
      record.to,
      record.value ?? null,
      record.timestamp || new Date().toISOString(),
      record.chain ?? null,
      record.policy ? JSON.stringify(record.policy) : null,
      record.meta ? JSON.stringify(record.meta) : null
    ]
  );

  return record;
}

