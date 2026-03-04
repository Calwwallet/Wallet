/**
 * StarkNet Chain Service
 * 
 * Support for StarkNet (StarkEx) using starknet.js
 * Includes account abstraction, ERC-20 transfers, and native tokens
 */

import 'dotenv/config';
import { Account, Contract, Provider, stark, ec, hash, uint256 } from 'starknet';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const STARKNET_MAINNET = {
  id: '0x534e5f4d41494e', // SN_MAINNET
  name: 'StarkNet',
  network: 'mainnet-alpha',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://rpc.starknet.io'] },
    public: { http: ['https://rpc.starknet.io'] }
  },
  blockExplorers: {
    default: { name: 'Starkscan', url: 'https://starkscan.co' }
  }
};

const STARKNET_TESTNET = {
  id: '0x534e5f474f45524c49', // SN_GOERLI
  name: 'StarkNet Testnet',
  network: 'testnet-alpha',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: { http: ['https://rpc.starknet-testnet.co'] },
    public: { http: ['https://rpc.starknet-testnet.co'] }
  },
  blockExplorers: {
    default: { name: 'Starkscan', url: 'https://testnet.starkscan.co' }
  }
};

// ERC20 ABI for token transfers
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' }
    ],
    outputs: [{ name: 'retval', type: 'felt' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }]
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'felt' },
      { name: 'spender', type: 'felt' }
    ],
    outputs: [{ name: 'remaining', type: 'Uint256' }]
  },
  {
    name: 'transferFrom',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'felt' },
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' }
    ],
    outputs: [{ name: 'retval', type: 'felt' }]
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'felt' },
      { name: 'amount', type: 'Uint256' }
    ],
    outputs: [{ name: 'retval', type: 'felt' }]
  }
];

// Standard ERC20 token addresses on StarkNet
const TOKEN_ADDRESSES = {
  mainnet: {
    ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    USDC: '0x053c91253bc968ea04923ac3aec9e8bfc1e3440134390f1f1f0e02d2e6e8a5f',
    USDT: '0x068f5c6a61780768455de69077e07e1258781e4e5cbf39d8a1cdd0f3a8a7d5f'
  },
  testnet: {
    ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    USDC: '0x053c91253bc968ea04923ac3aec9e8bfc1e3440134390f1f1f0e02d2e6e8a5f',
    USDT: '0x068f5c6a61780768455de69077e07e1258781e4e5cbf39d8a1cdd0f3a8a7d5f'
  }
};

const CHAINS = {
  'starknet': {
    chain: STARKNET_MAINNET,
    rpcs: [
      process.env.STARKNET_MAINNET_RPC || 'https://rpc.starknet.io',
      'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_6'
    ].filter(Boolean),
    tokens: TOKEN_ADDRESSES.mainnet
  },
  'starknet-testnet': {
    chain: STARKNET_TESTNET,
    rpcs: [
      process.env.STARKNET_TESTNET_RPC || 'https://rpc.starknet-testnet.co',
      'https://starknet-testnet.g.alchemy.com/starknet/version/rpc/v0_6'
    ].filter(Boolean),
    tokens: TOKEN_ADDRESSES.testnet
  }
};

const DEFAULT_CHAIN = 'starknet-testnet';

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
 * Create a StarkNet provider with fallback RPCs
 */
async function createProvider(chainConfig) {
  const { rpcs } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const provider = new Provider({ sequencer: { network: chainConfig.chain.network } });
      // Test the connection
      await provider.getBlockNumber();
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
    testnet: key.includes('testnet'),
    type: 'cairo',
    nativeCurrency: CHAINS[key].chain.nativeCurrency,
    features: ['account-abstraction', 'erc20', 'native-starknet']
  }));
}

/**
 * Generate a random keypair
 */
function generateKeypair() {
  const privateKey = randomBytes(32).toString('hex');
  const starkKeyPair = ec.getKeyPair(privateKey);
  const starkPublicKey = ec.getStarkKey(starkKeyPair);
  
  return {
    privateKey,
    publicKey: starkPublicKey,
    keyPair: starkKeyPair
  };
}

/**
 * Create a new wallet on StarkNet
 */
