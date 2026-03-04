/**
 * X402 Payment Chaining Service
 * 
 * Implementation of X402 (Payment Streaming for HTTP)
 * Enables per-request crypto payments for API endpoints
 * 
 * Specification: https://x402.org
 */

import { randomUUID } from 'crypto';

/**
 * X402 Header parsing and validation
 */
export class X402Payment {
  constructor() {
    this.scheme = 'x402';
  }

  /**
   * Parse X402 payment header
   * Format: x402 <scheme>:<payment_info>
   */
  parseHeader(authHeader) {
    if (!authHeader || !authHeader.startsWith('x402 ')) {
      return null;
    }

    const parts = authHeader.slice(5).split(':');
    if (parts.length < 2) {
      return null;
    }

    const scheme = parts[0];
    if (scheme !== 'erc20' && scheme !== 'native') {
      return null;
    }

    // Parse payment info
    const paymentInfo = parts.slice(1).join(':');
    const params = new URLSearchParams(paymentInfo);

    return {
      scheme,
      contract: params.get('contract'),
      token: params.get('token'),
      recipient: params.get('recipient'),
      maxAmount: params.get('maxAmount'),
      chainId: params.get('chainId'),
    };
  }

  /**
   * Create X402 payment header for a request
   */
  createHeader(payment) {
    const params = new URLSearchParams();
    if (payment.contract) params.set('contract', payment.contract);
    if (payment.token) params.set('token', payment.token);
    if (payment.recipient) params.set('recipient', payment.recipient);
    if (payment.maxAmount) params.set('maxAmount', payment.maxAmount);
    if (payment.chainId) params.set('chainId', payment.chainId);

    return `x402 ${payment.scheme}:${params.toString()}`;
  }

  /**
   * Create payment response headers
   */
  createPaymentResponse(payment) {
    return {
      'X-Payment-Required': this.createHeader(payment),
      'X-Payment-Accepted': payment.scheme,
    };
  }
}

/**
 * Payment pricing configuration
 */
export const PAYMENT_RATES = {
  // Per-request pricing in USD equivalent (wei for native, token units for ERC20)
  'wallet:create': {
    native: '1000000000000000', // 0.001 ETH
    usd: 0.01,
  },
  'wallet:send': {
    native: '2000000000000000', // 0.002 ETH
    usd: 0.02,
  },
  'identity:create': {
    native: '5000000000000000', // 0.005 ETH
    usd: 0.05,
  },
  'defi:swap': {
    native: '3000000000000000', // 0.003 ETH
    usd: 0.03,
  },
  'defi:stake': {
    native: '4000000000000000', // 0.004 ETH
    usd: 0.04,
  },
  'defi:lend': {
    native: '3000000000000000', // 0.003 ETH
    usd: 0.03,
  },
  // Default rate
  'default': {
    native: '1000000000000000', // 0.001 ETH
    usd: 0.01,
  }
};

/**
 * Get payment rate for endpoint
 */
export function getPaymentRate(endpoint) {
  // Find matching rate
  for (const [key, rate] of Object.entries(PAYMENT_RATES)) {
    if (endpoint.includes(key.split(':')[0])) {
      return rate;
    }
  }
  return PAYMENT_RATES['default'];
}

/**
 * Payment verification result
 */
export class PaymentVerification {
  constructor() {
    this.verified = false;
    this.amount = '0';
    this.txHash = null;
    this.error = null;
  }
}

/**
 * Payment service for X402
 */
export class X402Service {
  constructor(options = {}) {
    this.paymentRecipient = options.paymentRecipient;
    this.priceFeed = options.priceFeed; // Optional price feed service
    this.minConfirmations = options.minConfirmations || 1;
    this.x402 = new X402Payment();
  }

  /**
   * Check if request requires payment
   */
  requiresPayment(endpoint, method) {
    // GET requests are free, others may require payment
    if (method === 'GET') {
      return false;
    }

    // Check if endpoint is in free tier
    const freeEndpoints = ['/health', '/onboarding', '/chains'];
    if (freeEndpoints.includes(endpoint)) {
      return false;
    }

    return true;
  }

  /**
   * Create payment requirement for endpoint
   */
  createPaymentRequirement(endpoint, scheme = 'native') {
    const rate = getPaymentRate(endpoint);
    
    return {
      scheme,
      recipient: this.paymentRecipient,
      maxAmount: rate.native,
      chainId: '8453', // Base mainnet by default
      description: `Payment for ${endpoint}`,
      rates: rate,
    };
  }

  /**
   * Verify payment for a request
   */
  async verifyPayment(paymentData, expectedAmount) {
    const result = new PaymentVerification();

    if (!paymentData) {
      result.error = 'No payment provided';
      return result;
    }

    // Parse the payment
    const payment = this.x402.parseHeader(paymentData);
    if (!payment) {
      result.error = 'Invalid payment format';
      return result;
    }

    // Verify amount is sufficient
    const paymentAmount = BigInt(payment.maxAmount || '0');
    const requiredAmount = BigInt(expectedAmount);

    if (paymentAmount < requiredAmount) {
      result.error = `Insufficient payment: ${paymentAmount} < ${requiredAmount}`;
      return result;
    }

    // In a full implementation, we would:
    // 1. Verify the payment transaction on-chain
    // 2. Check confirmations
    // 3. Verify the recipient matches

    // For now, we'll just verify the structure
    result.verified = true;
    result.amount = payment.maxAmount;
    result.recipient = payment.recipient;
    result.scheme = payment.scheme;

    return result;
  }

  /**
   * Get payment header for 402 response
   */
  getPaymentHeader(endpoint) {
    const requirement = this.createPaymentRequirement(endpoint);
    return this.x402.createPaymentResponse(requirement);
  }
}

/**
 * Create X402 middleware for Express
 */
export function createPaymentMiddleware(options = {}) {
  const service = new X402Service(options);

  return async (req, res, next) => {
    // Skip for health check and free endpoints
    if (!service.requiresPayment(req.path, req.method)) {
      return next();
    }

    // Get payment header
    const paymentHeader = req.headers['x-payment'];
    
    // Get expected payment for this endpoint
    const rate = getPaymentRate(req.path);
    
    // Verify payment
    if (paymentHeader) {
      const verification = await service.verifyPayment(paymentHeader, rate.native);
      
      if (verification.verified) {
        // Attach payment info to request
        req.payment = verification;
        return next();
      }
      
      // Payment verification failed
      return res.status(402).json({
        error: 'Payment Required',
        error_code: 'PAYMENT_REQUIRED',
        payment: service.getPaymentHeader(req.path),
        message: verification.error,
      });
    }

    // No payment provided - return 402 with payment requirements
    const headers = service.getPaymentHeader(req.path);
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    return res.status(402).json({
      error: 'Payment Required',
      error_code: 'PAYMENT_REQUIRED',
      endpoint: req.path,
      rate: rate.usd,
      rateNative: rate.native,
      acceptedSchemes: ['native', 'erc20'],
      instructions: 'Include x-payment header with payment proof',
    });
  };
}

export default {
  X402Payment,
  X402Service,
  PAYMENT_RATES,
  getPaymentRate,
  createPaymentMiddleware,
};
