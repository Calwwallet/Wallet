/**
 * DeFi Routes
 * 
 * API endpoints for DeFi operations:
 * - Token swaps (Uniswap V3, 0x)
 * - Staking (Lido, Rocket Pool)
 * - Lending (Aave V3)
 * - Cross-chain (LayerZero, Axelar)
 * - Price feeds (Chainlink)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { z } from 'zod';
import {
  // Swap functions
  getUniswapV3Quote,
  getZeroxQuote,
  executeSwap,
  getBestQuote,
  getSupportedSwapChains,
  getSupportedTokens as getSwapTokens,
  getTokenAddress as getSwapTokenAddress
} from '../services/defi/swap-service.js';

import {
  // Staking functions
  stakeLido,
  unstakeLido,
  getLidoStakedBalance,
  stakeRocketPool,
  unstakeRocketPool,
  getRocketPoolStakedBalance,
  getStakingPositions,
  getSupportedStakingChains,
  getStakingProtocols
} from '../services/defi/staking-service.js';

import {
  // Lending functions
  supplyToAave,
  withdrawFromAave,
  borrowFromAave,
  repayToAave,
  setCollateralAave,
  getAavePositions,
  getSupportedLendingChains,
  getLendingTokens
} from '../services/defi/lending-service.js';

import {
  // Cross-chain functions
  executeCrossChainTransfer,
  sendViaLayerZero,
  sendViaAxelar,
  getLayerZeroDestinations,
  getAxelarDestinations,
  getCrossChainRoutes,
  getSupportedCrossChainChains
} from '../services/defi/crosschain-service.js';

import {
  // Price feed functions
  getPrice,
  getPrices,
  getEthPrice,
  getBtcPrice,
  getAllPrices,
  tokenToUsd,
  usdToToken,
  getSupportedPriceChains,
  getAvailableTokens,
  hasPriceFeed,
  getAllPriceFeeds
} from '../services/defi/price-feed.js';

const router = Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

// Swap schemas
const quoteSchema = z.object({
  fromToken: z.string().min(1, 'fromToken is required'),
  toToken: z.string().min(1, 'toToken is required'),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum'),
  provider: z.enum(['uniswap_v3', '0x', 'best']).default('best'),
  slippagePercentage: z.number().min(0).max(50).optional()
});

const swapSchema = z.object({
  fromToken: z.string().min(1, 'fromToken is required'),
  toToken: z.string().min(1, 'toToken is required'),
  amount: z.string().min(1, 'amount is required'),
  minAmountOut: z.string().min(1, 'minAmountOut is required'),
  chain: z.string().default('ethereum'),
  provider: z.enum(['uniswap_v3', '0x']).default('uniswap_v3'),
  feeTier: z.number().int().min(0).optional()
});

// Staking schemas
const stakeSchema = z.object({
  protocol: z.enum(['lido', 'rocket_pool']),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum')
});

const stakingPositionSchema = z.object({
  protocol: z.enum(['lido', 'rocket_pool']),
  chain: z.string().default('ethereum')
});

// Lending schemas
const supplySchema = z.object({
  asset: z.string().min(1, 'asset is required'),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum'),
  useAsCollateral: z.boolean().default(true)
});

const borrowSchema = z.object({
  asset: z.string().min(1, 'asset is required'),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum'),
  interestRateMode: z.number().int().min(1).max(2).default(2)
});

const repaySchema = z.object({
  asset: z.string().min(1, 'asset is required'),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum'),
  interestRateMode: z.number().int().min(1).max(2).default(2)
});

const withdrawSchema = z.object({
  asset: z.string().min(1, 'asset is required'),
  amount: z.string().min(1, 'amount is required'),
  chain: z.string().default('ethereum')
});

const collateralSchema = z.object({
  asset: z.string().min(1, 'asset is required'),
  useAsCollateral: z.boolean(),
  chain: z.string().default('ethereum')
});

// Cross-chain schemas
const crosschainSchema = z.object({
  toChain: z.string().min(1, 'toChain is required'),
  toAddress: z.string().min(1, 'toAddress is required'),
  amount: z.string().min(1, 'amount is required'),
  token: z.string().default('ETH'),
  protocol: z.enum(['layer_zero', 'axelar']).default('layer_zero'),
  fromChain: z.string().default('ethereum')
});

// Price schema
const priceSchema = z.object({
  chain: z.string().default('ethereum')
});

// ============================================================
// SWAP ROUTES
// ============================================================

/**
 * GET /defi/quote
 * Get swap quote from DEX
 */
