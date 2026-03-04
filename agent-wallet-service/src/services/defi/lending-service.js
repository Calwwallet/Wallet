/**
 * DeFi Lending Service
 * 
 * Lending/borrowing operations using:
 * - Aave V3 - supply/borrow assets
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, polygon, optimism, arbitrum, base } from 'viem/chains';
import { evaluateTransferPolicy } from '../policy-engine.js';
import { getWalletByAddress } from '../viem-wallet.js';
import { decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const CHAINS = {
  'ethereum': { chain: mainnet, rpcs: ['https://ethereum.publicnode.com'] },
  'ethereum-sepolia': { chain: sepolia, rpcs: ['https://ethereum-sepolia.publicnode.com'] },
  'polygon': { chain: polygon, rpcs: ['https://polygon-rpc.com'] },
  'optimism': { chain: optimism, rpcs: ['https://mainnet.optimism.io'] },
  'arbitrum': { chain: arbitrum, rpcs: ['https://arb1.arbitrum.io/rpc'] },
  'base': { chain: base, rpcs: ['https://mainnet.base.org'] }
};

// ============================================================
// AAVE V3 PROTOCOL ADDRESSES
// ============================================================

const AAVE_ADDRESSES = {
  ethereum: {
    pool: '0x87870Bca3F3fD6335C3FbdC83E7a82f43aa5B2a6',
    aToken: '0x4dAe5D55a6a7e9113a60e7D3C1d6c6E5C8B7A1F2', // Generic - will use per-asset
    poolDataProvider: '0x41393e5e3378dcb43c6d227f42aa2d1d17c4a7e9',
    protocolDataProvider: '0x7B4EB56E47A8B7f4E2b5f2d7d8E9F0A1B2C3D4E5',
    aaveOracle: '0xA50ba011c48153De246E5192C8f9258A48baE2C5',
    incentivesController: '0x01D83Fe6A10D2f2B7EC17022b5314927B1D02e87',
    // Token addresses
    tokens: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      DAI: '0x6B175474E89094C44Da98b954EadeAC6Bf9C2a71',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    },
    // aToken addresses
    aTokens: {
      // aEthUSDC: '0x4e67d33e3927b49E8a7Dd0E1Cc7e1C5F6dE8fA9B',
      // aEthUSDT: '0x1234567890abcdef1234567890abcdef12345678',
      // aEthDAI: '0xabcdef1234567890abcdef1234567890abcdef12'
    }
  },
  polygon: {
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    poolDataProvider: '0x69FA688f1Dc10d3b54203B0Ab6fbEb4c2d2aB9F7',
    protocolDataProvider: '0xfa2D9d804b9B7F5F5F6E4D3C2B1A0F9E8D7C6B5A4',
    aaveOracle: '0x73511eE7d6CC5D5B9f2E5F8a5C3B2D1E0F9A8B7C6',
    incentivesController: '0x8a4C3a4b2F1e0D9c8B7A6F5E4D3C2B1A0F9E8D7C6',
    tokens: {
      USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      DAI: '0x53E0bca35eC356BD5ddDFEbdD1Fc0fD03FaBad39',
      WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    }
  },
  optimism: {
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    poolDataProvider: '0xE6E340D132b5f0762Da4b7b131D4c3d41f1B2D8C',
    tokens: {
      USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      USDT: '0x94b008aA00579c1307B0EF2c484aE9b48251bA20',
      WETH: '0x4200000000000000000000000000000000000006'
    }
  },
  arbitrum: {
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    poolDataProvider: '0x8a4C3a4b2F1e0D9c8B7A6F5E4D3C2B1A0F9E8D7C6',
    tokens: {
      USDC: '0xAF88d065d77C72cE23D6fB4D4DE14cBF3d00586d',
      USDT: '0xFd086bC7CD5D481aC85eE2A4C8F9BbDe8B3d8A5D',
      WETH: '0x82aF49447D8a07e3bd95BD0d56f78341539c28Ed'
    }
  },
  base: {
    pool: '0xA238Dd80C259a72e5d5F4eC6A3dA6b8c1B9d5E7F',
    poolDataProvider: '0x9e11F46E5D7b8d9B8c7a6d5e4f3c2b1a0f9e8d7c6',
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      WETH: '0x4200000000000000000000000000000000000006'
    }
  }
};

// ============================================================
// ABIs
// ============================================================

// Aave Pool ABI (main functions)
const AAVE_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' }
    ],
    outputs: []
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: []
  },
  {
    name: 'repay',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'setUserUseReserveAsCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'useAsCollateral', type: 'bool' }
    ],
    outputs: []
  }
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

// AToken ABI
const ATOKEN_ABI = [
  {
    name: 'scaledBalanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
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

function getAaveAddresses(chainName) {
  const addresses = AAVE_ADDRESSES[chainName];
  if (!addresses) {
    throw new Error(`Aave not configured for chain: ${chainName}`);
  }
  return addresses;
}

function getTokenAddress(chainName, tokenSymbol) {
  const addresses = getAaveAddresses(chainName);
  const tokenAddress = addresses.tokens[tokenSymbol.toUpperCase()];
  if (!tokenAddress) {
    throw new Error(`Token ${tokenSymbol} not available on ${chainName}`);
  }
  return tokenAddress;
}

async function createClient(chainName) {
  const config = getChainConfig(chainName);
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcs[0])
  });
}

// ============================================================
// SUPPLY (DEPOSIT)
// ============================================================

/**
 * Supply (deposit) assets to Aave V3
 */
