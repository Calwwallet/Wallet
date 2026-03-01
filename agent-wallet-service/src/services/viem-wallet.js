/**
 * Viem-based Wallet Service
 * 
 * Simple wallet creation using viem (no CDP dependency)
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  baseSepolia, base, mainnet, sepolia,
  polygon, optimism, optimismSepolia,
  arbitrum, arbitrumSepolia
} from 'viem/chains';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logTransaction } from './tx-history.js';
import { encrypt, decrypt } from './encryption.js';
import { evaluateTransferPolicy, recordPolicySpend } from './policy-engine.js';

// ============================================================
// MULTI-CHAIN CONFIG
// ============================================================

// Check for Alchemy API key
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;

// Alchemy URLs (only works for chains you've created apps for)
const getAlchemyUrl = (network) => ALCHEMY_KEY
  ? `https://${network}.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : null;

const CHAINS = {
  // Testnets
  'base-sepolia': {
    chain: baseSepolia,
    rpcs: [getAlchemyUrl('base-sepolia'), 'https://sepolia.base.org', 'https://base-sepolia.blockpi.network/v1/rpc/public'].filter(Boolean)
  },
  'ethereum-sepolia': {
    chain: sepolia,
    rpcs: [getAlchemyUrl('eth-sepolia'), 'https://ethereum-sepolia.publicnode.com', 'https://rpc.sepolia.org'].filter(Boolean)
  },
  'optimism-sepolia': {
    chain: optimismSepolia,
    rpcs: [getAlchemyUrl('opt-sepolia'), 'https://sepolia.optimism.io', 'https://optimism-sepolia.publicnode.com'].filter(Boolean)
  },
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    rpcs: [getAlchemyUrl('arb-sepolia'), 'https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.publicnode.com'].filter(Boolean)
  },

  // Mainnets
  'base': {
    chain: base,
    rpcs: [getAlchemyUrl('base-mainnet'), 'https://mainnet.base.org', 'https://base-rpc.publicnode.com'].filter(Boolean)
  },
  'ethereum': {
    chain: mainnet,
    rpcs: [getAlchemyUrl('eth-mainnet'), 'https://ethereum.publicnode.com', 'https://eth.llamarpc.com'].filter(Boolean)
  },
  'polygon': {
    chain: polygon,
    rpcs: [getAlchemyUrl('polygon-mainnet'), 'https://polygon-rpc.com', 'https://polygon-bor.publicnode.com'].filter(Boolean)
  },
  'optimism': {
    chain: optimism,
    rpcs: [getAlchemyUrl('opt-mainnet'), 'https://mainnet.optimism.io', 'https://optimism.publicnode.com'].filter(Boolean)
  },
  'arbitrum': {
    chain: arbitrum,
    rpcs: [getAlchemyUrl('arb-mainnet'), 'https://arb1.arbitrum.io/rpc', 'https://arbitrum-one.publicnode.com'].filter(Boolean)
  }
};

// Default chain
const DEFAULT_CHAIN = 'base-sepolia';

/**
 * Get chain config by name
 */
