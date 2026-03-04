/**
 * Chain Manager Service
 * 
 * Unified interface for all blockchain chain services
 * Routes requests to appropriate chain service based on chain type
 */

import 'dotenv/config';

// Always-available base wallet service
import * as viemWallet from './viem-wallet.js';

function createUnavailableChainService(name, error) {
  const reason = error?.message || 'missing runtime dependency';
  const message = `Chain service "${name}" unavailable: ${reason}`;

  return new Proxy(
    {
      isUnavailable: true,
      serviceName: name,
      unavailableReason: message,
      getSupportedChains() {
        return [];
      }
    },
    {
      get(target, prop) {
        if (prop === 'then') return undefined;
        if (prop in target) return target[prop];
        return () => {
          throw new Error(message);
        };
      }
    }
  );
}

async function loadChainService(path, name) {
  try {
    return await import(path);
  } catch (error) {
    const isMissingDependency = error?.code === 'ERR_MODULE_NOT_FOUND' || String(error?.message || '').includes('Cannot find package');
    if (!isMissingDependency) {
      console.warn(`Failed to load chain service "${name}":`, error?.message || error);
    }
    return createUnavailableChainService(name, error);
  }
}

// Optional chain services are lazy-loaded to keep startup resilient
const polygonZkevm = await loadChainService('./chains/polygon-zkevm-service.js', 'polygon-zkevm');
const zksync = await loadChainService('./chains/zksync-service.js', 'zksync');
const solana = await loadChainService('./chains/solana-service.js', 'solana');
const aptos = await loadChainService('./chains/aptos-service.js', 'aptos');
const sui = await loadChainService('./chains/sui-service.js', 'sui');
const starknet = await loadChainService('./chains/starknet-service.js', 'starknet');

const OPTIONAL_CHAIN_SERVICES = {
  'polygon-zkevm': polygonZkevm,
  zksync,
  solana,
  aptos,
  sui,
  starknet
};

// ============================================================
// CHAIN REGISTRY
// ============================================================

// Map chain prefixes to their services
const CHAIN_SERVICES = {
  // EVM chains (existing)
  'ethereum': viemWallet,
  'base': viemWallet,
  'polygon': viemWallet,
  'optimism': viemWallet,
  'arbitrum': viemWallet,
  
  // New EVM-compatible chains
  'polygon-zkevm': polygonZkevm,
  'zksync': zksync,
  
  // Non-EVM chains
  'solana': solana,
  'solana-devnet': solana,
  'solana-testnet': solana,
  
  'aptos': aptos,
  'aptos-testnet': aptos,
  'aptos-devnet': aptos,
  
  'sui': sui,
  'sui-testnet': sui,
  'sui-devnet': sui,
  
  'starknet': starknet,
  'starknet-testnet': starknet
};

// Chain type classification
const CHAIN_TYPES = {
  // EVM-compatible
  'ethereum': 'evm',
  'base': 'evm',
  'polygon': 'evm',
  'optimism': 'evm',
  'arbitrum': 'evm',
  'ethereum-sepolia': 'evm',
  'base-sepolia': 'evm',
  'polygon-mumbai': 'evm',
  'optimism-sepolia': 'evm',
  'arbitrum-sepolia': 'evm',
  'polygon-zkevm': 'evm',
  'polygon-zkevm-testnet': 'evm',
  'zksync': 'evm',
  'zksync-sepolia': 'evm',
  
  // Non-EVM
  'solana': 'non-evm',
  'solana-devnet': 'non-evm',
  'solana-testnet': 'non-evm',
  'aptos': 'move',
  'aptos-testnet': 'move',
  'aptos-devnet': 'move',
  'sui': 'move',
  'sui-testnet': 'move',
  'sui-devnet': 'move',
  'starknet': 'cairo',
  'starknet-testnet': 'cairo'
};

function matchChainService(chainName) {
  if (CHAIN_SERVICES[chainName]) {
    return CHAIN_SERVICES[chainName];
  }

  for (const [key, service] of Object.entries(CHAIN_SERVICES)) {
    if (chainName.startsWith(key) || key.startsWith(chainName)) {
      return service;
    }
  }

  return null;
}

