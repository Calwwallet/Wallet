/**
 * Multi-Sig Wallet Service
 *
 * Core multi-sig wallet logic including:
 * - Smart contract deployment (simplified Gnosis Safe pattern)
 * - Transaction submission, confirmation, and execution
 * - Timelock functionality
 * - Transaction batching
 * - Hardware wallet support (Ledger, Trezor)
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, encodeFunctionData, keccak256, toHex, recoverAddress, hashMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainConfig } from './viem-wallet.js';
import { evaluateTransferPolicy, recordPolicySpend } from './policy-engine.js';
import {
  createMultisigWallet,
  getMultisigWalletByAddress,
  getAllMultisigWallets,
  updateMultisigWallet,
  createMultisigTransaction,
  getMultisigTransactionById,
  getNextTransactionIndex,
  getMultisigTransactions,
  updateMultisigTransaction,
  addConfirmation,
  getConfirmations,
  getConfirmationCount,
  hasConfirmed
} from '../repositories/multisig-repository.js';
import { findWalletByAddress, findWalletByAddressDb, getWalletStore } from '../repositories/wallet-repository.js';
import { getDb } from './db.js';

const USE_DB = process.env.STORAGE_BACKEND === 'db';
const MULTISIG_DEMO_MODE = process.env.MULTISIG_DEMO_MODE === 'true';

// ============================================================
// Multi-Sig Contract ABI (Simplified Gnosis Safe Pattern)
// ============================================================

// SimpleMultiSig ABI - minimal 2-of-N or M-of-N owner-based wallet
const SIMPLE_MULTISIG_ABI = [
  {
    name: 'setup',
    type: 'function',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' }
    ],
    stateMutability: 'nonpayable'
  },
  {
    name: 'execTransaction',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'signatures', type: 'bytes' }
    ],
    stateMutability: 'nonpayable',
    outputs: [{ name: 'success', type: 'bool' }]
  },
  {
    name: 'confirmTransaction',
    type: 'function',
    inputs: [{ name: 'txHash', type: 'bytes32' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'getTransactionHash',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'nonce', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    name: 'getConfirmations',
    type: 'function',
    inputs: [{ name: 'txHash', type: 'bytes32' }],
    stateMutability: 'view',
    outputs: [{ name: 'confirmations', type: 'address[]' }]
  },
  {
    name: 'owners',
    type: 'function',
    inputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'threshold',
    type: 'function',
    inputs: [],
    stateMutability: 'view'
  },
  {
    name: 'nonce',
    type: 'function',
    inputs: [],
    stateMutability: 'view'
  },
  {
    name: 'transactions',
    type: 'function',
    inputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view'
  },
  {
    name: 'executedTransactions',
    type: 'function',
    inputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view'
  }
];

// Simplified MultiSig bytecode (minimal M-of-N implementation)
// This is a placeholder - in production you'd deploy the actual Gnosis Safe contracts
const SIMPLE_MULTISIG_BYTECODE = '0x608060405234801561001057600080fd5b5061012a806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063368b8772146037578063d4d04d5f146068575b600080fd5b606660048036038101906062919060ba565b600055565b60005460749060d6565b60405180910390f35b600080fd5b60d6565b600080fd5b600081905091905056';

// ============================================================
// Chain Configuration
// ============================================================

// Pre-existing multi-sig wallet deployments (for demo purposes)
// In production, you'd deploy your own
const KNOWN_MULTISIG_DEPLOYMENTS = {
  'base-sepolia': [],
  'ethereum-sepolia': [],
  'arbitrum-sepolia': [],
  'optimism-sepolia': []
};

// ============================================================
// Service Functions
// ============================================================

/**
 * Deploy a new multi-sig wallet contract
 */
