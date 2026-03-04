/**
 * Multi-Sig Wallet Repository
 *
 * Data layer for multi-sig wallet configurations and transactions.
 * Supports both JSON file storage (dev) and PostgreSQL (production).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../services/db.js';
import { randomBytes } from 'crypto';

const MULTISIG_FILE = join(process.cwd(), 'multisig-wallets.json');
const MULTISIG_TX_FILE = join(process.cwd(), 'multisig-transactions.json');
const MULTISIG_CONFIRMATIONS_FILE = join(process.cwd(), 'multisig-confirmations.json');

const USE_DB = process.env.STORAGE_BACKEND === 'db';

// ============================================================
// JSON File Storage (Development)
// ============================================================

function loadJsonStore(filePath, defaultValue = {}) {
  if (!existsSync(filePath)) {
    return defaultValue;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

function saveJsonStore(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// In-memory stores
const walletsStore = loadJsonStore(MULTISIG_FILE);
const transactionsStore = loadJsonStore(MULTISIG_TX_FILE);
const confirmationsStore = loadJsonStore(MULTISIG_CONFIRMATIONS_FILE);

// ============================================================
// Helper Functions
// ============================================================

function normalizeAddress(address) {
  return (address || '').toLowerCase();
}

function generateId() {
  return randomBytes(16).toString('hex');
}

// ============================================================
// Wallet Operations
// ============================================================

/**
 * Create a new multi-sig wallet
 */
export async function createMultisigWallet(wallet) {
  const id = wallet.id || generateId();
  const normalizedOwners = (wallet.owners || []).map(normalizeAddress);
  
  const record = {
    id,
    tenantId: wallet.tenantId,
    address: normalizeAddress(wallet.address),
    chain: wallet.chain,
    threshold: wallet.threshold,
    ownerCount: normalizedOwners.length,
    owners: normalizedOwners,
    roles: wallet.roles || {},
    timelockSeconds: wallet.timelockSeconds || 0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (USE_DB) {
    const db = getDb();
    await db.query(
      `INSERT INTO multisig_wallets (id, tenant_id, address, chain, threshold, owner_count, owners, roles, timelock_seconds, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id, address) DO UPDATE SET
         threshold = excluded.threshold,
         owners = excluded.owners,
         roles = excluded.roles,
         timelock_seconds = excluded.timelock_seconds,
         updated_at = excluded.updated_at`,
      [id, wallet.tenantId, record.address, record.chain, record.threshold, record.ownerCount, JSON.stringify(record.owners), JSON.stringify(record.roles), record.timelockSeconds, record.isActive, record.createdAt, record.updatedAt]
    );
    return record;
  }

  walletsStore[id] = record;
  saveJsonStore(MULTISIG_FILE, walletsStore);
  return record;
}

/**
 * Get multi-sig wallet by address
 */
export async function getMultisigWalletByAddress(address, { tenantId } = {}) {
  const normalized = normalizeAddress(address);
  
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    const res = await db.query(
      `SELECT * FROM multisig_wallets WHERE tenant_id = $1 AND address = $2 AND is_active = true`,
      [tenantId, normalized]
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      address: row.address,
      chain: row.chain,
      threshold: row.threshold,
      ownerCount: row.owner_count,
      owners: row.owners,
      roles: row.roles,
      timelockSeconds: row.timelock_seconds,
      isActive: row.is_active,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    };
  }

  return Object.values(walletsStore).find(w => w.address === normalized && w.isActive) || null;
}

/**
 * Get all multi-sig wallets for a tenant
 */
export async function getAllMultisigWallets({ tenantId } = {}) {
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    const res = await db.query(
      `SELECT * FROM multisig_wallets WHERE tenant_id = $1 AND is_active = true ORDER BY created_at DESC`,
      [tenantId]
    );
    return res.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      address: row.address,
      chain: row.chain,
      threshold: row.threshold,
      ownerCount: row.owner_count,
      owners: row.owners,
      roles: row.roles,
      timelockSeconds: row.timelock_seconds,
      isActive: row.is_active,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    }));
  }

  return Object.values(walletsStore).filter(w => w.isActive);
}

/**
 * Update multi-sig wallet
 */