/**
 * Get the appropriate service for a chain
 */
function getChainService(chainName) {
  const matched = matchChainService(chainName);
  const service = matched || viemWallet;
  if (service?.isUnavailable) {
    throw new Error(service.unavailableReason || `Chain service unavailable for ${chainName}`);
  }
  return service;
}

/**
 * Get chain type
 */
export function getChainType(chainName) {
  return CHAIN_TYPES[chainName] || 'evm';
}

/**
 * Get all supported chains across all services
 */
export function getAllSupportedChains() {
  const chains = [];
  
  // Get EVM chains from viem-wallet
  const evmChains = viemWallet.getSupportedChains();
  chains.push(...evmChains.map(c => ({ ...c, type: 'evm' })));
  
  // Get new chains
  chains.push(...polygonZkevm.getSupportedChains());
  chains.push(...zksync.getSupportedChains());
  chains.push(...solana.getSupportedChains());
  chains.push(...aptos.getSupportedChains());
  chains.push(...sui.getSupportedChains());
  chains.push(...starknet.getSupportedChains());
  
  return chains;
}

export function getChainAvailability() {
  const unavailable = [];
  const available = [];

  for (const [name, service] of Object.entries(OPTIONAL_CHAIN_SERVICES)) {
    if (service?.isUnavailable) {
      unavailable.push({
        name,
        reason: service.unavailableReason
      });
    } else {
      available.push(name);
    }
  }

  return {
    availableOptionalServices: available,
    unavailableOptionalServices: unavailable
  };
}

/**
 * Get chains by type
 */
export function getChainsByType(type) {
  return getAllSupportedChains().filter(c => c.type === type);
}

/**
 * Create a wallet on a specific chain
 */
export async function createWallet({ agentName, chain = 'base-sepolia', tenantId }) {
  const service = getChainService(chain);
  return service.createWallet({ agentName, chain, tenantId });
}

/**
 * Get wallet balance
 */
export async function getBalance(address, chain = 'base-sepolia') {
  const service = getChainService(chain);
  return service.getBalance(address, chain);
}

/**
 * Get native token balance
 */
export async function getNativeBalance(address, chain = 'base-sepolia') {
  const service = getChainService(chain);
  return service.getNativeBalance ? service.getNativeBalance(address, chain) : service.getBalance(address, chain);
}

/**
 * Transfer tokens
 */
export async function transfer({ fromPrivateKey, fromAddress, to, amount, chain = 'base-sepolia' }) {
  const service = getChainService(chain);
  if (chain.startsWith('solana')) {
    return service.transfer({ fromPrivateKeyBase64: fromPrivateKey, to, amount, chain });
  }
  if (chain.startsWith('aptos')) {
    return service.transfer({ fromPrivateKeyHex: fromPrivateKey, to, amount, chain });
  }
  if (chain.startsWith('sui')) {
    return service.transfer({ fromPrivateKeyBase64: fromPrivateKey, to, amount, chain });
  }
  if (chain.startsWith('starknet')) {
    return service.transfer({ fromPrivateKey, fromAddress, to, amount, chain });
  }
  return service.transfer({ fromPrivateKey, to, amount, chain });
}

/**
 * Estimate gas/fees
 */
