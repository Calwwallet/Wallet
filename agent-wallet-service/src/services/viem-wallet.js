/**
 * Viem-based Wallet Service
 * 
 * Simple wallet creation using viem (no CDP dependency)
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, parseUnits, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  baseSepolia, base, mainnet, sepolia,
  polygon, optimism, optimismSepolia,
  arbitrum, arbitrumSepolia
} from 'viem/chains';
import { randomBytes } from 'crypto';
import { logTransaction } from './tx-history.js';
import { encrypt, decrypt } from './encryption.js';
import { evaluateTransferPolicy, recordPolicySpend, recordPolicySpendUsd, checkPendingApproval } from './policy-engine.js';
import {
  getWalletStore,
  persistWalletStore,
  findWalletByAddress,
  getAllWallets as repoGetAllWallets,
  findWalletByAddressDb,
  getAllWalletsDb,
  upsertWalletDb
} from '../repositories/wallet-repository.js';

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
import { getAllowedHostPatterns, isLocalHost, hostMatchesPattern } from '../middleware/rpc-access.js';

const DEFAULT_CHAIN = 'base-sepolia';
const BYO_RPC_HINT = 'Provide X-RPC-URL header, ?rpcUrl query param, or rpcUrl in request body.';

/**
 * Validate that a BYO RPC URL is from an allowed host
 * This prevents users from making the service proxy requests to arbitrary destinations
 */
function validateByoRpcUrl(rpcUrl) {
  try {
    const url = new URL(rpcUrl);
    const hostname = url.hostname.toLowerCase();
    
    // Allow localhost for development
    if (isLocalHost(hostname)) {
      return true;
    }
    
    // Check against allowed host patterns
    const allowedPatterns = getAllowedHostPatterns();
    const isAllowed = allowedPatterns.some(pattern => hostMatchesPattern(hostname, pattern));
    
    if (!isAllowed) {
      throw new Error(
        `BYO_RPC_HOST_NOT_ALLOWED: RPC URL host '${hostname}' is not in allowed list. ` +
        `Allowed: ${allowedPatterns.join(', ')}. ` +
        `Set BYO_RPC_ALLOWED_HOSTS environment variable to configure.`
      );
    }
    
    return true;
  } catch (error) {
    if (error.message.startsWith('BYO_RPC_HOST_NOT_ALLOWED')) {
      throw error;
    }
    throw new Error(`BYO_RPC_INVALID_URL: Invalid RPC URL: ${error.message}`);
  }
}

function resolveRpcMode({ tier, rpcMode } = {}) {
  if (rpcMode === 'byo' || rpcMode === 'managed') return rpcMode;
  return tier === 'free' ? 'byo' : 'managed';
}

function normalizeRuntimeRpcUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;

  try {
    return new URL(value).toString();
  } catch {
    throw new Error('Invalid rpcUrl format.');
  }
}

function resolveChainConfigForRequest(chainName, options = {}) {
  const chainConfig = getChainConfig(chainName);
  const mode = resolveRpcMode(options);

  if (mode !== 'byo') {
    return chainConfig;
  }

  const rpcUrl = normalizeRuntimeRpcUrl(options.rpcUrl);
  if (!rpcUrl) {
    throw new Error(`BYO_RPC_REQUIRED: free-tier requests must include rpcUrl. ${BYO_RPC_HINT}`);
  }
  
  // Validate the RPC URL is from an allowed host
  validateByoRpcUrl(rpcUrl);
  
  // BYO mode intentionally disables managed RPC fallback to protect infra costs.
  return {
    ...chainConfig,
    rpcs: [rpcUrl]
  };
}

/**
 * Get chain config by name
 */
