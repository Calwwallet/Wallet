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
import { logTransaction } from './tx-history.js';
import { encrypt, decrypt } from './encryption.js';
import db from './db.js';

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

// Persist wallets to SQLite

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

    // Store wallet in DB
    db.prepare('INSERT INTO wallets (id, agent_name, address, encrypted_key, chain, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      wallet.id, wallet.agentName, wallet.address, wallet.privateKey, wallet.chain, wallet.createdAt
    );

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
  const wallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(address);

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
  const wallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(from);

  if (!wallet) {
    throw new Error(`Wallet not found: ${from}`);
  }

  // Use provided chain or wallet's chain
  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = getChainConfig(chainName);

  try {
    // Decrypt private key for use
    const decryptedKey = decrypt(wallet.encrypted_key);
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
  const rows = db.prepare('SELECT * FROM wallets').all();
  return rows.map(w => ({
    id: w.id,
    agentName: w.agent_name,
    address: w.address,
    chain: w.chain,
    createdAt: w.created_at
  }));
}

/**
 * Get wallet by ID (for internal use)
 */
export function getWalletById(id) {
  return db.prepare('SELECT * FROM wallets WHERE id = ?').get(id);
}

/**
 * Get wallet by address
 */
export function getWalletByAddress(address) {
  return db.prepare('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)').get(address);
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
    const existing = db.prepare('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)').get(account.address);

    if (existing) {
      return {
        id: existing.id,
        address: existing.address,
        chain: existing.chain,
        imported: false,
        message: 'Wallet already exists'
      };
    }

    db.prepare('INSERT INTO wallets (id, agent_name, address, encrypted_key, chain, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      wallet.id, wallet.agentName, wallet.address, wallet.privateKey, wallet.chain, wallet.createdAt
    );

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
  const balances = [];

  for (const [chainName, config] of Object.entries(CHAINS)) {
    try {
      const { client } = await createClientWithFallback(config, 'public');
      const balance = await client.getBalance({ address });

      balances.push({
        chain: chainName,
        eth: formatEther(balance),
        wei: balance.toString(),
        status: 'ok'
      });
    } catch (error) {
      balances.push({
        chain: chainName,
        eth: '0',
        wei: '0',
        status: 'error',
        error: error.message
      });
    }
  }

  return balances;
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas({ from, to, value, data = '0x', chain }) {
  const wallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(from);
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
  const wallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(from);
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

    // Add 20% buffer to gas estimate to ensure it doesn't fail during spikes
    const gasLimit = (gasEstimate * 120n) / 100n;
    const gasCost = gasLimit * gasPrice;

    // Calculate amount to send (balance - gas)
    const amountToSend = balance - gasCost;

    if (amountToSend <= 0n) {
      throw new Error(`Insufficient balance to cover gas. Balance: ${formatEther(balance)} ETH, Needed: ${formatEther(gasCost)} ETH`);
    }

    // Create wallet client
    const decryptedKey = decrypt(wallet.encrypted_key || wallet.privateKey);
    const account = privateKeyToAccount(decryptedKey);
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcs[0])
    });

    const hash = await walletClient.sendTransaction({
      to,
      value: amountToSend,
      gas: gasLimit,
      data: '0x'
    });

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