export async function updateMultisigWallet(address, updates, { tenantId } = {}) {
  const normalized = normalizeAddress(address);
  
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB updates');
    const db = getDb();
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (updates.threshold !== undefined) {
      setClauses.push(`threshold = $${paramIndex++}`);
      values.push(updates.threshold);
    }
    if (updates.owners !== undefined) {
      setClauses.push(`owners = $${paramIndex++}`);
      values.push(JSON.stringify(updates.owners));
    }
    if (updates.roles !== undefined) {
      setClauses.push(`roles = $${paramIndex++}`);
      values.push(JSON.stringify(updates.roles));
    }
    if (updates.timelockSeconds !== undefined) {
      setClauses.push(`timelock_seconds = $${paramIndex++}`);
      values.push(updates.timelockSeconds);
    }
    if (updates.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(tenantId, normalized);
    
    await db.query(
      `UPDATE multisig_wallets SET ${setClauses.join(', ')} WHERE tenant_id = $${paramIndex++} AND address = $${paramIndex}`,
      values
    );
    return getMultisigWalletByAddress(address, { tenantId });
  }

  const wallet = await getMultisigWalletByAddress(address, { tenantId });
  if (!wallet) return null;

  Object.assign(wallet, updates, { updatedAt: new Date().toISOString() });
  walletsStore[wallet.id] = wallet;
  saveJsonStore(MULTISIG_FILE, walletsStore);
  return wallet;
}

// ============================================================
// Transaction Operations
// ============================================================

/**
 * Create a new multi-sig transaction
 */
export async function createMultisigTransaction(tx) {
  const id = tx.id || generateId();
  const normalizedTo = normalizeAddress(tx.toAddress);
  
  const record = {
    id,
    tenantId: tx.tenantId,
    multisigAddress: normalizeAddress(tx.multisigAddress),
    txIndex: tx.txIndex,
    toAddress: normalizedTo,
    valueEth: tx.valueEth || '0',
    data: tx.data || '0x',
    operation: tx.operation || 0,
    nonce: tx.nonce || generateId(),
    description: tx.description || null,
    timelockUntil: tx.timelockUntil || null,
    executedAt: null,
    executorAddress: null,
    txHash: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (USE_DB) {
    const db = getDb();
    await db.query(
      `INSERT INTO multisig_transactions (id, tenant_id, multisig_address, tx_index, to_address, value_eth, data, operation, nonce, description, timelock_until, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (tenant_id, multisig_address, tx_index) DO UPDATE SET
         to_address = excluded.to_address,
         value_eth = excluded.value_eth,
         data = excluded.data,
         description = excluded.description,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [id, tx.tenantId, record.multisigAddress, record.txIndex, record.toAddress, record.valueEth, record.data, record.operation, record.nonce, record.description, record.timelockUntil, record.status, record.createdAt, record.updatedAt]
    );
    return record;
  }

  transactionsStore[id] = record;
  saveJsonStore(MULTISIG_TX_FILE, transactionsStore);
  return record;
}

/**
 * Get transaction by ID
 */
export async function getMultisigTransactionById(txId, { tenantId } = {}) {
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    const res = await db.query(
      `SELECT * FROM multisig_transactions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, txId]
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return mapTransactionRow(row);
  }

  return transactionsStore[txId] || null;
}

/**
 * Get next transaction index for a multi-sig wallet
 */
export async function getNextTransactionIndex(multisigAddress, { tenantId } = {}) {
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    const res = await db.query(
      `SELECT COALESCE(MAX(tx_index), -1) + 1 as next_index FROM multisig_transactions 
       WHERE tenant_id = $1 AND multisig_address = $2`,
      [tenantId, normalizeAddress(multisigAddress)]
    );
    return parseInt(res.rows[0].next_index);
  }

  const txs = Object.values(transactionsStore).filter(
    t => t.multisigAddress === normalizeAddress(multisigAddress)
  );
  if (txs.length === 0) return 0;
  return Math.max(...txs.map(t => t.txIndex)) + 1;
}

/**
 * Get all transactions for a multi-sig wallet
 */
export async function getMultisigTransactions(multisigAddress, { tenantId, status } = {}) {
  const normalized = normalizeAddress(multisigAddress);
  
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    let query = `SELECT * FROM multisig_transactions WHERE tenant_id = $1 AND multisig_address = $2`;
    const values = [tenantId, normalized];
    let paramIndex = 3;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }

    query += ` ORDER BY tx_index DESC`;

    const res = await db.query(query, values);
    return res.rows.map(mapTransactionRow);
  }

  return Object.values(transactionsStore)
    .filter(t => t.multisigAddress === normalized && (!status || t.status === status))
    .sort((a, b) => b.txIndex - a.txIndex);
}

