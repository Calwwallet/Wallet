import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  validate,
  createWalletSchema,
  importWalletSchema,
  sendTransactionSchema,
  sweepWalletSchema,
  estimateGasSchema,
  setPolicySchema,
  evaluatePolicySchema
} from '../middleware/validation.js';
import {
  attachRpcContext,
  requireRpcUrlForByo,
  blockByoRpcForMultiChain,
  getRpcRuntimeOptions
} from '../middleware/rpc-access.js';
import {
  createWallet,
  getBalance,
  signTransaction,
  getAllWallets,
  getSupportedChains,
  importWallet,
  getTransactionReceipt,
  getMultiChainBalance,
  getWalletByAddress,
  estimateGas,
  sweepWallet
} from '../services/wallet-backend.js';
import { getFeeConfig } from '../services/fee-collector.js';
import { getHistory, getWalletTransactions } from '../services/tx-history.js';
import { getPolicy, setPolicy, evaluateTransferPolicy, applyPolicyPreset, getPolicyPresets, getPolicyStats, checkPendingApproval } from '../services/policy-engine.js';
import {
  getPendingApprovalsByWallet,
  getPendingApprovalsByTenant,
  countPendingApprovals,
  approvePendingApproval,
  rejectPendingApproval,
  cancelPendingApproval
} from '../repositories/pending-approval-repository.js';

const router = Router();
router.use(attachRpcContext);

// ============================================================
// STATIC ROUTES (must come before /:address routes)
// ============================================================

/**
 * POST /wallet/create
 * Create a new agent wallet
 */
