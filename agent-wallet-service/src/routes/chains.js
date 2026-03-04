/**
 * Chains API Routes
 * 
 * REST API endpoints for multi-chain wallet operations
 * Supports: Ethereum, Base, Polygon, Optimism, Arbitrum, Polygon zkEVM, zkSync, Solana, Aptos, Sui, StarkNet
 */

import express from 'express';
import { z } from 'zod';
import { 
  getAllSupportedChains, 
  createWallet, 
  getBalance, 
  transfer, 
  estimateGas,
  getTransactionReceipt,
  isValidAddress,
  isChainSupported,
  getChainsByCategory,
  getChainType
} from '../services/chain-manager.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';

const router = express.Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const createWalletSchema = z.object({
  agentName: z.string().min(1).max(100),
  chain: z.string().optional(),
  tenantId: z.string().optional()
});

const transferSchema = z.object({
  fromPrivateKey: z.string().min(1),
  fromAddress: z.string().optional(),
  to: z.string().min(1),
  amount: z.string().or(z.number()).transform(val => String(val)),
  chain: z.string().optional()
});

const balanceSchema = z.object({
  address: z.string().min(1),
  chain: z.string().optional()
});

const estimateSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  value: z.string().or(z.number()).transform(val => String(val)),
  chain: z.string().optional()
});

const transactionReceiptSchema = z.object({
  txHash: z.string().min(1),
  chain: z.string().optional()
});

// ============================================================
// ROUTES
// ============================================================

/**
 * GET /chains
 * List all supported blockchain chains
 */
router.get('/', async (req, res, next) => {
  try {
    const chains = getAllSupportedChains();
    const categories = getChainsByCategory();
    
    res.json({
      supportedChains: chains,
      categories,
      totalCount: chains.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/:chain
 * Get information about a specific chain
 */
router.get('/:chain', async (req, res, next) => {
  try {
    const { chain } = req.params;
    
    if (!isChainSupported(chain)) {
      return res.status(404).json({
        error: 'Chain not supported',
        message: `Chain "${chain}" is not supported`,
        supportedChains: getAllSupportedChains().map(c => c.id)
      });
    }
    
    const chains = getAllSupportedChains();
    const chainInfo = chains.find(c => c.id === chain);
    
    if (!chainInfo) {
      return res.status(404).json({
        error: 'Chain not found',
        message: `Chain "${chain}" information not found`
      });
    }
    
    res.json({
      ...chainInfo,
      chainType: getChainType(chain)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /chains/:chain/wallet
 * Create a new wallet on a specific chain
 */
router.post('/:chain/wallet', validate(createWalletSchema), requireAuth('write'), async (req, res, next) => {
  try {
    const { chain } = req.params;
    const { agentName, tenantId } = req.validated?.body || req.body;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`,
        supportedChains: getAllSupportedChains().map(c => c.id)
      });
    }
    
    const wallet = await createWallet({ 
      agentName, 
      chain,
      tenantId: req.headers['x-tenant-id'] || tenantId
    });
    
    res.status(201).json({
      message: `Wallet created successfully on ${chain}`,
      wallet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/:chain/wallet/:address
 * Get wallet information for a specific address on a chain
 */
router.get('/:chain/wallet/:address', async (req, res, next) => {
  try {
    const { chain, address } = req.params;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    // Validate address format
    if (!isValidAddress(address, chain)) {
      return res.status(400).json({
        error: 'Invalid address format',
        message: `Address "${address}" is not valid for chain "${chain}"`
      });
    }
    
    // Get balance
    const balanceInfo = await getBalance(address, chain);
    
    res.json({
      address,
      chain,
      ...balanceInfo
    });
  } catch (error) {
    // Check if error is due to wallet not found
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Wallet not found',
        message: `No wallet found for address "${req.params.address}" on ${req.params.chain}`
      });
    }
    next(error);
  }
});

/**
 * POST /chains/:chain/transfer
 * Transfer tokens on a specific chain
 */
router.post('/:chain/transfer', validate(transferSchema), requireAuth('write'), async (req, res, next) => {
  try {
    const { chain } = req.params;
    const { fromPrivateKey, fromAddress, to, amount } = req.validated?.body || req.body;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    // Validate recipient address
    if (!isValidAddress(to, chain)) {
      return res.status(400).json({
        error: 'Invalid recipient address',
        message: `Address "${to}" is not valid for chain "${chain}"`
      });
    }
    
    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: 'Amount must be a positive number'
      });
    }
    
    // Execute transfer
    const result = await transfer({
      fromPrivateKey,
      fromAddress,
      to,
      amount,
      chain
    });
    
    res.status(201).json({
      message: 'Transfer submitted successfully',
      transaction: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/:chain/balance/:address
 * Get balance for an address on a specific chain
 */
router.get('/:chain/balance/:address', async (req, res, next) => {
  try {
    const { chain, address } = req.params;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    // Validate address format
    if (!isValidAddress(address, chain)) {
      return res.status(400).json({
        error: 'Invalid address format',
        message: `Address "${address}" is not valid for chain "${chain}"`
      });
    }
    
    const balanceInfo = await getBalance(address, chain);
    
    res.json(balanceInfo);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /chains/:chain/estimate
 * Estimate gas/fees for a transaction on a specific chain
 */
router.post('/:chain/estimate', validate(estimateSchema), async (req, res, next) => {
  try {
    const { chain } = req.params;
    const { from, to, value } = req.validated?.body || req.body;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    // Validate addresses
    if (!isValidAddress(from, chain)) {
      return res.status(400).json({
        error: 'Invalid sender address',
        message: `Address "${from}" is not valid for chain "${chain}"`
      });
    }
    
    if (!isValidAddress(to, chain)) {
      return res.status(400).json({
        error: 'Invalid recipient address',
        message: `Address "${to}" is not valid for chain "${chain}"`
      });
    }
    
    const estimate = await estimateGas({ from, to, value, chain });
    
    if (!estimate) {
      return res.status(400).json({
        error: 'Estimation not available',
        message: `Gas estimation is not available for chain "${chain}"`
      });
    }
    
    res.json({
      chain,
      estimate
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/:chain/transaction/:txHash
 * Get transaction receipt/status
 */
router.get('/:chain/transaction/:txHash', async (req, res, next) => {
  try {
    const { chain, txHash } = req.params;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    const receipt = await getTransactionReceipt(txHash, chain);
    
    if (!receipt) {
      return res.status(404).json({
        error: 'Transaction not found',
        message: `Transaction "${txHash}" not found on chain "${chain}"`
      });
    }
    
    res.json({
      chain,
      ...receipt
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/:chain/tokens
 * Get supported tokens for a chain
 */
router.get('/:chain/tokens', async (req, res, next) => {
  try {
    const { chain } = req.params;
    
    // Validate chain support
    if (!isChainSupported(chain)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain "${chain}" is not supported`
      });
    }
    
    // For now, return basic token info
    // In production, this would query chain-specific token registries
    const chainInfo = getAllSupportedChains().find(c => c.id === chain);
    
    res.json({
      chain,
      nativeCurrency: chainInfo?.nativeCurrency,
      tokens: [] // Would be populated from token registries
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chains/categories
 * Get chains organized by category
 */
router.get('/categories/list', async (req, res, next) => {
  try {
    const categories = getChainsByCategory();
    
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

export default router;
