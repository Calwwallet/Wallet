/**
 * DeFi Cross-chain Service
 * 
 * Cross-chain operations using:
 * - LayerZero - omnichain transfers
 * - Axelar - cross-chain messaging
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, polygon, avalanche, bsc, arbitrum, optimism, base } from 'viem/chains';
import { evaluateTransferPolicy } from '../policy-engine.js';
import { getWalletByAddress } from '../viem-wallet.js';
import { decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const CHAINS = {
  'ethereum': { chain: mainnet, rpcs: ['https://ethereum.publicnode.com'] },
  'polygon': { chain: polygon, rpcs: ['https://polygon-rpc.com'] },
  'avalanche': { chain: avalanche, rpcs: ['https://api.avax.network/ext/bc/C/rpc'] },
  'bsc': { chain: bsc, rpcs: ['https://bsc-dataseed.binance.org'] },
  'arbitrum': { chain: arbitrum, rpcs: ['https://arb1.arbitrum.io/rpc'] },
  'optimism': { chain: optimism, rpcs: ['https://mainnet.optimism.io'] },
  'base': { chain: base, rpcs: ['https://mainnet.base.org'] }
};

// ============================================================
// CHAIN IDs (for LayerZero/Axelar)
// ============================================================

const CHAIN_IDS = {
  // LayerZero
  ethereum: 101,
  bsc: 102,
  polygon: 109,
  avalanche: 106,
  arbitrum: 110,
  optimism: 111,
  base: 184,

  // Axelar
  ethereum: 'ethereum-2',
  bsc: 'binance-smart-chain',
  polygon: 'polygon',
  avalanche: 'avalanche',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base'
};

// ============================================================
// PROTOCOL ADDRESSES
// ============================================================

const PROTOCOL_ADDRESSES = {
  ethereum: {
    // LayerZero
    layerZero: {
      endpoint: '0x66A71D08229A2FDf59Fb54719F8c3B5553Dc47E1',
      omnichain: '0x5b5a0F0a0a8F3e2D1C5D2A7B9E8F0D1C2B3A4E5'
    },
    // Axelar
    axelar: {
      gateway: '0x4Bb6782c49d3eF7a6D89d87B3E8f1f3E5D6C7B8A',
      gasService: '0x5d5fF5D4e2F8C9E7D6B5A3F2E1D0C9B8A7F6E5D4',
      interchainAdapter: '0x3E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1F2'
    }
  },
  polygon: {
    layerZero: {
      endpoint: '0x11984dc4465481512eb5b777E44061C30CF2B384',
      omnichain: '0x7E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1F2'
    },
    axelar: {
      gateway: '0x978379D5F2F3dA9b3E2F5D6C7B8A9F0E1D2C3B4',
      gasService: '0x5E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    }
  },
  avalanche: {
    layerZero: {
      endpoint: '0x3c2269811836af69497E5F486A85D731675735cf',
      omnichain: '0x6E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    },
    axelar: {
      gateway: '0xF9Db20Da58a4ae4a3a8f8d2E3C1D4B5E6F7A8B9C',
      gasService: '0x4E5F6D7C8B9A0F1E2D3C4B5A6F7E8D9C0B1A2F3'
    }
  },
  bsc: {
    layerZero: {
      endpoint: '0x3c2269811836af69497E5F486A85D731675735cf',
      omnichain: '0x5E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    },
    axelar: {
      gateway: '0xF8Db20Da58a4ae4a3a8f8d2E3C1D4B5E6F7A8B9C',
      gasService: '0x5E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    }
  },
  arbitrum: {
    layerZero: {
      endpoint: '0x3c2269811836af69497E5F486A85D731675735cf',
      omnichain: '0x7E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    }
  },
  optimism: {
    layerZero: {
      endpoint: '0x3c2269811836af69497E5F486A85D731675735cf',
      omnichain: '0x8E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    }
  },
  base: {
    layerZero: {
      endpoint: '0x3c2269811836af69497E5F486A85D731675735cf',
      omnichain: '0x9E4F5D6C7B8A9F0E1D2C3B4A5F6E7D8C9B0A1'
    }
  }
};

// ============================================================
// ABIs (simplified)
// ============================================================

const LAYERZERO_ENDPOINT_ABI = [
  {
    name: 'send',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_dstChainId', type: 'uint16' },
      { name: '_destination', type: 'bytes' },
      { name: '_sourceTxHash', type: 'bytes32' },
      { name: '_amount', type: 'uint256' },
      { name: '_refundAddress', type: 'address' }
    ],
    outputs: []
  }
];

const AXELAR_GATEWAY_ABI = [
  {
    name: 'sendToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'destinationChain', type: 'string' },
      { name: 'destinationAddress', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    name: 'callContract',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'destinationChain', type: 'string' },
      { name: 'destinationAddress', type: 'string' },
      { name: 'payload', type: 'bytes' }
    ],
    outputs: []
  }
];

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getChainConfig(chainName) {
  const config = CHAINS[chainName];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainName}. Supported: ${Object.keys(CHAINS).join(', ')}`);
  }
  return config;
}

function getProtocolAddresses(chainName, protocol) {
  const chainAddresses = PROTOCOL_ADDRESSES[chainName];
  if (!chainAddresses) {
    throw new Error(`Protocol addresses not configured for chain: ${chainName}`);
  }
  const addresses = chainAddresses[protocol];
  if (!addresses) {
    throw new Error(`Protocol ${protocol} not configured for chain: ${chainName}`);
  }
  return addresses;
}

async function createClient(chainName) {
  const config = getChainConfig(chainName);
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcs[0])
  });
}

// ============================================================
// LAYERZERO
// ============================================================

/**
 * Send tokens via LayerZero
 */