router.post('/create', requireAuth('write'), validate(createWalletSchema), async (req, res) => {
  try {
    const { agentName, chain } = req.validated.body;

    // Sanitize agentName to prevent XSS and injection attacks
    const sanitizedAgentName = agentName
      .replace(/[<>&"'{}]/g, '') // Remove potentially dangerous characters
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim()
      .slice(0, 100);             // Limit length

    if (!sanitizedAgentName || sanitizedAgentName.length < 1) {
      return res.status(400).json({ error: 'Agent name is required after sanitization' });
    }

    const runtime = getRpcRuntimeOptions(req);
    const wallet = await createWallet({ agentName: sanitizedAgentName, chain, tenantId: runtime.tenantId });
    res.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        chain: wallet.chain
      }
    });
  } catch (error) {
    console.error('Wallet creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/import
 * Import an existing wallet from private key
 */
router.post('/import', requireAuth('write'), validate(importWalletSchema), async (req, res) => {
  try {
    const { privateKey, agentName, chain } = req.validated.body;
    const runtime = getRpcRuntimeOptions(req);
    const wallet = await importWallet({ privateKey, agentName, chain, tenantId: runtime.tenantId });
    res.json({
      success: true,
      wallet
    });
  } catch (error) {
    console.error('Wallet import error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /wallet/policies
 * List all policies across all wallets
 */
router.get('/policies', requireAuth('read'), async (req, res) => {
  try {
    const wallets = await getAllWallets({ tenantId: req.tenant?.id });
    const policies = wallets.map(w => ({
      wallet: w.address,
      policy: w.policy
    })).filter(p => p.policy && Object.keys(p.policy).length > 0);

    res.json({
      count: policies.length,
      policies
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/policies/stats
 * Get policy engine stats
 */
router.get('/policies/stats', requireAuth('read'), (req, res) => {
  res.json({ stats: getPolicyStats() });
});

/**
 * GET /wallet/policies/presets
 * Get available policy presets
 */
router.get('/policies/presets', (req, res) => {
  res.json({ presets: getPolicyPresets() });
});


/**
 * GET /wallet/list
 * List all wallets
 */
router.get('/list', requireAuth('read'), async (req, res) => {
  try {
    const runtime = getRpcRuntimeOptions(req);
    const wallets = await getAllWallets({ tenantId: runtime.tenantId });
    res.json({
      count: wallets.length,
      wallets
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/chains
 * List all supported chains
 */
router.get('/chains', (req, res) => {
  const chains = getSupportedChains();
  res.json({
    default: 'base-sepolia',
    count: chains.length,
    chains
  });
});

/**
 * GET /wallet/policy/:address
 * Get wallet policy
 */
router.get('/policy/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const policy = await getPolicy(address, { tenantId: req.tenant?.id });
    res.json({ address, policy, presets: getPolicyPresets() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /wallet/policy/:address
 * Upsert wallet policy
 */
router.put('/policy/:address', requireAuth('write'), validate(setPolicySchema, 'body'), async (req, res) => {
  try {
    const { address } = req.params;
    const body = req.validated.body || {};
    const { preset, ...overrides } = body;
    const policy = preset
      ? await applyPolicyPreset(address, preset, overrides, { tenantId: req.tenant?.id })
      : await setPolicy(address, overrides, { tenantId: req.tenant?.id });
    res.json({ success: true, address, policy, preset: preset || null });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /wallet/policy/:address/evaluate
 * Evaluate policy without sending a transaction
 * Requires authentication to prevent enumeration attacks
 */
router.post('/policy/:address/evaluate', requireAuth('read'), validate(evaluatePolicySchema, 'body'), async (req, res) => {
  try {
    const { address } = req.params;
    const { to, value, chain, timestamp, dryRun } = req.validated.body;

    const evaluation = await evaluateTransferPolicy({
      walletAddress: address,
      to,
      valueEth: value,
      chain,
      timestamp,
      tenantId: req.tenant?.id
    });

    const reasonHints = {
      policy_disabled: 'Policy is disabled; transaction would be allowed.',
      invalid_recipient: 'Recipient address is missing or invalid.',
      invalid_value: 'Transfer amount must be a non-negative number.',
      recipient_blocked: 'Recipient is explicitly blocked in this wallet policy.',
      recipient_not_allowlisted: 'Recipient is not in the allowedRecipients list.',
      per_tx_limit_exceeded: 'Lower the amount or raise perTxLimitEth for this wallet.',
      daily_limit_exceeded: 'Daily budget exceeded; adjust dailyLimitEth or wait until tomorrow.',
      ok: 'Transfer is within current policy limits.'
    };

    const explanation = reasonHints[evaluation.reason] || null;

    res.json({
      address,
      dryRun: Boolean(dryRun),
      request: { to, value, chain, timestamp },
      evaluation,
      explanation
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


/**
 * GET /wallet/fees
 * Get fee configuration
 */
router.get('/fees', (req, res) => {
  res.json(getFeeConfig());
});

/**
 * GET /wallet/history
 * Get global transaction history
 */
router.get('/history', (req, res) => {
  const { limit } = req.query;
  const history = getHistory(parseInt(limit) || 50);
  res.json({
    count: history.length,
    transactions: history
  });
});

/**
 * GET /wallet/tx/:hash
 * Get transaction receipt/status
 */
router.get('/tx/:hash', requireRpcUrlForByo, async (req, res) => {
  try {
    const { hash } = req.params;
    const { chain = 'base-sepolia' } = req.query;
    const runtime = getRpcRuntimeOptions(req);
    const receipt = await getTransactionReceipt(hash, chain, runtime);
    res.json(receipt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/estimate-gas
 * Estimate gas for a transaction
 */
router.post('/estimate-gas', requireRpcUrlForByo, validate(estimateGasSchema), async (req, res) => {
  try {
    const { from, to, value, data, chain } = req.validated.body;
    const runtime = getRpcRuntimeOptions(req);
    const estimate = await estimateGas({ from, to, value, data, chain, ...runtime });
    res.json(estimate);
  } catch (error) {
    console.error('Gas estimation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PENDING APPROVALS (HITL) ROUTES
// Must come BEFORE /:address routes to prevent Express
// from matching "pending" as an address parameter.
// ============================================================

/**
 * GET /wallet/pending
 * List all pending approvals for tenant (dashboard view)
 */
router.get('/pending', requireAuth('read'), async (req, res) => {
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    const approvals = await getPendingApprovalsByTenant(req.tenant?.id, {
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const count = await countPendingApprovals(req.tenant?.id, { status });

    res.json({
      approvals,
      count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get all pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/pending/:id
 * Get specific pending approval details
 */
router.get('/pending/:id', requireAuth('read'), async (req, res) => {
  try {
    const { id } = req.params;

    const approvals = await getPendingApprovalsByWallet(null, {
      tenantId: req.tenant?.id,
      status: null,
      limit: 1
    });

    const approval = approvals.find(a => a.id === id);

    if (!approval) {
      return res.status(404).json({ error: 'Pending approval not found' });
    }

    res.json({ approval });
  } catch (error) {
    console.error('Get pending approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/pending/:id/status
 * Poll for approval status (for agents)
 */
router.get('/pending/:id/status', requireAuth('read'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await checkPendingApproval(id, {
      tenantId: req.tenant?.id
    });

    res.json(result);
  } catch (error) {
    console.error('Check approval status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/pending/:id/approve
 * Human approves a pending transaction
 */
router.post('/pending/:id/approve', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const approvedBy = req.apiKey?.name || req.headers['x-api-key'] || 'human-approver';

    const result = await approvePendingApproval(id, {
      tenantId: req.tenant?.id,
      approvedBy
    });

    if (!result) {
      return res.status(404).json({
        error: 'Pending approval not found or already processed'
      });
    }

    res.json({
      success: true,
      message: 'Transaction approved',
      approval: {
        id: result.id,
        status: result.status,
        approvedAt: result.approved_at,
        approvedBy: result.approved_by
      }
    });
  } catch (error) {
    console.error('Approve pending approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/pending/:id/reject
 * Human rejects a pending transaction
 */
router.post('/pending/:id/reject', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await rejectPendingApproval(id, {
      tenantId: req.tenant?.id,
      rejectionReason: reason || 'Rejected by human approver'
    });

    if (!result) {
      return res.status(404).json({
        error: 'Pending approval not found or already processed'
      });
    }

    res.json({
      success: true,
      message: 'Transaction rejected',
      approval: {
        id: result.id,
        status: result.status,
        rejectedAt: result.rejected_at,
        rejectionReason: result.rejection_reason
      }
    });
  } catch (error) {
    console.error('Reject pending approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/pending/:id/cancel
 * Cancel a pending approval (by agent/wallet owner)
 */
router.post('/pending/:id/cancel', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await cancelPendingApproval(id, {
      tenantId: req.tenant?.id
    });

    if (!result) {
      return res.status(404).json({
        error: 'Pending approval not found or already processed'
      });
    }

    res.json({
      success: true,
      message: 'Pending approval cancelled',
      approval: {
        id: result.id,
        status: result.status
      }
    });
  } catch (error) {
    console.error('Cancel pending approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DYNAMIC ROUTES (/:address)
// These must come AFTER all static routes above.
// ============================================================

/**
 * GET /wallet/:address
 * Get wallet details
 */
router.get('/:address', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;
    const tenantId = req.tenant?.id;

    const wallet = await getWalletByAddress(address, { tenantId });

    if (!wallet) {
      return res.status(404).json({ error: `Wallet not found: ${address}`, error_code: 'WALLET_NOT_FOUND' });
    }

    res.json({
      id: wallet.id,
      agentName: wallet.agentName,
      address: wallet.address,
      chain: wallet.chain,
      createdAt: wallet.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message, error_code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /wallet/:address/balance
 * Get wallet balance
 */
router.get('/:address/balance', requireRpcUrlForByo, async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    const runtime = getRpcRuntimeOptions(req);
    const balance = await getBalance(address, chain, runtime);
    res.json({
      address,
      balance
    });
  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/:address/balance/all
 * Get balance across all chains
 */
router.get('/:address/balance/all', blockByoRpcForMultiChain, async (req, res) => {
  try {
    const { address } = req.params;
    const runtime = getRpcRuntimeOptions(req);
    const balances = await getMultiChainBalance(address, runtime);
    res.json({
      address,
      balances
    });
  } catch (error) {
    console.error('Multi-chain balance error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/:address/history
 * Get transaction history for a wallet
 */
router.get('/:address/history', (req, res) => {
  const { address } = req.params;
  const history = getWalletTransactions(address);
  res.json({ address, transactions: history });
});

/**
 * POST /wallet/:address/send
 * Send a transaction
 */
router.post('/:address/send', requireAuth('write'), requireRpcUrlForByo, validate(sendTransactionSchema), async (req, res) => {
  try {
    const { address } = req.params;
    const { to, value, data, chain } = req.validated.body;
    const runtime = getRpcRuntimeOptions(req);

    const context = {
      apiKeyId: req.apiKey?.id || null,
      apiKeyName: req.apiKey?.name || null,
      tenantId: runtime.tenantId || null
    };

    const tx = await signTransaction({ from: address, to, value, data, chain, context, ...runtime });
    res.json({
      success: true,
      transaction: tx
    });
  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /wallet/:address/sweep
 * Sweep all funds to another address
 */
router.post('/:address/sweep', requireAuth('write'), requireRpcUrlForByo, validate(sweepWalletSchema), async (req, res) => {
  try {
    const { address } = req.params;
    const { to, chain } = req.validated.body;
    const runtime = getRpcRuntimeOptions(req);
    const result = await sweepWallet({ from: address, to, chain, ...runtime });
    res.json({
      success: true,
      sweep: result
    });
  } catch (error) {
    console.error('Sweep error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /wallet/:address/pending
 * List pending approvals for a specific wallet
 */
router.get('/:address/pending', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    const approvals = await getPendingApprovalsByWallet(address, {
      tenantId: req.tenant?.id,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const count = await countPendingApprovals(req.tenant?.id, { status });

    res.json({
      approvals,
      count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
