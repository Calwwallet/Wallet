import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createAgentIdentity,
  getIdentity,
  getIdentitiesByWallet,
  listIdentities,
  updateCapability,
  revokeIdentity,
  exportVerifiableCredential,
  getSupportedCapabilities,
  getAgentTypes
} from '../services/agent-identity.js';

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
router.post('/create', requireAuth('write'), async (req, res, next) => {
  try {
    const { walletAddress, agentName, description, agentType, capabilities, metadata, owner, chain } = req.body;

    if (!walletAddress || !agentName) {
      return res.status(400).json({
        error: 'walletAddress and agentName are required'
      });
    }

    const identity = await createAgentIdentity({
      walletAddress,
      agentName,
      description,
      agentType,
      capabilities,
      metadata,
      owner,
      chain
    });

    res.json({
      success: true,
      identity
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /identity/list
 * List all identities
 */
router.get('/list', (req, res) => {
  const identities = listIdentities();
  res.json({
    count: identities.length,
    identities
  });
});

/**
 * GET /identity/wallet/:address
 * Get identities for a wallet
 */
router.get('/wallet/:address', (req, res) => {
  const { address } = req.params;
  const identities = getIdentitiesByWallet(address);
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
router.get('/:agentId', (req, res) => {
  const { agentId } = req.params;
  const identity = getIdentity(agentId);

  if (!identity) {
    return res.status(404).json({ error: 'Identity not found' });
  }

  res.json(identity);
});

/**
 * PATCH /identity/:agentId/capability
 * Update a capability
 */
router.patch('/:agentId/capability', requireAuth('write'), (req, res, next) => {
  try {
    const { agentId } = req.params;
    const { capability, granted } = req.body;

    if (!capability) {
      return res.status(400).json({ error: 'capability is required' });
    }

    const identity = updateCapability(agentId, capability, granted ?? true);
    res.json({
      success: true,
      identity
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /identity/:agentId/revoke
 * Revoke an identity
 */
router.post('/:agentId/revoke', requireAuth('write'), (req, res, next) => {
  try {
    const { agentId } = req.params;
    const revoked = revokeIdentity(agentId);

    if (!revoked) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    res.json({
      success: true,
      message: 'Identity revoked'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /identity/:agentId/credential
 * Export as W3C Verifiable Credential
 */
router.get('/:agentId/credential', (req, res, next) => {
  try {
    const { agentId } = req.params;
    const credential = exportVerifiableCredential(agentId);
    res.json(credential);
  } catch (error) {
    next(error);
  }
});

export default router;
