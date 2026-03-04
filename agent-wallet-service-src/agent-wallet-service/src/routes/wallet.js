import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
  createWallet, getBalance, signTransaction,
  getAllWallets, getSupportedChains, importWallet,
  getTransactionReceipt, getMultiChainBalance,
  estimateGas, sweepWallet, getWalletByAddress
} from '../services/viem-wallet.js';
import { getFeeConfig } from '../services/fee-collector.js';
import { getHistory, getWalletTransactions } from '../services/tx-history.js';

const router = Router();

// ============================================================
// STATIC ROUTES (must come before /:address routes)
// ============================================================

/**
 * @swagger
 * /wallet/create:
 *   post:
 *     summary: Create a new agent wallet
 *     description: Generates a new Ethereum-compatible wallet tied to an agent name.
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentName
 *             properties:
 *               agentName:
 *                 type: string
 *               chain:
 *                 type: string
 *                 default: base-sepolia
 *     responses:
 *       200:
 *         description: Wallet created successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
router.post('/create', requireAuth('write'), async (req, res, next) => {
  try {
    const { agentName, chain = 'base-sepolia' } = req.body;

    if (!agentName) {
      throw new ApiError('agentName is required', 400, 'MISSING_AGENT_NAME');
    }

    const wallet = await createWallet({ agentName, chain });
    res.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        chain: wallet.chain
      }
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'WALLET_CREATION_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/import:
 *   post:
 *     summary: Import an existing wallet
 *     description: Imports a wallet using a private key (must be prefixed with 0x).
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - privateKey
 *               - agentName
 *             properties:
 *               privateKey:
 *                 type: string
 *               agentName:
 *                 type: string
 *               chain:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet imported successfully
 *       400:
 *         description: Missing private key
 */
