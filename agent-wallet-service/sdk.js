/**
 * Agent Wallet SDK
 * 
 * Simple client for Agent Wallet Service
 */

class AgentWallet {
  constructor(options = {}) {
    if (typeof options === 'string') {
      options = { baseUrl: options };
    }

    const {
      baseUrl = 'http://localhost:3000',
      apiKey,
      rpcUrl,
      timeoutMs = 10000
    } = options;

    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.rpcUrl = rpcUrl;
    this.timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'GET', body, query, rpcUrl } = {}) {
    const pathString = String(path);
    const absoluteUrlPattern = /^https?:\/\//i;
    const url = absoluteUrlPattern.test(pathString)
      ? new URL(pathString)
      : (() => {
          const baseUrl = new URL(this.baseUrl);
          const basePath = baseUrl.pathname.replace(/\/+$/, '');
          const requestPath = pathString.replace(/^\/+/, '');
          baseUrl.pathname = `${basePath}/${requestPath}`;
          return baseUrl;
        })();

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    const resolvedRpcUrl = rpcUrl || this.rpcUrl;
    if (resolvedRpcUrl) {
      headers['X-RPC-URL'] = resolvedRpcUrl;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      const requestError = new Error(`Request failed: ${error.message}`);
      requestError.code = error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      requestError.cause = error;
      throw requestError;
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await res.text();
    let data;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }
    }

    if (!res.ok) {
      const message = data?.error || data?.message || `Request failed with status ${res.status}`;
      const httpError = new Error(message);
      httpError.code = 'HTTP_ERROR';
      httpError.status = res.status;
      httpError.details = data;
      throw httpError;
    }

    return data;
  }

  // =========================
  // Core service helpers
  // =========================

  async health() {
    return this.#request('/health');
  }

  async onboarding() {
    return this.#request('/onboarding');
  }

  /**
   * Create a new wallet for an agent
   */
  async createWallet(agentName, options = {}) {
    const chain = typeof options === 'string' ? options : options?.chain;
    return this.#request('/wallet/create', {
      method: 'POST',
      body: { agentName, chain }
    });
  }

  /**
   * Get wallet balance
   */
  async getBalance(address, options = {}) {
    const chain = typeof options === 'string' ? options : options?.chain;
    const rpcUrl = typeof options === 'object' ? options?.rpcUrl : undefined;
    return this.#request(`/wallet/${address}/balance`, {
      query: { chain, rpcUrl },
      rpcUrl
    });
  }

  /**
   * Send a transaction
   */
  async send(from, to, value, options = {}) {
    const chain = typeof options === 'string' ? options : options?.chain;
    const data = typeof options === 'object' ? options?.data : undefined;
    const rpcUrl = typeof options === 'object' ? options?.rpcUrl : undefined;
    return this.#request(`/wallet/${from}/send`, {
      method: 'POST',
      body: { to, value, chain, data, rpcUrl },
      rpcUrl
    });
  }

  /**
   * List all wallets
   */
  async listWallets() {
    return this.#request('/wallet/list');
  }

  /**
   * Get fee configuration
   */
  async getFees() {
    return this.#request('/wallet/fees');
  }

  async listChains() {
    return this.#request('/wallet/chains');
  }

  async getWallet(address) {
    return this.#request(`/wallet/${address}`);
  }

  async getWalletHistory(address) {
    return this.#request(`/wallet/${address}/history`);
  }

  async getGlobalHistory(limit) {
    return this.#request('/wallet/history', {
      query: { limit }
    });
  }

  async getPolicy(address) {
    return this.#request(`/wallet/policy/${address}`);
  }

  async setPolicy(address, body) {
    return this.#request(`/wallet/policy/${address}`, {
      method: 'PUT',
      body
    });
  }

  async evaluatePolicy(address, { to, value, chain, timestamp } = {}) {
    return this.#request(`/wallet/policy/${address}/evaluate`, {
      method: 'POST',
      body: { to, value, chain, timestamp, dryRun: true }
    });
  }

  // =========================
  // Identity + agent helpers
  // =========================

  async createIdentity({ walletAddress, agentName, description, agentType, capabilities, metadata, owner, chain } = {}) {
    return this.#request('/identity/create', {
      method: 'POST',
      body: { walletAddress, agentName, description, agentType, capabilities, metadata, owner, chain }
    });
  }

  async listIdentities() {
    return this.#request('/identity/list');
  }

  async getIdentity(agentId) {
    return this.#request(`/identity/${agentId}`);
  }

  async getIdentityCredential(agentId) {
    return this.#request(`/identity/${agentId}/credential`);
  }

  async issueIdentityCredential(agentId) {
    return this.#request(`/identity/${agentId}/credential/issue`, {
      method: 'POST'
    });
  }

  async generateIdentityProof(agentId) {
    return this.#request(`/identity/${agentId}/proof`, {
      method: 'POST'
    });
  }

  async payAsAgent(agentId, { to, amountEth, chain, memo, dryRun = false } = {}) {
    return this.#request(`/identity/${agentId}/pay`, {
      method: 'POST',
      body: { to, amountEth, chain, memo, dryRun }
    });
  }

  // =========================
  // ENS helpers
  // =========================

  async checkEns(name, options = {}) {
    const chain = typeof options === 'string' ? options : options?.chain;
    return this.#request(`/ens/check/${name}`, {
      query: { chain }
    });
  }

  async getEnsPrice(name, { years = 1, chain } = {}) {
    return this.#request(`/ens/price/${name}`, {
      query: { years, chain }
    });
  }

  async prepareEnsRegistration({ name, ownerAddress, durationYears = 1, chain } = {}) {
    return this.#request('/ens/register', {
      method: 'POST',
      body: { name, ownerAddress, durationYears, chain }
    });
  }

  async listEnsRegistrations() {
    return this.#request('/ens/list');
  }
}

export default AgentWallet;

// Usage example:
/*
import AgentWallet from './sdk.js';

const wallet = new AgentWallet({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENT_WALLET_API_KEY
});

// Create wallet
const { wallet: w } = await wallet.createWallet('MyAgent', { chain: 'base-sepolia' });
console.log('Address:', w.address);

// Check balance
const bal = await wallet.getBalance(w.address, { chain: 'base-sepolia' });
console.log('Balance:', bal.balance.eth, 'ETH');

// Send transaction
const tx = await wallet.send(w.address, '0x...', '0.001', { chain: 'base-sepolia' });
console.log('Tx:', tx.transaction.hash);
*/
