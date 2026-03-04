/**
 * Agent Wallet SDK
 * 
 * Simple client for Agent Wallet Service
 */

class AgentWallet {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new wallet for an agent
   */
  async createWallet(agentName) {
    const res = await fetch(`${this.baseUrl}/wallet/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName })
    });
    return res.json();
  }

  /**
   * Get wallet balance
   */
  async getBalance(address) {
    const res = await fetch(`${this.baseUrl}/wallet/${address}/balance`);
    return res.json();
  }

  /**
   * Send a transaction
   */
  async send(from, to, value) {
    const res = await fetch(`${this.baseUrl}/wallet/${from}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, value })
    });
    return res.json();
  }

  /**
   * List all wallets
   */
  async listWallets() {
    const res = await fetch(`${this.baseUrl}/wallet/list`);
    return res.json();
  }

  /**
   * Get fee configuration
   */
  async getFees() {
    const res = await fetch(`${this.baseUrl}/wallet/fees`);
    return res.json();
  }
}

export default AgentWallet;

// Usage example:
/*
import AgentWallet from './sdk.js';

const wallet = new AgentWallet();

// Create wallet
const { wallet: w } = await wallet.createWallet('MyAgent');
console.log('Address:', w.address);

// Check balance
const bal = await wallet.getBalance(w.address);
console.log('Balance:', bal.balance.eth, 'ETH');

// Send transaction
const tx = await wallet.send(w.address, '0x...', '0.001');
console.log('Tx:', tx.transaction.hash);
*/
