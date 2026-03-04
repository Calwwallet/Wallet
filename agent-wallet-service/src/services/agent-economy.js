/**
 * Agent Economy Service
 * 
 * Universal Agent-to-Agent payments - NO DISCRIMINATION!
 * Any agent can pay any other agent for services
 * 
 * Supported payment flows:
 * - Human → Agent
 * - Agent → Agent  
 * - Agent → Human
 * - Any → Any (universal)
 */

import { randomUUID } from 'crypto';

/**
 * Payment status
 */
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

/**
 * Payment types
 */
export const PAYMENT_TYPE = {
  SERVICE: 'service',         // Payment for agent service
  TIP: 'tip',                 // Voluntary tip
  SUBSCRIPTION: 'subscription', // Recurring payment
  REFERRAL: 'referral',       // Referral bonus
  BOUNTY: 'bounty',           // Task completion reward
  CUSTOM: 'custom',           // Custom payment
};

/**
 * Agent Economy Service
 */
export class AgentEconomyService {
  constructor(options = {}) {
    this.registry = options.registry;
    this.feeBasisPoints = options.feeBasisPoints || 25; // 0.25% platform fee
    this.treasuryAddress = options.treasuryAddress;
    this.minPaymentAmount = options.minPaymentAmount || '1000000000000'; // 0.000001 ETH
  }

  /**
   * Create a payment between agents
   */
  async createPayment(options = {}) {
    const {
      fromAgent,      // Name or wallet of sender
      toAgent,        // Name or wallet of recipient  
      amount,         // Payment amount in wei
      token = 'eth',  // Token (eth, usdc, etc.)
      type = PAYMENT_TYPE.SERVICE,
      description = '',
      metadata = {},
      serviceId,      // Optional service ID if paying for specific service
      referenceId,    // Optional reference (order ID, etc.)
    } = options;

    // Validate amount
    if (BigInt(amount) < BigInt(this.minPaymentAmount)) {
      throw new Error(`Minimum payment amount is ${this.minPaymentAmount} wei`);
    }

    // Resolve sender (can be agent name or wallet address)
    let fromAgentData = null;
    if (fromAgent) {
      fromAgentData = this._resolveAgent(fromAgent);
    }

    // Resolve recipient
    const toAgentData = this._resolveAgent(toAgent);
    if (!toAgentData) {
      throw new Error(`Recipient agent '${toAgent}' not found`);
    }

    // Calculate fees
    const platformFee = (BigInt(amount) * BigInt(this.feeBasisPoints)) / BigInt(10000);
    const netAmount = BigInt(amount) - platformFee;

    // Create payment record
    const payment = {
      id: `pay_${randomUUID().slice(0, 16)}`,
      from: {
        type: fromAgentData ? 'agent' : 'external',
        agentId: fromAgentData?.id,
        name: fromAgentData?.name,
        wallet: fromAgentData?.walletAddress,
      },
      to: {
        type: 'agent',
        agentId: toAgentData.id,
        name: toAgentData.name,
        wallet: toAgentData.walletAddress,
      },
      amount: amount.toString(),
      netAmount: netAmount.toString(),
      platformFee: platformFee.toString(),
      token,
      type,
      status: PAYMENT_STATUS.PENDING,
      description,
      metadata,
      serviceId,
      referenceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Transaction data
      txHash: null,
      confirmedAt: null,
    };

    return payment;
  }

  /**
   * Resolve agent by name or wallet address
   */
  _resolveAgent(identifier) {
    if (!this.registry) return null;
    
    // Try as agent name first
    let agent = this.registry.getAgent(identifier);
    if (agent) return agent;
    
    // Try as wallet address
    agent = this.registry.getAgentByWallet(identifier);
    if (agent) return agent;
    
    return null;
  }

  /**
   * Process payment (mark as completed)
   */
  async processPayment(payment, txHash) {
    payment.status = PAYMENT_STATUS.COMPLETED;
    payment.txHash = txHash;
    payment.confirmedAt = new Date().toISOString();
    payment.updatedAt = new Date().toISOString();

    // Update agent stats
    if (this.registry) {
      // Update recipient stats
      this.registry.recordTransaction(
        payment.to.name, 
        'received', 
        payment.netAmount
      );
      
      // Update sender stats if agent
      if (payment.from.agentId) {
        this.registry.recordTransaction(
          payment.from.name,
          'sent',
          payment.amount
        );
      }
    }

    return payment;
  }

  /**
   * Get payment by ID
   */
  getPayment(paymentId) {
    // In production, this would query a database
    return this.payments?.get(paymentId) || null;
  }

  /**
   * List payments for an agent
   */
  listPayments(agentName, direction = 'all') {
    const agent = this._resolveAgent(agentName);
    if (!agent) return [];

    // In production, query from database
    // Filter by agent involvement
    return [];
  }

