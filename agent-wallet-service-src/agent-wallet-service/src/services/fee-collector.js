/**
 * Fee Collection Service
 * 
 * Collects a small fee on each transaction
 */

import { parseEther, formatEther } from 'viem';

// Treasury address (where fees go)
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || null;

// Fee percentage (0.5% = 50 basis points)
const FEE_BASIS_POINTS = BigInt(process.env.FEE_BASIS_POINTS || '50');

/**
 * Calculate fee for a transaction
 * @param {string} value - Amount in ETH
 * @returns {{ fee: string, netValue: string }}
 */
export function calculateFee(value) {
  const amount = parseEther(value);
  const feeAmount = (amount * FEE_BASIS_POINTS) / 10000n;
  const netAmount = amount - feeAmount;

  return {
    fee: formatEther(feeAmount),
    netValue: formatEther(netAmount),
    feePercent: `${Number(FEE_BASIS_POINTS) / 100}%`,
    treasury: TREASURY_ADDRESS || 'Not configured'
  };
}

/**
 * Get fee configuration
 */
export function getFeeConfig() {
  return {
    feePercent: `${Number(FEE_BASIS_POINTS) / 100}%`,
    feeBasisPoints: Number(FEE_BASIS_POINTS),
    treasuryAddress: TREASURY_ADDRESS || 'Not configured',
    minFee: '0.00001 ETH',
    enabled: TREASURY_ADDRESS !== null
  };
}