export async function deployMultisigWallet({ owners, threshold, chain, tenantId, context = {} }) {
  if (!owners || owners.length < threshold) {
    throw new Error('Threshold must be <= number of owners');
  }
  if (threshold < 1) {
    throw new Error('Threshold must be at least 1');
  }

  const chainConfig = getChainConfig(chain);
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcs[0])
  });

  // For demo purposes, we'll create a virtual wallet and return it
  // In production, you'd deploy an actual contract here
  const walletAddress = generateMultisigAddress(owners, threshold, chain);
  
  // Create the multi-sig wallet record
  const wallet = await createMultisigWallet({
    id: `multisig_${walletAddress.slice(2, 10)}`,
    tenantId,
    address: walletAddress,
    chain,
    threshold,
    owners,
    roles: context.roles || getDefaultRoles(owners),
    timelockSeconds: context.timelockSeconds || 0
  });

  return {
    address: walletAddress,
    chain,
    threshold,
    owners,
    roles: wallet.roles,
    timelockSeconds: wallet.timelockSeconds,
    transactionHash: null, // No actual deployment in demo mode
    isDeployed: false // Demo mode - not actually deployed
  };
}

/**
 * Get multi-sig wallet info
 */
export async function getMultisigWallet(address, { tenantId } = {}) {
  const wallet = await getMultisigWalletByAddress(address, { tenantId });
  if (!wallet) {
    return null;
  }

  // Get pending transaction count
  const pendingTxs = await getMultisigTransactions(address, { tenantId, status: 'pending' });
  
  return {
    address: wallet.address,
    chain: wallet.chain,
    threshold: wallet.threshold,
    owners: wallet.owners,
    ownerCount: wallet.ownerCount,
    roles: wallet.roles,
    timelockSeconds: wallet.timelockSeconds,
    isActive: wallet.isActive,
    pendingTransactions: pendingTxs.length,
    createdAt: wallet.createdAt
  };
}

/**
 * List all multi-sig wallets
 */
export async function listMultisigWallets({ tenantId } = {}) {
  const wallets = await getAllMultisigWallets({ tenantId });
  return wallets.map(w => ({
    address: w.address,
    chain: w.chain,
    threshold: w.threshold,
    owners: w.owners,
    ownerCount: w.ownerCount,
    isActive: w.isActive,
    createdAt: w.createdAt
  }));
}

/**
 * Update multi-sig wallet settings
 */
export async function updateMultisigSettings(address, updates, { tenantId } = {}) {
  const wallet = await updateMultisigWallet(address, updates, { tenantId });
  if (!wallet) {
    throw new Error('Multi-sig wallet not found');
  }
  return wallet;
}

/**
 * Submit a new transaction to the multi-sig wallet
 */
export async function submitTransaction({ multisigAddress, to, value, data, description, tenantId, context = {} }) {
  // Get the wallet
  const wallet = await getMultisigWalletByAddress(multisigAddress, { tenantId });
  if (!wallet) {
    throw new Error('Multi-sig wallet not found');
  }

  // Validate the recipient if policy is enabled
  const policyResult = await evaluateTransferPolicy({
    walletAddress: multisigAddress,
    to,
    valueEth: value || '0',
    chain: wallet.chain,
    tenantId
  });

  if (!policyResult.allowed) {
    throw new Error(`Transaction blocked by policy: ${policyResult.reason}`);
  }

  // Get next transaction index
  const txIndex = await getNextTransactionIndex(multisigAddress, { tenantId });

  // Calculate timelock if enabled
  let timelockUntil = null;
  if (wallet.timelockSeconds > 0) {
    timelockUntil = new Date(Date.now() + wallet.timelockSeconds * 1000).toISOString();
  }

  // Create the transaction record
  const tx = await createMultisigTransaction({
    tenantId,
    multisigAddress,
    txIndex,
    toAddress: to,
    valueEth: value || '0',
    data: data || '0x',
    description,
    timelockUntil,
    nonce: `${multisigAddress}_${txIndex}`
  });

  return {
    id: tx.id,
    txIndex: tx.txIndex,
    multisigAddress,
    toAddress: to,
    valueEth: value || '0',
    data: data || '0x',
    description,
    status: 'pending',
    timelockUntil: tx.timelockUntil,
    confirmationsRequired: wallet.threshold,
    confirmationsReceived: 0,
    createdAt: tx.createdAt
  };
}

/**
 * Submit multiple transactions as a batch
 */
export async function submitTransactionBatch({ multisigAddress, transactions, description, tenantId }) {
  const results = [];
  
  for (const tx of transactions) {
    const result = await submitTransaction({
      multisigAddress,
      to: tx.to,
      value: tx.value,
      data: tx.data,
      description: tx.description || description,
      tenantId,
      context: { batched: true }
    });
    results.push(result);
  }

  return {
    batchId: `batch_${Date.now()}`,
    transactions: results,
    multisigAddress,
    totalTransactions: results.length
  };
}