export async function sendViaLayerZero({
  walletAddress,
  fromChain,
  toChain,
  toAddress,
  amount,
  token,
  tenantId
}) {
  // Validate chains
  const fromChainId = CHAIN_IDS[fromChain];
  const toChainId = CHAIN_IDS[toChain];
  
  if (!fromChainId || !toChainId) {
    throw new Error(`Invalid chain: ${!fromChainId ? fromChain : toChain}`);
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(fromChain, 'layerZero');
  
  // Policy evaluation
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: addresses.endpoint,
    valueEth: amount,
    chain: fromChain,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked cross-chain transfer (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(fromChain);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(fromChain);
  
  const amountWei = parseEther(amount.toString());
  
  // For cross-chain, we'll simulate the send
  // In practice, this would involve:
  // 1. Approving the omnichain contract to spend tokens
  // 2. Calling the send function with proper parameters
  
  return {
    success: false,
    message: 'LayerZero integration requires token-specific implementation',
    protocol: 'layer_zero',
    fromChain,
    toChain,
    toAddress,
    amount,
    note: 'Contact the development team for specific token implementations'
  };
}

/**
 * Get LayerZero supported destination chains
 */
export function getLayerZeroDestinations(sourceChain) {
  const sourceChainId = CHAIN_IDS[sourceChain];
  if (!sourceChainId) {
    return [];
  }
  
  // Return all chains except the source
  return Object.keys(CHAIN_IDS).filter(c => c !== sourceChain);
}

// ============================================================
// AXELAR
// ============================================================

/**
 * Send tokens via Axelar GMP
 */
export async function sendViaAxelar({
  walletAddress,
  fromChain,
  toChain,
  toAddress,
  amount,
  token,
  tenantId
}) {
  // Validate chains
  const axelarFromChain = CHAIN_IDS[fromChain];
  const axelarToChain = CHAIN_IDS[toChain];
  
  if (!axelarFromChain || !axelarToChain) {
    throw new Error(`Invalid chain: ${!axelarFromChain ? fromChain : toChain}`);
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(fromChain, 'axelar');
  
  // Policy evaluation
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: addresses.gateway,
    valueEth: amount,
    chain: fromChain,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked cross-chain transfer (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(fromChain);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(fromChain);
  
  const amountWei = parseEther(amount.toString());
  
  // For Axelar, we'd:
  // 1. Approve gateway to spend tokens
  // 2. Call sendToken on the gateway
  // 3. Pay gas on destination chain (optional via gasService)
  
  return {
    success: false,
    message: 'Axelar integration requires token-specific implementation',
    protocol: 'axelar',
    fromChain,
    toChain,
    toAddress,
    amount,
    note: 'Contact the development team for specific token implementations'
  };
}

/**
 * Get Axelar supported destination chains
 */
export function getAxelarDestinations(sourceChain) {
  const axelarChains = ['ethereum', 'polygon', 'avalanche', 'bsc', 'arbitrum', 'optimism', 'base'];
  return axelarChains.filter(c => c !== sourceChain);
}

// ============================================================
// CROSS-CHAIN UTILITIES
// ============================================================

/**
 * Execute cross-chain transfer
 */
export async function executeCrossChainTransfer({
  walletAddress,
  fromChain,
  toChain,
  toAddress,
  amount,
  token = 'ETH',
  protocol = 'layer_zero',
  tenantId
}) {
  if (protocol === 'layer_zero') {
    return sendViaLayerZero({
      walletAddress,
      fromChain,
      toChain,
      toAddress,
      amount,
      token,
      tenantId
    });
  } else if (protocol === 'axelar') {
    return sendViaAxelar({
      walletAddress,
      fromChain,
      toChain,
      toAddress,
      amount,
      token,
      tenantId
    });
  } else {
    throw new Error(`Unknown protocol: ${protocol}`);
  }
}

/**
 * Get supported cross-chain routes
 */
export function getCrossChainRoutes() {
  const routes = [];
  
  for (const fromChain of Object.keys(PROTOCOL_ADDRESSES)) {
    const fromAddresses = PROTOCOL_ADDRESSES[fromChain];
    
    if (fromAddresses.layerZero) {
      for (const toChain of Object.keys(PROTOCOL_ADDRESSES)) {
        if (fromChain !== toChain && PROTOCOL_ADDRESSES[toChain]?.layerZero) {
          routes.push({
            from: fromChain,
            to: toChain,
            protocol: 'layer_zero'
          });
        }
      }
    }
    
    if (fromAddresses.axelar) {
      for (const toChain of Object.keys(PROTOCOL_ADDRESSES)) {
        if (fromChain !== toChain && PROTOCOL_ADDRESSES[toChain]?.axelar) {
          routes.push({
            from: fromChain,
            to: toChain,
            protocol: 'axelar'
          });
        }
      }
    }
  }
  
  return routes;
}

/**
 * Get supported cross-chain chains
 */
export function getSupportedCrossChainChains() {
  return Object.keys(CHAINS);
}

// ============================================================
// EXPLORER URL
// ============================================================

function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'polygon': `https://polygonscan.com/tx/${txHash}`,
    'avalanche': `https://snowtrace.io/tx/${txHash}`,
    'bsc': `https://bscscan.com/tx/${txHash}`,
    'arbitrum': `https://arbiscan.io/tx/${txHash}`,
    'optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
    'base': `https://basescan.org/tx/${txHash}`
  };
  return explorers[chainName];
}

export default {
  // LayerZero
  sendViaLayerZero,
  getLayerZeroDestinations,
  
  // Axelar
  sendViaAxelar,
  getAxelarDestinations,
  
  // Utilities
  executeCrossChainTransfer,
  getCrossChainRoutes,
  getSupportedCrossChainChains,
  PROTOCOL_ADDRESSES,
  CHAIN_IDS
};
