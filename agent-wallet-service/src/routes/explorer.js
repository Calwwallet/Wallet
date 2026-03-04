/**
 * Agent Explorer Routes
 * 
 * API endpoints for the Agent Explorer - view all activities
 * performed by AI agents powered by your wallet service
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { 
  getAgentActivity, 
  getAgentActivitySummary, 
  getAgentStats,
  getActivityByTxHash,
  searchActivities,
  ACTIVITY_EVENTS 
} from '../services/agent-activity.js';
import { getSocialPresence } from '../services/social-identity.js';
import { getIdentity } from '../services/agent-identity.js';

const router = Router();

/**
 * GET /explorer/activity-events
 * List all possible activity event types
 */
router.get('/activity-events', (req, res) => {
  res.json({
    eventTypes: Object.entries(ACTIVITY_EVENTS).map(([key, value]) => ({
      name: key,
      value
    })),
    categories: {
      wallet: ['wallet.created', 'wallet.funded', 'wallet.deleted'],
      transaction: ['tx.sent', 'tx.confirmed', 'tx.failed'],
      defi: ['defi.swap', 'defi.stake', 'defi.unstake', 'defi.supply', 'defi.borrow', 'defi.repay', 'defi.withdraw', 'defi.crosschain'],
      identity: ['identity.created', 'identity.updated', 'identity.revoked', 'capability.granted', 'capability.revoked'],
      policy: ['policy.updated', 'policy.triggered'],
      ens: ['ens.registered', 'ens.transferred'],
      multisig: ['multisig.created', 'multisig.tx_submitted', 'multisig.tx_confirmed', 'multisig.tx_executed', 'multisig.tx_rejected'],
      social: ['social.linked', 'social.unlinked', 'social.verified']
    }
  });
});

/**
 * GET /explorer/agent/:agentId
 * Get complete agent profile with activity summary
 */
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Get agent identity
    const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });
    
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get activity summary
    const summary = await getAgentActivitySummary(agentId, { tenantId: req.tenant?.id });
    
    // Get stats
    const stats = await getAgentStats(agentId, { tenantId: req.tenant?.id });
    
    // Get social presence (if social links exist)
    let socialPresence = null;
    try {
      socialPresence = await getSocialPresence(agentId, { tenantId: req.tenant?.id });
    } catch (e) {
      // Social links table might not exist yet
    }
    
    res.json({
      agent: identity,
      summary,
      stats,
      socialPresence
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/agent/:agentId/activity
 * Get activity history for an agent
 */
router.get('/agent/:agentId/activity', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit = 50, offset = 0, eventType } = req.query;
    
    // Verify agent exists
    const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });
    
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const activity = await getAgentActivity(agentId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      eventType,
      tenantId: req.tenant?.id
    });
    
    res.json({
      agentId,
      agentName: identity.agent_name,
      count: activity.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      activity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/agent/:agentId/stats
 * Get detailed statistics for an agent
 */
router.get('/agent/:agentId/stats', async (req, res) => {
  try {
    const { agentId } = req.params;
    
    const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });
    
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const stats = await getAgentStats(agentId, { tenantId: req.tenant?.id });
    const summary = await getAgentActivitySummary(agentId, { tenantId: req.tenant?.id });
    
    res.json({
      agentId,
      agentName: identity.agent_name,
      walletAddress: identity.wallet,
      stats,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/tx/:txHash
 * Get all activities related to a transaction
 */
router.get('/tx/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;
    
    const activities = await getActivityByTxHash(txHash, { tenantId: req.tenant?.id });
    
    if (activities.length === 0) {
      return res.status(404).json({ error: 'No activities found for this transaction' });
    }
    
    res.json({
      txHash,
      count: activities.length,
      activities
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/search
 * Search activities across all agents
 */
router.get('/search', requireAuth('read'), async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const results = await searchActivities(q, {
      limit: parseInt(limit),
      tenantId: req.tenant?.id
    });
    
    res.json({
      query: q,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/leaderboard
 * Get most active agents (by transaction count)
 */
router.get('/leaderboard', requireAuth('admin'), async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // This would query the database for most active agents
    // For now, returning placeholder
    
    res.json({
      message: 'Leaderboard feature - would rank agents by activity',
      limit: parseInt(limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /explorer/export/:agentId
 * Export complete agent history as JSON
 */
router.get('/export/:agentId', requireAuth('read'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const { format = 'json' } = req.query;
    
    const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });
    
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get all activity (no limit)
    const activity = await getAgentActivity(agentId, {
      limit: 10000,
      offset: 0,
      tenantId: req.tenant?.id
    });
    
    const stats = await getAgentStats(agentId, { tenantId: req.tenant?.id });
    const summary = await getAgentActivitySummary(agentId, { tenantId: req.tenant?.id });
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeader = 'timestamp,event_type,tx_hash,chain,details\n';
      const csvRows = activity.map(a => 
        `${a.created_at},${a.event_type},${a.tx_hash || ''},${a.chain || ''},"${JSON.stringify(a.event_data).replace(/"/g, '""')}"`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=agent-${agentId}-history.csv`);
      res.send(csvHeader + csvRows);
    } else {
      res.json({
        exportedAt: new Date().toISOString(),
        agent: identity,
        stats,
        summary,
        activityCount: activity.length,
        activity
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
