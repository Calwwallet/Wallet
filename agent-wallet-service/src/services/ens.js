/**
 * ENS (Ethereum Name Service) Integration
 * Register .eth names for agent wallets
 */

import { createPublicClient, http, formatEther } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import {
  getEnsRegistrations,
  addEnsRegistration
} from '../repositories/ens-registration-repository.js';

let registrations = getEnsRegistrations();

// Get RPC URL
function getRpcUrl(chain) {
  const key = process.env.ALCHEMY_API_KEY;
  if (key) {
    return chain === 'ethereum' 
      ? `https://eth-mainnet.g.alchemy.com/v2/${key}`
      : `https://eth-sepolia.g.alchemy.com/v2/${key}`;
  }
  return chain === 'ethereum' 
    ? 'https://ethereum.publicnode.com'
    : 'https://ethereum-sepolia.publicnode.com';
}

/**
 * Check if ENS name is available
 * Uses ENS subgraph or direct lookup
 */
export async function checkAvailability(name, chain = 'ethereum') {
  const label = name.toLowerCase().replace('.eth', '');
  
  if (label.length < 3) {
    return { available: false, reason: 'Name too short (min 3 characters)' };
  }

  try {
    // Query ENS via ethers/ens.js approach
    const client = createPublicClient({
      chain: chain === 'ethereum' ? mainnet : sepolia,
      transport: http(getRpcUrl(chain))
    });

    // Try to resolve the name
    const address = await client.getEnsAddress({
      name: `${label}.eth`
    }).catch(() => null);

    if (address && address !== '0x0000000000000000000000000000000000000000') {
      return {
        name: `${label}.eth`,
        label,
        available: false,
        owner: address,
        chain
      };
    }

    return {
      name: `${label}.eth`,
      label,
      available: true,
      chain
    };
  } catch (error) {
    // If we can't resolve, assume it might be available
    return {
      name: `${label}.eth`,
      label,
      available: null,
      chain,
      note: 'Could not verify availability. Check on app.ens.domains',
      error: error.message
    };
  }
}

/**
 * Get registration price for ENS name
 * Prices are: $5/year for 5+ chars, $160/year for 4 chars, $640/year for 3 chars
 */
export async function getPrice(name, durationYears = 1, chain = 'ethereum') {
  const label = name.toLowerCase().replace('.eth', '');
  const len = label.length;

  // ENS pricing (USD, approximate)
  let pricePerYear;
  if (len >= 5) pricePerYear = 5;
  else if (len === 4) pricePerYear = 160;
  else if (len === 3) pricePerYear = 640;
  else return { error: 'Name too short (min 3 characters)' };

  const totalUsd = pricePerYear * durationYears;

  // Get ETH price (approximate)
  let ethPrice = 1800; // fallback
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    const data = await res.json();
    ethPrice = parseFloat(data.data.amount);
  } catch {}

  const totalEth = (totalUsd / ethPrice).toFixed(6);

  return {
    name: `${label}.eth`,
    label,
    length: len,
    durationYears,
    pricePerYearUsd: pricePerYear,
    totalUsd,
    totalEth,
    ethPriceUsd: ethPrice,
    chain,
    note: 'Approximate price. Actual price may vary. Premium applies to recently expired names.'
  };
}

/**
 * Prepare ENS registration
 * Returns info needed to register
 */
export async function prepareRegistration({ name, ownerAddress, durationYears = 1, chain = 'ethereum' }) {
  const label = name.toLowerCase().replace('.eth', '');
  
  if (label.length < 3) {
    throw new Error('Name too short (min 3 characters)');
  }

  const price = await getPrice(name, durationYears, chain);

  // Generate a random secret for commitment
  const secret = '0x' + Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  const registration = {
    name: `${label}.eth`,
    label,
    owner: ownerAddress,
    durationYears,
    secret,
    estimatedPrice: price,
    chain,
    createdAt: new Date().toISOString(),
    status: 'ready'
  };

  addEnsRegistration(registration);

  return {
    success: true,
    registration,
    instructions: [
      '1. Go to https://app.ens.domains',
      `2. Search for "${label}.eth"`,
      '3. Connect wallet with ETH',
      '4. Complete registration (commit + wait 60s + register)',
      '',
      'Or use the wallet service to auto-register (requires funded wallet)'
    ]
  };
}

/**
 * List all ENS registrations
 */
export function listRegistrations() {
  return registrations;
}

/**
 * Get registration by name
 */
export function getRegistration(name) {
  const label = name.toLowerCase().replace('.eth', '');
  return registrations.find(r => r.label === label);
}