router.post('/import', requireAuth('write'), async (req, res, next) => {
  try {
    const { privateKey, agentName, chain } = req.body;

    if (!privateKey) {
      throw new ApiError('privateKey is required', 400, 'MISSING_PRIVATE_KEY');
    }

    const wallet = await importWallet({ privateKey, agentName, chain });
    res.json({
      success: true,
      wallet
    });
  } catch (error) {
    next(new ApiError(error.message, 400, 'WALLET_IMPORT_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/list:
 *   get:
 *     summary: List all wallets
 *     description: Retrieves a list of all wallets managed by the service.
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: A list of wallets
 */
router.get('/list', async (req, res, next) => {
  try {
    const wallets = getAllWallets();
    res.json({
      count: wallets.length,
      wallets
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'WALLET_FETCH_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/chains:
 *   get:
 *     summary: List all supported chains
 *     description: Returns the list of blockchain networks supported by the service.
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Supported chains
 */
router.get('/chains', (req, res) => {
  const chains = getSupportedChains();
  res.json({
    default: 'base-sepolia',
    count: chains.length,
    chains
  });
});

/**
 * @swagger
 * /wallet/fees:
 *   get:
 *     summary: Get fee configuration
 *     description: Retrieves the current fee configuration including percentage and treasury address.
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Fee configuration object
 */
router.get('/fees', (req, res) => {
  res.json(getFeeConfig());
});

/**
 * @swagger
 * /wallet/history:
 *   get:
 *     summary: Get global transaction history
 *     description: Retrieves the global transaction history across all wallets.
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of transactions to return
 *     responses:
 *       200:
 *         description: Global transction history
 */
router.get('/history', (req, res) => {
  const { limit } = req.query;
  const history = getHistory(parseInt(limit) || 50);
  res.json({
    count: history.length,
    transactions: history
  });
});

/**
 * @swagger
 * /wallet/tx/{hash}:
 *   get:
 *     summary: Get transaction receipt
 *     description: Fetches the receipt or status for a given transaction hash.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: chain
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction receipt details
 */
router.get('/tx/:hash', async (req, res, next) => {
  try {
    const { hash } = req.params;
    const { chain = 'base-sepolia' } = req.query;

    const receipt = await getTransactionReceipt(hash, chain);
    res.json(receipt);
  } catch (error) {
    next(new ApiError(error.message, 500, 'TRANSACTION_FETCH_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/estimate-gas:
 *   post:
 *     summary: Estimate gas for a transaction
 *     description: Simulates an EVM call to estimate required gas and cost.
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *             properties:
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               value:
 *                 type: string
 *               data:
 *                 type: string
 *               chain:
 *                 type: string
 *     responses:
 *       200:
 *         description: Gas estimation details
 */
router.post('/estimate-gas', async (req, res, next) => {
  try {
    const { from, to, value, data, chain } = req.body;

    if (!from || !to) {
      throw new ApiError('from and to addresses are required', 400, 'MISSING_ADDRESSES');
    }

    const estimate = await estimateGas({ from, to, value, data, chain });
    res.json(estimate);
  } catch (error) {
    next(new ApiError(error.message, 500, 'GAS_ESTIMATION_FAILED'));
  }
});

// ============================================================
// DYNAMIC ROUTES (/:address)
// ============================================================

/**
 * @swagger
 * /wallet/{address}:
 *   get:
 *     summary: Get wallet details
 *     description: Retrieves the details of a specific wallet by its address.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Wallet details retrieved successfully
 *       404:
 *         description: Wallet not found
 */
router.get('/:address', async (req, res, next) => {
  try {
    const { address } = req.params;
    const wallet = getWalletByAddress(address);

    if (!wallet) {
      throw new ApiError(`Wallet not found: ${address}`, 404, 'WALLET_NOT_FOUND');
    }

    res.json({
      id: wallet.id,
      agentName: wallet.agentName,
      address: wallet.address,
      chain: wallet.chain,
      createdAt: wallet.createdAt
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'WALLET_FETCH_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/{address}/balance:
 *   get:
 *     summary: Get wallet balance
 *     description: Retrieves the native currency balance of a specific wallet.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: chain
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Balance retrieved
 *       500:
 *         description: Internal server error
 */
router.get('/:address/balance', async (req, res, next) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    const balance = await getBalance(address, chain);
    res.json({
      address,
      balance
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'BALANCE_FETCH_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/{address}/balance/all:
 *   get:
 *     summary: Get balance across all chains
 *     description: Retrieves the balance for the given address across all supported blockchain networks.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Balances retrieved
 */
router.get('/:address/balance/all', async (req, res, next) => {
  try {
    const { address } = req.params;
    const balances = await getMultiChainBalance(address);
    res.json({
      address,
      balances
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'MULTI_CHAIN_BALANCE_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/{address}/history:
 *   get:
 *     summary: Get transaction history for a wallet
 *     description: Retrieves the local transaction history initiated by this specific wallet.
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction history retrieved
 */
router.get('/:address/history', (req, res) => {
  const { address } = req.params;
  const history = getWalletTransactions(address);
  res.json({ address, transactions: history });
});

/**
 * @swagger
 * /wallet/{address}/send:
 *   post:
 *     summary: Send a transaction
 *     description: Signs and broadcasts a transaction from the specified wallet.
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *             properties:
 *               to:
 *                 type: string
 *               value:
 *                 type: string
 *                 default: "0"
 *               data:
 *                 type: string
 *                 default: "0x"
 *               chain:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction sent successfully
 *       400:
 *         description: Missing recipient address
 */
router.post('/:address/send', requireAuth('write'), async (req, res, next) => {
  try {
    const { address } = req.params;
    const { to, value = '0', data = '0x', chain } = req.body;

    if (!to) {
      throw new ApiError('recipient address (to) is required', 400, 'MISSING_RECIPIENT');
    }

    const tx = await signTransaction({ from: address, to, value, data, chain });
    res.json({
      success: true,
      transaction: tx
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'TRANSACTION_FAILED'));
  }
});

/**
 * @swagger
 * /wallet/{address}/sweep:
 *   post:
 *     summary: Sweep all funds
 *     description: Transfers all available funds (minus gas fees) to a destination address.
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *             properties:
 *               to:
 *                 type: string
 *               chain:
 *                 type: string
 *     responses:
 *       200:
 *         description: Funds swept successfully
 *       400:
 *         description: Missing destination address
 *       500:
 *         description: Insufficient funds to cover gas
 */
router.post('/:address/sweep', requireAuth('write'), async (req, res, next) => {
  try {
    const { address } = req.params;
    const { to, chain } = req.body;

    if (!to) {
      throw new ApiError('recipient address (to) is required', 400, 'MISSING_RECIPIENT');
    }

    const result = await sweepWallet({ from: address, to, chain });
    res.json({
      success: true,
      sweep: result
    });
  } catch (error) {
    next(new ApiError(error.message, 500, 'SWEEP_FAILED'));
  }
});

export default router;
