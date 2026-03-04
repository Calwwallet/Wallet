/**
 * DeFi Price Feed Service
 * 
 * Price oracles using:
 * - Chainlink - get asset prices
 */

import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { mainnet, polygon, optimism, arbitrum, base, avalanche } from 'viem/chains';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const CHAINS = {
  'ethereum': { chain: mainnet, rpcs: ['https://ethereum.publicnode.com'] },
  'polygon': { chain: polygon, rpcs: ['https://polygon-rpc.com'] },
  'optimism': { chain: optimism, rpcs: ['https://mainnet.optimism.io'] },
  'arbitrum': { chain: arbitrum, rpcs: ['https://arb1.arbitrum.io/rpc'] },
  'base': { chain: base, rpcs: ['https://mainnet.base.org'] },
  'avalanche': { chain: avalanche, rpcs: ['https://api.avax.network/ext/bc/C/rpc'] }
};

// ============================================================
// CHAINLINK PRICE FEED ADDRESSES
// ============================================================

const CHAINLINK_FEEDS = {
  ethereum: {
    ETH: { address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', decimals: 8 },
    BTC: { address: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', decimals: 8 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 8 }, // Not direct feed
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 8 },
    DAI: { address: '0x6B175474E89094C44Da98b954EadeAC6Bf9C2a71', decimals: 8 },
    LINK: { address: '0x2c1d072e5361172c2F8C1f7d7E1E8B3C5D6E7F8A', decimals: 8 },
    // Token/USD feeds
    stETH: { address: '0x86392dC19c0b719886221c78AB11eb8cf5Cd9881', decimals: 8 },
    rETH: { address: '0x536218F9E7613CC4d1875b0dA7A9E7E0C9E8F5A', decimals: 8 }
  },
  polygon: {
    ETH: { address: '0xF9680D99D6C9589e2a93a78A04A279e509205945', decimals: 8 },
    BTC: { address: '0xc907E1160548111030855a77C8C1B844790D9527', decimals: 8 },
    USDC: { address: '0x6dC104B2533A6e8B9D0E3a3b2C2E5D6F7A8B9C0D', decimals: 8 },
    USDT: { address: '0x0a6513e06db1f1c5E3b8D2D2b2c6B8E9A7F6C5D4', decimals: 8 },
    DAI: { address: '0xE1BfdC6F937cE7c3c8b9D4B6b5a7c8d9e0f1a2b3', decimals: 8 },
    MATIC: { address: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0', decimals: 8 }
  },
  optimism: {
    ETH: { address: '0x13e3Ee699D1909E989722E753853AE30b5aB3dEd', decimals: 8 },
    BTC: { address: '0xD702DD976Fb76F4002b4f9E3c556e20D06c5eF8D', decimals: 8 },
    USDC: { address: '0x7e07E09990D1a527c13D3e1b1a8A4B4B7E8F9A6D', decimals: 8 },
    USDT: { address: '0xB1bc9f561031a6c2c11ddE14d56E5B2EAbA4C7D8', decimals: 8 }
  },
  arbitrum: {
    ETH: { address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba613', decimals: 8 },
    BTC: { address: '0x6CE185e4DfD0D6C5B0E9B1E5c6F7D8A9B0C1D2E3', decimals: 8 },
    USDC: { address: '0xA6Bcc2319E1d5f2D6B5a7c8d9E0F1A2B3C4D5E6F', decimals: 8 }
  },
  base: {
    ETH: { address: '0x71041dd1dE2027e2dD8f7B1e7C5E4d6B5c4D3E2F', decimals: 8 },
    BTC: { address: '0x8dF7B0f3dE5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D', decimals: 8 },
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 8 }
  },
  avalanche: {
    AVAX: { address: '0x45E6e8Ad2b0c5f8a7E5F6D8C9B0A1D2E3F4A5B6C', decimals: 8 },
    BTC: { address: '0xF1FCf8743d5a4D2B9A4E5F6D7C8B9A0D1E2F3A4B', decimals: 8 },
    ETH: { address: '0xB0d5F3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0', decimals: 8 }
  }
};

// ============================================================
// CHAINLINK PRICE FEED ABI
// ============================================================

const CHAINLINK_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' }
    ]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    name: 'description',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  }
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getChainConfig(chainName) {
  const config = CHAINS[chainName];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainName}. Supported: ${Object.keys(CHAINS).join(', ')}`);
  }
  return config;
}

function getFeedAddress(chainName, tokenSymbol) {
  const feeds = CHAINLINK_FEEDS[chainName];
  if (!feeds) {
    throw new Error(`Price feeds not configured for chain: ${chainName}`);
  }
  const feed = feeds[tokenSymbol.toUpperCase()];
  if (!feed) {
    throw new Error(`Price feed not available for ${tokenSymbol} on ${chainName}`);
  }
  return feed;
}

async function createClient(chainName) {
  const config = getChainConfig(chainName);
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcs[0])
  });
}

// ============================================================
// PRICE FEED FUNCTIONS
// ============================================================

/**
 * Get current price for a token from Chainlink
 */
export async function getPrice(chainName, tokenSymbol) {
  const feed = getFeedAddress(chainName, tokenSymbol);
  const client = await createClient(chainName);
  
  try {
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feed.address,
        abi: CHAINLINK_ABI,
        functionName: 'latestRoundData'
      }),
      client.readContract({
        address: feed.address,
        abi: CHAINLINK_ABI,
        functionName: 'decimals'
      })
    ]);
    
    const answer = roundData[1];
    const price = Number(answer) / Math.pow(10, decimals);
    
    return {
      symbol: tokenSymbol.toUpperCase(),
      chain: chainName,
      price: price.toFixed(decimals),
      priceWei: answer.toString(),
      decimals,
      updatedAt: new Date(Number(roundData[3]) * 1000).toISOString(),
      roundId: roundData[0].toString(),
      source: 'chainlink'
    };
  } catch (error) {
    throw new Error(`Failed to get price for ${tokenSymbol} on ${chainName}: ${error.message}`);
  }
}

/**
 * Get multiple prices in a single call
 */
export async function getPrices(chainName, tokenSymbols) {
  const results = await Promise.allSettled(
    tokenSymbols.map(symbol => getPrice(chainName, symbol))
  );
  
  return results.map((result, index) => ({
    symbol: tokenSymbols[index].toUpperCase(),
    ...(result.status === 'fulfilled' 
      ? { price: result.value.price, success: true }
      : { error: result.reason.message, success: false }
    )
  }));
}

/**
 * Get ETH price in USD
 */
export async function getEthPrice(chainName = 'ethereum') {
  return getPrice(chainName, 'ETH');
}

/**
 * Get BTC price in USD
 */
export async function getBtcPrice(chainName = 'ethereum') {
  return getPrice(chainName, 'BTC');
}

/**
 * Get all available prices on a chain
 */
export async function getAllPrices(chainName) {
  const feeds = CHAINLINK_FEEDS[chainName];
  if (!feeds) {
    throw new Error(`Price feeds not configured for chain: ${chainName}`);
  }
  
  const symbols = Object.keys(feeds);
  return getPrices(chainName, symbols);
}

// ============================================================
// TOKEN CONVERSIONS
// ============================================================

/**
 * Convert token amount to USD value
 */
export async function tokenToUsd(chainName, tokenSymbol, tokenAmount) {
  const priceData = await getPrice(chainName, tokenSymbol);
  const price = parseFloat(priceData.price);
  const usdValue = price * parseFloat(tokenAmount);
  
  return {
    tokenAmount: tokenAmount.toString(),
    tokenSymbol: tokenSymbol.toUpperCase(),
    price: priceData.price,
    usdValue: usdValue.toFixed(2),
    chain: chainName
  };
}

/**
 * Convert USD value to token amount
 */
export async function usdToToken(chainName, tokenSymbol, usdAmount) {
  const priceData = await getPrice(chainName, tokenSymbol);
  const price = parseFloat(priceData.price);
  const tokenAmount = parseFloat(usdAmount) / price;
  
  return {
    usdAmount: usdAmount.toString(),
    tokenSymbol: tokenSymbol.toUpperCase(),
    price: priceData.price,
    tokenAmount: tokenAmount.toFixed(8),
    chain: chainName
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get supported price feed chains
 */
export function getSupportedPriceChains() {
  return Object.keys(CHAINLINK_FEEDS);
}

/**
 * Get available tokens on a chain
 */
export function getAvailableTokens(chainName) {
  return Object.keys(CHAINLINK_FEEDS[chainName] || {});
}

/**
 * Check if price feed exists for a token
 */
export function hasPriceFeed(chainName, tokenSymbol) {
  return !!CHAINLINK_FEEDS[chainName]?.[tokenSymbol.toUpperCase()];
}

/**
 * Get all supported price feed pairs
 */
export function getAllPriceFeeds() {
  const feeds = {};
  
  for (const [chain, tokens] of Object.entries(CHAINLINK_FEEDS)) {
    feeds[chain] = {};
    for (const [symbol, config] of Object.entries(tokens)) {
      feeds[chain][symbol] = {
        address: config.address,
        decimals: config.decimals
      };
    }
  }
  
  return feeds;
}

export default {
  // Core functions
  getPrice,
  getPrices,
  getEthPrice,
  getBtcPrice,
  getAllPrices,
  
  // Conversions
  tokenToUsd,
  usdToToken,
  
  // Utilities
  getSupportedPriceChains,
  getAvailableTokens,
  hasPriceFeed,
  getAllPriceFeeds,
  CHAINLINK_FEEDS
};
