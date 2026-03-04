/**
 * Solana Chain Service
 * 
 * Support for Solana blockchain using @solana/web3.js
 * Includes SPL token transfers and transaction signing
 */

import 'dotenv/config';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getMint,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const SOLANA_MAINNET = {
  id: 0x01, // Solana mainnet
  name: 'Solana',
  network: 'mainnet-beta',
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://api.mainnet-beta.solana.com'] },
    public: { http: ['https://api.mainnet-beta.solana.com'] }
  },
  blockExplorers: {
    default: { name: 'Solana Explorer', url: 'https://explorer.solana.com' }
  }
};

const SOLANA_DEVNET = {
  id: 0x02, // Solana devnet
  name: 'Solana Devnet',
  network: 'devnet',
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://api.devnet.solana.com'] },
    public: { http: ['https://api.devnet.solana.com'] }
  },
  blockExplorers: {
    default: { name: 'Solana Explorer', url: 'https://explorer.solana.com/?cluster=devnet' }
  }
};

const SOLANA_TESTNET = {
  id: 0x03, // Solana testnet
  name: 'Solana Testnet',
  network: 'testnet',
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9
  },
  rpcUrls: {
    default: { http: ['https://api.testnet.solana.com'] },
    public: { http: ['https://api.testnet.solana.com'] }
  },
  blockExplorers: {
    default: { name: 'Solana Explorer', url: 'https://explorer.solana.com/?cluster=testnet' }
  }
};

const CHAINS = {
  'solana': {
    chain: SOLANA_MAINNET,
    rpcs: [
      process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
      'https://solana-mainnet.g.alchemy.com/v2/demo',
      'https://rpc.ankr.com/solana'
    ].filter(Boolean),
    commitment: 'confirmed'
  },
  'solana-devnet': {
    chain: SOLANA_DEVNET,
    rpcs: [
      process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
    ].filter(Boolean),
    commitment: 'confirmed'
  },
  'solana-testnet': {
    chain: SOLANA_TESTNET,
    rpcs: [
      process.env.SOLANA_TESTNET_RPC || 'https://api.testnet.solana.com'
    ].filter(Boolean),
    commitment: 'confirmed'
  }
};

const DEFAULT_CHAIN = 'solana-devnet';

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
 * Create a connection with fallback RPCs
 */
async function createConnection(chainConfig) {
  const { rpcs, commitment } = chainConfig;

  for (const rpc of rpcs) {
    try {
      const connection = new Connection(rpc, commitment);
      // Test the connection
      await connection.getVersion();
      return { connection, rpc };
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
    testnet: key.includes('devnet') || key.includes('testnet'),
    type: 'non-evm',
    nativeCurrency: CHAINS[key].chain.nativeCurrency,
    features: ['spl-tokens', 'nfts']
  }));
}

/**
 * Generate a random keypair (wallet)
 */
function generateKeypair() {
  return Keypair.generate();
}

/**
 * Create a new wallet on Solana
 */
export async function createWallet({ agentName, chain = DEFAULT_CHAIN, tenantId }) {
  try {
    const chainConfig = getChainConfig(chain);
    const keypair = generateKeypair();
    const walletId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const rawPrivateKey = Buffer.from(keypair.secretKey).toString('base64');
    const wallet = {
      id: walletId,
      agentName,
      address: keypair.publicKey.toBase58(),
      privateKey: encrypt(rawPrivateKey), // Encrypted at rest
      chain,
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Created Solana wallet for ${agentName}: ${keypair.publicKey.toBase58()}`);

    return {
      id: walletId,
      address: keypair.publicKey.toBase58(),
      chain,
      chainId: chainConfig.chain.id,
      privateKeyBase64: wallet.privateKey
    };
  } catch (error) {
    console.error('Failed to create Solana wallet:', error);
    throw error;
  }
}

/**
 * Get wallet from encrypted or raw private key
 * Automatically detects if key is encrypted and decrypts if needed
 */
function getKeypairFromPrivateKey(privateKeyInput) {
  let rawKey = privateKeyInput;
  
  // Check if key is encrypted (format: iv:authTag:encrypted)
  if (privateKeyInput.includes(':') && privateKeyInput.split(':').length === 3) {
    rawKey = decrypt(privateKeyInput);
  }
  
  const secretKey = Buffer.from(rawKey, 'base64');
  return Keypair.fromSecretKey(secretKey);
}

function formatTokenAmount(amount, decimals) {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (decimals <= 0) return value.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionString}`;
}

/**
 * Get wallet balance (SOL)
 */
export async function getBalance(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const publicKey = new PublicKey(address);
    const balance = await connection.getBalance(publicKey);
    
    return {
      address,
      chain,
      balance: (balance / LAMPORTS_PER_SOL).toString(),
      balanceLamports: balance.toString(),
      nativeCurrency: chainConfig.chain.nativeCurrency
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Get native token balance (SOL)
 */
export async function getNativeBalance(address, chain = DEFAULT_CHAIN) {
  return getBalance(address, chain);
}

/**
 * Transfer native tokens (SOL)
 */
export async function transfer({ 
  fromPrivateKey, 
  to, 
  amount, 
  chain = DEFAULT_CHAIN 
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const fromKeypair = getKeypairFromPrivateKey(fromPrivateKey);
    const toPublicKey = new PublicKey(to);
    
    // Create transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toPublicKey,
        lamports: Math.round(amount * LAMPORTS_PER_SOL)
      })
    );

    // Sign and send transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [fromKeypair]
    );

    return {
      hash: signature,
      from: fromKeypair.publicKey.toBase58(),
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
 * Get SPL token balance
 */
export async function getTokenBalance(address, tokenMintAddress, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const tokenPublicKey = new PublicKey(tokenMintAddress);
    const walletPublicKey = new PublicKey(address);
    const mintInfo = await getMint(connection, tokenPublicKey);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
      mint: tokenPublicKey
    });
    const tokenAmountRaw = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount || '0';
    
    return {
      address,
      tokenMint: tokenMintAddress,
      balance: formatTokenAmount(tokenAmountRaw, mintInfo.decimals),
      decimals: mintInfo.decimals
    };
  } catch (error) {
    console.error('Failed to get token balance:', error);
    throw error;
  }
}

