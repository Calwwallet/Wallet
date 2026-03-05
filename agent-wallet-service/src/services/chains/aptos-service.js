/**
 * Aptos Chain Service
 * 
 * Support for Aptos blockchain using @aptos-js
 * Includes account creation, coin transfers, and Move module interactions
 */

import 'dotenv/config';
import { Account, Aptos, AptosConfig, Network, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const APTOS_MAINNET = {
  id: 1,
  name: 'Aptos',
  network: 'mainnet',
  nativeCurrency: {
    name: 'Aptos',
    symbol: 'APT',
    decimals: 8
  },
  rpcUrls: {
    default: { http: ['https://api.mainnet.aptoslabs.com'] },
    public: { http: ['https://api.mainnet.aptoslabs.com'] }
  },
  blockExplorers: {
    default: { name: 'Aptos Explorer', url: 'https://explorer.aptoslabs.com' }
  }
};

const APTOS_TESTNET = {
  id: 2,
  name: 'Aptos Testnet',
  network: 'testnet',
  nativeCurrency: {
    name: 'Aptos',
    symbol: 'APT',
    decimals: 8
  },
  rpcUrls: {
    default: { http: ['https://api.testnet.aptoslabs.com'] },
    public: { http: ['https://api.testnet.aptoslabs.com'] }
  },
  blockExplorers: {
    default: { name: 'Aptos Explorer', url: 'https://explorer.aptoslabs.com/?network=testnet' }
  }
};

const APTOS_DEVNET = {
  id: 3,
  name: 'Aptos Devnet',
  network: 'devnet',
  nativeCurrency: {
    name: 'Aptos',
    symbol: 'APT',
    decimals: 8
  },
  rpcUrls: {
    default: { http: ['https://api.devnet.aptoslabs.com'] },
    public: { http: ['https://api.devnet.aptoslabs.com'] }
  },
  blockExplorers: {
    default: { name: 'Aptos Explorer', url: 'https://explorer.aptoslabs.com/?network=devnet' }
  }
};

const CHAINS = {
  'aptos': {
    chain: APTOS_MAINNET,
    rpcs: [
      process.env.APTOS_MAINNET_RPC || 'https://api.mainnet.aptoslabs.com'
    ].filter(Boolean)
  },
  'aptos-testnet': {
    chain: APTOS_TESTNET,
    rpcs: [
      process.env.APTOS_TESTNET_RPC || 'https://api.testnet.aptoslabs.com'
    ].filter(Boolean)
  },
  'aptos-devnet': {
    chain: APTOS_DEVNET,
    rpcs: [
      process.env.APTOS_DEVNET_RPC || 'https://api.devnet.aptoslabs.com'
    ].filter(Boolean)
  }
};

const DEFAULT_CHAIN = 'aptos-testnet';

// APT coin type - used for native APT transfers
const APT_COIN_TYPE = '0x1::aptos_coin::AptosCoin';

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
 * Create an Aptos client with fallback RPCs
 */
async function createClient(chainConfig) {
  const { rpcs } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const client = new Aptos(new AptosConfig({
        network: Network.CUSTOM,
        fullnode: rpc.endsWith('/v1') ? rpc : `${rpc}/v1`
      }));
      // Test the connection
      await client.getLedgerInfo();
      return { client, rpc };
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
    features: ['move-modules', 'aptos-coin', 'fungible-assets']
  }));
}

/**
 * Generate a random keypair (wallet)
 */
function generateKeypair() {
  return Account.generate();
}

/**
 * Create a new wallet on Aptos
 */
