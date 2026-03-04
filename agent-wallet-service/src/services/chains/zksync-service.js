/**
 * zkSync Era Chain Service
 * 
 * EVM-compatible zkRollup with account abstraction support using viem
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const ZKSYNC_MAINNET = {
  id: 324,
  name: 'zksync Era',
  network: 'zksync-era',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://mainnet.era.zksync.io'] },
    public: { http: ['https://mainnet.era.zksync.io'] }
  },
  blockExplorers: {
    default: { name: 'zksync Explorer', url: 'https://explorer.zksync.io' }
  }
};

const ZKSYNC_TESTNET = {
  id: 300,
  name: 'zksync Era Sepolia Testnet',
  network: 'zksync-era-sepolia',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://sepolia.era.zksync.dev'] },
    public: { http: ['https://sepolia.era.zksync.dev'] }
  },
  blockExplorers: {
    default: { name: 'zksync Explorer', url: 'https://sepolia.explorer.zksync.io' }
  }
};

const CHAINS = {
  'zksync': {
    chain: ZKSYNC_MAINNET,
    rpcs: [
      process.env.ZKSYNC_MAINNET_RPC || 'https://mainnet.era.zksync.io',
      'https://zksync-era.blockpi.network/v1/rpc/public'
    ].filter(Boolean)
  },
  'zksync-sepolia': {
    chain: ZKSYNC_TESTNET,
    rpcs: [
      process.env.ZKSYNC_TESTNET_RPC || 'https://sepolia.era.zksync.dev',
      'https://zksync-sepolia.blockpi.network/v1/rpc/public'
    ].filter(Boolean)
  }
};

const DEFAULT_CHAIN = 'zksync-sepolia';

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
    testnet: key.includes('sepolia'),
    type: 'evm',
    nativeCurrency: CHAINS[key].chain.nativeCurrency,
    features: ['account-abstraction', 'paymaster']
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
 * Create a new wallet on zkSync Era
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
      privateKey,
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created zkSync Era wallet for ${agentName}: ${account.address}`);

    return {
      id: walletId,
      address: account.address,
      chain,
      chainId: chainConfig.chain.id
    };
  } catch (error) {
    console.error('Failed to create zkSync Era wallet:', error);
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
  chain = DEFAULT_CHAIN,
  paymasterAddress = null // For account abstraction
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, fromPrivateKey, 'wallet');
    
    const value = parseEther(amount.toString());
    
    const tx = {
      to,
      value,
      account: client.account
    };

    // Add paymaster for fee abstraction if provided
    if (paymasterAddress) {
      tx.paymaster = paymasterAddress;
    }
    
    const sentTx = await client.sendTransaction(tx);

    // Wait for transaction receipt
    const receipt = await client.waitForTransactionReceipt({ hash: sentTx });

    return {
      hash: sentTx,
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
      gasPriceGwei: formatEther(gasPrice),
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

/**
 * Deploy account (for account abstraction on zkSync)
 * Note: This creates an EOA. For true AA, you'd need to deploy a smart contract account
 */
export async function deployAccount({ privateKey, chain = DEFAULT_CHAIN }) {
  // On zkSync Era, EOA accounts can be used directly
  // For smart contract accounts, you'd need to deploy a contract
  const account = privateKeyToAccount(privateKey);
  
  return {
    address: account.address,
    deployed: true,
    chain
  };
}

/**
 * Get fee estimate (includes zkSync specific L1 gas fee)
 */
export async function getFeeEstimate({ from, to, value, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClientWithFallback(chainConfig, null, 'public');
    
    const estimate = await client.estimateGas({
      from,
      to,
      value: parseEther(value.toString())
    });

    const gasPrice = await client.getGasPrice();
    
    // zkSync has L1 + L2 fees
    const l2Fee = estimate * gasPrice;
    
    return {
      l2FeeWei: l2Fee.toString(),
      l2FeeEth: formatEther(l2Fee),
      gasLimit: estimate.toString(),
      gasPriceWei: gasPrice.toString()
    };
  } catch (error) {
    console.error('Failed to estimate fee:', error);
    throw error;
  }
}
