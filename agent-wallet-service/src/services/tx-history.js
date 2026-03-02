/**
 * Transaction History Service
 * 
 * Simple transaction logging
 */

import {
  getTransactionStore,
  appendTransaction,
  appendTransactionDb
} from '../repositories/transaction-repository.js';

let transactions = getTransactionStore();
const USE_DB = process.env.STORAGE_BACKEND === 'db';

/**
 * Log a transaction
 */
export async function logTransaction(tx, { tenantId } = {}) {
  const record = {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    timestamp: new Date().toISOString(),
    chain: tx.chain || 'base-sepolia',
    policy: tx.policy || null,
    meta: tx.meta || null
  };
  
  if (USE_DB) {
    return appendTransactionDb(record, { tenantId }, 100);
  }

  transactions = getTransactionStore();
  return appendTransaction(record, 100);
}

/**
 * Get transaction history
 */
export function getHistory(limit = 10) {
  return transactions.slice(0, limit);
}

/**
 * Get transactions by wallet
 */
export function getWalletTransactions(address) {
  return transactions.filter(tx => 
    tx.from.toLowerCase() === address.toLowerCase() ||
    tx.to.toLowerCase() === address.toLowerCase()
  );
}
