/**
 * DeFi Swap Service
 * 
 * Token swap functionality using:
 * - Uniswap V3 - swap tokens via router
 * - 0x API - aggregated DEX swaps
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  baseSepolia, base, mainnet, sepolia,
  polygon, optimism, arbitrum
} from 'viem/chains';
import { evaluateTransferPolicy } from '../policy-engine.js';
import { getWalletByAddress } from '../viem-wallet.js';
import { decrypt } from '../encryption.js';

// ============================================================
// CHAIN CONFIGURATION
// ============================================================

const CHAINS = {
  'base-sepolia': { chain: baseSepolia, rpcs: ['https://sepolia.base.org'] },
  'base': { chain: base, rpcs: ['https://mainnet.base.org'] },
  'ethereum-sepolia': { chain: sepolia, rpcs: ['https://ethereum-sepolia.publicnode.com'] },
  'ethereum': { chain: mainnet, rpcs: ['https://ethereum.publicnode.com'] },
  'polygon': { chain: polygon, rpcs: ['https://polygon-rpc.com'] },
  'optimism': { chain: optimism, rpcs: ['https://mainnet.optimism.io'] },
  'arbitrum': { chain: arbitrum, rpcs: ['https://arb1.arbitrum.io/rpc'] }
};

// ============================================================
// PROTOCOL ADDRESSES
// ============================================================

const PROTOCOL_ADDRESSES = {
  ethereum: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    zeroxExchangeProxy: '0xdef1c0ded9bec7f1a1670819833240f027b25eff'
  },
  base: {
    uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481',
    uniswapV3Quoter: '0x3d4e6f59d7c83E1c9E1dB9c9d1d8b6c6F6e8c1a2'
  },
  polygon: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
  },
  optimism: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
  },
  arbitrum: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
  }
};

// Common token addresses
const TOKEN_ADDRESSES = {
  ethereum: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EadeAC6Bf9C2a71',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393'
  },
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C4c6Fc82E5a6Ea5E7Dc34b151107b15d2E28',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    cbBTC: '0xcbB7C0000aB88B4739f9f54c9b6dF5Bf55b2dE8'
  },
  polygon: {
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x53E0bca35eC356BD5ddDFEbdD1Fc0fD03FaBad39'
  },
  optimism: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    USDT: '0x94b008aA00579c1307B0EF2c484aE9b48251bA20'
  },
  arbitrum: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f78341539c28Ed',
    USDC: '0xAF88d065d77C72cE23D6fB4D4DE14cBF3d00586d',
    USDT: '0xFd086bC7CD5D481aC85eE2A4C8F9BbDe8B3d8A5D'
  }
};

// ============================================================
// ERC20 ABI (minimal)
// ============================================================

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  }
];

// Uniswap V3 Router ABI
const UNISWAP_V3_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'params', type: 'tuple', components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' }
      ]}
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'params', type: 'tuple', components: [
        { name: 'path', type: 'bytes' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' }
      ]}
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  }
];

// Uniswap V3 Quoter ABI
const UNISWAP_V3_QUOTER_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'params', type: 'tuple', components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'fee', type: 'uint24' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' }
      ]}
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }]
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

function getProtocolAddresses(chainName) {
  const addresses = PROTOCOL_ADDRESSES[chainName];
  if (!addresses) {
    throw new Error(`Protocol addresses not configured for chain: ${chainName}`);
  }
  return addresses;
}

export function getTokenAddress(chainName, tokenSymbol) {
  const tokens = TOKEN_ADDRESSES[chainName];
  if (!tokens) {
    throw new Error(`Token addresses not configured for chain: ${chainName}`);
  }
  const address = tokens[tokenSymbol.toUpperCase()];
  if (!address) {
    throw new Error(`Token not found: ${tokenSymbol} on chain ${chainName}`);
  }
  return address;
}

async function createClient(chainName) {
  const config = getChainConfig(chainName);
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcs[0])
  });
}

async function getTokenDecimals(client, tokenAddress) {
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    return 18; // Native ETH
  }
  try {
    return await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals'
    });
  } catch {
    return 18;
  }
}

async function getTokenSymbol(client, tokenAddress) {
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    return 'ETH';
  }
  try {
    return await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol'
    });
  } catch {
    return 'UNKNOWN';
  }
}

async function getTokenBalance(client, tokenAddress, walletAddress) {
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    return await client.getBalance({ address: walletAddress });
  }
  return await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress]
  });
}

async function ensureTokenAllowance(client, walletClient, tokenAddress, spender, amount) {
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    return true; // Native ETH doesn't need approval
  }
  
  const allowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletClient.account.address, spender]
  });
  
  if (allowance < amount) {
    const { request } = await client.simulateContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount]
    });
    await walletClient.writeContract(request);
    return false;
  }
  return true;
}

// ============================================================
// UNISWAP V3 QUOTE
// ============================================================

/**
 * Get swap quote from Uniswap V3
 */
