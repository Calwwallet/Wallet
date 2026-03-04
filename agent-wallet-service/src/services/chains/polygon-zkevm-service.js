/**
 * Polygon zkEVM Chain Service
 * 
 * EVM-compatible zkRollup chain support using viem
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const POLYGON_ZKEVM_MAINNET = {
  id: 1101,
  name: 'Polygon zkEVM',
  network: 'polygon-zkevm',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://zkevm-rpc.com', 'https://polygon-zkevm-mainnet.titanbuilder.xyz'] },
    public: { http: ['https://zkevm-rpc.com', 'https://polygon-zkevm-mainnet.titanbuilder.xyz'] }
  },
  blockExplorers: {
    default: { name: 'PolygonScan', url: 'https://zkevm.polygonscan.com' }
  }
};

const POLYGON_ZKEVM_TESTNET = {
  id: 1442,
  name: 'Polygon zkEVM Testnet',
  network: 'polygon-zkevm-testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://rpc.public.zkevm-testnet.com', 'https://zkevm-testnet..polygon.technology'] },
    public: { http: ['https://rpc.public.zkevm-testnet.com', 'https://zkevm-testnet..polygon.technology'] }
  },
  blockExplorers: {
    default: { name: 'PolygonScan', url: 'https://testnet-zkevm.polygonscan.com' }
  }
};

const CHAINS = {
  'polygon-zkevm': {
    chain: POLYGON_ZKEVM_MAINNET,
    rpcs: [
      process.env.POLYGON_ZKEVM_RPC || 'https://zkevm-rpc.com',
      'https://polygon-zkevm-mainnet.titanbuilder.xyz',
      'https://zkevm-rpc.polygon.technology'
    ].filter(Boolean)
  },
  'polygon-zkevm-testnet': {
    chain: POLYGON_ZKEVM_TESTNET,
    rpcs: [
      process.env.POLYGON_ZKEVM_TESTNET_RPC || 'https://rpc.public.zkevm-testnet.com',
      'https://zkevm-testnet..polygon.technology'
    ].filter(Boolean)
  }
};

const DEFAULT_CHAIN = 'polygon-zkevm-testnet';

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
async function createClientWithFallback(chainConfig, privateKey = null, clientType = 'public') {
  const { chain, rpcs } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const clientConfig = { chain, transport: http(rpc) };
      
      let client;
      if (clientType === 'public') {
        client = createPublicClient(clientConfig);
      } else {
        client = createWalletClient({
          ...clientConfig,
          account: privateKeyToAccount(privateKey)
        });
      }

      // Test the connection
      await client.getBlockNumber();
      return { client, rpc };
    } catch (error) {
      console.log(`RPC ${rpc} failed: ${error.message}, trying next...`);
      continue;
    }
  }

  throw new Error(`All RPCs failed for chain ${chain.name}`);
}

/**
 * Get supported chains
 */
export function getSupportedChains() {
  return Object.keys(CHAINS).map(key => ({
    id: key,
    name: CHAINS[key].chain.name,
    chainId: CHAINS[key].chain.id,
    testnet: key.includes('testnet'),
    type: 'evm',
    nativeCurrency: CHAINS[key].chain.nativeCurrency
  }));
}

/**
 * Generate a random private key
 */
function generatePrivateKey() {
  const bytes = randomBytes(32);
  return '0x' + bytes.toString('hex');
}

/**
 * Create a new wallet on Polygon zkEVM
 */
export async function createWallet({ agentName, chain = DEFAULT_CHAIN, tenantId }) {
  try {
    const chainConfig = getChainConfig(chain);
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const wallet = {
      id: walletId,
      agentName,
      address: account.address,
      privateKey, // Will be encrypted by the caller
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created Polygon zkEVM wallet for ${agentName}: ${account.address}`);

    return {
      id: walletId,
      address: account.address,
      chain,
      chainId: chainConfig.chain.id
    };
  } catch (error) {
    console.error('Failed to create Polygon zkEVM wallet:', error);
    throw error;
  }
}

/**
 * Get wallet balance
 */
export async function getBalance(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, null, 'public');
    const balance = await client.getBalance({ address });
    
    return {
      address,
      chain,
      balance: formatEther(balance),
      balanceWei: balance.toString(),
      nativeCurrency: chainConfig.chain.nativeCurrency
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Get native token balance
 */
export async function getNativeBalance(address, chain = DEFAULT_CHAIN) {
  return getBalance(address, chain);
}

/**
 * Transfer native tokens (ETH)
 */
export async function transfer({ 
  fromPrivateKey, 
  to, 
  amount, 
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, fromPrivateKey, 'wallet');
    
    const value = parseEther(amount.toString());
    
    const tx = await client.sendTransaction({
      to,
      value,
      account: client.account
    });

    // Wait for transaction receipt
    const receipt = await client.waitForTransactionReceipt({ hash: tx });

    return {
      hash: tx,
      from: client.account.address,
      to,
      amount: amount.toString(),
      chain,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: receipt.blockNumber?.toString()
    };
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas({ from, to, value, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, null, 'public');
    
    const estimate = await client.estimateGas({
      from,
      to,
      value: parseEther(value.toString())
    });

    const gasPrice = await client.getGasPrice();
    const gasLimit = estimate * BigInt(120) / BigInt(100); // Add 20% buffer

    return {
      estimatedGas: estimate.toString(),
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      gasPriceGwei: formatUnits(gasPrice, 9),
      totalCostWei: (gasLimit * gasPrice).toString(),
      totalCostEth: formatEther(gasLimit * gasPrice)
    };
  } catch (error) {
    console.error('Failed to estimate gas:', error);
    throw error;
  }
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(txHash, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, null, 'public');
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber?.toString(),
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      gasUsed: receipt.gasUsed?.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString()
    };
  } catch (error) {
    console.error('Failed to get transaction receipt:', error);
    throw error;
  }
}

/**
 * Get chain ID
 */
export function getChainId(chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  return chainConfig.chain.id;
}

/**
 * Validate address format
 */
export function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