export async function createWallet({ agentName, chain = DEFAULT_CHAIN, tenantId }) {
  try {
    const chainConfig = getChainConfig(chain);
    const account = generateKeypair();
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const wallet = {
      id: walletId,
      agentName,
      address: account.accountAddress.toString(),
      privateKey: account.privateKey.toString().replace('ed25519-priv-', '').replace('0x', ''), // Hex encoded
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created Aptos wallet for ${agentName}: ${account.accountAddress.toString()}`);

    return {
      id: walletId,
      address: account.accountAddress.toString(),
      chain,
      chainId: chainConfig.chain.id,
      privateKeyHex: wallet.privateKey
    };
  } catch (error) {
    console.error('Failed to create Aptos wallet:', error);
    throw error;
  }
}

/**
 * Get wallet from hex private key
 */
function getAccountFromHex(privateKeyHex) {
  const normalized = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`;
  const privateKey = new Ed25519PrivateKey(normalized);
  return Account.fromPrivateKey({ privateKey });
}

/**
 * Get wallet balance (APT)
 */
export async function getBalance(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    
    const resources = await client.getAccountResources({ accountAddress: address });
    const aptCoinResource = resources.find(r => r.type === `0x1::coin::CoinStore<${APT_COIN_TYPE}>`);
    
    let balance = '0';
    if (aptCoinResource && aptCoinResource.data) {
      balance = (parseInt(aptCoinResource.data.coin.value) / Math.pow(10, 8)).toString();
    }
    
    return {
      address,
      chain,
      balance,
      nativeCurrency: chainConfig.chain.nativeCurrency
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Get native token balance (APT)
 */
export async function getNativeBalance(address, chain = DEFAULT_CHAIN) {
  return getBalance(address, chain);
}

/**
 * Transfer native tokens (APT)
 */
export async function transfer({ 
  fromPrivateKeyHex, 
  to, 
  amount, 
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    const sender = getAccountFromHex(fromPrivateKeyHex);
    
    // Convert amount to octas (8 decimals)
    const amountOctas = Math.round(amount * Math.pow(10, 8));
    
    const transaction = await client.transaction.build.simple({
      sender: sender.accountAddress,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [to, amountOctas]
      },
      options: {
        maxGasAmount: 2000,
        gasUnitPrice: 100
      }
    });

    const result = await client.signAndSubmitTransaction({
      signer: sender,
      transaction
    });

    await client.waitForTransaction({ transactionHash: result.hash });

    return {
      hash: result.hash,
      from: sender.accountAddress.toString(),
      to,
      amount: amount.toString(),
      chain,
      status: 'confirmed'
    };
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

/**
 * Get fungible asset balance (for newer token standard)
 */
export async function getFungibleAssetBalance(address, assetType, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    
    const resources = await client.getAccountResources({ accountAddress: address });
    const faStoreResource = resources.find(r => 
      r.type.includes('0x1::fungible_asset::Store') && r.type.includes(assetType)
    );
    
    if (!faStoreResource) {
      return { address, balance: '0', assetType };
    }
    
    const balance = (parseInt(faStoreResource.data.balance) / Math.pow(10, 6)).toString();
    
    return {
      address,
      balance,
      assetType,
      nativeCurrency: { name: 'Unknown', symbol: 'UNKNOWN', decimals: 6 }
    };
  } catch (error) {
    console.error('Failed to get fungible asset balance:', error);
    throw error;
  }
}

/**
 * Transfer fungible assets
 */
export async function transferFungibleAsset({ 
  fromPrivateKeyHex, 
  to, 
  amount, 
  assetType,
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    const sender = getAccountFromHex(fromPrivateKeyHex);
    
    // Convert amount to smallest unit (6 decimals for fungible assets)
    const amountSmallest = Math.round(amount * Math.pow(10, 6));
    
    const transaction = await client.transaction.build.simple({
      sender: sender.accountAddress,
      data: {
        function: '0x1::fungible_asset::transfer',
        typeArguments: [assetType],
        functionArguments: [
          sender.accountAddress.toString(),
          to,
          amountSmallest
        ]
      },
      options: {
        maxGasAmount: 2000,
        gasUnitPrice: 100
      }
    });

    const result = await client.signAndSubmitTransaction({
      signer: sender,
      transaction
    });

    await client.waitForTransaction({ transactionHash: result.hash });

    return {
      hash: result.hash,
      from: sender.accountAddress.toString(),
      to,
      amount: amount.toString(),
      assetType,
      chain,
      status: 'confirmed'
    };
  } catch (error) {
    console.error('Fungible asset transfer failed:', error);
    throw error;
  }
}

/**
 * Get account resources
 */
export async function getAccountResources(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    const resources = await client.getAccountResources({ accountAddress: address });
    
    return resources.map(r => ({
      type: r.type,
      data: r.data
    }));
  } catch (error) {
    console.error('Failed to get account resources:', error);
    throw error;
  }
}

/**
 * Get transaction by hash
 */
export async function getTransaction(txHash, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    const txn = await client.getTransactionByHash({ transactionHash: txHash });
    
    return {
      hash: txHash,
      status: txn.success ? 'confirmed' : 'failed',
      type: txn.type,
      vm_status: txn.vm_status
    };
  } catch (error) {
    console.error('Failed to get transaction:', error);
    throw error;
  }
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas({ from, to, value, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { client } = await createClient(chainConfig);
    
    const simulationSigner = Account.generate();
    const transaction = await client.transaction.build.simple({
      sender: from,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [to, Math.round(value * Math.pow(10, 8))]
      },
      options: {
        maxGasAmount: 2000,
        gasUnitPrice: 100
      }
    });

    const simulation = await client.transaction.simulate.simple({
      signerPublicKey: simulationSigner.publicKey,
      transaction
    });
    
    if (simulation && simulation.length > 0) {
      return {
        gasUsed: simulation[0].gas_used,
        gasUnitPrice: simulation[0].gas_unit_price,
        success: simulation[0].success
      };
    }
    
    return {
      gasUsed: '2000',
      gasUnitPrice: '100',
      success: true
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
 * Validate address format (Aptos address)
 */
export function isValidAddress(address) {
  // Aptos addresses are 64 hex characters (0x prefix optional)
  return /^0x[a-fA-F0-9]{0,64}$/.test(address);
}

/**
 * Fund account (faucet - testnet/devnet only)
 */
export async function fundAccount(address, amount = 1, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  if (!chain.includes('testnet') && !chain.includes('devnet')) {
    throw new Error('Faucet only available on testnet/devnet');
  }
  
  try {
    const { client } = await createClient(chainConfig);
    
    // Note: On testnet, use the faucet API directly
    // This is a placeholder - actual implementation depends on faucet availability
    console.log(`Funding ${address} with ${amount} APT on ${chain}`);
    
    return {
      address,
      amount: amount.toString(),
      chain,
      status: 'pending'
    };
  } catch (error) {
    console.error('Failed to fund account:', error);
    throw error;
  }
}