function getChainConfig(chainName) {
  const config = CHAINS[chainName];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainName}. Supported: ${Object.keys(CHAINS).join(', ')}`);
  }
  return config;
}

/**
 * Create a client with fallback RPCs
 */
async function createClientWithFallback(chainConfig, clientType = 'public') {
  const { chain, rpcs } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const client = clientType === 'public'
        ? createPublicClient({ chain, transport: http(rpc) })
        : createWalletClient({ chain, transport: http(rpc) });

      // Test the connection with a simple request
      if (clientType === 'public') {
        await client.getBlockNumber();
      }
      return { client, rpc };
    } catch (error) {
      console.log(`RPC ${rpc} failed, trying next...`);
      continue;
    }
  }

  throw new Error(`All RPCs failed for chain ${chain.name}`);
}

/**
 * Get all supported chains
 */
export function getSupportedChains() {
  return Object.keys(CHAINS).map(key => ({
    id: key,
    name: CHAINS[key].chain.name,
    testnet: key.includes('sepolia') || key.includes('mumbai'),
    nativeCurrency: CHAINS[key].chain.nativeCurrency
  }));
}

// Persist wallets to JSON file
const WALLET_FILE = join(process.cwd(), 'wallets.json');

function loadWallets() {
  if (existsSync(WALLET_FILE)) {
    const data = JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
    return new Map(Object.entries(data));
  }
  return new Map();
}

function saveWallets(wallets) {
  const obj = Object.fromEntries(wallets);
  writeFileSync(WALLET_FILE, JSON.stringify(obj, null, 2));
}

const wallets = loadWallets();

/**
 * Generate a random private key
 */
function generatePrivateKey() {
  const bytes = randomBytes(32);
  return '0x' + bytes.toString('hex');
}

/**
 * Create a new wallet for an AI agent
 */
export async function createWallet({ agentName, chain = 'base-sepolia' }) {
  try {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletId = `wallet_${Date.now()}`;

    const wallet = {
      id: walletId,
      agentName,
      address: account.address,
      privateKey: encrypt(privateKey), // Encrypted at rest
      chain,
      createdAt: new Date().toISOString()
    };

    // Store wallet
    wallets.set(walletId, wallet);
    saveWallets(wallets);

    console.log(`✅ Created wallet for ${agentName}: ${account.address}`);

    return {
      id: walletId,
      address: account.address,
      chain
    };
  } catch (error) {
    console.error('Failed to create wallet:', error);
    throw error;
  }
}

/**
 * Get wallet balance
 */
export async function getBalance(address, chain) {
  const wallet = Array.from(wallets.values()).find(w => w.address === address);

  // Use wallet's chain if not specified, fallback to default
  const chainName = chain || wallet?.chain || DEFAULT_CHAIN;
  const chainConfig = getChainConfig(chainName);

  if (!wallet) {
    throw new Error(`Wallet not found: ${address}`);
  }

  try {
    const { client, rpc } = await createClientWithFallback(chainConfig, 'public');
    const balance = await client.getBalance({ address });

    return {
      chain: chainName,
      eth: formatEther(balance),
      wei: balance.toString(),
      rpc: rpc.split('/')[2] // Just show domain
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Sign and send a transaction
 */
export async function signTransaction({ from, to, value, data = '0x', chain }) {
  const wallet = Array.from(wallets.values()).find(w => w.address === from);

  if (!wallet) {
    throw new Error(`Wallet not found: ${from}`);
  }

  // Use provided chain or wallet's chain
  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = getChainConfig(chainName);

  const policyEvaluation = evaluateTransferPolicy({
    walletAddress: from,
    to,
    valueEth: value,
    chain: chainName
  });

  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked transaction (${policyEvaluation.reason})`);
  }

  try {
    // Decrypt private key for use
    const decryptedKey = decrypt(wallet.privateKey);
    const account = privateKeyToAccount(decryptedKey);

    const { client } = await createClientWithFallback(
      { ...chainConfig, account },
      'wallet'
    );

    // Re-create with account for wallet client
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcs[0])
    });

    const hash = await walletClient.sendTransaction({
      to,
      value: parseEther(value),
      data
    });

    console.log(`✅ Transaction sent on ${chainName}: ${hash}`);

    // Log transaction
    const txRecord = {
      hash,
      from,
      to,
      value,
      chain: chainName
    };
    logTransaction(txRecord);
    recordPolicySpend({ walletAddress: from, valueEth: value });

    return {
      hash,
      from,
      to,
      value,
      data,
      chain: chainName,
      explorer: getExplorerUrl(chainName, hash)
    };
  } catch (error) {
    console.error('Failed to send transaction:', error);
    throw error;
  }
}

/**
 * Get block explorer URL for a transaction
 */
function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'base-sepolia': `https://sepolia.basescan.org/tx/${txHash}`,
    'base': `https://basescan.org/tx/${txHash}`,
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'ethereum-sepolia': `https://sepolia.etherscan.io/tx/${txHash}`,
    'polygon': `https://polygonscan.com/tx/${txHash}`,
    'polygon-mumbai': `https://mumbai.polygonscan.com/tx/${txHash}`,
    'optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
    'optimism-sepolia': `https://sepolia-optimism.etherscan.io/tx/${txHash}`,
    'arbitrum': `https://arbiscan.io/tx/${txHash}`,
    'arbitrum-sepolia': `https://sepolia.arbiscan.io/tx/${txHash}`
  };
  return explorers[chainName];
}

/**
 * Get all wallets (for admin)
 */
export function getAllWallets() {
  return Array.from(wallets.values()).map(w => ({
    id: w.id,
    agentName: w.agentName,
    address: w.address,
    chain: w.chain,
    createdAt: w.createdAt
  }));
}

/**
 * Get wallet by ID (for internal use)
 */
export function getWalletById(id) {
  return wallets.get(id);
}

/**
 * Get wallet by address
 */