export async function getUniswapV3Quote({ chain, fromToken, toToken, amount, feeTiers = [3000, 500, 100, 2500] }) {
  const client = await createClient(chain);
  const addresses = getProtocolAddresses(chain);
  
  const amountWei = parseEther(amount.toString());
  let bestQuote = null;
  let bestAmountOut = 0n;
  
  for (const fee of feeTiers) {
    try {
      const [amountOut] = await client.readContract({
        address: addresses.uniswapV3Quoter,
        abi: UNISWAP_V3_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: amountWei,
          fee: fee,
          sqrtPriceLimitX96: 0n
        }]
      });
      
      if (amountOut > bestAmountOut) {
        bestAmountOut = amountOut;
        bestQuote = {
          protocol: 'uniswap_v3',
          chain,
          fromToken,
          toToken,
          amountIn: amount,
          amountOut: formatEther(amountOut),
          amountOutWei: amountOut.toString(),
          fee,
          priceImpact: '0', // Would need more complex calculation
          gasEstimate: '210000' // Default estimate
        };
      }
    } catch (error) {
      console.log(`Uniswap V3 quote failed for fee ${fee}:`, error.message);
      continue;
    }
  }
  
  if (!bestQuote) {
    throw new Error('No valid Uniswap V3 quote found');
  }
  
  return bestQuote;
}

// ============================================================
// 0x API QUOTE
// ============================================================

/**
 * Get swap quote from 0x API
 */
