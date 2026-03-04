/**
 * DeFi Staking Service
 * 
 * Staking operations using:
 * - Lido - stake ETH for stETH
 * - Rocket Pool - stake ETH for rETH
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { evaluateTransferPolicy } from '../policy-engine.js';
import { getWalletByAddress } from '../viem-wallet.js';
import { decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const CHAINS = {
  'ethereum': { chain: mainnet, rpcs: ['https://ethereum.publicnode.com'] },
  'ethereum-sepolia': { chain: sepolia, rpcs: ['https://ethereum-sepolia.publicnode.com'] }
};

// ============================================================
// PROTOCOL ADDRESSES (Ethereum Mainnet)
// ============================================================

const PROTOCOL_ADDRESSES = {
  ethereum: {
    // Lido
    lido: {
      stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      lidoLocator: '0xC1d0b3DE6792Bf6b4e37EccfC2E2Ee8B4EA3fd47',
      withdrawalQueue: '0xB9E793E8C337454b3E2c7a492b5fde5D28E7d8E2',
      stETHBridge: '0x7f39C581F595B53c5cb19bD0b3f8dAf617778325'
    },
    // Rocket Pool
    rocketPool: {
      rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
      depositPool: '0x2cacD3a6a4CbC0D2B1d12b29e3B8aD6fB0d4B9E8',
      minipoolManager: '0xA6C2d4B8E2f7B3a1c4F5e6d7A8f9c0d1e2f3a4b5',
      nodeDeposit: '0xD8f0E4c6B3a2C1D0e9F8A7b6C5D4E3F2A1B0C9d8',
      rocketTokenRETH: '0xae78736Cd615f374D3085123A210448E74Fc6393'
    }
  },
  'ethereum-sepolia': {
    // Testnet addresses (example - would need actual addresses)
    lido: {
      stETH: '0x0000000000000000000000000000000000000000',
      lidoLocator: '0x0000000000000000000000000000000000000000',
      withdrawalQueue: '0x0000000000000000000000000000000000000000',
      stETHBridge: '0x0000000000000000000000000000000000000000'
    },
    rocketPool: {
      rETH: '0x0000000000000000000000000000000000000000',
      depositPool: '0x0000000000000000000000000000000000000000',
      minipoolManager: '0x0000000000000000000000000000000000000000',
      nodeDeposit: '0x0000000000000000000000000000000000000000',
      rocketTokenRETH: '0x0000000000000000000000000000000000000000'
    }
  }
};

// ============================================================
// ABIs
// ============================================================

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
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  }
];

// Lido stETH ABI
const LIDO_STETH_ABI = [
  {
    name: 'submit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: '_referral', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'sharesOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getSharesByPooledEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_pooledEth', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getPooledEthByShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  }
];

// Rocket Pool rETH ABI
const ROCKET_POOL_RETH_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getEthValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_rethAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getRethValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_ethAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
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
// LIDO STAKING
// ============================================================

/**
 * Stake ETH to receive stETH via Lido
 */