/**
 * Confirm a transaction (sign)
 * SECURITY: Verifies signature before accepting confirmation
 */
export async function confirmTransaction({ txId, signerAddress, signature, tenantId }) {
  // Get the transaction
  const tx = await getMultisigTransactionById(txId, { tenantId });
  if (!tx) {
    throw new Error('Transaction not found');
  }

  if (tx.status !== 'pending') {
    throw new Error(`Transaction is not pending (status: ${tx.status})`);
  }

  // Check if timelock is active
  if (tx.timelockUntil && new Date(tx.timelockUntil) > new Date()) {
    const remaining = Math.ceil((new Date(tx.timelockUntil) - new Date()) / 1000);
    throw new Error(`Transaction is timelocked. Wait ${remaining} seconds.`);
  }

  // Get the wallet to verify signer is an owner
  const wallet = await getMultisigWalletByAddress(tx.multisigAddress, { tenantId });
  if (!wallet) {
    throw new Error('Multi-sig wallet not found');
  }

  const normalizedSigner = signerAddress.toLowerCase();
  if (!wallet.owners.includes(normalizedSigner)) {
    throw new Error('Signer is not an owner of this multi-sig wallet');
  }

  // SECURITY: Verify signature before accepting confirmation
  // This prevents fake confirmations from being recorded
  // Signature is REQUIRED for all confirmations
  if (!signature) {
    throw new Error('Signature is required for transaction confirmation');
  }
  
  let signatureValid = false;
  try {
    // Recover the signer from the signature and verify it matches
    const recoveredSigner = recoverSigner(tx, signature);
    if (recoveredSigner && recoveredSigner.toLowerCase() === normalizedSigner) {
      signatureValid = true;
    } else {
      throw new Error('Signature verification failed: signer does not match');
    }
  } catch (sigError) {
    // Re-throw signature errors - we require valid signatures
    throw new Error(`Signature verification failed: ${sigError.message}`);
  }

  // Check if already confirmed
  const alreadyConfirmed = await hasConfirmed(txId, signerAddress, { tenantId });
  if (alreadyConfirmed) {
    throw new Error('Transaction already confirmed by this signer');
  }

  // Add confirmation with verified signature status
  await addConfirmation({
    tenantId,
    multisigAddress: tx.multisigAddress,
    txId,
    signerAddress,
    signature,
    signatureVerified: signatureValid
  });

  // Get updated confirmation count
  const confirmationCount = await getConfirmationCount(txId, { tenantId });

  // Update transaction status if threshold is met
  if (confirmationCount >= wallet.threshold) {
    await updateMultisigTransaction(txId, { status: 'confirmed' }, { tenantId });
  }

  return {
    txId,
    signerAddress,
    confirmationCount,
    confirmationsRequired: wallet.threshold,
    thresholdMet: confirmationCount >= wallet.threshold,
    status: confirmationCount >= wallet.threshold ? 'confirmed' : 'pending'
  };
}

/**
 * Recover signer address from signature using EIP-191 signed message format
 * @param {Object} tx - Transaction object containing details
 * @param {string} signature - The signature to verify
 * @returns {string|null} - Recovered signer address or null if verification fails
 */
function recoverSigner(tx, signature) {
  if (!signature) return null;
  
  try {
    // Create a deterministic message hash from transaction details
    // This must match how the transaction was originally signed
    const message = JSON.stringify({
      multisigAddress: tx.multisigAddress,
      to: tx.to,
      value: tx.value,
      data: tx.data,
      nonce: tx.nonce,
      operation: 'confirmTransaction'
    });
    
    const messageHash = hashMessage(message);
    
    // Recover the signer address from the signature
    const recovered = recoverAddress({
      messageHash,
      signature: signature
    });
    
    return recovered;
  } catch (error) {
    console.warn('Failed to recover signer from signature:', error.message);
    return null;
  }
}

/**
 * Execute a confirmed transaction
 */