export function getWalletByAddress(address) {
  return Array.from(wallets.values()).find(w =>
    w.address.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Import an existing wallet from private key
 */
export async function importWallet({ privateKey, agentName, chain = DEFAULT_CHAIN }) {
  try {
    // Validate private key format
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    const account = privateKeyToAccount(privateKey);
    const walletId = `wallet_imported_${Date.now()}`;

    const wallet = {
      id: walletId,
      agentName: agentName || 'Imported',
      address: account.address,
      privateKey: encrypt(privateKey), // Encrypted at rest
      chain,
      imported: true,
      createdAt: new Date().toISOString()
    };

    // Check if wallet already exists
    const existing = Array.from(wallets.values()).find(w =>
      w.address.toLowerCase() === account.address.toLowerCase()
    );

    if (existing) {
      return {
        id: existing.id,
        address: existing.address,
        chain: existing.chain,
        imported: false,
        message: 'Wallet already exists'
      };
    }

    wallets.set(walletId, wallet);
    saveWallets(wallets);

    console.log(`✅ Imported wallet: ${account.address}`);

    return {
      id: walletId,
      address: account.address,
      chain,
      imported: true
    };
  } catch (error) {
    console.error('Failed to import wallet:', error);
    throw new Error('Invalid private key');
  }
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(txHash, chainName = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chainName);

  try {
    const { client } = await createClientWithFallback(chainConfig, 'public');
    const receipt = await client.getTransactionReceipt({ hash: txHash });

    return {
      hash: receipt.transactionHash,
      status: receipt.status === 'success' ? 'success' : 'failed',
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      from: receipt.from,
      to: receipt.to,
      chain: chainName
    };
  } catch (error) {
    // Transaction might be pending
    return {
      hash: txHash,
      status: 'pending',
      chain: chainName,
      explorer: getExplorerUrl(chainName, txHash)
    };
  }
}

/**
 * Get balance across all chains
 */
export async function getMultiChainBalance(address) {
  const requests = Object.entries(CHAINS).map(async ([chainName, config]) => {
    try {
      const { client } = await createClientWithFallback(config, 'public');
      const balance = await client.getBalance({ address });

      return {
        chain: chainName,
        eth: formatEther(balance),
        wei: balance.toString(),
        status: 'ok'
      };
    } catch (error) {
      return {
        chain: chainName,
        eth: '0',
        wei: '0',
        status: 'error',
        error: error.message
      };
    }
  });

  return await Promise.all(requests);
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas({ from, to, value, data = '0x', chain }) {
  const wallet = Array.from(wallets.values()).find(w => w.address === from);
  const chainName = chain || wallet?.chain || DEFAULT_CHAIN;
  const chainConfig = getChainConfig(chainName);

  try {
    const { client } = await createClientWithFallback(chainConfig, 'public');

    const gas = await client.estimateGas({
      account: from,
      to,
      value: parseEther(value || '0'),
      data
    });

    // Get current gas price
    const gasPrice = await client.getGasPrice();

    const estimatedCost = gas * gasPrice;

    return {
      chain: chainName,
      gasUnits: gas.toString(),
      gasPrice: formatEther(gasPrice) + ' ETH',
      estimatedCost: formatEther(estimatedCost) + ' ETH',
      estimatedCostWei: estimatedCost.toString()
    };
  } catch (error) {
    console.error('Gas estimation failed:', error);
    throw error;
  }
}

/**
 * Transfer all funds (sweep wallet)
 */
export async function sweepWallet({ from, to, chain }) {
  const wallet = Array.from(wallets.values()).find(w => w.address === from);
  if (!wallet) throw new Error('Wallet not found');

  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = getChainConfig(chainName);

  try {
    const { client: publicClient } = await createClientWithFallback(chainConfig, 'public');

    // Get balance
    const balance = await publicClient.getBalance({ address: from });

    // Estimate gas
    const gasEstimate = await publicClient.estimateGas({
      account: from,
      to,
      value: balance,
      data: '0x'
    });

    const gasPrice = await publicClient.getGasPrice();
    const gasCost = gasEstimate * gasPrice;

    // Calculate amount to send (balance - gas)
    const amountToSend = balance - gasCost;

    if (amountToSend <= 0n) {
      throw new Error('Insufficient balance to cover gas');
    }

    const amountToSendEth = formatEther(amountToSend);
    const policyEvaluation = evaluateTransferPolicy({
      walletAddress: from,
      to,
      valueEth: amountToSendEth,
      chain: chainName
    });

    if (!policyEvaluation.allowed) {
      throw new Error(`Policy blocked sweep (${policyEvaluation.reason})`);
    }

    // Create wallet client
    const account = privateKeyToAccount(decrypt(wallet.privateKey));
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcs[0])
    });

    const hash = await walletClient.sendTransaction({
      to,
      value: amountToSend,
      data: '0x'
    });

    logTransaction({
      hash,
      from,
      to,
      value: amountToSendEth,
      chain: chainName
    });
    recordPolicySpend({ walletAddress: from, valueEth: amountToSendEth });

    return {
      hash,
      from,
      to,
      amountSent: formatEther(amountToSend),
      gasCost: formatEther(gasCost),
      chain: chainName,
      explorer: getExplorerUrl(chainName, hash)
    };
  } catch (error) {
    console.error('Sweep failed:', error);
    throw error;
  }
}