export async function estimateGas({ from, to, value, chain = 'base-sepolia' }) {
  const service = getChainService(chain);
  return service.estimateGas ? service.estimateGas({ from, to, value, chain }) : null;
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(txHash, chain = 'base-sepolia') {
  const service = getChainService(chain);
  return service.getTransactionReceipt ? service.getTransactionReceipt(txHash, chain) : null;
}

/**
 * Validate address format
 */
export function isValidAddress(address, chain = 'base-sepolia') {
  const service = getChainService(chain);
  return service.isValidAddress ? service.isValidAddress(address) : /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Get chain ID
 */
export function getChainId(chain = 'base-sepolia') {
  const service = getChainService(chain);
  return service.getChainId ? service.getChainId(chain) : null;
}

/**
 * Get chain configuration
 */
export function getChainConfig(chainName) {
  const service = getChainService(chainName);
  const chains = service.getSupportedChains ? service.getSupportedChains() : [];
  return chains.find(c => c.id === chainName);
}

/**
 * Check if chain is supported
 */
export function isChainSupported(chainName) {
  if (!CHAIN_TYPES[chainName]) return false;
  const service = matchChainService(chainName);
  return Boolean(service && !service.isUnavailable);
}

/**
 * Get default chain for different use cases
 */
export function getDefaultChain(useCase = 'testnet') {
  switch (useCase) {
    case 'mainnet':
      return 'base';
    case 'testnet':
      return 'base-sepolia';
    case 'solana':
      return 'solana-devnet';
    case 'aptos':
      return 'aptos-testnet';
    case 'sui':
      return 'sui-testnet';
    case 'starknet':
      return 'starknet-testnet';
    case 'zksync':
      return 'zksync-sepolia';
    case 'polygon-zkevm':
      return 'polygon-zkevm-testnet';
    default:
      return 'base-sepolia';
  }
}

/**
 * Get chains by category
 */
export function getChainsByCategory() {
  return {
    evm: getChainsByType('evm').filter(c => !c.testnet),
    evmTestnet: getChainsByType('evm').filter(c => c.testnet),
    solana: solana.getSupportedChains(),
    move: [
      ...aptos.getSupportedChains(),
      ...sui.getSupportedChains()
    ],
    starknet: starknet.getSupportedChains()
  };
}

/**
 * Unified transfer function with token support
 */
export async function transferTokens({ 
  fromPrivateKey, 
  fromAddress,
  to, 
  amount, 
  chain = 'base-sepolia',
  token = null // For non-native tokens
}) {
  const service = getChainService(chain);
  const chainType = getChainType(chain);
  
  // Handle token transfers for different chain types
  if (token && token !== 'native') {
    switch (chainType) {
      case 'evm':
        // For EVM chains, use ERC-20 transfer from viem-wallet
        const { transferErc20 } = await import('./viem-wallet.js');
        return transferErc20({
          fromAddress,
          to,
          tokenAddress: token,
          amount,
          chain,
          tenantId: fromPrivateKey // Using fromPrivateKey param to pass tenantId
        });
        
      case 'non-evm':
        if (chain.startsWith('solana')) {
          return solana.transferToken({
            fromPrivateKeyBase64: fromPrivateKey,
            to,
            amount,
            tokenMintAddress: token,
            chain
          });
        }
        throw new Error(`Token transfer not supported for chain: ${chain}`);
        
      default:
        throw new Error(`Token transfer not supported for chain type: ${chainType}`);
    }
  }
  
  // Native token transfer
  return service.transfer({ 
    fromPrivateKey, 
    fromAddress,
    to, 
    amount, 
    chain 
  });
}

/**
 * Get token balances
 */
export async function getTokenBalances(address, chain = 'base-sepolia') {
  const chainType = getChainType(chain);
  
  switch (chainType) {
    case 'evm':
      // For EVM, would query ERC-20 balances
      return [];
      
    case 'non-evm':
      if (chain.startsWith('solana')) {
        return solana.getTokenAccounts(address, chain);
      }
      return [];
      
    case 'move':
      if (chain.startsWith('aptos')) {
        return aptos.getAccountResources(address, chain);
      }
      if (chain.startsWith('sui')) {
        return sui.getAllBalances(address, chain);
      }
      return [];
      
    default:
      return [];
  }
}

// Export chain types for reference
export const CHAIN_CATEGORIES = {
  EVM: 'evm',
  SOLANA: 'solana',
  MOVE: 'move',
  STARKNET: 'cairo'
};

export default {
  getAllSupportedChains,
  getChainAvailability,
  getChainsByType,
  getChainType,
  createWallet,
  getBalance,
  getNativeBalance,
  transfer,
  transferTokens,
  estimateGas,
  getTransactionReceipt,
  isValidAddress,
  getChainId,
  getChainConfig,
  isChainSupported,
  getDefaultChain,
  getChainsByCategory,
  getTokenBalances,
  CHAIN_CATEGORIES
};
