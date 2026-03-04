/**
 * Agent Activity Service
 * 
 * Tracks all activities performed by ERC-8004 AI agents
 * Powers the Agent Explorer with complete history
 */

import { getDb } from './db.js';

// Event types for activity logging
export const ACTIVITY_EVENTS = {
  // Wallet events
  WALLET_CREATED: 'wallet.created',
  WALLET_FUNDED: 'wallet.funded',
  WALLET_DELETED: 'wallet.deleted',
  
  // Transaction events
  TX_SENT: 'tx.sent',
  TX_CONFIRMED: 'tx.confirmed',
  TX_FAILED: 'tx.failed',
  
  // DeFi events
  DEFI_SWAP: 'defi.swap',
  DEFI_STAKE: 'defi.stake',
  DEFI_UNSTAKE: 'defi.unstake',
  DEFI_SUPPLY: 'defi.supply',
  DEFI_BORROW: 'defi.borrow',
  DEFI_REPAY: 'defi.repay',
  DEFI_WITHDRAW: 'defi.withdraw',
  DEFI_CROSSCHAIN: 'defi.crosschain',
  
  // Identity events
  IDENTITY_CREATED: 'identity.created',
  IDENTITY_UPDATED: 'identity.updated',
  IDENTITY_REVOKED: 'identity.revoked',
  CAPABILITY_GRANTED: 'capability.granted',
  CAPABILITY_REVOKED: 'capability.revoked',
  
  // Policy events
  POLICY_UPDATED: 'policy.updated',
  POLICY_TRIGGERED: 'policy.triggered',
  
  // ENS events
  ENS_REGISTERED: 'ens.registered',
  ENS_TRANSFERRED: 'ens.transferred',
  
  // Multi-sig events
  MULTISIG_CREATED: 'multisig.created',
  MULTISIG_TX_SUBMITTED: 'multisig.tx_submitted',
  MULTISIG_TX_CONFIRMED: 'multisig.tx_confirmed',
  MULTISIG_TX_EXECUTED: 'multisig.tx_executed',
  MULTISIG_TX_REJECTED: 'multisig.tx_rejected',
  
  // Social events
  SOCIAL_LINKED: 'social.linked',
  SOCIAL_UNLINKED: 'social.unlinked',
  SOCIAL_VERIFIED: 'social.verified'
};

/**
 * Log an activity event
 */
export async function logActivity(agentId, eventType, eventData = {}, metadata = {}, { tenantId, txHash, chain } = {}) {
  const db = getDb();
  
  // Validate event type
  if (!Object.values(ACTIVITY_EVENTS).includes(eventType)) {
    throw new Error(`Invalid event type: ${eventType}`);
  }
  
  const result = await db.query(
    `SELECT log_agent_activity($1, $2, $3, $4, $5, $6, $7) as activity_id`,
    [agentId, eventType, JSON.stringify(eventData), JSON.stringify(metadata), tenantId, txHash, chain]
  );
  
  return result.rows[0].activity_id;
}

/**
 * Get activity history for an agent
 */
export async function getAgentActivity(agentId, { limit = 50, offset = 0, eventType, tenantId } = {}) {
  const db = getDb();
  
  let query = `
    SELECT 
      aal.id,
      aal.event_type,
      aal.event_data,
      aal.metadata,
      aal.tx_hash,
      aal.chain,
      aal.created_at,
      ai.agent_name,
      ai.wallet_address
    FROM agent_activity_log aal
    JOIN agent_identities ai ON aal.agent_id = ai.id
    WHERE aal.agent_id = $1
  `;
  
  const params = [agentId];
  let paramIndex = 2;
  
  if (tenantId) {
    query += ` AND (aal.tenant_id = $${paramIndex} OR aal.tenant_id IS NULL)`;
    params.push(tenantId);
    paramIndex++;
  }
  
  if (eventType) {
    query += ` AND aal.event_type = $${paramIndex}`;
    params.push(eventType);
    paramIndex++;
  }
  
  query += ` ORDER BY aal.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);
  
  const result = await db.query(query, params);
  
  return result.rows;
}

/**
 * Get activity summary for an agent
 */
export async function getAgentActivitySummary(agentId, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT 
      event_type,
      COUNT(*) as count,
      MIN(created_at) as first_activity,
      MAX(created_at) as last_activity
    FROM agent_activity_log 
    WHERE agent_id = $1 AND (tenant_id = $2 OR $2 IS NULL)
    GROUP BY event_type
    ORDER BY count DESC`,
    [agentId, tenantId]
  );
  
  const summary = {
    totalEvents: 0,
    eventCounts: {},
    firstActivity: null,
    lastActivity: null
  };
  
  for (const row of result.rows) {
    summary.eventCounts[row.event_type] = parseInt(row.count);
    summary.totalEvents += parseInt(row.count);
    if (!summary.firstActivity || row.first_activity < summary.firstActivity) {
      summary.firstActivity = row.first_activity;
    }
    if (!summary.lastActivity || row.last_activity > summary.lastActivity) {
      summary.lastActivity = row.last_activity;
    }
  }
  
  return summary;
}