/**
 * Transfer SPL tokens
 */
export async function transferToken({ 
  fromPrivateKey, 
  to, 
  amount, 
  tokenMintAddress,
  chain = DEFAULT_CHAIN
}) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const fromKeypair = getKeypairFromPrivateKey(fromPrivateKey);
    const toPublicKey = new PublicKey(to);
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const mintInfo = await getMint(connection, mintPublicKey);
    const decimals = mintInfo.decimals;
    const scaledAmount = BigInt(Math.round(Number(amount) * Math.pow(10, decimals)));
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      mintPublicKey,
      fromKeypair.publicKey
    );
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      mintPublicKey,
      toPublicKey
    );
    
    // Create transfer transaction
    const transaction = new Transaction().add(
      createTransferInstruction(
        fromTokenAccount.address,
        toTokenAccount.address,
        fromKeypair.publicKey,
        scaledAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Sign and send transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [fromKeypair]
    );

    return {
      hash: signature,
      from: fromKeypair.publicKey.toBase58(),
      to,
      amount: amount.toString(),
      tokenMint: tokenMintAddress,
      chain,
      status: 'confirmed'
    };
  } catch (error) {
    console.error('Token transfer failed:', error);
    throw error;
  }
}

/**
 * Get all token accounts for a wallet
 */
export async function getTokenAccounts(address, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const publicKey = new PublicKey(address);
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID
    });
    
    return tokenAccounts.value.map(account => ({
      mint: account.account.data.parsed.info.mint,
      address: account.pubkey.toBase58(),
      balance: account.account.data.parsed.info.tokenAmount.uiAmountString,
      decimals: account.account.data.parsed.info.tokenAmount.decimals
    }));
  } catch (error) {
    console.error('Failed to get token accounts:', error);
    throw error;
  }
}

/**
 * Estimate transaction fee
 */
export async function estimateFee({ from, to, amount, chain = DEFAULT_CHAIN }) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const fromPublicKey = new PublicKey(from);
    const toPublicKey = new PublicKey(to);
    
    // Create a test transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromPublicKey,
        toPubkey: toPublicKey,
        lamports: Math.round(amount * LAMPORTS_PER_SOL)
      })
    );
    
    // Get fee
    const fee = await transaction.getEstimatedFee(connection);
    
    return {
      feeLamports: fee.toString(),
      feeSol: (fee / LAMPORTS_PER_SOL).toString()
    };
  } catch (error) {
    console.error('Failed to estimate fee:', error);
    throw error;
  }
}

/**
 * Get transaction receipt/status
 */
export async function getTransactionReceipt(txHash, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  try {
    const { connection } = await createConnection(chainConfig);
    const tx = await connection.getParsedTransaction(txHash);
    
    if (!tx) {
      return { status: 'not_found' };
    }
    
    return {
      hash: txHash,
      status: tx.meta?.err ? 'failed' : 'confirmed',
      slot: tx.slot,
      blockTime: tx.blockTime
    };
  } catch (error) {
    console.error('Failed to get transaction:', error);
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
 * Validate address format (Solana base58)
 */
export function isValidAddress(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Airdrop SOL (devnet/testnet only)
 */
export async function airdrop(address, amount = 1, chain = DEFAULT_CHAIN) {
  const chainConfig = getChainConfig(chain);
  
  if (!chain.includes('devnet') && !chain.includes('testnet')) {
    throw new Error('Airdrop only available on devnet/testnet');
  }
  
  try {
    const { connection } = await createConnection(chainConfig);
    const publicKey = new PublicKey(address);
    
    const signature = await connection.requestAirdrop(
      publicKey,
      Math.round(amount * LAMPORTS_PER_SOL)
    );
    
    // Confirm the airdrop
    await connection.confirmTransaction(signature);
    
    return {
      hash: signature,
      address,
      amount: amount.toString(),
      chain,
      status: 'confirmed'
    };
  } catch (error) {
    console.error('Airdrop failed:', error);
    throw error;
  }
}