export async function createWallet({ agentName, chain = DEFAULT_CHAIN, tenantId }) {
  try {
    const chainConfig = getChainConfig(chain);
    const { privateKey, publicKey } = generateKeypair();
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Derive address from public key using StarkNet's format
    // For account abstraction, the address is derived from the public key
    const address = hash.calculateContractAddressFromHash(publicKey, 0, []);

    const wallet = {
      id: walletId,
      agentName,
      address,
      privateKey: encrypt(privateKey), // Encrypted at rest
      publicKey,
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created StarkNet wallet for ${agentName}: ${address}`);

    return {
      id: walletId,
      address,
      publicKey,
      chain,
      chainId: chainConfig.chain.id,
      privateKeyHex: privateKey
    };
  } catch (error) {
    console.error('Failed to create StarkNet wallet:', error);
    throw error;
  }
}

/**
 * Get Account instance from encrypted or raw private key
 */
async function getAccount(privateKeyInput, address, chainConfig) {
  const { provider } = await createProvider(chainConfig);
  
  // Decrypt if encrypted
  let rawKey = privateKeyInput;
  if (privateKeyInput.includes(':') && privateKeyInput.split(':').length === 3) {
    rawKey = decrypt(privateKeyInput);
  }
  
  // For now, use the Account class with the provided private key
  // In production, you'd deploy an actual account contract
  return new Account(provider, address, rawKey);
}

/**
 * Get wallet balance (native ETH)
 */
export async function getBalance(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    // Get ETH balance using the provider
    const balance = await provider.getBalance(address);
    
    // Convert to ETH (balance is in wei/lovelace)
    const balanceEth = (parseInt(balance.toString()) / Math.pow(10, 18)).toString();
    
    return {
      address,
      chain,
      balance: balanceEth,
      balanceWei: balance.toString(),
      nativeCurrency: chainConfig.chain.nativeCurrency
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Get native token balance (ETH)
 */
export async function getNativeBalance(address, chain = DEFAULT_CHAIN) {
  return getBalance(address, chain);
}

/**
 * Transfer native tokens (ETH)
 * Note: StarkNet uses account abstraction, so we need to deploy an account first
 * or use thefee transfer mechanism
 */
export async function transfer({ 
  fromPrivateKey, 
  fromAddress,
  to, 
  amount, 
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const account = await getAccount(fromPrivateKey, fromAddress, chainConfig);
    
    // Convert amount to wei (18 decimals)
    const amountWei = uint256.bnToUint256(BigInt(Math.round(amount * Math.pow(10, 18))));
    
    // Execute transfer via account
    const tx = await account.execute({
      contractAddress: chainConfig.tokens.ETH, // ETH contract
      entrypoint: 'transfer',
      calldata: [
        to, // recipient
        amountWei.low, // amount low
        amountWei.high // amount high
      ]
    });

    return {
      hash: tx.transaction_hash,
      from: fromAddress,
      to,
      amount: amount.toString(),
      chain,
      status: 'submitted'
    };
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(address, tokenAddress, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    const tokenContract = new Contract(ERC20_ABI, tokenAddress, provider);
    const balance = await tokenContract.balanceOf(address);
    
    // Uint256 returned as [low, high]
    const balanceNum = uint256.uint256ToBN({
      low: balance[0],
      high: balance[1]
    });
    
    return {
      address,
      tokenAddress,
      balance: (balanceNum / BigInt(Math.pow(10, 18))).toString()
    };
  } catch (error) {
    console.error('Failed to get token balance:', error);
    throw error;
  }
}

/**
 * Transfer ERC20 tokens
 */
export async function transferToken({ 
  fromPrivateKey, 
  fromAddress,
  to, 
  amount, 
  tokenAddress,
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const account = await getAccount(fromPrivateKey, fromAddress, chainConfig);
    
    // Convert amount to Uint256 (18 decimals standard)
    const amountUint256 = uint256.bnToUint256(BigInt(Math.round(amount * Math.pow(10, 18))));
    
    // Execute transfer via account
    const tx = await account.execute({
      contractAddress: tokenAddress,
      entrypoint: 'transfer',
      calldata: [
        to, // recipient
        amountUint256.low, // amount low
        amountUint256.high // amount high
      ]
    });

    return {
      hash: tx.transaction_hash,
      from: fromAddress,
      to,
      amount: amount.toString(),
      tokenAddress,
      chain,
      status: 'submitted'
    };
  } catch (error) {
    console.error('Token transfer failed:', error);
    throw error;
  }
}

/**
 * Deploy account (account abstraction)
 * 
 * Note: On StarkNet, all wallets are smart contract accounts.
 * This function creates and deploys an account contract.
 */
export async function deployAccount({ privateKey, publicKey, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    // For OpenZeppelin account:
    // 1. Precompute address
    // 2. Fund the address with ETH for deployment
    // 3. Deploy the account
    
    // This is a simplified version - actual implementation would use
    // account contracts like OpenZeppelin's AccountUpgradeable
    
    const accountAddress = hash.calculateContractAddressFromHash(publicKey, 0, []);
    
    return {
      address: accountAddress,
      publicKey,
      deployed: false, // Requires funding and actual deployment
      message: 'Account requires ETH funding for deployment'
    };
  } catch (error) {
    console.error('Failed to deploy account:', error);
    throw error;
  }
}

/**
 * Get transaction receipt/status
 */
export async function getTransactionReceipt(txHash, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    const tx = await provider.getTransactionReceipt(txHash);
    
    return {
      hash: txHash,
      status: tx.status === 'ACCEPTED_ON_L2' || tx.status === 'ACCEPTED_ON_L1' ? 'confirmed' : 'pending',
      blockNumber: tx.block_number,
      actualFee: tx.actual_fee
    };
  } catch (error) {
    console.error('Failed to get transaction receipt:', error);
    throw error;
  }
}

/**
 * Estimate fee for a transaction
 */
export async function estimateFee({ from, to, value, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { provider } = await createProvider(chainConfig);
    
    // Get estimate by simulating the transaction
    const account = await getAccount(
      '0x0', // dummy private key for estimation
      from,
      chainConfig
    );
    
    const fee = await account.estimateFee({
      contractAddress: chainConfig.tokens.ETH,
      entrypoint: 'transfer',
      calldata: [
        to,
        uint256.bnToUint256(BigInt(Math.round(value * Math.pow(10, 18)))).low,
        uint256.bnToUint256(BigInt(Math.round(value * Math.pow(10, 18)))).high
      ]
    });
    
    return {
      gasLimit: fee.overall_fee.toString(),
      gasPrice: fee.gas_price.toString(),
      suggestedMaxFee: fee.suggestedMaxFee.toString()
    };
  } catch (error) {
    console.error('Failed to estimate fee:', error);
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
 * Validate address format (StarkNet address)
 */
export function isValidAddress(address) {
  // StarkNet addresses are 64 hex characters (0x prefix)
  return /^0x[a-fA-F0-9]{1,64}$/.test(address);
}

/**
 * Get supported tokens
 */
export function getSupportedTokens(chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  return Object.entries(chainConfig.tokens).map(([symbol, address]) => ({
    symbol,
    address
  }));
}
