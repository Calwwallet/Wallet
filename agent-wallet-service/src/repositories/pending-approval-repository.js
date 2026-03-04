import { getDb } from '../services/db.js';
import { randomUUID } from 'crypto';

const HAS_DB = Boolean(process.env.DATABASE_URL);
let memoryStore = []; // In-memory fallback

export async function createPendingApproval({
  tenantId, walletAddress, fromAddress, toAddress,
  valueEth, valueUsd, chain, token = null, data = null,
  method = null, priority = 'normal', expiresAt = null, metadata = {}
}) {
  const id = `pa_${randomUUID()}`;
  const record = {
    id, tenant_id: tenantId, wallet_address: walletAddress?.toLowerCase(),
    from_address: fromAddress?.toLowerCase(), to_address: toAddress?.toLowerCase(),
    value_eth: valueEth, value_usd: valueUsd, chain, token, data, method,
    priority, status: 'pending', expires_at: expiresAt, metadata,
    created_at: new Date().toISOString()
  };

  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `INSERT INTO pending_approvals (
        id, tenant_id, wallet_address, from_address, to_address, 
        value_eth, value_usd, chain, token, data, method,
        priority, expires_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [id, tenantId, record.wallet_address, record.from_address, record.to_address,
        valueEth, valueUsd, chain, token, data, method, priority, expiresAt, JSON.stringify(metadata)]
    );
    return result.rows[0];
  }

  memoryStore.push(record);
  return record;
}

export async function getPendingApprovalById(id, { tenantId } = {}) {
  if (HAS_DB) {
    const db = getDb();
    let query = 'SELECT * FROM pending_approvals WHERE id = $1';
    const params = [id];
    if (tenantId) { query += ' AND tenant_id = $2'; params.push(tenantId); }
    const result = await db.query(query, params);
    return result.rows[0] || null;
  }
  return memoryStore.find(a => a.id === id && (!tenantId || a.tenant_id === tenantId)) || null;
}

export async function getPendingApprovalsByWallet(walletAddress, { tenantId, status = 'pending', limit = 50, offset = 0 } = {}) {
  if (HAS_DB) {
    const db = getDb();
    let query = 'SELECT * FROM pending_approvals WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    if (walletAddress) { query += ` AND wallet_address = $${paramIndex++}`; params.push(walletAddress.toLowerCase()); }
    if (tenantId) { query += ` AND tenant_id = $${paramIndex++}`; params.push(tenantId); }
    if (status) { query += ` AND status = $${paramIndex++}`; params.push(status); }
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    const result = await db.query(query, params);
    return result.rows;
  }
  let results = memoryStore;
  if (walletAddress) results = results.filter(a => a.wallet_address === walletAddress.toLowerCase());
  if (tenantId) results = results.filter(a => a.tenant_id === tenantId);
  if (status) results = results.filter(a => a.status === status);
  results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return results.slice(offset, offset + limit);
}

export async function getPendingApprovalsByTenant(tenantId, { status = 'pending', limit = 50, offset = 0 } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `SELECT * FROM pending_approvals 
       WHERE tenant_id = $1 AND status = $2 
       ORDER BY 
         CASE priority 
           WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 
           WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END,
         created_at ASC
       LIMIT $3 OFFSET $4`,
      [tenantId, status, limit, offset]
    );
    return result.rows;
  }
  let results = memoryStore.filter(a => a.tenant_id === tenantId && a.status === status);
  const priorityOrder = { 'urgent': 1, 'high': 2, 'normal': 3, 'low': 4 };
  results.sort((a, b) => {
    const diff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    if (diff !== 0) return diff;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return results.slice(offset, offset + limit);
}

export async function countPendingApprovals(tenantId, { status = 'pending' } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `SELECT COUNT(*) as count FROM pending_approvals WHERE tenant_id = $1 AND status = $2`,
      [tenantId, status]
    );
    return parseInt(result.rows[0].count, 10);
  }
  return memoryStore.filter(a => a.tenant_id === tenantId && a.status === status).length;
}

export async function approvePendingApproval(id, { tenantId, approvedBy } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `UPDATE pending_approvals 
       SET status = 'approved', approved_at = NOW(), approved_by = $1
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
       RETURNING *`,
      [approvedBy, id, tenantId]
    );
    return result.rows[0] || null;
  }
  const record = memoryStore.find(a => a.id === id && a.tenant_id === tenantId && a.status === 'pending');
  if (record) {
    record.status = 'approved';
    record.approved_at = new Date().toISOString();
    record.approved_by = approvedBy;
    return record;
  }
  return null;
}

export async function rejectPendingApproval(id, { tenantId, rejectionReason = null } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `UPDATE pending_approvals 
       SET status = 'rejected', rejected_at = NOW(), rejection_reason = $1
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
       RETURNING *`,
      [rejectionReason, id, tenantId]
    );
    return result.rows[0] || null;
  }
  const record = memoryStore.find(a => a.id === id && a.tenant_id === tenantId && a.status === 'pending');
  if (record) {
    record.status = 'rejected';
    record.rejected_at = new Date().toISOString();
    record.rejection_reason = rejectionReason;
    return record;
  }
  return null;
}

export async function cancelPendingApproval(id, { tenantId } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `UPDATE pending_approvals SET status = 'cancelled'
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, tenantId]
    );
    return result.rows[0] || null;
  }
  const record = memoryStore.find(a => a.id === id && a.tenant_id === tenantId && a.status === 'pending');
  if (record) {
    record.status = 'cancelled';
    return record;
  }
  return null;
}

export async function expirePendingApprovals() {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `UPDATE pending_approvals SET status = 'expired'
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING *`
    );
    return result.rows;
  }
  const now = new Date();
  const expired = [];
  for (const record of memoryStore) {
    if (record.status === 'pending' && record.expires_at && new Date(record.expires_at) < now) {
      record.status = 'expired';
      expired.push(record);
    }
  }
  return expired;
}

export async function getApprovalStatus(id, { tenantId } = {}) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `SELECT id, status, approved_at, approved_by, rejected_at, rejection_reason 
       FROM pending_approvals WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return result.rows[0] || null;
  }
  const record = memoryStore.find(a => a.id === id && a.tenant_id === tenantId);
  if (!record) return null;
  return {
    id: record.id, status: record.status, approved_at: record.approved_at,
    approved_by: record.approved_by, rejected_at: record.rejected_at,
    rejection_reason: record.rejection_reason
  };
}

export async function deleteExpiredApprovals(olderThanDays = 30) {
  if (HAS_DB) {
    const db = getDb();
    const result = await db.query(
      `DELETE FROM pending_approvals 
       WHERE status IN ('approved', 'rejected', 'expired', 'cancelled')
         AND created_at < NOW() - INTERVAL '${olderThanDays} days'
       RETURNING *`
    );
    return result.rows;
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const deleted = [];
  memoryStore = memoryStore.filter(record => {
    if (['approved', 'rejected', 'expired', 'cancelled'].includes(record.status) && new Date(record.created_at) < cutoff) {
      deleted.push(record);
      return false;
    }
    return true;
  });
  return deleted;
}