export function getChainConfig(chainName) {
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

// Wallet storage is handled via the WalletRepository abstraction
const wallets = getWalletStore();
const USE_DB = process.env.STORAGE_BACKEND === 'db';

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
export async function createWallet({ agentName, chain = 'base-sepolia', tenantId }) {
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
    if (USE_DB) {
      await upsertWalletDb(wallet, { tenantId });
    } else {
      wallets.set(walletId, wallet);
      persistWalletStore();
    }

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
export async function getBalance(address, chain, options = {}) {
  const { tenantId } = options;
  const wallet = USE_DB
    ? await findWalletByAddressDb(address, { tenantId })
    : Array.from(wallets.values()).find(w => w.address === address);

  // Use wallet's chain if not specified, fallback to default
  const chainName = chain || wallet?.chain || DEFAULT_CHAIN;
  const chainConfig = resolveChainConfigForRequest(chainName, options);

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
export async function signTransaction({
  from,
  to,
  value,
  data = '0x',
  chain,
  context = {},
  tenantId,
  tier,
  rpcMode,
  rpcUrl
}) {
  const wallet = USE_DB
    ? await findWalletByAddressDb(from, { tenantId })
    : Array.from(wallets.values()).find(w => w.address === from);

  if (!wallet) {
    throw new Error(`Wallet not found: ${from}`);
  }

  // Use provided chain or wallet's chain
  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = resolveChainConfigForRequest(chainName, { tier, rpcMode, rpcUrl });

  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress: from,
    fromAddress: from, // Pass fromAddress for proper policy evaluation
    to,
    valueEth: value,
    chain: chainName,
    tenantId
  });

  // Handle HITL (Human-in-the-Loop) approval
  if (!policyEvaluation.allowed) {
    if (policyEvaluation.reason === 'requires_human_approval') {
      // Return pending approval info instead of throwing
      return {
        success: false,
        requiresApproval: true,
        pendingApprovalId: policyEvaluation.pendingApprovalId,
        message: 'Transaction requires human approval',
        expiresAt: policyEvaluation.context?.expiresAt,
        policy: policyEvaluation.policy
      };
    }
    throw new Error(`Policy blocked transaction (${policyEvaluation.reason})`);
  }

  let decryptedKey;
  try {
    // Decrypt private key for use
    // SECURITY NOTE: Private key is decrypted in memory during transaction signing.
    // This is inherent to hot wallet architecture. For production, consider:
    // - Hardware Security Modules (HSM)
    // - Intel SGX / ARM TrustZone enclaves
    // - External signing services (e.g., Fireblocks, BitGo)
    decryptedKey = decrypt(wallet.privateKey);
    const account = privateKeyToAccount(decryptedKey);

    const { client: walletClient } = await createClientWithFallback(
      { ...chainConfig, account },
      'wallet'
    );

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
      chain: chainName,
      policy: {
        reason: policyEvaluation.reason,
        context: policyEvaluation.context || null
      },
      meta: context || null
    };
    await logTransaction(txRecord, { tenantId });
    await recordPolicySpend({ walletAddress: from, valueEth: value, tenantId });
    
    // Also record USD spending for USD-based policy tracking
    if (policyEvaluation.context?.valueUsd) {
      await recordPolicySpendUsd({ walletAddress: from, valueUsd: policyEvaluation.context.valueUsd, tenantId });
    }

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
  } finally {
    // Zero out the decrypted key from memory after use
    // Note: JavaScript doesn't guarantee immediate memory release, but this signals intent
    if (decryptedKey) {
      // Key will be garbage collected - explicit zeroing isn't possible in JS
      // but we log for audit purposes
      console.debug('Private key used for signing, removed from active scope');
      decryptedKey = null;
    }
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
export async function getAllWallets({ tenantId } = {}) {
  const list = USE_DB ? await getAllWalletsDb({ tenantId }) : repoGetAllWallets();
  return list.map(w => ({
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
export async function getWalletByAddress(address, { tenantId } = {}) {
  return USE_DB ? await findWalletByAddressDb(address, { tenantId }) : findWalletByAddress(address);
}

/**
 * Import an existing wallet from private key
 */
export async function importWallet({ privateKey, agentName, chain = DEFAULT_CHAIN, tenantId }) {
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
    const existing = USE_DB
      ? await findWalletByAddressDb(account.address, { tenantId })
      : Array.from(wallets.values()).find(w =>
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

    if (USE_DB) {
      await upsertWalletDb(wallet, { tenantId });
    } else {
      wallets.set(walletId, wallet);
      persistWalletStore();
    }

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
export async function getTransactionReceipt(txHash, chainName = DEFAULT_CHAIN, options = {}) {
  const chainConfig = resolveChainConfigForRequest(chainName, options);

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
export async function getMultiChainBalance(address, options = {}) {
  if (resolveRpcMode(options) === 'byo') {
    throw new Error('BYO_RPC_MULTI_CHAIN_NOT_SUPPORTED: free-tier BYO RPC does not support /balance/all.');
  }

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
export async function estimateGas({ from, to, value, data = '0x', chain, tenantId, tier, rpcMode, rpcUrl }) {
  const wallet = USE_DB
    ? await findWalletByAddressDb(from, { tenantId })
    : Array.from(wallets.values()).find(w => w.address === from);
  const chainName = chain || wallet?.chain || DEFAULT_CHAIN;
  const chainConfig = resolveChainConfigForRequest(chainName, { tier, rpcMode, rpcUrl });

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
export async function sweepWallet({ from, to, chain, tenantId, tier, rpcMode, rpcUrl }) {
  const wallet = USE_DB
    ? await findWalletByAddressDb(from, { tenantId })
    : Array.from(wallets.values()).find(w => w.address === from);
  if (!wallet) throw new Error('Wallet not found');

  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = resolveChainConfigForRequest(chainName, { tier, rpcMode, rpcUrl });

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
    const policyEvaluation = await evaluateTransferPolicy({
      walletAddress: from,
      to,
      valueEth: amountToSendEth,
      chain: chainName,
      tenantId
    });

    if (!policyEvaluation.allowed) {
      // Handle HITL (Human-in-the-Loop) approval
      if (policyEvaluation.reason === 'requires_human_approval') {
        return {
          success: false,
          requiresApproval: true,
          pendingApprovalId: policyEvaluation.pendingApprovalId,
          message: 'Sweep requires human approval',
          expiresAt: policyEvaluation.context?.expiresAt,
          policy: policyEvaluation.policy
        };
      }
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

    await logTransaction({
      hash,
      from,
      to,
      value: amountToSendEth,
      chain: chainName,
      policy: {
        reason: policyEvaluation.reason,
        context: policyEvaluation.context || null
      }
    }, { tenantId });
    await recordPolicySpend({ walletAddress: from, valueEth: amountToSendEth, tenantId });
    
    // Also record USD spending for USD-based policy tracking
    if (policyEvaluation.context?.valueUsd) {
      await recordPolicySpendUsd({ walletAddress: from, valueUsd: policyEvaluation.context.valueUsd, tenantId });
    }

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

// ERC-20 Token ABI (transfer function)
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable'
  }
];

/**
 * Transfer ERC-20 tokens
 * @param {string} from - Sender wallet address
 * @param {string} to - Recipient wallet address  
 * @param {string} tokenAddress - ERC-20 token contract address
 * @param {string} amount - Amount to transfer (in human-readable format, e.g., "10.5")
 * @param {number} decimals - Token decimals (default 18)
 * @param {string} chain - Chain name
 * @param {object} options - Options including tenantId, tier, rpcMode, rpcUrl
 */
export async function transferErc20({ 
  from, 
  to, 
  tokenAddress, 
  amount, 
  decimals = 18,
  chain = DEFAULT_CHAIN,
  ...options 
}) {
  const { tenantId, tier, rpcMode, rpcUrl } = options;
  
  // Get wallet
  const wallet = USE_DB
    ? await findWalletByAddressDb(from, { tenantId })
    : findWalletByAddress(from);
  
  if (!wallet) {
    throw new Error(`Wallet not found: ${from}`);
  }

  // Get chain config
  const chainName = chain || wallet.chain || DEFAULT_CHAIN;
  const chainConfig = resolveChainConfigForRequest(chainName, { tier, rpcMode, rpcUrl });

  let decryptedKey;
  try {
    // Decrypt private key
    decryptedKey = decrypt(wallet.privateKey);
    const account = privateKeyToAccount(decryptedKey);

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcs[0])
    });

    // Encode ERC-20 transfer data
    const amountWei = parseUnits(amount, decimals);
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to, amountWei]
    });

    // Send transaction
    const hash = await walletClient.sendTransaction({
      to: tokenAddress,
      value: 0n,
      data
    });

    console.log(`✅ ERC-20 token transfer on ${chainName}: ${hash}`);

    return {
      hash,
      from,
      to,
      tokenAddress,
      amount,
      amountWei: amountWei.toString(),
      chain: chainName,
      explorer: getExplorerUrl(chainName, hash)
    };
  } catch (error) {
    console.error('ERC-20 transfer failed:', error);
    throw error;
  } finally {
    if (decryptedKey) {
      decryptedKey = null;
    }
  }
}