  /**
   * Create service listing for an agent
   */
  async createServiceListing(agentName, service) {
    const agent = this._resolveAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const listing = {
      id: `srv_${randomUUID().slice(0, 12)}`,
      agentId: agent.id,
      agentName: agent.name,
      name: service.name,
      description: service.description,
      price: service.price,        // Price in wei
      priceUsd: service.priceUsd,  // USD equivalent
      accepts: service.accepts || ['eth', 'usdc'], // Accepted tokens
      endpoint: service.endpoint,  // API endpoint for service
      metadata: service.metadata || {},
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Stats
      stats: {
        purchases: 0,
        revenue: '0',
        rating: 0,
        reviews: 0,
      },
    };

    // Add to registry
    if (this.registry) {
      this.registry.addService(agentName, listing);
    }

    return listing;
  }

  /**
   * Get service listings
   */
  async getServiceListings(filters = {}) {
    const agents = this.registry?.getAllAgents({ hasWallet: true }) || [];
    
    let services = [];
    for (const agent of agents) {
      const agentServices = this.registry?.getServices(agent.name) || [];
      for (const service of agentServices) {
        if (filters.activeOnly !== false || service.active) {
          services.push({
            ...service,
            agentName: agent.name,
            agentType: agent.type,
            agentVerified: agent.verified,
          });
        }
      }
    }

    // Sort by popularity
    if (filters.sortBy === 'popular') {
      services.sort((a, b) => b.stats.purchases - a.stats.purchases);
    } else if (filters.sortBy === 'price') {
      services.sort((a, b) => BigInt(a.price) - BigInt(b.price));
    }

    // Limit
    if (filters.limit) {
      services = services.slice(0, filters.limit);
    }

    return services;
  }

  /**
   * Search services
   */
  async searchServices(query, limit = 20) {
    const q = query.toLowerCase();
    const services = await this.getServiceListings({ limit: 100 });
    
    return services.filter(s => 
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.agentName.toLowerCase().includes(q)
    ).slice(0, limit);
  }

  /**
   * Create subscription/recurring payment
   */
  async createSubscription(options = {}) {
    const {
      fromAgent,
      toAgent,
      amount,
      interval, // 'daily', 'weekly', 'monthly'
      token = 'eth',
      description = '',
    } = options;

    const subscription = {
      id: `sub_${randomUUID().slice(0, 12)}`,
      from: fromAgent,
      to: toAgent,
      amount: amount.toString(),
      interval,
      token,
      description,
      status: 'active',
      nextPaymentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      // Stats
      totalPaid: '0',
      paymentsCompleted: 0,
    };

    return subscription;
  }

  /**
   * Get balance for agent (total received)
   */
  async getAgentBalance(agentName) {
    const agent = this._resolveAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    return {
      totalReceived: agent.stats.totalReceived,
      totalSent: agent.stats.totalSent,
      netBalance: (BigInt(agent.stats.totalReceived) - BigInt(agent.stats.totalSent)).toString(),
      transactionCount: agent.stats.transactionCount,
    };
  }

  /**
   * Get economy statistics
   */
  async getEconomyStats() {
    const agents = this.registry?.getAllAgents() || [];
    
    let totalVolume = BigInt(0);
    let totalFees = BigInt(0);
    let agentCount = agents.length;

    for (const agent of agents) {
      totalVolume += BigInt(agent.stats.totalReceived || '0');
    }

    totalFees = (totalVolume * BigInt(this.feeBasisPoints)) / BigInt(10000);

    return {
      totalAgents: agentCount,
      totalVolume: totalVolume.toString(),
      totalFees: totalFees.toString(),
      volumeByType: this._getVolumeByAgentType(agents),
      topAgents: agents
        .sort((a, b) => BigInt(b.stats.totalReceived) - BigInt(a.stats.totalReceived))
        .slice(0, 10)
        .map(a => ({
          name: a.name,
          type: a.type,
          volume: a.stats.totalReceived,
          transactions: a.stats.transactionCount,
        })),
    };
  }

  /**
   * Get volume by agent type
   */
  _getVolumeByAgentType(agents) {
    const volume = {};
    for (const agent of agents) {
      const type = agent.type || 'other';
      volume[type] = (BigInt(volume[type] || '0') + BigInt(agent.stats.totalReceived || '0')).toString();
    }
    return volume;
  }

  /**
   * Process webhook from payment provider
   */
  async processWebhook(event) {
    // Handle payment confirmations, failures, etc.
    switch (event.type) {
      case 'payment.completed':
        return this.processPayment(event.data.payment, event.data.txHash);
      case 'payment.failed':
        // Handle failure
        return { status: 'failed', reason: event.data.reason };
      default:
        return { status: 'unknown', eventType: event.type };
    }
  }
}

/**
 * Singleton
 */
let economyInstance = null;

export function getAgentEconomyService(options = {}) {
  if (!economyInstance) {
    economyInstance = new AgentEconomyService(options);
  }
  return economyInstance;
}

export default {
  AgentEconomyService,
  getAgentEconomyService,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
};
