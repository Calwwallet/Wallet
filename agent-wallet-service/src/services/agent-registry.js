/**
 * Agent Registry Service
 * 
 * Universal registry for ALL AI agents - no discrimination!
 * Supports: OpenClaw, LangChain, AutoGen, CrewAI, Custom agents, and any future agents
 * 
 * Agent-to-Agent Economy: Anyone can register, anyone can pay
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Supported agent types
export const AGENT_TYPES = {
  OPENCLAW: 'openclaw',
  LANGCHAIN: 'langchain',
  AUTOGEN: 'autogen',
  CREWAI: 'crewai',
  CUSTOM: 'custom',
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  LLAMA: 'llama',
  MISTRAL: 'mistral',
  OTHER: 'other',
};

/**
 * Agent metadata structure
 */
export class AgentRegistry {
  constructor(options = {}) {
    this.storagePath = options.storagePath || join(__dirname, '../../data/agent-registry.json');
    this.agents = new Map();
    this.useDb = options.useDb || process.env.STORAGE_BACKEND === 'db';
    
    if (!this.useDb) {
      this._loadFromFile();
    }
  }

  /**
   * Load agents from file storage
   */
  _loadFromFile() {
    try {
      if (existsSync(this.storagePath)) {
        const data = JSON.parse(readFileSync(this.storagePath, 'utf-8'));
        this.agents = new Map(data.agents || []);
      }
    } catch (error) {
      console.warn('Failed to load agent registry:', error.message);
      this.agents = new Map();
    }
  }