export async function stakeLido({ walletAddress, amount, chain = 'ethereum', referral = '0x0000000000000000000000000000000000000000', tenantId }) {
  // Validate chain
  if (chain !== 'ethereum' && chain !== 'ethereum-sepolia') {
    throw new Error('Lido staking is only supported on Ethereum mainnet and Sepolia');
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(chain, 'lido');
  
  // Policy evaluation
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: addresses.stETH,
    valueEth: amount,
    chain,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked staking (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(chain);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chain);
  
  const amountWei = parseEther(amount.toString());
  
  // Submit stake transaction
  const { request } = await publicClient.simulateContract({
    address: addresses.stETH,
    abi: LIDO_STETH_ABI,
    functionName: 'submit',
    args: [referral],
    value: amountWei
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Get stETH balance after stake
  const stETHBalance = await publicClient.readContract({
    address: addresses.stETH,
    abi: LIDO_STETH_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'lido',
    chain,
    action: 'stake',
    stakedAmount: amount,
    stETHBalance: formatEther(stETHBalance),
    explorer: getExplorerUrl(chain, hash)
  };
}

/**
 * Get stETH balance for a wallet
 */
export async function getLidoStakedBalance(walletAddress, chain = 'ethereum') {
  const addresses = getProtocolAddresses(chain, 'lido');
  const client = await createClient(chain);
  
  const [stETHBalance, shares] = await Promise.all([
    client.readContract({
      address: addresses.stETH,
      abi: LIDO_STETH_ABI,
      functionName: 'balanceOf',
      args: [walletAddress]
    }),
    client.readContract({
      address: addresses.stETH,
      abi: LIDO_STETH_ABI,
      functionName: 'sharesOf',
      args: [walletAddress]
    })
  ]);
  
  return {
    stETH: formatEther(stETHBalance),
    shares: shares.toString(),
    stETHWei: stETHBalance.toString()
  };
}

/**
 * Calculate stETH value from shares
 */
export async function getLidoSharesValue(shares, chain = 'ethereum') {
  const addresses = getProtocolAddresses(chain, 'lido');
  const client = await createClient(chain);
  
  const pooledEth = await client.readContract({
    address: addresses.stETH,
    abi: LIDO_STETH_ABI,
    functionName: 'getPooledEthByShares',
    args: [shares]
  });
  
  return {
    ethValue: formatEther(pooledEth),
    ethValueWei: pooledEth.toString()
  };
}

// ============================================================
// ROCKET POOL STAKING
// ============================================================

/**
 * Stake ETH to receive rETH via Rocket Pool
 */
export async function stakeRocketPool({ walletAddress, amount, chain = 'ethereum', tenantId }) {
  // Validate chain
  if (chain !== 'ethereum' && chain !== 'ethereum-sepolia') {
    throw new Error('Rocket Pool staking is only supported on Ethereum mainnet and Sepolia');
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(chain, 'rocketPool');
  
  // Policy evaluation
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: addresses.rocketTokenRETH,
    valueEth: amount,
    chain,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked staking (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const config = getChainConfig(chain);
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chain);
  
  const amountWei = parseEther(amount.toString());
  
  // Deposit ETH for rETH
  const { request } = await publicClient.simulateContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'deposit',
    args: [],
    value: amountWei
  });
  
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Get rETH balance after stake
  const rETHBalance = await publicClient.readContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
  
  return {
    success: receipt.status === 'success',
    hash,
    protocol: 'rocket_pool',
    chain,
    action: 'stake',
    stakedAmount: amount,
    rETHBalance: formatEther(rETHBalance),
    explorer: getExplorerUrl(chain, hash)
  };
}

/**
 * Get rETH balance for a wallet
 */
export async function getRocketPoolStakedBalance(walletAddress, chain = 'ethereum') {
  const addresses = getProtocolAddresses(chain, 'rocketPool');
  const client = await createClient(chain);
  
  const rETHBalance = await client.readContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
  
  // Get ETH value of rETH
  const ethValue = await client.readContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'getEthValue',
    args: [rETHBalance]
  });
  
  return {
    rETH: formatEther(rETHBalance),
    ethValue: formatEther(ethValue),
    rETHWei: rETHBalance.toString(),
    ethValueWei: ethValue.toString()
  };
}

/**
 * Calculate rETH value for a given ETH amount
 */
export async function getRocketPoolRethValue(ethAmount, chain = 'ethereum') {
  const addresses = getProtocolAddresses(chain, 'rocketPool');
  const client = await createClient(chain);
  
  const amountWei = parseEther(ethAmount.toString());
  
  const rETHValue = await client.readContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'getRethValue',
    args: [amountWei]
  });
  
  return {
    rETH: formatEther(rETHValue),
    rETHWei: rETHValue.toString()
  };
}

// ============================================================
// WITHDRAWAL (unstaking)
// ============================================================

/**
 * Unstake stETH from Lido (withdraw)
 * Note: Lido withdrawals require the withdrawal queue contract
 */