export async function getZeroxQuote({ chain, fromToken, toToken, amount, slippagePercentage = 1 }) {
  const chainIdMap = {
    'ethereum': 1,
    'ethereum-sepolia': 11155111,
    'base': 8453,
    'base-sepolia': 84532,
    'polygon': 137,
    'optimism': 10,
    'arbitrum': 42161
  };
  
  const chainId = chainIdMap[chain];
  if (!chainId) {
    throw new Error(`0x API not supported for chain: ${chain}`);
  }
  
  const sellToken = fromToken;
  const buyToken = toToken;
  const sellAmount = parseEther(amount.toString()).toString();
  
  const apiUrl = `https://api.0x.org/swap/v1/quote?chainId=${chainId}&sellToken=${sellToken}&buyToken=${buyToken}&sellAmount=${sellAmount}&slippagePercentage=${slippagePercentage / 100}`;
  
  try {
    const response = await fetch(apiUrl, {
      headers: {
        '0x-api-key': process.env.ZEROX_API_KEY || ''
      }
    });
    
    if (!response.ok) {
      throw new Error(`0x API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      protocol: '0x',
      chain,
      fromToken,
      toToken,
      amountIn: amount,
      amountOut: data.buyAmount,
      amountOutFormatted: formatEther(data.buyAmount),
      price: data.price,
      guaranteedPrice: data.guaranteedPrice,
      gasEstimate: data.gas,
      gasPrice: data.gasPrice,
      estimatedGas: data.estimatedGas,
      allowanceTarget: data.allowanceTarget,
      to: data.to,
      data: data.data,
      value: data.value,
      sellTokenAddress: data.sellTokenAddress,
      buyTokenAddress: data.buyTokenAddress
    };
  } catch (error) {
    console.error('0x quote error:', error.message);
    throw new Error(`Failed to get 0x quote: ${error.message}`);
  }
}

// ============================================================
// SWAP EXECUTION
// ============================================================

/**
 * Execute a token swap
 */
export async function executeSwap({ 
  walletAddress, 
  chain, 
  fromToken, 
  toToken, 
  amount, 
  minAmountOut, 
  provider = 'uniswap_v3', 
  feeTier = 3000,
  tenantId 
}) {
  // Get wallet
  const wallet = await getWalletByAddress(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletAddress}`);
  }
  
  // Get chain config
  const config = getChainConfig(chain);
  const addresses = getProtocolAddresses(chain);
  
  // Determine if we're swapping from native ETH
  const fromTokenAddress = fromToken.toLowerCase() === 'eth' 
    ? '0x0000000000000000000000000000000000000000'
    : fromToken;
  
  // Parse amounts
  const amountIn = parseEther(amount.toString());
  const minAmountOutWei = parseEther(minAmountOut.toString());
  
  // Policy evaluation - check if this is a valid DeFi operation
  const isToDeFi = addresses.uniswapV3Router.toLowerCase() === toToken?.toLowerCase() || 
                   addresses.zeroxExchangeProxy?.toLowerCase() === toToken?.toLowerCase();
  
  // Evaluate policy
  const policyEvaluation = await evaluateTransferPolicy({
    walletAddress,
    to: isToDeFi ? fromTokenAddress : addresses.uniswapV3Router, // Use router as recipient for policy
    valueEth: amount,
    chain,
    tenantId
  });
  
  if (!policyEvaluation.allowed) {
    throw new Error(`Policy blocked swap (${policyEvaluation.reason})`);
  }
  
  // Create wallet client
  const decryptedKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(decryptedKey);
  
  const walletClient = createWalletClient({
    chain: config.chain,
    account,
    transport: http(config.rpcs[0])
  });
  
  const publicClient = await createClient(chain);
  
  // Handle token approval if not native ETH
  if (fromTokenAddress !== '0x0000000000000000000000000000000000000000') {
    await ensureTokenAllowance(publicClient, walletClient, fromTokenAddress, addresses.uniswapV3Router, amountIn);
  }
  
  // Execute swap based on provider
  let hash;
  let receipt;
  
  if (provider === 'uniswap_v3') {
    // Build exactInputSingle params
    const params = {
      tokenIn: fromTokenAddress,
      tokenOut: toToken,
      fee: feeTier,
      recipient: walletAddress,
      deadline: BigInt(Date.now() + 30 * 60 * 1000), // 30 minutes
      amountIn,
      amountOutMinimum: minAmountOutWei,
      sqrtPriceLimitX96: 0n
    };
    
    const value = fromTokenAddress === '0x0000000000000000000000000000000000000000' ? amountIn : 0n;
    
    const { request } = await publicClient.simulateContract({
      address: addresses.uniswapV3Router,
      abi: UNISWAP_V3_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [params],
      value
    });
    
    hash = await walletClient.writeContract(request);
    receipt = await publicClient.waitForTransactionReceipt({ hash });
    
  } else if (provider === '0x') {
    // Get 0x quote first
    const quote = await getZeroxQuote({ chain, fromToken: fromTokenAddress, toToken, amount, slippagePercentage: 1 });
    
    // For 0x, we send the data to the exchange proxy
    const value = fromTokenAddress === '0x0000000000000000000000000000000000000000' ? quote.value : '0';
    
    hash = await walletClient.sendTransaction({
      to: quote.to,
      data: quote.data,
      value: parseEther(value || '0')
    });
    
    receipt = await publicClient.waitForTransactionReceipt({ hash });
    
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }
  
  return {
    success: receipt.status === 'success',
    hash,
    from: walletAddress,
    to: addresses.uniswapV3Router,
    fromToken: fromTokenAddress,
    toToken,
    amountIn: amount,
    amountOut: minAmountOut, // Minimum expected
    chain,
    provider,
    gasUsed: receipt.gasUsed?.toString(),
    explorer: getExplorerUrl(chain, hash)
  };
}

/**
 * Get best quote across all providers
 */
export async function getBestQuote({ chain, fromToken, toToken, amount }) {
  const quotes = [];
  const errors = [];
  
  // Get Uniswap V3 quote
  try {
    const uniQuote = await getUniswapV3Quote({ chain, fromToken, toToken, amount });
    quotes.push(uniQuote);
  } catch (error) {
    errors.push({ provider: 'uniswap_v3', error: error.message });
  }
  
  // Get 0x quote
  try {
    const zeroxQuote = await getZeroxQuote({ chain, fromToken, toToken, amount });
    quotes.push(zeroxQuote);
  } catch (error) {
    errors.push({ provider: '0x', error: error.message });
  }
  
  if (quotes.length === 0) {
    throw new Error(`No quotes available. Errors: ${JSON.stringify(errors)}`);
  }
  
  // Sort by amount out (highest first)
  quotes.sort((a, b) => {
    const aOut = BigInt(a.amountOutWei || a.amountOutFormatted?.replace('.', '') || '0');
    const bOut = BigInt(b.amountOutWei || b.amountOutFormatted?.replace('.', '') || '0');
    return bOut > aOut ? 1 : -1;
  });
  
  return {
    bestQuote: quotes[0],
    allQuotes: quotes,
    errors: errors.length > 0 ? errors : undefined
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'base-sepolia': `https://sepolia.basescan.org/tx/${txHash}`,
    'base': `https://basescan.org/tx/${txHash}`,
    'ethereum': `https://etherscan.io/tx/${txHash}`,
    'ethereum-sepolia': `https://sepolia.etherscan.io/tx/${txHash}`,
    'polygon': `https://polygonscan.com/tx/${txHash}`,
    'optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
    'arbitrum': `https://arbiscan.io/tx/${txHash}`
  };
  return explorers[chainName];
}

/**
 * Get supported chains for swaps
 */
export function getSupportedSwapChains() {
  return Object.keys(PROTOCOL_ADDRESSES);
}

/**
 * Get supported tokens for a chain
 */
export function getSupportedTokens(chain) {
  return TOKEN_ADDRESSES[chain] || {};
}

export default {
  getUniswapV3Quote,
  getZeroxQuote,
  executeSwap,
  getBestQuote,
  getSupportedSwapChains,
  getSupportedTokens,
  getTokenAddress,
  TOKEN_ADDRESSES,
  PROTOCOL_ADDRESSES
};