  /**
   * Save agents to file storage
   */
  _saveToFile() {
    try {
      const dir = dirname(this.storagePath);
      // Ensure directory exists
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.storagePath, JSON.stringify({
        agents: Array.from(this.agents.entries()),
        updatedAt: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('Failed to save agent registry:', error.message);
    }
  }

  /**
   * Register a new agent (UNIVERSAL - any agent can register!)
   */
  registerAgent(options = {}) {
    const {
      agentId, // Optional custom ID
      agentName,
      agentType = AGENT_TYPES.CUSTOM,
      metadata = {},
      walletAddress,
      ownerApiKey,
    } = options;

    // Generate ID if not provided
    const id = agentId || `agent_${randomUUID().slice(0, 16)}`;
    
    // Normalize agent name
    const normalizedName = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Check if already registered
    if (this.agents.has(normalizedName)) {
      const existing = this.agents.get(normalizedName);
      // Allow re-registration if same owner
      if (ownerApiKey && existing.ownerApiKey === ownerApiKey) {
        // Update metadata
        existing.metadata = { ...existing.metadata, ...metadata };
        existing.updatedAt = new Date().toISOString();
        this._saveToFile();
        return existing;
      }
      throw new Error(`Agent '${normalizedName}' already registered by another owner`);
    }

    // Create agent record
    const agent = {
      id,
      name: normalizedName,
      displayName: agentName,
      type: this._normalizeAgentType(agentType),
      metadata,
      walletAddress,
      ownerApiKey,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Agent economy stats
      stats: {
        totalReceived: '0',
        totalSent: '0',
        transactionCount: 0,
        serviceCalls: 0,
      },
      // Service offerings (for agent-to-agent economy)
      services: [],
      // Verification status
      verified: false,
      // Social links
      social: {},
    };

    this.agents.set(normalizedName, agent);
    this._saveToFile();

    return agent;
  }

  /**
   * Normalize agent type
   */
  _normalizeAgentType(type) {
    const t = type.toLowerCase();
    
    // Map common types
    const typeMap = {
      'openclaw': AGENT_TYPES.OPENCLAW,
      'langchain': AGENT_TYPES.LANGCHAIN,
      'autogen': AGENT_TYPES.AUTOGEN,
      'crewai': AGENT_TYPES.CREWAI,
      'anthropic': AGENT_TYPES.ANTHROPIC,
      'claude': AGENT_TYPES.CLAUDE,
      'openai': AGENT_TYPES.OPENAI,
      'gpt': AGENT_TYPES.OPENAI,
      'gemini': AGENT_TYPES.GEMINI,
      'llama': AGENT_TYPES.LLAMA,
      'mistral': AGENT_TYPES.MISTRAL,
      'custom': AGENT_TYPES.CUSTOM,
      'other': AGENT_TYPES.OTHER,
    };

    return typeMap[t] || AGENT_TYPES.OTHER;
  }

  /**
   * Get agent by name
   */
  getAgent(agentName) {
    const normalized = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return this.agents.get(normalized) || null;
  }

  /**
   * Get agent by wallet address
   */
  getAgentByWallet(walletAddress) {
    for (const agent of this.agents.values()) {
      if (agent.walletAddress?.toLowerCase() === walletAddress.toLowerCase()) {
        return agent;
      }
    }
    return null;
  }

  /**
   * Get all registered agents
   */
  getAllAgents(filters = {}) {
    let agents = Array.from(this.agents.values());

    // Apply filters
    if (filters.type) {
      agents = agents.filter(a => a.type === filters.type);
    }
    if (filters.verified) {
      agents = agents.filter(a => a.verified);
    }
    if (filters.hasWallet) {
      agents = agents.filter(a => a.walletAddress);
    }

    // Sort by various criteria
    if (filters.sortBy === 'transactions') {
      agents.sort((a, b) => b.stats.transactionCount - a.stats.transactionCount);
    } else if (filters.sortBy === 'recent') {
      agents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    // Pagination
    if (filters.limit) {
      agents = agents.slice(0, filters.limit);
    }

    return agents;
  }

  /**
   * Search agents by name
   */
  searchAgents(query, limit = 20) {
    const q = query.toLowerCase();
    return Array.from(this.agents.values())
      .filter(a => 
        a.name.includes(q) || 
        a.displayName.toLowerCase().includes(q) ||
        a.type.includes(q)
      )
      .slice(0, limit);
  }

  /**
   * Update agent
   */
  updateAgent(agentName, updates) {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    // Allowed updates
    if (updates.metadata) {
      agent.metadata = { ...agent.metadata, ...updates.metadata };
    }
    if (updates.walletAddress) {
      agent.walletAddress = updates.walletAddress;
    }
    if (updates.services) {
      agent.services = updates.services;
    }
    if (updates.social) {
      agent.social = { ...agent.social, ...updates.social };
    }
    if (updates.verified !== undefined) {
      agent.verified = updates.verified;
    }

    agent.updatedAt = new Date().toISOString();
    this._saveToFile();

    return agent;
  }

  /**
   * Record transaction for agent (update stats)
   */
  recordTransaction(agentName, direction, amount) {
    const agent = this.getAgent(agentName);
    if (!agent) return null;

    if (direction === 'received') {
      agent.stats.totalReceived = (BigInt(agent.stats.totalReceived) + BigInt(amount)).toString();
    } else if (direction === 'sent') {
      agent.stats.totalSent = (BigInt(agent.stats.totalSent) + BigInt(amount)).toString();
    }
    agent.stats.transactionCount++;
    agent.updatedAt = new Date().toISOString();
    this._saveToFile();

    return agent;
  }

  /**
   * Add service offering (for agent economy)
   */
  addService(agentName, service) {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const serviceRecord = {
      id: `svc_${randomUUID().slice(0, 12)}`,
      name: service.name,
      description: service.description || '',
      price: service.price, // in wei or token units
      priceUsd: service.priceUsd,
      accepts: service.accepts || ['eth', 'usdc'], // payment tokens
      endpoint: service.endpoint,
      metadata: service.metadata || {},
      createdAt: new Date().toISOString(),
    };

    agent.services.push(serviceRecord);
    agent.updatedAt = new Date().toISOString();
    this._saveToFile();

    return serviceRecord;
  }

  /**
   * Get agent services
   */
  getServices(agentName) {
    const agent = this.getAgent(agentName);
    return agent?.services || [];
  }

  /**
   * Delete/Revoke agent registration
   */
  deleteAgent(agentName, ownerApiKey) {
    const agent = this.getAgent(agentName);
    if (!agent) {
      return false;
    }

    // Verify ownership
    if (ownerApiKey && agent.ownerApiKey !== ownerApiKey) {
      throw new Error('Not authorized to delete this agent');
    }

    this.agents.delete(agentName);
    this._saveToFile();

    return true;
  }

  /**
   * Get agent count by type
   */
  getAgentCountByType() {
    const counts = {};
    for (const agent of this.agents.values()) {
      counts[agent.type] = (counts[agent.type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get popular agents (most transactions)
   */
  getPopularAgents(limit = 10) {
    return this.getAllAgents({ 
      sortBy: 'transactions', 
      limit 
    });
  }

  /**
   * Get recent agents
   */
  getRecentAgents(limit = 10) {
    return this.getAllAgents({ 
      sortBy: 'recent', 
      limit 
    });
  }

  /**
   * Verify agent owns a wallet
   */
  verifyAgentWallet(agentName, walletAddress) {
    const agent = this.getAgent(agentName);
    if (!agent) return false;
    
    return agent.walletAddress?.toLowerCase() === walletAddress.toLowerCase();
  }
}

/**
 * Singleton instance
 */
let registryInstance = null;

export function getAgentRegistry(options = {}) {
  if (!registryInstance) {
    registryInstance = new AgentRegistry(options);
  }
  return registryInstance;
}

export default {
  AgentRegistry,
  getAgentRegistry,
  AGENT_TYPES,
};