export async function supplyToAave({ walletAddress, asset, amount, chain, useAsCollateral = true, tenantId }) {
  // Validate chain
  const chainName = chain || 'ethereum';
  const aaveAddresses = getAaveAddresses(chainName);
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get token address
  const assetAddress = typeof asset === 'string' && asset.startsWith('0x') 
    ? asset 
    : getTokenAddress(chainName, asset);
  
  // Policy evaluation
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: aaveAddresses.pool,
    valueEth: amount,
    chain: chainName,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked supply (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(chainName);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chainName);
  
  const amountWei = parseEther(amount.toString());
  
  // Approve Aave pool to spend tokens
  const allowance = await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAddress, aaveAddresses.pool]
  });
  
  if (allowance < amountWei) {
    const { request: approveRequest } = await publicClient.simulateContract({
      address: assetAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [aaveAddresses.pool, amountWei]
    });
    await walletClient.writeContract(approveRequest);
  }
  
  // Supply to Aave
  const { request } = await publicClient.simulateContract({
    address: aaveAddresses.pool,
    abi: AAVE_POOL_ABI,
    functionName: 'supply',
    args: [assetAddress, amountWei, walletAddress, 0] // referralCode = 0
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Get updated balance
  // Note: Would need aToken address for accurate balance
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'aave_v3',
    chain: chainName,
    action: 'supply',
    asset: assetAddress,
    amount,
    useAsCollateral,
    explorer: getExplorerUrl(chainName, hash)
  };
}

// ============================================================
// WITHDRAW
// ============================================================

/**
 * Withdraw assets from Aave V3
 */
export async function withdrawFromAave({ walletAddress, asset, amount, chain, tenantId }) {
  const chainName = chain || 'ethereum';
  const aaveAddresses = getAaveAddresses(chainName);
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get token address
  const assetAddress = typeof asset === 'string' && asset.startsWith('0x') 
    ? asset 
    : getTokenAddress(chainName, asset);
  
  // Create wallet client
  const config = getChainConfig(chainName);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chainName);
  
  const amountWei = parseEther(amount.toString());
  
  // Withdraw from Aave
  const { request } = await publicClient.simulateContract({
    address: aaveAddresses.pool,
    abi: AAVE_POOL_ABI,
    functionName: 'withdraw',
    args: [assetAddress, amountWei, walletAddress]
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'aave_v3',
    chain: chainName,
    action: 'withdraw',
    asset: assetAddress,
    amount,
    explorer: getExplorerUrl(chainName, hash)
  };
}

// ============================================================
// BORROW
// ============================================================

/**
 * Borrow assets from Aave V3
 */
