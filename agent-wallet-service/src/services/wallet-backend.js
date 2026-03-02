/**
 * WalletBackend
 *
 * Single, stable facade over wallet implementations.
 * - Default: viem-backed wallets (full feature support)
 * - Optional: Coinbase AgentKit (experimental) when WALLET_BACKEND=agentkit|hybrid
 *
 * Multi-tenant: all viem-backed operations accept a `tenantId`.
 */

import * as viemWallet from './viem-wallet.js';
import * as agentkitWallet from './agentkit.js';

const BACKEND = (process.env.WALLET_BACKEND || 'viem').toLowerCase();

function useAgentKit() {
  return BACKEND === 'agentkit' || BACKEND === 'hybrid';
}

function agentKitConfigured() {
  return Boolean(process.env.CDP_API_KEY_NAME && process.env.CDP_API_KEY_PRIVATE_KEY);
}

export function getWalletBackendInfo() {
  return {
    requested: BACKEND,
    agentKitConfigured: agentKitConfigured()
  };
}

export function getSupportedChains() {
  return viemWallet.getSupportedChains();
}

export async function createWallet(options) {
  if (useAgentKit() && agentKitConfigured()) {
    try {
      return await agentkitWallet.createWallet(options);
    } catch (error) {
      console.warn('AgentKit createWallet failed, falling back to viem:', error.message);
    }
  }
  return viemWallet.createWallet(options);
}

export async function importWallet(options) {
  return viemWallet.importWallet(options);
}

export async function getBalance(address, chain, options = {}) {
  if (useAgentKit() && agentKitConfigured()) {
    try {
      return await agentkitWallet.getBalance(address, chain);
    } catch (error) {
      console.warn('AgentKit getBalance failed, falling back to viem:', error.message);
    }
  }
  return viemWallet.getBalance(address, chain, options);
}

export async function signTransaction(params) {
  if (useAgentKit() && agentKitConfigured()) {
    try {
      return await agentkitWallet.signTransaction(params);
    } catch (error) {
      console.warn('AgentKit signTransaction failed, falling back to viem:', error.message);
    }
  }
  return viemWallet.signTransaction(params);
}

export async function sweepWallet(options) {
  return viemWallet.sweepWallet(options);
}

export async function getTransactionReceipt(hash, chainName) {
  return viemWallet.getTransactionReceipt(hash, chainName);
}

export async function getMultiChainBalance(address) {
  return viemWallet.getMultiChainBalance(address);
}

export async function estimateGas(params) {
  return viemWallet.estimateGas(params);
}

export async function getAllWallets(options = {}) {
  if (useAgentKit() && agentKitConfigured()) {
    // AgentKit wallets are currently process-local; for production use viem+DB.
    return agentkitWallet.getAllWallets();
  }
  return viemWallet.getAllWallets(options);
}

export async function getWalletByAddress(address, options = {}) {
  return viemWallet.getWalletByAddress(address, options);
}

