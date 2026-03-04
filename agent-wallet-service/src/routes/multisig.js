import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate, ethAddressSchema, chainSchema } from '../middleware/validation.js';
import { z } from 'zod';
import {
  deployMultisigWallet,
  getMultisigWallet,
  listMultisigWallets,
  updateMultisigSettings,
  submitTransaction,
  submitTransactionBatch,
  confirmTransaction,
  executeTransaction,
  getTransaction,
  getTransactions,
  cancelTransaction,
  getExecutableTransactions,
  validateMultisigTransaction
} from '../services/multisig-wallet.js';

const router = Router();

// ============================================================
// Validation Schemas
// ============================================================

/** POST /multisig/create */
const createMultisigSchema = z.object({
  owners: z.array(ethAddressSchema).min(1, 'At least one owner required'),
  threshold: z.number().int().min(1).max(100, 'Threshold must be between 1 and 100'),
  chain: chainSchema.default('base-sepolia'),
  timelockSeconds: z.number().int().min(0).optional(),
  roles: z.record(z.string()).optional()
});

/** POST /multisig/:address/submit */
const submitTxSchema = z.object({
  to: ethAddressSchema,
  value: z.string().default('0'),
  data: z.string().default('0x'),
  description: z.string().optional()
});

/** POST /multisig/:address/submit-batch */
const batchTxSchema = z.object({
  transactions: z.array(z.object({
    to: ethAddressSchema,
    value: z.string().default('0'),
    data: z.string().default('0x'),
    description: z.string().optional()
  })).min(1, 'At least one transaction required').max(10, 'Maximum 10 transactions per batch'),
  description: z.string().optional()
});

/** POST /multisig/:address/confirm */
const confirmTxSchema = z.object({
  txId: z.string().min(1, 'txId is required'),
  signerAddress: ethAddressSchema,
  signature: z.string().optional()
});

/** POST /multisig/:address/execute */
const executeTxSchema = z.object({
  txId: z.string().min(1, 'txId is required'),
  executorAddress: ethAddressSchema.optional()
});

/** POST /multisig/:address/cancel */
const cancelTxSchema = z.object({
  txId: z.string().min(1, 'txId is required'),
  signerAddress: ethAddressSchema
});

/** PUT /multisig/:address/settings */
const updateSettingsSchema = z.object({
  threshold: z.number().int().min(1).max(100).optional(),
  owners: z.array(ethAddressSchema).optional(),
  timelockSeconds: z.number().int().min(0).optional(),
  roles: z.record(z.string()).optional()
});

// ============================================================
// Routes
// ============================================================

/**
 * POST /multisig/create
 * Create a new multi-sig wallet
 */