/**
 * Get recent activities across all agents (for explorer)
 */
export function getRecentActivities({ limit = 20, eventType, tenantId } = {}) {
  // This would be a real query in production
  // For now, returning stub
  return [];
}

/**
 * Get activities by transaction hash
 */
export async function getActivityByTxHash(txHash, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT 
      aal.id,
      aal.agent_id,
      aal.event_type,
      aal.event_data,
      aal.metadata,
      aal.tx_hash,
      aal.chain,
      aal.created_at,
      ai.agent_name,
      ai.wallet_address
    FROM agent_activity_log aal
    JOIN agent_identities ai ON aal.agent_id = ai.id
    WHERE aal.tx_hash = $1 AND (aal.tenant_id = $2 OR $2 IS NULL)
    ORDER BY aal.created_at DESC`,
    [txHash, tenantId]
  );
  
  return result.rows;
}

/**
 * Search activities
 */
export async function searchActivities(query, { limit = 20, tenantId } = {}) {
  const db = getDb();
  
  // Search by agent name or event data
  const result = await db.query(
    `SELECT 
      aal.id,
      aal.agent_id,
      aal.event_type,
      aal.event_data::text,
      aal.tx_hash,
      aal.chain,
      aal.created_at,
      ai.agent_name,
      ai.wallet_address
    FROM agent_activity_log aal
    JOIN agent_identities ai ON aal.agent_id = ai.id
    WHERE (ai.agent_name ILIKE $1 OR aal.event_data::text ILIKE $1)
    AND (aal.tenant_id = $2 OR $2 IS NULL)
    ORDER BY aal.created_at DESC
    LIMIT $3`,
    [`%${query}%`, tenantId, limit]
  );
  
  return result.rows;
}

/**
 * Get agent statistics
 */
export async function getAgentStats(agentId, { tenantId } = {}) {
  const db = getDb();
  
  // Get transaction stats
  const txStats = await db.query(
    `SELECT 
      COUNT(*) as total_txs,
      COUNT(CASE WHEN event_type = 'tx.confirmed' THEN 1 END) as confirmed_txs,
      COUNT(CASE WHEN event_type = 'tx.failed' THEN 1 END) as failed_txs,
      COUNT(CASE WHEN event_type LIKE 'defi.%' THEN 1 END) as defi_operations
    FROM agent_activity_log 
    WHERE agent_id = $1 AND (tenant_id = $2 OR $2 IS NULL)
    AND event_type LIKE 'tx.%'`,
    [agentId, tenantId]
  );
  
  // Get total value transacted (from event data)
  const valueStats = await db.query(
    `SELECT 
      SUM((event_data->>'value')::numeric) as total_value,
      COUNT(DISTINCT DATE(created_at)) as active_days
    FROM agent_activity_log 
    WHERE agent_id = $1 AND (tenant_id = $2 OR $2 IS NULL)
    AND event_data->>'value' IS NOT NULL`,
    [agentId, tenantId]
  );
  
  return {
    transactions: {
      total: parseInt(txStats.rows[0].total_txs) || 0,
      confirmed: parseInt(txStats.rows[0].confirmed_txs) || 0,
      failed: parseInt(txStats.rows[0].failed_txs) || 0,
      defiOperations: parseInt(txStats.rows[0].defi_operations) || 0
    },
    totalValue: parseFloat(valueStats.rows[0].total_value) || 0,
    activeDays: parseInt(valueStats.rows[0].active_days) || 0
  };
}
