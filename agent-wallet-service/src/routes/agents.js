/**
 * Agent Routes
 * 
 * Universal API for ALL AI agents - NO DISCRIMINATION!
 * Register, discover, and pay ANY agent
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate, agentRegistrationSchema, agentPaymentSchema, serviceListingSchema } from '../middleware/validation.js';
import { getAgentRegistry } from '../services/agent-registry.js';
import { getAgentEconomyService } from '../services/agent-economy.js';

const router = Router();

// ============================================================
// STATIC ROUTES (must come before /:agentName)
// ============================================================

/**
 * GET /agents
 * List all registered agents
 */
router.get('/', async (req, res) => {
  try {
    const { type, verified, sort, limit } = req.query;
    const registry = getAgentRegistry();

    const agents = registry.getAllAgents({
      type,
      verified: verified === 'true',
      sortBy: sort || 'recent',
      limit: parseInt(limit) || 50,
    });

    // Return public info only
    const publicAgents = agents.map(a => ({
      id: a.id,
      name: a.name,
      displayName: a.displayName,
      type: a.type,
      verified: a.verified,
      stats: a.stats,
    }));

    res.json({
      agents: publicAgents,
      count: publicAgents.length,
    });
  } catch (error) {
    console.error('List agents error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agents/types
 * Get supported agent types
 */
router.get('/types', (req, res) => {
  res.json({
    types: [
      { id: 'openclaw', name: 'OpenClaw', description: 'OpenClaw AI agents' },
      { id: 'langchain', name: 'LangChain', description: 'LangChain agents' },
      { id: 'autogen', name: 'AutoGen', description: 'Microsoft AutoGen agents' },
      { id: 'crewai', name: 'CrewAI', description: 'CrewAI agents' },
      { id: 'anthropic', name: 'Anthropic', description: 'Claude-powered agents' },
      { id: 'openai', name: 'OpenAI', description: 'GPT-powered agents' },
      { id: 'claude', name: 'Claude', description: 'Anthropic Claude agents' },
      { id: 'gemini', name: 'Gemini', description: 'Google Gemini agents' },
      { id: 'llama', name: 'Llama', description: 'Meta Llama agents' },
      { id: 'custom', name: 'Custom', description: 'Custom/unknown agents' },
      { id: 'other', name: 'Other', description: 'Other AI agents' },
    ]
  });
});

/**
 * GET /agents/popular
 * Get popular agents
 */
router.get('/popular', async (req, res) => {
  try {
    const { limit } = req.query;
    const registry = getAgentRegistry();

    const agents = registry.getPopularAgents(parseInt(limit) || 10);

    res.json({
      agents: agents.map(a => ({
        name: a.name,
        displayName: a.displayName,
        type: a.type,
        verified: a.verified,
        stats: a.stats,
      })),
    });
  } catch (error) {
    console.error('Popular agents error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agents/services
 * Browse all service listings
 */
router.get('/services', async (req, res) => {
  try {
    const { sort, limit, category } = req.query;
    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
    });

    const services = await economy.getServiceListings({
      sortBy: sort || 'popular',
      limit: parseInt(limit) || 50,
    });

    res.json({
      services,
      count: services.length,
    });
  } catch (error) {
    console.error('List services error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agents/services/:serviceId
 * Get service details
 */
router.get('/services/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
    });

    const services = await economy.getServiceListings({ limit: 1000 });
    const service = services.find(s => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agents/economy/stats
 * Get economy statistics
 */
router.get('/economy/stats', async (req, res) => {
  try {
    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
    });

    const stats = await economy.getEconomyStats();

    res.json(stats);
  } catch (error) {
    console.error('Economy stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agents/search/:query
 * Search agents
 */
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { limit } = req.query;
    const registry = getAgentRegistry();

    const agents = registry.searchAgents(query, parseInt(limit) || 20);

    res.json({
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        displayName: a.displayName,
        type: a.type,
        verified: a.verified,
      })),
      count: agents.length,
    });
  } catch (error) {
    console.error('Search agents error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AGENT REGISTRATION
// ============================================================

/**
 * POST /agents/register
 * Register a new agent (UNIVERSAL - any agent can register!)
 */
router.post('/register', requireAuth('write'), validate(agentRegistrationSchema), async (req, res) => {
  try {
    const { agentName, agentType, metadata, walletAddress } = req.validated.body;

    const registry = getAgentRegistry();

    // Register agent
    const agent = registry.registerAgent({
      agentName,
      agentType: agentType || 'custom',
      metadata,
      walletAddress,
      ownerApiKey: req.apiKey?.key || req.headers['x-api-key'],
    });

    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        type: agent.type,
        walletAddress: agent.walletAddress,
        registeredAt: agent.registeredAt,
      }
    });
  } catch (error) {
    console.error('Agent registration error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /agents/pay
 * Pay another agent (UNIVERSAL - any agent can pay any agent!)
 */
router.post('/pay', requireAuth('write'), validate(agentPaymentSchema), async (req, res) => {
  try {
    const { toAgent, amount, token, type, description, serviceId } = req.validated.body;

    // Get sender info
    const fromApiKey = req.headers['x-api-key'];

    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
      treasuryAddress: process.env.TREASURY_ADDRESS,
      feeBasisPoints: parseInt(process.env.ECONOMY_FEE_BPS) || 25,
    });

    // Create payment
    const payment = await economy.createPayment({
      fromAgent: null, // External/human sender
      toAgent,
      amount,
      token: token || 'eth',
      type: type || 'service',
      description,
      serviceId,
    });

    res.json({
      success: true,
      payment: {
        id: payment.id,
        to: payment.to.name,
        amount: payment.amount,
        netAmount: payment.netAmount,
        platformFee: payment.platformFee,
        status: payment.status,
      },
      instructions: {
        recipient: payment.to.wallet,
        amount: payment.amount,
        token: payment.token,
      }
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// DYNAMIC ROUTES (/:agentName) - must come AFTER static routes
// ============================================================

/**
 * GET /agents/:agentName
 * Get agent details
 */
router.get('/:agentName', async (req, res) => {
  try {
    const { agentName } = req.params;
    const registry = getAgentRegistry();

    const agent = registry.getAgent(agentName);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Return public info (hide sensitive data)
    res.json({
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        type: agent.type,
        walletAddress: agent.walletAddress ? `${agent.walletAddress.slice(0, 10)}...${agent.walletAddress.slice(-4)}` : null,
        verified: agent.verified,
        registeredAt: agent.registeredAt,
        stats: agent.stats,
        services: agent.services,
        social: agent.social,
      }
    });
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /agents/:agentName
 * Update agent details
 */
router.put('/:agentName', requireAuth('write'), async (req, res) => {
  try {
    const { agentName } = req.params;
    const { metadata, services, social, verified } = req.body;
    const registry = getAgentRegistry();

    const agent = registry.updateAgent(agentName, {
      metadata,
      services,
      social,
      verified,
    });

    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        updatedAt: agent.updatedAt,
      }
    });
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /agents/:agentName
 * Delete/revoke agent
 */
router.delete('/:agentName', requireAuth('write'), async (req, res) => {
  try {
    const { agentName } = req.params;
    const registry = getAgentRegistry();

    const deleted = registry.deleteAgent(agentName, req.headers['x-api-key']);

    if (!deleted) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      success: true,
      message: `Agent '${agentName}' has been revoked`,
    });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /agents/:agentName/services
 * Add a service listing
 */
router.post('/:agentName/services', requireAuth('write'), validate(serviceListingSchema), async (req, res) => {
  try {
    const { agentName } = req.params;
    const { name, description, price, priceUsd, accepts, endpoint, metadata } = req.validated.body;

    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
    });

    const service = await economy.createServiceListing(agentName, {
      name,
      description,
      price,
      priceUsd,
      accepts,
      endpoint,
      metadata,
    });

    res.json({
      success: true,
      service,
    });
  } catch (error) {
    console.error('Create service error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /agents/:agentName/pay
 * Pay specific agent (shorthand)
 */
router.post('/:agentName/pay', requireAuth('write'), async (req, res) => {
  try {
    const { agentName } = req.params;
    const { amount, token, type, description } = req.body;

    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
      treasuryAddress: process.env.TREASURY_ADDRESS,
    });

    const payment = await economy.createPayment({
      fromAgent: null,
      toAgent: agentName,
      amount,
      token: token || 'eth',
      type: type || 'service',
      description,
    });

    res.json({
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount,
        netAmount: payment.netAmount,
        status: payment.status,
      },
      instructions: {
        recipient: payment.to.wallet,
        amount: payment.amount,
      }
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /agents/:agentName/balance
 * Get agent balance
 */
router.get('/:agentName/balance', async (req, res) => {
  try {
    const { agentName } = req.params;
    const economy = getAgentEconomyService({
      registry: getAgentRegistry(),
    });

    const balance = await economy.getAgentBalance(agentName);

    res.json({
      agent: agentName,
      balance,
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
