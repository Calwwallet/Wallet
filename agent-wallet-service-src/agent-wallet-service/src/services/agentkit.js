/**
 * AgentKit Wallet Service
 * 
 * Manages AI agent wallets using Coinbase AgentKit
 */

import { CdpWalletProvider } from '@coinbase/agentkit';

// Store wallets in memory (TODO: use proper DB)
const wallets = new Map();

/**
 * Create a new wallet for an AI agent
 */
export async function createWallet({ agentName, chain = 'base-sepolia' }) {
  // Check for CDP API credentials
  if (!process.env.CDP_API_KEY_NAME || !process.env.CDP_API_KEY_PRIVATE_KEY) {
    throw new Error('CDP API credentials not configured. Set CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE_KEY');
  }

  try {
    // Initialize CDP wallet provider
    const walletProvider = await CdpWalletProvider.configureWithWallet({
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
      networkId: chain,
    });

    const address = walletProvider.getAddress();
    const walletId = `wallet_${Date.now()}`;

    // Store wallet
    wallets.set(walletId, {
      id: walletId,
      agentName,
      address,
      chain,
      provider: walletProvider,
      createdAt: new Date().toISOString()
    });

    console.log(`✅ Created wallet for ${agentName}: ${address}`);

    return {
      id: walletId,
      address,
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
export async function getBalance(address, chain = 'base-sepolia') {
  // Find wallet by address
  const wallet = Array.from(wallets.values()).find(w => w.address === address);
  
  if (!wallet) {
    throw new Error(`Wallet not found: ${address}`);
  }

  try {
    const balance = await wallet.provider.getBalance();
    return {
      eth: balance.toString(),
      wei: balance.toString()
    };
  } catch (error) {
    console.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Sign a transaction
 */
export async function signTransaction({ from, to, value, data }) {
  // Find wallet
  const wallet = Array.from(wallets.values()).find(w => w.address === from);
  
  if (!wallet) {
    throw new Error(`Wallet not found: ${from}`);
  }

  try {
    const txHash = await wallet.provider.sendTransaction({
      to,
      value: BigInt(value),
      data
    });

    console.log(`✅ Transaction signed: ${txHash}`);

    return {
      hash: txHash,
      from,
      to,
      value,
      data
    };
  } catch (error) {
    console.error('Failed to sign transaction:', error);
    throw error;
  }
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
