import { Router } from 'express';
import { sendError } from '../utils/error-envelope.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, createIdentitySchema, agentPaySchema, updateCapabilitySchema } from '../middleware/validation.js';
import {
  createAgentIdentity,
  getIdentity,
  getIdentitiesByWallet,
  listIdentities,
  updateCapability,
  revokeIdentity,
  exportVerifiableCredential,
  generateVerificationProof,
  issueVerifiableCredential,
  getSupportedCapabilities,
  getAgentTypes
} from '../services/agent-identity.js';
import { estimateGas, signTransaction } from '../services/wallet-backend.js';

const router = Router();

/**
 * GET /identity/capabilities
 * List supported capabilities
 */
router.get('/capabilities', (req, res) => {
  res.json({
    capabilities: getSupportedCapabilities()
  });
});

/**
 * GET /identity/types
 * List supported agent types
 */
router.get('/types', (req, res) => {
  res.json({
    types: getAgentTypes()
  });
});

/**
 * POST /identity/create
 * Create new ERC-8004 agent identity
 */
router.post('/create', requireAuth('write'), validate(createIdentitySchema), async (req, res) => {
  try {
    const { walletAddress, agentName, description, agentType, capabilities, metadata, owner, chain } = req.validated.body;

    const identity = await createAgentIdentity({
      walletAddress,
      agentName,
      description,
      agentType,
      capabilities,
      metadata,
      owner,
      chain,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      identity
    });
  } catch (error) {
    console.error('Identity creation error:', error);
    if (error.message.includes('Invalid agent type')) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

/**
 * GET /identity/list
 * List all identities
 */
router.get('/list', requireAuth('read'), async (req, res) => {
  const identities = await listIdentities({ tenantId: req.tenant?.id });
  res.json({ count: identities.length, identities });
});

/**
 * GET /identity/wallet/:address
 * Get identities for a wallet
 */
router.get('/wallet/:address', async (req, res) => {
  const { address } = req.params;
  const identities = await getIdentitiesByWallet(address, { tenantId: req.tenant?.id });
  res.json({
    wallet: address,
    count: identities.length,
    identities
  });
});

/**
 * GET /identity/:agentId
 * Get specific identity
 */
router.get('/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });

  if (!identity) {
    return sendError(res, 404, 'IDENTITY_NOT_FOUND', 'Identity not found');
  }

  res.json(identity);
});

/**
 * POST /identity/:agentId/pay
 * High-level payment helper for agents
 */
router.post('/:agentId/pay', requireAuth('write'), validate(agentPaySchema), async (req, res) => {
  try {
    const { agentId } = req.params;
    const { to, amountEth, chain, memo, dryRun } = req.validated.body;

    const identity = await getIdentity(agentId, { tenantId: req.tenant?.id });
    if (!identity) {
      return sendError(res, 404, 'AGENT_IDENTITY_NOT_FOUND', 'Identity not found');
    }

    if (!identity.wallet) {
      return sendError(res, 400, 'AGENT_IDENTITY_NO_WALLET', 'Identity has no associated wallet');
    }

    const from = identity.wallet;

    const context = {
      apiKeyId: req.apiKey?.id || null,
      apiKeyName: req.apiKey?.name || null,
      tenantId: req.tenant?.id || null,
      agentId
    };

    if (dryRun) {
      const gasEstimate = await estimateGas({
        from,
        to,
        value: amountEth,
        data: '0x',
        chain,
        tenantId: req.tenant?.id
      });

      return res.json({
        success: true,
        dryRun: true,
        agentId,
        from,
        to,
        amountEth,
        chain: gasEstimate.chain,
        memo: memo || null,
        gasEstimate,
        summary: `Would send ${amountEth} ETH from ${from} to ${to} on ${gasEstimate.chain}`
      });
    }

    const tx = await signTransaction({
      from,
      to,
      value: amountEth,
      data: '0x',
      chain,
      context,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      agentId,
      from,
      to,
      amountEth,
      chain: tx.chain,
      memo: memo || null,
      transaction: tx,
      receiptUrl: tx.explorer
    });
  } catch (error) {
    console.error('Agent pay error:', error);

    // Map specific errors to appropriate status codes
    const errorMessage = error.message || 'Unknown error';
    let errorCode = 'AGENT_PAY_ERROR';

    if (errorMessage.includes('not found')) {
      errorCode = 'AGENT_WALLET_NOT_FOUND';
    } else if (errorMessage.includes('no associated wallet')) {
      errorCode = 'AGENT_IDENTITY_NO_WALLET';
    } else if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
      errorCode = 'INSUFFICIENT_BALANCE';
    }

    sendError(res, 500, errorCode, errorMessage);
  }
});

/**
 * PATCH /identity/:agentId/capability
 * Update a capability
 */
router.patch('/:agentId/capability', requireAuth('write'), validate(updateCapabilitySchema), async (req, res) => {
  try {
    const { agentId } = req.params;
    const { capability, granted } = req.validated.body;

    const identity = await updateCapability(agentId, capability, granted ?? true, { tenantId: req.tenant?.id });
    res.json({ success: true, identity });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

/**
 * POST /identity/:agentId/revoke
 * Revoke an identity
 */
router.post('/:agentId/revoke', requireAuth('write'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const revoked = await revokeIdentity(agentId, { tenantId: req.tenant?.id });
    if (!revoked) {
      return sendError(res, 404, 'IDENTITY_NOT_FOUND', 'Identity not found');
    }
    res.json({ success: true, message: 'Identity revoked' });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

/**
 * GET /identity/:agentId/credential
 * Export as W3C Verifiable Credential
 */
router.get('/:agentId/credential', requireAuth('read'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const credential = await exportVerifiableCredential(agentId, { tenantId: req.tenant?.id });
    res.json(credential);
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

/**
 * POST /identity/:agentId/proof
 * Generate a signed verification proof for this identity
 */
router.post('/:agentId/proof', async (req, res) => {
  try {
    const { agentId } = req.params;
    const proof = await generateVerificationProof(agentId, { tenantId: req.tenant?.id });
    res.json(proof);
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

/**
 * POST /identity/:agentId/credential/issue
 * Issue a signed verifiable credential for this identity
 */
router.post('/:agentId/credential/issue', requireAuth('write'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const vc = await issueVerifiableCredential(agentId, { tenantId: req.tenant?.id });
    res.json(vc);
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

export default router;
