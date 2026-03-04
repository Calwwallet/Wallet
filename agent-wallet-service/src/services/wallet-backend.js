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
import { getCachedBalance, setCachedBalance, invalidateBalanceCache, getCachedChainConfig, setCachedChainConfig } from './redis.js';
import { logger, walletLogger } from './logger.js';

const BACKEND = (process.env.WALLET_BACKEND || 'viem').toLowerCase();

function useAgentKit() {
  return BACKEND === 'agentkit' || BACKEND === 'hybrid';
}

function agentKitConfigured() {
  return Boolean(process.env.CDP_API_KEY_NAME && process.env.CDP_API_KEY_PRIVATE_KEY);
}

function shouldUseAgentKit(options = {}) {
  if (options?.rpcMode === 'byo') return false;
  return useAgentKit() && agentKitConfigured();
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
  if (shouldUseAgentKit(options)) {
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
  const tenantId = options.tenantId || 'default';
  
  // Try cache first
  const cached = await getCachedBalance(address, chain);
  if (cached) {
    logger.debug({ address, chain, tenantId }, 'Balance cache hit');
    return cached;
  }
  
  logger.debug({ address, chain, tenantId }, 'Balance cache miss, fetching from chain');
  
  let balance;
  if (shouldUseAgentKit(options)) {
    try {
      balance = await agentkitWallet.getBalance(address, chain);
    } catch (error) {
      logger.warn({ error: error.message }, 'AgentKit getBalance failed, falling back to viem');
      balance = await viemWallet.getBalance(address, chain, options);
    }
  } else {
    balance = await viemWallet.getBalance(address, chain, options);
  }
  
  // Cache the result
  if (balance) {
    await setCachedBalance(address, chain, balance);
  }
  
  return balance;
}

export async function signTransaction(params) {
  const { from, chain } = params;
  
  let tx;
  if (shouldUseAgentKit(params)) {
    try {
      tx = await agentkitWallet.signTransaction(params);
    } catch (error) {
      logger.warn({ error: error.message }, 'AgentKit signTransaction failed, falling back to viem');
      tx = await viemWallet.signTransaction(params);
    }
  } else {
    tx = await viemWallet.signTransaction(params);
  }
  
  // Invalidate balance cache after transaction
  if (tx && from) {
    walletLogger.info({ from, chain, txHash: tx.hash }, 'Transaction sent, invalidating balance cache');
    await invalidateBalanceCache(from, chain);
  }
  
  return tx;
}

export async function sweepWallet(options) {
  return viemWallet.sweepWallet(options);
}

export async function getTransactionReceipt(hash, chainName, options = {}) {
  return viemWallet.getTransactionReceipt(hash, chainName, options);
}

export async function getMultiChainBalance(address, options = {}) {
  return viemWallet.getMultiChainBalance(address, options);
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

export async function transferErc20(options) {
  return viemWallet.transferErc20(options);
}