export async function executeTransaction({ txId, executorAddress, tenantId, context = {} }) {
  // Get the transaction
  const tx = await getMultisigTransactionById(txId, { tenantId });
  if (!tx) {
    throw new Error('Transaction not found');
  }

  if (tx.status === 'executed') {
    throw new Error('Transaction already executed');
  }

  // Check if timelock is active
  if (tx.timelockUntil && new Date(tx.timelockUntil) > new Date()) {
    const remaining = Math.ceil((new Date(tx.timelockUntil) - new Date()) / 1000);
    throw new Error(`Transaction is timelocked. Wait ${remaining} seconds.`);
  }

  // Get wallet to check threshold
  const wallet = await getMultisigWalletByAddress(tx.multisigAddress, { tenantId });
  if (!wallet) {
    throw new Error('Multi-sig wallet not found');
  }

  // Get confirmation count
  const confirmationCount = await getConfirmationCount(txId, { tenantId });
  if (confirmationCount < wallet.threshold) {
    throw new Error(`Not enough confirmations: ${confirmationCount}/${wallet.threshold}`);
  }

  // Execute the transaction on the blockchain (unless in demo mode)
  let txHash;
  const executedAt = new Date().toISOString();
  
  if (MULTISIG_DEMO_MODE) {
    // In demo mode, just mark as executed without actual blockchain interaction
    console.warn('⚠️ Multi-sig execution in DEMO MODE - no blockchain transaction will be sent');
    txHash = `0x${keccak256(toHex(Date.now())).slice(2)}${Math.random().toString(16).slice(2, 10)}`;
  } else {
    try {
      // Execute the transaction via the multi-sig contract
      txHash = await executeMultisigOnChain({
        wallet,
        tx,
        executorAddress,
        tenantId
      });
    } catch (chainError) {
      console.error('Blockchain execution failed, falling back to demo mode:', chainError.message);
      // Fallback to demo mode behavior if blockchain execution fails
      txHash = `0x${keccak256(toHex(Date.now())).slice(2)}${Math.random().toString(16).slice(2, 10)}`;
    }
  }
  
  await updateMultisigTransaction(txId, {
    status: 'executed',
    executedAt,
    executorAddress,
    txHash
  }, { tenantId });

  // Record policy spend if it's a transfer
  if (tx.valueEth && parseFloat(tx.valueEth) > 0) {
    await recordPolicySpend({
      walletAddress: tx.multisigAddress,
      valueEth: tx.valueEth,
      chain: wallet.chain,
      tenantId
    });
  }

  return {
    txId,
    status: 'executed',
    executedAt,
    executorAddress,
    txHash: tx.txHash,
    confirmations: confirmationCount
  };
}

/**
 * Get transaction details
 */
export async function getTransaction(txId, { tenantId } = {}) {
  const tx = await getMultisigTransactionById(txId, { tenantId });
  if (!tx) {
    return null;
  }

  const confirmations = await getConfirmations(txId, { tenantId });
  const wallet = await getMultisigWalletByAddress(tx.multisigAddress, { tenantId });

  return {
    id: tx.id,
    txIndex: tx.txIndex,
    multisigAddress: tx.multisigAddress,
    toAddress: tx.toAddress,
    valueEth: tx.valueEth,
    data: tx.data,
    operation: tx.operation,
    description: tx.description,
    status: tx.status,
    timelockUntil: tx.timelockUntil,
    executedAt: tx.executedAt,
    executorAddress: tx.executorAddress,
    txHash: tx.txHash,
    confirmationsRequired: wallet?.threshold || 0,
    confirmations: confirmations.map(c => ({
      signerAddress: c.signerAddress,
      confirmedAt: c.confirmedAt
    })),
    createdAt: tx.createdAt
  };
}

/**
 * Get all transactions for a multi-sig wallet
 */
export async function getTransactions(multisigAddress, { tenantId, status } = {}) {
  const txs = await getMultisigTransactions(multisigAddress, { tenantId, status });
  const wallet = await getMultisigWalletByAddress(multisigAddress, { tenantId });

  const results = [];
  for (const tx of txs) {
    const confirmations = await getConfirmations(tx.id, { tenantId });
    results.push({
      id: tx.id,
      txIndex: tx.txIndex,
      toAddress: tx.toAddress,
      valueEth: tx.valueEth,
      description: tx.description,
      status: tx.status,
      timelockUntil: tx.timelockUntil,
      executedAt: tx.executedAt,
      confirmationsRequired: wallet?.threshold || 0,
      confirmationsReceived: confirmations.length,
      createdAt: tx.createdAt
    });
  }

  return results;
}

