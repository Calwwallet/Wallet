/**
 * CLAWwallet Multi-Agent Skill
 * 
 * A universal skill that works with ANY AI agent framework!
 * Supports: OpenClaw, LangChain, AutoGen, CrewAI, Custom agents, and more!
 * 
 * Usage:
 *   1. Import this skill into your agent
 *   2. The agent can now create wallets, send payments, and receive funds
 *   3. Works with ANY agent type - NO DISCRIMINATION!
 * 
 * @author Mr. Claw
 * @version 1.0.0
 */

import { randomUUID } from 'crypto';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG = {
  walletServiceUrl: process.env.CLAW_WALLET_URL || 'http://localhost:3000',
  apiKey: process.env.CLAW_WALLET_API_KEY,
  defaultChain: process.env.CLAW_WALLET_CHAIN || 'base-sepolia',
  autoRegister: true,
  enablePayments: true,
};

// ============================================================
// Skill State
// ============================================================

class MultiWalletSkill {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wallets = new Map(); // agentName -> wallet info
    this.initialized = false;
  }

  /**
   * Initialize the skill
   */
  async initialize(context = {}) {
    console.log('🦞 CLAWwallet Multi-Agent Skill initializing...');
    
    // Store context for later use
    this.context = context;
    
    // Test connection to wallet service
    try {
      const health = await this._request('/health');
      console.log(`✅ Wallet service healthy: ${health.status}`);
    } catch (error) {
      console.warn('⚠️ Wallet service not reachable:', error.message);
    }

    this.initialized = true;
    return {
      name: 'CLAWwallet',
      version: '1.0.0',
      description: 'Universal wallet skill for ANY AI agent - create wallets, send/receive payments',
      capabilities: [
        'create_wallet',
        'get_balance',
        'send_payment',
        'register_agent',
        'list_agents',
        'pay_agent',
        'get_services',
      ],
    };
  }

  // ============================================================
  // Wallet Operations
  // ============================================================

  /**
   * Create a wallet for an agent
   * @param {string} agentName - Name of the agent
   * @param {string} chain - Blockchain chain (default: base-sepolia)
   */
  async createWallet(agentName, chain = this.config.defaultChain) {
    const response = await this._request('/wallet/create', {
      method: 'POST',
      body: { agentName, chain },
    });

    const wallet = response.wallet;
    
    // Store locally
    this.wallets.set(agentName, {
      address: wallet.address,
      chain: wallet.chain,
      id: wallet.id,
    });

    return {
      success: true,
      agentName,
      address: wallet.address,
      chain: wallet.chain,
      message: `Wallet created for ${agentName} on ${chain}`,
    };
  }

  /**
   * Get wallet balance
   * @param {string} address - Wallet address
   * @param {string} chain - Blockchain chain
   */
  async getBalance(address, chain = this.config.defaultChain) {
    const response = await this._request(`/wallet/${address}/balance?chain=${chain}`);
    
    return {
      address,
      chain: response.balance.chain,
      eth: response.balance.eth,
      rpc: response.balance.rpc,
    };
  }

  /**
   * Send payment from wallet
   * @param {string} fromAddress - Sender wallet address
   * @param {string} toAddress - Recipient wallet address  
   * @param {string} amount - Amount in ETH
   * @param {string} chain - Blockchain chain
   */
  async sendPayment(fromAddress, toAddress, amount, chain = this.config.defaultChain) {
    const response = await this._request(`/wallet/${fromAddress}/send`, {
      method: 'POST',
      body: {
        to: toAddress,
        value: amount,
        chain,
      },
    });

    return {
      success: true,
      txHash: response.transaction?.hash,
      from: fromAddress,
      to: toAddress,
      amount,
      chain,
      message: `Sent ${amount} ETH from ${fromAddress.slice(0, 8)}... to ${toAddress.slice(0, 8)}...`,
    };
  }

  /**
   * Get wallet address for an agent
   * @param {string} agentName - Name of the agent
   */
  async getWallet(agentName) {
    const wallet = this.wallets.get(agentName);
    if (wallet) return wallet;

    // Try to get from service
    const response = await this._request('/wallet');
    const wallets = response.wallets || [];
    
    for (const w of wallets) {
      // Match by some identifier if available
      if (w.agentName === agentName) {
        return {
          address: w.address,
          chain: w.chain,
          id: w.id,
        };
      }
    }

    return null;
  }

  // ============================================================
  // Agent Registry Operations (Universal!)
  // ============================================================

  /**
   * Register this agent in the universal registry
   * @param {string} agentName - Name of the agent
   * @param {string} agentType - Type of agent (langchain, autogen, crewai, custom, etc.)
   * @param {string} walletAddress - Associated wallet address
   */
  async registerAgent(agentName, agentType = 'custom', walletAddress = null) {
    const response = await this._request('/agents/register', {
      method: 'POST',
      body: {
        agentName,
        agentType,
        metadata: {
          registeredAt: new Date().toISOString(),
          skill: 'CLAWwallet Multi-Agent',
          framework: this.context?.framework || 'unknown',
        },
        walletAddress,
      },
    });

    return {
      success: true,
      agent: response.agent,
      message: `Agent '${agentName}' registered as '${agentType}'`,
    };
  }

  /**
   * Get agent info
   * @param {string} agentName - Name of the agent
   */
  async getAgent(agentName) {
    try {
      const response = await this._request(`/agents/${agentName}`);
      return response.agent;
    } catch (error) {
      return null;
    }
  }

  /**
   * List all registered agents
   */
  async listAgents(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    const response = await this._request(`/agents${params ? '?' + params : ''}`);
    return response.agents || [];
  }

  /**
   * Search for agents
   * @param {string} query - Search query
   */
  async searchAgents(query) {
    const response = await this._request(`/agents/search/${query}`);
    return response.agents || [];
  }

  // ============================================================
  // Agent-to-Agent Payments (Universal!)
  // ============================================================

  /**
   * Pay another agent (UNIVERSAL - works with ANY registered agent!)
   * @param {string} toAgent - Recipient agent name or address
   * @param {string} amount - Amount in ETH or wei
   * @param {string} description - Payment description
   */
  async payAgent(toAgent, amount, description = '') {
    const response = await this._request('/agents/pay', {
      method: 'POST',
      body: {
        toAgent,
        amount: amount.toString(),
        token: 'eth',
        type: 'service',
        description,
      },
    });

    return {
      success: true,
      payment: response.payment,
      instructions: response.instructions,
      message: `Payment of ${amount} ETH queued for ${toAgent}`,
    };
  }

  /**
   * Get agent balance
   * @param {string} agentName - Agent name
   */
  async getAgentBalance(agentName) {
    const response = await this._request(`/agents/${agentName}/balance`);
    return response.balance;
  }

  // ============================================================
  // Service Marketplace
  // ============================================================

  /**
   * List available services from agents
   */
  async getServices() {
    const response = await this._request('/agents/services');
    return response.services || [];
  }

  /**
   * Add a service offering
   * @param {string} agentName - Agent name
   * @param {object} service - Service details
   */
  async addService(agentName, service) {
    const response = await this._request(`/agents/${agentName}/services`, {
      method: 'POST',
      body: service,
    });

    return {
      success: true,
      service: response.service,
    };
  }

  // ============================================================
  // Economy Stats
  // ============================================================

  /**
   * Get economy statistics
   */
  async getEconomyStats() {
    return await this._request('/agents/economy/stats');
  }

  /**
   * Get popular agents
   */
  async getPopularAgents(limit = 10) {
    const response = await this._request(`/agents/popular?limit=${limit}`);
    return response.agents || [];
  }

  // ============================================================
  // Identity Operations
  // ============================================================

  /**
   * Create agent identity (ERC-8004)
   * @param {string} walletAddress - Wallet address
   * @param {string} agentName - Agent name
   * @param {string} description - Agent description
   * @param {string} agentType - Type of agent
   */
  async createIdentity(walletAddress, agentName, description = '', agentType = 'assistant') {
    const response = await this._request('/identity/create', {
      method: 'POST',
      body: {
        walletAddress,
        agentName,
        description,
        agentType,
      },
    });

    return {
      success: true,
      identity: response.identity,
    };
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Make request to wallet service
   */
  async _request(path, options = {}) {
    const url = `${this.config.walletServiceUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get skill status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      wallets: this.wallets.size,
      config: {
        walletServiceUrl: this.config.walletServiceUrl,
        defaultChain: this.config.defaultChain,
        autoRegister: this.config.autoRegister,
      },
    };
  }
}

// ============================================================
// Factory Function for Easy Integration
// ============================================================

/**
 * Create a CLAWwallet skill instance
 * @param {object} config - Configuration options
 */
export function createCLAWSkill(config) {
  return new MultiWalletSkill(config);
}

/**
 * Default skill instance
 */
export const defaultSkill = new MultiWalletSkill();

// ============================================================
// Agent Framework Adapters
// ============================================================

/**
 * OpenClaw Skill Adapter
 * Usage in OpenClaw:
 *   import { clawWalletSkill } from './skills/multiwallet-skill.js';
 *   agent.useSkill(clawWalletSkill);
 */
export const clawWalletSkill = {
  name: 'CLAWwallet',
  version: '1.0.0',
  
  async install(agent) {
    const skill = new MultiWalletSkill();
    await skill.initialize({ framework: 'openclaw', agent });
    
    // Register skill methods with agent
    agent.createWallet = (name, chain) => skill.createWallet(name, chain);
    agent.getBalance = (addr, chain) => skill.getBalance(addr, chain);
    agent.sendPayment = (from, to, amount, chain) => skill.sendPayment(from, to, amount, chain);
    agent.registerAgent = (name, type, wallet) => skill.registerAgent(name, type, wallet);
    agent.payAgent = (to, amount, desc) => skill.payAgent(to, amount, desc);
    agent.listAgents = () => skill.listAgents();
    agent.getServices = () => skill.getServices();
    agent.getEconomyStats = () => skill.getEconomyStats();
    
    console.log('✅ CLAWwallet skill installed on agent');
    return skill;
  },
};

/**
 * Standalone function for any agent
 * Just call this and use the returned methods!
 */
export default MultiWalletSkill;