router.get('/quote', requireAuth('read'), async (req, res) => {
  try {
    const { fromToken, toToken, amount, chain = 'ethereum', provider = 'best' } = req.query;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({ error: 'fromToken, toToken, and amount are required' });
    }

    // Resolve token addresses
    const fromTokenAddress = fromToken.startsWith('0x')
      ? fromToken
      : getSwapTokenAddress(chain, fromToken);

    const toTokenAddress = toToken.startsWith('0x')
      ? toToken
      : getSwapTokenAddress(chain, toToken);

    const result = provider === 'best'
      ? await getBestQuote({ chain, fromToken: fromTokenAddress, toToken: toTokenAddress, amount })
      : provider === 'uniswap_v3'
        ? await getUniswapV3Quote({ chain, fromToken: fromTokenAddress, toToken: toTokenAddress, amount })
        : await getZeroxQuote({ chain, fromToken: fromTokenAddress, toToken: toTokenAddress, amount });

    res.json({
      success: true,
      quote: result
    });
  } catch (error) {
    console.error('Quote error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/swap
 * Execute a token swap
 * SECURITY: Enforces slippage protection to prevent front-running
 */
router.post('/swap', requireAuth('write'), async (req, res) => {
  try {
    // Slippage protection constants
    const DEFAULT_SLIPPAGE = 0.5; // 0.5% default
    const MAX_SLIPPAGE = 50; // 50% max (prevent unreasonable values)

    const {
      fromToken,
      toToken,
      amount,
      minAmountOut,
      chain = 'ethereum',
      provider = 'uniswap_v3',
      feeTier = 3000,
      slippagePercentage = DEFAULT_SLIPPAGE
    } = req.body;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({ error: 'fromToken, toToken, and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    // Enforce slippage bounds to prevent MEV extraction
    const enforcedSlippage = Math.min(Math.max(parseFloat(slippagePercentage) || DEFAULT_SLIPPAGE, 0), MAX_SLIPPAGE);

    // Resolve token addresses
    const fromTokenAddress = fromToken.startsWith('0x')
      ? fromToken
      : getSwapTokenAddress(chain, fromToken);

    const toTokenAddress = toToken.startsWith('0x')
      ? toToken
      : getSwapTokenAddress(chain, toToken);

    const result = await executeSwap({
      walletAddress,
      chain,
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      amount,
      minAmountOut, // Can be provided or calculated from quote
      provider,
      feeTier,
      slippagePercentage: enforcedSlippage,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      swap: result
    });
  } catch (error) {
    console.error('Swap error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// STAKING ROUTES
// ============================================================

/**
 * POST /defi/stake
 * Stake tokens
 */
router.post('/stake', requireAuth('write'), async (req, res) => {
  try {
    const { protocol, amount, chain = 'ethereum' } = req.body;

    if (!protocol || !amount) {
      return res.status(400).json({ error: 'protocol and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    let result;
    if (protocol === 'lido') {
      result = await stakeLido({ walletAddress, amount, chain, tenantId: req.tenant?.id });
    } else if (protocol === 'rocket_pool') {
      result = await stakeRocketPool({ walletAddress, amount, chain, tenantId: req.tenant?.id });
    } else {
      return res.status(400).json({ error: 'Invalid protocol. Use lido or rocket_pool' });
    }

    res.json({
      success: true,
      stake: result
    });
  } catch (error) {
    console.error('Stake error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/unstake
 * Unstake tokens
 */
router.post('/unstake', requireAuth('write'), async (req, res) => {
  try {
    const { protocol, amount, chain = 'ethereum' } = req.body;

    if (!protocol || !amount) {
      return res.status(400).json({ error: 'protocol and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    let result;
    if (protocol === 'lido') {
      result = await unstakeLido({ walletAddress, amount, chain, tenantId: req.tenant?.id });
    } else if (protocol === 'rocket_pool') {
      result = await unstakeRocketPool({ walletAddress, amount, chain, tenantId: req.tenant?.id });
    } else {
      return res.status(400).json({ error: 'Invalid protocol. Use lido or rocket_pool' });
    }

    res.json({
      success: true,
      unstake: result
    });
  } catch (error) {
    console.error('Unstake error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/staking/positions/:walletAddress
 * Get staking positions
 */
router.get('/staking/positions/:walletAddress', requireAuth('read'), async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { chain = 'ethereum' } = req.query;

    const positions = await getStakingPositions(walletAddress, chain);

    res.json({
      success: true,
      walletAddress,
      chain,
      positions
    });
  } catch (error) {
    console.error('Get staking positions error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// LENDING ROUTES
// ============================================================

/**
 * POST /defi/supply
 * Supply to Aave
 */
router.post('/supply', requireAuth('write'), async (req, res) => {
  try {
    const { asset, amount, chain = 'ethereum', useAsCollateral = true } = req.body;

    if (!asset || !amount) {
      return res.status(400).json({ error: 'asset and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await supplyToAave({
      walletAddress,
      asset,
      amount,
      chain,
      useAsCollateral,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      supply: result
    });
  } catch (error) {
    console.error('Supply error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/borrow
 * Borrow from Aave
 */
router.post('/borrow', requireAuth('write'), async (req, res) => {
  try {
    const { asset, amount, chain = 'ethereum', interestRateMode = 2 } = req.body;

    if (!asset || !amount) {
      return res.status(400).json({ error: 'asset and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await borrowFromAave({
      walletAddress,
      asset,
      amount,
      chain,
      interestRateMode,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      borrow: result
    });
  } catch (error) {
    console.error('Borrow error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/repay
 * Repay to Aave
 */
router.post('/repay', requireAuth('write'), async (req, res) => {
  try {
    const { asset, amount, chain = 'ethereum', interestRateMode = 2 } = req.body;

    if (!asset || !amount) {
      return res.status(400).json({ error: 'asset and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await repayToAave({
      walletAddress,
      asset,
      amount,
      chain,
      interestRateMode,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      repay: result
    });
  } catch (error) {
    console.error('Repay error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/withdraw
 * Withdraw from Aave
 */
router.post('/withdraw', requireAuth('write'), async (req, res) => {
  try {
    const { asset, amount, chain = 'ethereum' } = req.body;

    if (!asset || !amount) {
      return res.status(400).json({ error: 'asset and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await withdrawFromAave({
      walletAddress,
      asset,
      amount,
      chain,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      withdraw: result
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/collateral
 * Set collateral
 */
router.post('/collateral', requireAuth('write'), async (req, res) => {
  try {
    const { asset, useAsCollateral, chain = 'ethereum' } = req.body;

    if (!asset || useAsCollateral === undefined) {
      return res.status(400).json({ error: 'asset and useAsCollateral are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await setCollateralAave({
      walletAddress,
      asset,
      useAsCollateral,
      chain,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      collateral: result
    });
  } catch (error) {
    console.error('Set collateral error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/lending/positions/:walletAddress
 * Get Aave positions
 */
router.get('/lending/positions/:walletAddress', requireAuth('read'), async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { chain = 'ethereum' } = req.query;

    const positions = await getAavePositions(walletAddress, chain);

    res.json({
      success: true,
      walletAddress,
      chain,
      positions
    });
  } catch (error) {
    console.error('Get lending positions error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// CROSS-CHAIN ROUTES
// ============================================================

/**
 * POST /defi/crosschain
 * Execute cross-chain transfer
 */
router.post('/crosschain', requireAuth('write'), async (req, res) => {
  try {
    const { toChain, toAddress, amount, token = 'ETH', protocol = 'layer_zero', fromChain = 'ethereum' } = req.body;

    if (!toChain || !toAddress || !amount) {
      return res.status(400).json({ error: 'toChain, toAddress, and amount are required' });
    }

    const walletAddress = req.body.walletAddress || req.wallet?.address;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await executeCrossChainTransfer({
      walletAddress,
      fromChain,
      toChain,
      toAddress,
      amount,
      token,
      protocol,
      tenantId: req.tenant?.id
    });

    res.json({
      success: true,
      crosschain: result
    });
  } catch (error) {
    console.error('Cross-chain error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/crosschain/routes
 * Get available cross-chain routes
 */
router.get('/crosschain/routes', requireAuth('read'), async (req, res) => {
  try {
    const routes = getCrossChainRoutes();

    res.json({
      success: true,
      routes
    });
  } catch (error) {
    console.error('Get routes error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/crosschain/destinations/:fromChain
 * Get available destinations for a chain
 */
router.get('/crosschain/destinations/:fromChain', requireAuth('read'), async (req, res) => {
  try {
    const { fromChain } = req.params;
    const { protocol = 'layer_zero' } = req.query;

    const destinations = protocol === 'layer_zero'
      ? getLayerZeroDestinations(fromChain)
      : getAxelarDestinations(fromChain);

    res.json({
      success: true,
      fromChain,
      protocol,
      destinations
    });
  } catch (error) {
    console.error('Get destinations error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// PRICE FEED ROUTES
// Static routes (/price/eth, /price/btc) must come before /price/:token
// ============================================================

/**
 * GET /defi/price/eth
 * Get ETH price
 */
router.get('/price/eth', requireAuth('read'), async (req, res) => {
  try {
    const { chain = 'ethereum' } = req.query;

    const price = await getEthPrice(chain);

    res.json({
      success: true,
      price
    });
  } catch (error) {
    console.error('Get ETH price error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/price/btc
 * Get BTC price
 */
router.get('/price/btc', requireAuth('read'), async (req, res) => {
  try {
    const { chain = 'ethereum' } = req.query;

    const price = await getBtcPrice(chain);

    res.json({
      success: true,
      price
    });
  } catch (error) {
    console.error('Get BTC price error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/price/:token
 * Get token price (catch-all - must come after /price/eth and /price/btc)
 */
router.get('/price/:token', requireAuth('read'), async (req, res) => {
  try {
    const { token } = req.params;
    const { chain = 'ethereum' } = req.query;

    const price = await getPrice(chain, token);

    res.json({
      success: true,
      price
    });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/prices
 * Get multiple token prices
 */
router.get('/prices', requireAuth('read'), async (req, res) => {
  try {
    const { tokens, chain = 'ethereum' } = req.query;

    if (!tokens) {
      return res.status(400).json({ error: 'tokens parameter is required (comma-separated)' });
    }

    const tokenList = tokens.split(',').map(t => t.trim());
    const prices = await getPrices(chain, tokenList);

    res.json({
      success: true,
      chain,
      prices
    });
  } catch (error) {
    console.error('Get prices error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/convert/token-to-usd
 * Convert token amount to USD
 */
router.post('/convert/token-to-usd', requireAuth('read'), async (req, res) => {
  try {
    const { token, amount, chain = 'ethereum' } = req.body;

    if (!token || !amount) {
      return res.status(400).json({ error: 'token and amount are required' });
    }

    const result = await tokenToUsd(chain, token, amount);

    res.json({
      success: true,
      conversion: result
    });
  } catch (error) {
    console.error('Convert token to USD error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /defi/convert/usd-to-token
 * Convert USD amount to token
 */
router.post('/convert/usd-to-token', requireAuth('read'), async (req, res) => {
  try {
    const { token, amount, chain = 'ethereum' } = req.body;

    if (!token || !amount) {
      return res.status(400).json({ error: 'token and amount are required' });
    }

    const result = await usdToToken(chain, token, amount);

    res.json({
      success: true,
      conversion: result
    });
  } catch (error) {
    console.error('Convert USD to token error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// INFO ROUTES
// ============================================================

/**
 * GET /defi/info
 * Get supported DeFi info
 */
router.get('/info', requireAuth('read'), async (req, res) => {
  try {
    res.json({
      success: true,
      info: {
        swaps: {
          supportedChains: getSupportedSwapChains(),
          providers: ['uniswap_v3', '0x']
        },
        staking: {
          supportedChains: getSupportedStakingChains(),
          protocols: getStakingProtocols('ethereum'),
          protocolsByChain: {
            ethereum: getStakingProtocols('ethereum')
          }
        },
        lending: {
          supportedChains: getSupportedLendingChains(),
          tokensByChain: {
            ethereum: getLendingTokens('ethereum'),
            polygon: getLendingTokens('polygon'),
            optimism: getLendingTokens('optimism'),
            arbitrum: getLendingTokens('arbitrum'),
            base: getLendingTokens('base')
          }
        },
        crosschain: {
          supportedChains: getSupportedCrossChainChains(),
          protocols: ['layer_zero', 'axelar'],
          routes: getCrossChainRoutes()
        },
        priceFeeds: {
          supportedChains: getSupportedPriceChains(),
          feeds: getAllPriceFeeds()
        }
      }
    });
  } catch (error) {
    console.error('Get info error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /defi/balance/:address
 * Get DeFi positions for a wallet
 */
router.get('/balance/:address', requireAuth('read'), async (req, res) => {
  try {
    const { address } = req.params;
    const { chain = 'ethereum' } = req.query;

    const [stakingPositions, lendingPositions] = await Promise.all([
      getStakingPositions(address, chain),
      getAavePositions(address, chain)
    ]);

    res.json({
      success: true,
      walletAddress: address,
      chain,
      positions: {
        staking: stakingPositions,
        lending: lendingPositions
      }
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