router.post('/create', requireAuth('write'), async (req, res) => {
  try {
    const { owners, threshold, chain, timelockSeconds, roles } = req.body;

    // Validate threshold <= owners
    if (threshold > owners.length) {
      return res.status(400).json({ error: 'Threshold cannot exceed number of owners' });
    }

    const wallet = await deployMultisigWallet({
      owners,
      threshold,
      chain,
      tenantId: req.tenant?.id,
      context: { timelockSeconds, roles }
    });

    res.json({
      success: true,
      wallet: {
        address: wallet.address,
        chain: wallet.chain,
        threshold: wallet.threshold,
        owners: wallet.owners,
        roles: wallet.roles,
        timelockSeconds: wallet.timelockSeconds,
        isDeployed: wallet.isDeployed
      }
    });
  } catch (error) {
    console.error('Multi-sig creation error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /multisig/list
 * List all multi-sig wallets
 */
router.get('/list', requireAuth('read'), async (req, res) => {
  try {
    const wallets = await listMultisigWallets({ tenantId: req.tenant?.id });
    res.json({
      count: wallets.length,
      wallets
    });
  } catch (error) {
    console.error('List multi-sig wallets error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /multisig/:address
 * Get multi-sig wallet details
 */
router.get('/:address', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;
    const wallet = await getMultisigWallet(address, { tenantId: req.tenant?.id });

    if (!wallet) {
      return res.status(404).json({ error: `Multi-sig wallet not found: ${address}` });
    }

    res.json(wallet);
  } catch (error) {
    console.error('Get multi-sig wallet error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /multisig/:address/settings
 * Update multi-sig wallet settings
 */
router.put('/:address/settings', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const updates = req.body;

    // Validate threshold if being updated
    if (updates.threshold !== undefined && updates.owners) {
      if (updates.threshold > updates.owners.length) {
        return res.status(400).json({ error: 'Threshold cannot exceed number of owners' });
      }
    }

    const wallet = await updateMultisigSettings(address, updates, { tenantId: req.tenant?.id });

    res.json({
      success: true,
      wallet
    });
  } catch (error) {
    console.error('Update multi-sig settings error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /multisig/:address/submit
 * Submit a new transaction
 */
router.post('/:address/submit', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const { to, value, data, description } = req.body;

    // Validate transaction data
    validateMultisigTransaction({ to, value, data });

    const tx = await submitTransaction({
      multisigAddress: address,
      to,
      value,
      data,
      description,
      tenantId: req.tenant?.id,
      context: { submittedBy: req.apiKey?.id }
    });

    res.json({
      success: true,
      transaction: tx
    });
  } catch (error) {
    console.error('Submit transaction error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /multisig/:address/submit-batch
 * Submit multiple transactions as a batch
 */
router.post('/:address/submit-batch', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const { transactions, description } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    if (transactions.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 transactions per batch' });
    }

    // Validate each transaction
    for (const tx of transactions) {
      validateMultisigTransaction(tx);
    }

    const batch = await submitTransactionBatch({
      multisigAddress: address,
      transactions,
      description,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      batch
    });
  } catch (error) {
    console.error('Submit batch error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /multisig/:address/confirm
 * Confirm a transaction
 */
router.post('/:address/confirm', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const { txId, signerAddress, signature } = req.body;

    if (!txId) {
      return res.status(400).json({ error: 'txId is required' });
    }

    if (!signerAddress) {
      return res.status(400).json({ error: 'signerAddress is required' });
    }

    const result = await confirmTransaction({
      txId,
      signerAddress,
      signature,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      confirmation: result
    });
  } catch (error) {
    console.error('Confirm transaction error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /multisig/:address/execute
 * Execute a confirmed transaction
 */
router.post('/:address/execute', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const { txId, executorAddress } = req.body;

    if (!txId) {
      return res.status(400).json({ error: 'txId is required' });
    }

    const result = await executeTransaction({
      txId,
      executorAddress: executorAddress || req.body.signerAddress || address,
      tenantId: req.tenant?.id,
      context: { executedBy: req.apiKey?.id }
    });

    res.json({
      success: true,
      execution: result
    });
  } catch (error) {
    console.error('Execute transaction error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /multisig/:address/cancel
 * Cancel a pending transaction
 */
router.post('/:address/cancel', requireAuth('write'), async (req, res) => {
  try {
    const { address } = req.params;
    const { txId, signerAddress } = req.body;

    if (!txId) {
      return res.status(400).json({ error: 'txId is required' });
    }

    if (!signerAddress) {
      return res.status(400).json({ error: 'signerAddress is required' });
    }

    const result = await cancelTransaction({
      txId,
      signerAddress,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      cancellation: result
    });
  } catch (error) {
    console.error('Cancel transaction error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /multisig/:address/transactions
 * Get all transactions for a multi-sig wallet
 */
router.get('/:address/transactions', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;
    const { status } = req.query;

    const transactions = await getTransactions(address, {
      tenantId: req.tenant?.id,
      status
    });

    res.json({
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /multisig/:address/transactions/:txId
 * Get specific transaction details
 */
router.get('/:address/transactions/:txId', requireAuth('read'), async (req, res) => {
  try {
    const { txId } = req.params;

    const tx = await getTransaction(txId, { tenantId: req.tenant?.id });

    if (!tx) {
      return res.status(404).json({ error: `Transaction not found: ${txId}` });
    }

    res.json(tx);
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /multisig/:address/executable
 * Get transactions that can be executed
 */
router.get('/:address/executable', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;

    const executable = await getExecutableTransactions(address, { tenantId: req.tenant?.id });

    res.json({
      count: executable.length,
      transactions: executable
    });
  } catch (error) {
    console.error('Get executable transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