/**
 * Update transaction status
 */
export async function updateMultisigTransaction(txId, updates, { tenantId } = {}) {
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB updates');
    const db = getDb();
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.executedAt !== undefined) {
      setClauses.push(`executed_at = $${paramIndex++}`);
      values.push(updates.executedAt);
    }
    if (updates.executorAddress !== undefined) {
      setClauses.push(`executor_address = $${paramIndex++}`);
      values.push(normalizeAddress(updates.executorAddress));
    }
    if (updates.txHash !== undefined) {
      setClauses.push(`tx_hash = $${paramIndex++}`);
      values.push(updates.txHash);
    }
    if (updates.timelockUntil !== undefined) {
      setClauses.push(`timelock_until = $${paramIndex++}`);
      values.push(updates.timelockUntil);
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(tenantId, txId);

    await db.query(
      `UPDATE multisig_transactions SET ${setClauses.join(', ')} WHERE tenant_id = $${paramIndex++} AND id = $${paramIndex}`,
      values
    );
    return getMultisigTransactionById(txId, { tenantId });
  }

  const tx = transactionsStore[txId];
  if (!tx) return null;

  Object.assign(tx, updates, { updatedAt: new Date().toISOString() });
  transactionsStore[txId] = tx;
  saveJsonStore(MULTISIG_TX_FILE, transactionsStore);
  return tx;
}

// ============================================================
// Confirmation Operations
// ============================================================

/**
 * Add a confirmation to a transaction
 */
export async function addConfirmation(confirmation) {
  const id = confirmation.id || generateId();
  
  const record = {
    id,
    tenantId: confirmation.tenantId,
    multisigAddress: normalizeAddress(confirmation.multisigAddress),
    txId: confirmation.txId,
    signerAddress: normalizeAddress(confirmation.signerAddress),
    signature: confirmation.signature || null,
    confirmedAt: new Date().toISOString()
  };

  if (USE_DB) {
    const db = getDb();
    await db.query(
      `INSERT INTO multisig_confirmations (id, tenant_id, multisig_address, tx_id, signer_address, signature, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, tx_id, signer_address) DO NOTHING`,
      [id, confirmation.tenantId, record.multisigAddress, record.txId, record.signerAddress, record.signature, record.confirmedAt]
    );
    return record;
  }

  const key = `${record.txId}_${record.signerAddress}`;
  confirmationsStore[key] = record;
  saveJsonStore(MULTISIG_CONFIRMATIONS_FILE, confirmationsStore);
  return record;
}

/**
 * Get confirmations for a transaction
 */
export async function getConfirmations(txId, { tenantId } = {}) {
  if (USE_DB) {
    if (!tenantId) throw new Error('tenantId is required for DB lookups');
    const db = getDb();
    const res = await db.query(
      `SELECT * FROM multisig_confirmations WHERE tenant_id = $1 AND tx_id = $2 ORDER BY confirmed_at ASC`,
      [tenantId, txId]
    );
    return res.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      multisigAddress: row.multisig_address,
      txId: row.tx_id,
      signerAddress: row.signer_address,
      signature: row.signature,
      confirmedAt: row.confirmed_at?.toISOString?.() || row.confirmed_at
    }));
  }

  return Object.values(confirmationsStore)
    .filter(c => c.txId === txId)
    .sort((a, b) => new Date(a.confirmedAt) - new Date(b.confirmedAt));
}

/**
 * Get confirmation count for a transaction
 */
export async function getConfirmationCount(txId, { tenantId } = {}) {
  const confirmations = await getConfirmations(txId, { tenantId });
  return confirmations.length;
}

/**
 * Check if an address has confirmed a transaction
 */
export async function hasConfirmed(txId, signerAddress, { tenantId } = {}) {
  const confirmations = await getConfirmations(txId, { tenantId });
  return confirmations.some(c => c.signerAddress === normalizeAddress(signerAddress));
}

// ============================================================
// Helper Functions
// ============================================================

function mapTransactionRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    multisigAddress: row.multisig_address,
    txIndex: row.tx_index,
    toAddress: row.to_address,
    valueEth: row.value_eth,
    data: row.data,
    operation: row.operation,
    nonce: row.nonce,
    description: row.description,
    timelockUntil: row.timelock_until?.toISOString?.() || row.timelock_until,
    executedAt: row.executed_at?.toISOString?.() || row.executed_at,
    executorAddress: row.executor_address,
    txHash: row.tx_hash,
    status: row.status,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}