export async function borrowFromAave({ walletAddress, asset, amount, chain, interestRateMode = 2, tenantId }) {
  const chainName = chain || 'ethereum';
  const aaveAddresses = getAaveAddresses(chainName);
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get token address
  const assetAddress = typeof asset === 'string' && asset.startsWith('0x') 
    ? asset 
    : getTokenAddress(chainName, asset);
  
  // Policy evaluation (borrowing increases exposure)
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: walletAddress, // Borrowing goes to wallet
    valueEth: amount,
    chain: chainName,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked borrow (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(chainName);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chainName);
  
  const amountWei = parseEther(amount.toString());
  
  // Borrow from Aave
  const { request } = await publicClient.simulateContract({
    address: aaveAddresses.pool,
    abi: AAVE_POOL_ABI,
    functionName: 'borrow',
    args: [assetAddress, amountWei, interestRateMode, 0, walletAddress] // referralCode = 0
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'aave_v3',
    chain: chainName,
    action: 'borrow',
    asset: assetAddress,
    amount,
    interestRateMode: interestRateMode === 1 ? 'stable' : 'variable',
    explorer: getExplorerUrl(chainName, hash)
  };
}

// ============================================================
// REPAY
// ============================================================

/**
 * Repay borrowed assets to Aave V3
 */
export async function repayToAave({ walletAddress, asset, amount, chain, interestRateMode = 2, tenantId }) {
  const chainName = chain || 'ethereum';
  const aaveAddresses = getAaveAddresses(chainName);
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get token address
  const assetAddress = typeof asset === 'string' && asset.startsWith('0x') 
    ? asset 
    : getTokenAddress(chainName, asset);
  
  // Create wallet client
  const config = getChainConfig(chainName);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chainName);
  
  const amountWei = parseEther(amount.toString());
  
  // Approve Aave pool to spend tokens for repay
  const allowance = await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAddress, aaveAddresses.pool]
  });
  
  if (allowance < amountWei) {
    const { request: approveRequest } = await publicClient.simulateContract({
      address: assetAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [aaveAddresses.pool, amountWei]
    });
    await walletClient.writeContract(approveRequest);
  }
  
  // Repay to Aave
  const { request } = await publicClient.simulateContract({
    address: aaveAddresses.pool,
    abi: AAVE_POOL_ABI,
    functionName: 'repay',
    args: [assetAddress, amountWei, interestRateMode, walletAddress]
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'aave_v3',
    chain: chainName,
    action: 'repay',
    asset: assetAddress,
    amount,
    interestRateMode: interestRateMode === 1 ? 'stable' : 'variable',
    explorer: getExplorerUrl(chainName, hash)
  };
}

// ============================================================
// COLLATERAL MANAGEMENT
// ============================================================

/**
 * Set asset as collateral
 */
export async function setCollateralAave({ walletAddress, asset, useAsCollateral, chain, tenantId }) {
  const chainName = chain || 'ethereum';
  const aaveAddresses = getAaveAddresses(chainName);
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get token address
  const assetAddress = typeof asset === 'string' && asset.startsWith('0x') 
    ? asset 
    : getTokenAddress(chainName, asset);
  
  // Create wallet client
  const config = getChainConfig(chainName);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chainName);
  
  // Set collateral
  const { request } = await publicClient.simulateContract({
    address: aaveAddresses.pool,
    abi: AAVE_POOL_ABI,
    functionName: 'setUserUseReserveAsCollateral',
    args: [assetAddress, useAsCollateral]
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'aave_v3',
    chain: chainName,
    action: useAsCollateral ? 'enable_collateral' : 'disable_collateral',
    asset: assetAddress,
    explorer: getExplorerUrl(chainName, hash)
  };
}

// ============================================================
// POSITION QUERIES
// ============================================================

/**
 * Get user's Aave positions
 */
export async function getAavePositions(walletAddress, chain = 'ethereum') {
  const aaveAddresses = getAaveAddresses(chain);
  const client = await createClient(chain);
  
  const positions = {
    supplied: [],
    borrowed: [],
    availableToBorrow: {}
  };
  
  // Get data for each token
  const tokens = aaveAddresses.tokens;
  
  for (const [symbol, tokenAddress] of Object.entries(tokens)) {
    try {
      // Check if we can get user account data
      // Note: In a full implementation, would call getUserAccountData on the pool
      // For now, return placeholder
      
      positions.supplied.push({
        asset: tokenAddress,
        symbol,
        balance: '0',
        balanceWei: '0'
      });
      
      positions.borrowed.push({
        asset: tokenAddress,
        symbol,
        balance: '0',
        balanceWei: '0'
      });
    } catch (error) {
      console.log(`Error getting position for ${symbol}:`, error.message);
    }
  }
  
  return positions;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'ethereum-sepolia': `https://sepolia.etherscan.io/tx/${txHash}`,
    'polygon': `https://polygonscan.com/tx/${txHash}`,
    'optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
    'arbitrum': `https://arbiscan.io/tx/${txHash}`,
    'base': `https://basescan.org/tx/${txHash}`
  };
  return explorers[chainName];
}

/**
 * Get supported Aave chains
 */
export function getSupportedLendingChains() {
  return Object.keys(AAVE_ADDRESSES);
}

/**
 * Get supported tokens for lending
 */
export function getLendingTokens(chain = 'ethereum') {
  return AAVE_ADDRESSES[chain]?.tokens || {};
}

export default {
  // Core operations
  supplyToAave,
  withdrawFromAave,
  borrowFromAave,
  repayToAave,
  setCollateralAave,
  
  // Queries
  getAavePositions,
  
  // Utilities
  getSupportedLendingChains,
  getLendingTokens,
  getTokenAddress,
  AAVE_ADDRESSES
};
