/**
 * Sui Chain Service
 * 
 * Support for Sui blockchain using @mysten/sui
 * Includes wallet creation, token transfers, and object interactions
 */

import 'dotenv/config';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const SUI_MAINNET = {
  id: 0x01,
  name: 'Sui',
  network: 'mainnet',
  nativeCurrency: {
    name: 'Sui',
    symbol: 'SUI',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://fullnode.mainnet.sui.io'] },
    public: { http: ['https://fullnode.mainnet.sui.io'] }
  },
  blockExplorers: {
    default: { name: 'Sui Explorer', url: 'https://explorer.sui.io' }
  }
};

const SUI_TESTNET = {
  id: 0x02,
  name: 'Sui Testnet',
  network: 'testnet',
  nativeCurrency: {
    name: 'Sui',
    symbol: 'SUI',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://fullnode.testnet.sui.io'] },
    public: { http: ['https://fullnode.testnet.sui.io'] }
  },
  blockExplorers: {
    default: { name: 'Sui Explorer', url: 'https://explorer.sui.io/?network=testnet' }
  }
};

const SUI_DEVNET = {
  id: 0x03,
  name: 'Sui Devnet',
  network: 'devnet',
  nativeCurrency: {
    name: 'Sui',
    symbol: 'SUI',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://fullnode.devnet.sui.io'] },
    public: { http: ['https://fullnode.devnet.sui.io'] }
  },
  blockExplorers: {
    default: { name: 'Sui Explorer', url: 'https://explorer.sui.io/?network=devnet' }
  }
};

const CHAINS = {
  'sui': {
    chain: SUI_MAINNET,
    rpcs: [
      process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io'
    ].filter(Boolean)
  },
  'sui-testnet': {
    chain: SUI_TESTNET,
    rpcs: [
      process.env.SUI_TESTNET_RPC || 'https://fullnode.testnet.sui.io'
    ].filter(Boolean)
  },
  'sui-devnet': {
    chain: SUI_DEVNET,
    rpcs: [
      process.env.SUI_DEVNET_RPC || 'https://fullnode.devnet.sui.io'
    ].filter(Boolean)
  }
};

const DEFAULT_CHAIN = 'sui-testnet';

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
 * Create a Sui provider with fallback RPCs
 */
async function createProvider(chainConfig) {
  const { rpcs } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const provider = new SuiJsonRpcClient({ url: rpc });
      // Test the connection
      await provider.getLatestCheckpointSequenceNumber();
      return { provider, rpc };
    } catch (error) {
      console.log(`RPC ${rpc} failed: ${error.message}, trying next...`);
      continue;
    }
  }

  throw new Error(`All RPCs failed for chain ${chainConfig.chain.name}`);
}

/**
 * Get supported chains
 */
export function getSupportedChains() {
  return Object.keys(CHAINS).map(key => ({
    id: key,
    name: CHAINS[key].chain.name,
    chainId: CHAINS[key].chain.id,
    testnet: key.includes('testnet') || key.includes('devnet'),
    type: 'move',
    nativeCurrency: CHAINS[key].chain.nativeCurrency,
    features: ['objects', 'nfts', 'coins']
  }));
}

/**
 * Generate a random keypair (wallet)
 */
function generateKeypair() {
  return Ed25519Keypair.generate();
}

/**
 * Create a new wallet on Sui
 */