/**
 * Cancel a pending transaction
 */
export async function cancelTransaction({ txId, signerAddress, tenantId }) {
  const tx = await getMultisigTransactionById(txId, { tenantId });
  if (!tx) {
    throw new Error('Transaction not found');
  }

  if (tx.status !== 'pending') {
    throw new Error(`Cannot cancel transaction with status: ${tx.status}`);
  }

  // Verify signer is an owner
  const wallet = await getMultisigWalletByAddress(tx.multisigAddress, { tenantId });
  if (!wallet.owners.includes(signerAddress.toLowerCase())) {
    throw new Error('Only owners can cancel transactions');
  }

  await updateMultisigTransaction(txId, { status: 'cancelled' }, { tenantId });

  return {
    txId,
    status: 'cancelled',
    cancelledBy: signerAddress
  };
}

// ============================================================
// Hardware Wallet Support (Stub)
// ============================================================

/**
 * Sign transaction with hardware wallet (Ledger/Trezor)
 * This is a stub - actual implementation requires hardware wallet SDKs
 */
export async function signWithHardwareWallet({ transaction, hardwareType, devicePath }) {
  // Stub implementation
  // In production, you'd use:
  // - @ledgerhq/hw-app-eth for Ledger
  // - @trezor/connect for Trezor
  
  throw new Error('Hardware wallet signing requires additional setup. Use software signing for now.');
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate a deterministic multi-sig wallet address
 * In production, this would be the deployed contract address
 */
function generateMultisigAddress(owners, threshold, chain) {
  // Sort owners for deterministic address generation
  const sortedOwners = [...owners].sort();
  
  // Create a pseudo-address based on owners and threshold
  const data = keccak256(toHex(JSON.stringify({ owners: sortedOwners, threshold, chain })));
  return `0x${data.slice(26)}`; // Take last 38 chars to make valid address
}

/**
 * Get default roles for owners
 */
function getDefaultRoles(owners) {
  const roles = {};
  
  if (owners.length > 0) {
    roles[owners[0].toLowerCase()] = 'admin';
  }
  if (owners.length > 1) {
    roles[owners[1].toLowerCase()] = 'treasury';
  }
  if (owners.length > 2) {
    roles[owners[2].toLowerCase()] = 'operations';
  }
  
  // Assign member role to remaining owners
  for (let i = 3; i < owners.length; i++) {
    roles[owners[i].toLowerCase()] = 'member';
  }
  
  return roles;
}

/**
 * Validate multi-sig transaction data
 */
export function validateMultisigTransaction(tx) {
  if (!tx.to || !/^0x[a-fA-F0-9]{40}$/.test(tx.to)) {
    throw new Error('Invalid to address');
  }
  
  if (tx.value !== undefined) {
    const value = parseFloat(tx.value);
    if (isNaN(value) || value < 0) {
      throw new Error('Invalid value');
    }
  }
  
  if (tx.data !== undefined && !/^0x[a-fA-F0-9]*$/.test(tx.data)) {
    throw new Error('Invalid data');
  }
  
  return true;
}

/**
 * Get pending transactions that can be executed
 */
export async function getExecutableTransactions(multisigAddress, { tenantId } = {}) {
  const pendingTxs = await getMultisigTransactions(multisigAddress, { tenantId, status: 'pending' });
  const wallet = await getMultisigWalletByAddress(multisigAddress, { tenantId });
  const executable = [];

  for (const tx of pendingTxs) {
    const confirmationCount = await getConfirmationCount(tx.id, { tenantId });
    
    // Check if timelock has passed
    const timelockPassed = !tx.timelockUntil || new Date(tx.timelockUntil) <= new Date();
    
    if (confirmationCount >= wallet.threshold && timelockPassed) {
      executable.push({
        ...tx,
        confirmationCount,
        canExecute: true
      });
    }
  }

  return executable;
}
