/**
 * Transaction History Service
 * 
 * Simple transaction logging
 */

import db from './db.js';

/**
 * Log a transaction
 */
export function logTransaction(tx) {
  const record = {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    timestamp: new Date().toISOString(),
    chain: tx.chain || 'base-sepolia'
  };

  db.prepare('INSERT OR IGNORE INTO transactions (hash, from_address, to_address, value, chain, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(
    record.hash, record.from, record.to, record.value, record.chain, record.timestamp
  );

  return record;
}

/**
 * Get transaction history
 */
export function getHistory(limit = 10) {
  const rows = db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?').all(limit);
  return rows.map(r => ({
    hash: r.hash,
    from: r.from_address,
    to: r.to_address,
    value: r.value,
    timestamp: r.timestamp,
    chain: r.chain
  }));
}

/**
 * Get transactions by wallet
 */
export function getWalletTransactions(address) {
  const rows = db.prepare('SELECT * FROM transactions WHERE LOWER(from_address) = LOWER(?) OR LOWER(to_address) = LOWER(?) ORDER BY timestamp DESC').all(address, address);
  return rows.map(r => ({
    hash: r.hash,
    from: r.from_address,
    to: r.to_address,
    value: r.value,
    timestamp: r.timestamp,
    chain: r.chain
  }));
}