export async function unstakeLido({ walletAddress, amount, chain = 'ethereum', tenantId }) {
  // Validate chain
  if (chain !== 'ethereum' && chain !== 'ethereum-sepolia') {
    throw new Error('Lido is only supported on Ethereum mainnet and Sepolia');
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(chain, 'lido');
  
  // Get stETH balance
  const client = await createClient(chain);
  const stETHBalance = await client.readContract({
    address: addresses.stETH,
    abi: LIDO_STETH_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
  
  const amountWei = parseEther(amount.toString());
  
  if (stETHBalance < amountWei) {
    throw new Error(`Insufficient stETH balance. Available: ${formatEther(stETHBalance)}`);
  }
  
  // For Lido, withdrawals are done through the withdrawal queue
  // This is a simplified version - actual implementation would need:
  // 1. Request withdrawal via withdrawal queue
  // 2. Wait for validation period
  // 3. Claim withdrawal
  
  // Transfer stETH back to pool (burn) - simplified
  // In practice, you'd use the withdrawal queue
  
  return {
    success: false,
    message: 'Lido withdrawals require the withdrawal queue. Use transfer to withdraw.',
    protocol: 'lido',
    chain,
    action: 'unstake',
    stETHBalance: formatEther(stETHBalance)
  };
}

/**
 * Unstake rETH from Rocket Pool
 * Note: rETH can be redeemed for ETH through the protocol
 */
export async function unstakeRocketPool({ walletAddress, amount, chain = 'ethereum', tenantId }) {
  // Validate chain
  if (chain !== 'ethereum' && chain !== 'ethereum-sepolia') {
    throw new Error('Rocket Pool is only supported on Ethereum mainnet and Sepolia');
  }
  
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get protocol addresses
  const addresses = getProtocolAddresses(chain, 'rocketPool');
  
  // Get rETH balance
  const client = await createClient(chain);
  const rETHBalance = await client.readContract({
    address: addresses.rocketTokenRETH,
    abi: ROCKET_POOL_RETH_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
  
  const amountWei = parseEther(amount.toString());
  
  if (rETHBalance < amountWei) {
    throw new Error(`Insufficient rETH balance. Available: ${formatEther(rETHBalance)}`);
  }
  
  // Rocket Pool has a burning mechanism
  // For simplicity, return info about the position
  // Actual withdrawal would involve burning rETH
  
  return {
    success: false,
    message: 'Rocket Pool withdrawals require the burn mechanism.',
    protocol: 'rocket_pool',
    chain,
    action: 'unstake',
    rETHBalance: formatEther(rETHBalance)
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'ethereum-sepolia': `https://sepolia.etherscan.io/tx/${txHash}`
  };
  return explorers[chainName];
}

/**
 * Get staking positions for a wallet
 */
export async function getStakingPositions(walletAddress, chain = 'ethereum') {
  const positions = [];
  
  // Get Lido position
  try {
    const lidoBalance = await getLidoStakedBalance(walletAddress, chain);
    if (BigInt(lidoBalance.stETHWei) > 0n) {
      positions.push({
        protocol: 'lido',
        token: 'stETH',
        balance: lidoBalance.stETH,
        balanceWei: lidoBalance.stETHWei,
        shares: lidoBalance.shares
      });
    }
  } catch (error) {
    console.error('Error getting Lido position:', error.message);
  }
  
  // Get Rocket Pool position
  try {
    const rocketPoolBalance = await getRocketPoolStakedBalance(walletAddress, chain);
    if (BigInt(rocketPoolBalance.rETHWei) > 0n) {
      positions.push({
        protocol: 'rocket_pool',
        token: 'rETH',
        balance: rocketPoolBalance.rETH,
        balanceWei: rocketPoolBalance.rETHWei,
        ethValue: rocketPoolBalance.ethValue
      });
    }
  } catch (error) {
    console.error('Error getting Rocket Pool position:', error.message);
  }
  
  return positions;
}

/**
 * Get supported staking chains
 */
export function getSupportedStakingChains() {
  return Object.keys(CHAINS);
}

/**
 * Get staking protocol info
 */
export function getStakingProtocols(chain = 'ethereum') {
  return {
    lido: {
      name: 'Lido',
      token: 'stETH',
      description: 'Liquid staking for ETH',
      address: PROTOCOL_ADDRESSES[chain]?.lido?.stETH,
      supported: !!PROTOCOL_ADDRESSES[chain]?.lido
    },
    rocketPool: {
      name: 'Rocket Pool',
      token: 'rETH',
      description: 'Decentralized ETH staking',
      address: PROTOCOL_ADDRESSES[chain]?.rocketPool?.rocketTokenRETH,
      supported: !!PROTOCOL_ADDRESSES[chain]?.rocketPool
    }
  };
}

export default {
  // Lido
  stakeLido,
  unstakeLido,
  getLidoStakedBalance,
  getLidoSharesValue,
  
  // Rocket Pool
  stakeRocketPool,
  unstakeRocketPool,
  getRocketPoolStakedBalance,
  getRocketPoolRethValue,
  
  // Utilities
  getStakingPositions,
  getSupportedStakingChains,
  getStakingProtocols,
  PROTOCOL_ADDRESSES
};