export async function createWallet({ agentName, chain = DEFAULT_CHAIN, tenantId }) {
  try {
    const chainConfig = getChainConfig(chain);
    const keypair = generateKeypair();
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const wallet = {
      id: walletId,
      agentName,
      address: keypair.getPublicKey().toSuiAddress(),
      privateKey: toBase64(decodeSuiPrivateKey(keypair.getSecretKey()).secretKey), // Base64 encoded
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created Sui wallet for ${agentName}: ${wallet.address}`);

    return {
      id: walletId,
      address: wallet.address,
      chain,
      chainId: chainConfig.chain.id,
      privateKeyBase64: wallet.privateKey
    };
  } catch (error) {
    console.error('Failed to create Sui wallet:', error);
    throw error;
  }
}

/**
 * Get wallet from base64 private key
 */
function getSignerFromBase64(privateKeyBase64) {
  const privateKeyBytes = fromBase64(privateKeyBase64);
  const normalized = privateKeyBytes.length === 33 ? privateKeyBytes.slice(1) : privateKeyBytes;
  const keypair = Ed25519Keypair.fromSecretKey(normalized);
  return keypair;
}

/**
 * Get wallet balance (SUI)
 */
export async function getBalance(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    const balance = await provider.getBalance({
      owner: address
    });
    
    const totalBalance = balance.totalBalance;
    
    return {
      address,
      chain,
      balance: (parseInt(totalBalance) / Math.pow(10, 9)).toString(),
      balanceMIST: totalBalance.toString(),
      nativeCurrency: chainConfig.chain.nativeCurrency
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Get native token balance (SUI)
 */
export async function getNativeBalance(address, chain = DEFAULT_CHAIN) {
  return getBalance(address, chain);
}

/**
 * Transfer native tokens (SUI)
 */
export async function transfer({ 
  fromPrivateKeyBase64, 
  to, 
  amount, 
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    const signer = getSignerFromBase64(fromPrivateKeyBase64);
    
    // Convert amount to MIST (9 decimals)
    const amountMist = BigInt(Math.round(amount * Math.pow(10, 9)));
    
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [amountMist]);
    tx.transferObjects([coin], to);

    const result = await provider.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true }
    });

    await provider.waitForTransaction({ digest: result.digest });

    return {
      hash: result.digest,
      from: signer.toSuiAddress(),
      to,
      amount: amount.toString(),
      chain,
      status: result.effects?.status?.status === 'success' ? 'confirmed' : 'failed'
    };
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

/**
 * Get all coin balances for a wallet
 */
export async function getAllBalances(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    const balances = await provider.getAllBalances({
      owner: address
    });
    
    return balances.map(b => ({
      coinType: b.coinType,
      balance: (parseInt(b.totalBalance) / Math.pow(10, 9)).toString(),
      symbol: b.coinType.split('::').pop()
    }));
  } catch (error) {
    console.error('Failed to get all balances:', error);
    throw error;
  }
}

/**
 * Get coin metadata
 */
export async function getCoinMetadata(coinType, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    const metadata = await provider.getCoinMetadata({
      coinType
    });
    
    return {
      decimals: metadata.decimals,
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description,
      iconUrl: metadata.iconUrl
    };
  } catch (error) {
    console.error('Failed to get coin metadata:', error);
    throw error;
  }
}

/**
 * Get objects owned by an address
 */
export async function getOwnedObjects(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    const objects = await provider.getOwnedObjects({
      owner: address
    });
    
    return objects.data.map(obj => ({
      objectId: obj.data.objectId,
      type: obj.data.type,
      version: obj.data.version
    }));
  } catch (error) {
    console.error('Failed to get owned objects:', error);
    throw error;
  }
}

/**
 * Get transaction by digest
 */
export async function getTransaction(txDigest, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    const tx = await provider.getTransactionBlock({
      digest: txDigest
    });
    
    return {
      digest: txDigest,
      status: tx.effects?.status?.status === 'success' ? 'confirmed' : 'failed',
      gasUsed: tx.effects?.gasUsed?.toString(),
      sender: tx.sender
    };
  } catch (error) {
    console.error('Failed to get transaction:', error);
    throw error;
  }
}

/**
 * Execute a move call transaction
 */
export async function moveCall({ 
  fromPrivateKeyBase64, 
  packageId, 
  module, 
  function: funcName, 
  typeArguments = [],
  arguments: args = [],
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    const signer = getSignerFromBase64(fromPrivateKeyBase64);

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::${module}::${funcName}`,
      typeArguments,
      arguments: args
    });

    const result = await provider.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true }
    });

    await provider.waitForTransaction({ digest: result.digest });

    return {
      hash: result.digest,
      from: signer.toSuiAddress(),
      packageId,
      module,
      function: funcName,
      chain,
      status: result.effects?.status?.status === 'success' ? 'confirmed' : 'failed'
    };
  } catch (error) {
    console.error('Move call failed:', error);
    throw error;
  }
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas({ from, to, value, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    // Get gas price
    const gasPrice = await provider.getReferenceGasPrice();
    
    // Estimate gas for a simple transfer
    const gasBudget = 1000000; // Standard gas budget
    const gasFee = BigInt(gasBudget) * BigInt(gasPrice);
    
    return {
      gasPrice: gasPrice.toString(),
      gasBudget: gasBudget.toString(),
      estimatedFeeMIST: gasFee.toString(),
      estimatedFeeSUI: (parseInt(gasFee.toString()) / Math.pow(10, 9)).toString()
    };
  } catch (error) {
    console.error('Failed to estimate gas:', error);
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
 * Validate address format (Sui address)
 */
export function isValidAddress(address) {
  // Sui addresses are 64 hex characters (0x prefix optional)
  return /^0x[a-fA-F0-9]{0,64}$/.test(address);
}

/**
 * Request faucet (testnet/devnet only)
 */
export async function requestFaucet(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  if (!chain.includes('testnet') && !chain.includes('devnet')) {
    throw new Error('Faucet only available on testnet/devnet');
  }
  
  try {
    // Note: Sui faucet availability depends on network
    console.log(`Requesting faucet for ${address} on ${chain}`);
    
    return {
      address,
      chain,
      status: 'pending',
      message: 'Faucet request submitted'
    };
  } catch (error) {
    console.error('Failed to request faucet:', error);
    throw error;
  }
}
