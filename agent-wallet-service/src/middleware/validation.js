import { z } from 'zod';
import { sendError } from '../utils/error-envelope.js';

/**
 * Zod Validation Middleware
 * Provides request validation using Zod schemas
 */

// ============================================================
// Common Schemas
// ============================================================

/** Ethereum address schema */
export const ethAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/** Chain ID or name schema */
export const chainSchema = z.string().min(1).optional();

/** Pagination schema */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// ============================================================
// Wallet Schemas
// ============================================================

/** POST /wallet/create */
export const createWalletSchema = z.object({
  agentName: z.string().min(1).max(100).describe('Name for the agent wallet'),
  chain: chainSchema.default('base-sepolia')
});

/** POST /wallet/import */
export const importWalletSchema = z.object({
  privateKey: z.string().regex(/^(0x)?[a-fA-F0-9]{64}$/, 'Invalid private key'),
  agentName: z.string().min(1).max(100).optional(),
  chain: chainSchema.default('base-sepolia')
});

/** POST /wallet/estimate-gas */
export const estimateGasSchema = z.object({
  from: ethAddressSchema,
  to: ethAddressSchema,
  value: z.string().optional(),
  data: z.string().optional(),
  chain: chainSchema,
  rpcUrl: z.string().url().optional()
});

/** POST /wallet/:address/send */
export const sendTransactionSchema = z.object({
  to: ethAddressSchema,
  value: z.string().default('0'),
  data: z.string().default('0x'),
  chain: chainSchema,
  rpcUrl: z.string().url().optional()
});

/** POST /wallet/:address/sweep */
export const sweepWalletSchema = z.object({
  to: ethAddressSchema,
  chain: chainSchema,
  rpcUrl: z.string().url().optional()
});

/** PUT /wallet/policy/:address */
export const setPolicySchema = z.object({
  preset: z.string().optional(),
  // Policy fields
  enabled: z.boolean().optional(),
  perTxLimitEth: z.string().optional(),
  dailyLimitEth: z.string().optional(),
  allowedRecipients: z.array(ethAddressSchema).optional(),
  blockedRecipients: z.array(ethAddressSchema).optional(),
  allowedTokens: z.array(z.string()).optional(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional()
});

/** POST /wallet/policy/:address/evaluate */
export const evaluatePolicySchema = z.object({
  to: ethAddressSchema.optional(),
  value: z.string().default('0'),
  chain: chainSchema,
  timestamp: z.number().optional(),
  dryRun: z.boolean().default(true)
});

// ============================================================
// Identity Schemas
// ============================================================

/** POST /identity/create */
export const createIdentitySchema = z.object({
  walletAddress: ethAddressSchema,
  agentName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  agentType: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  owner: ethAddressSchema.optional(),
  chain: chainSchema
});

/** POST /identity/:agentId/pay */
export const agentPaySchema = z.object({
  to: ethAddressSchema,
  amountEth: z.string(),
  chain: chainSchema,
  memo: z.string().max(200).optional(),
  dryRun: z.boolean().default(false)
});

/** PATCH /identity/:agentId/capability */
export const updateCapabilitySchema = z.object({
  capability: z.string().min(1),
  granted: z.boolean().default(true)
});

// ============================================================
// API Key Schemas
// ============================================================

/** POST /api-keys */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string().min(1)).min(1)
});

/** DELETE /api-keys/:prefix */
export const apiKeyPrefixParamSchema = z.object({
  prefix: z.string().min(1).max(32)
});

// ============================================================
// ENS Schemas
// ============================================================

/** POST /ens/register */
export const registerEnsSchema = z.object({
  name: z.string().min(3).max(100).regex(/^[a-zA-Z0-9-]+\.claw$/i, 'Invalid ENS name format'),
  walletAddress: ethAddressSchema,
  duration: z.number().int().min(1).max(100).default(1),
  chain: chainSchema.default('base-sepolia')
});

/** POST /ens/resolve */
export const resolveEnsSchema = z.object({
  name: z.string().min(3).max(100)
});

// ============================================================
// Middleware Factory
// ============================================================

/**
 * Create validation middleware for a given Zod schema
 * @param {z.ZodSchema} schema - The Zod schema to validate against
 * @param {string} property - Which property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export function validate(schema, property = 'body') {
  return (req, res, next) => {
    try {
      const data = req[property];
      const result = schema.parse(data);
      req.validated = req.validated || {};
      req.validated[property] = result;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'Validation failed',
          error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        );
      }
      return sendError(res, 500, 'INTERNAL_ERROR', 'Validation error');
    }
  };
}

/**
 * Validate Ethereum address in route params
 */
export function validateAddress(paramName = 'address') {
  return (req, res, next) => {
    const address = req.params[paramName];
    const result = ethAddressSchema.safeParse(address);
    if (!result.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', `Invalid ${paramName}`, result.error.errors);
    }
    next();
  };
}

/**
 * Validate agent ID format
 */
export function validateAgentId(paramName = 'agentId') {
  return (req, res, next) => {
    const agentId = req.params[paramName];
    // Agent ID should be a non-empty string
    if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', `Invalid ${paramName}`);
    }
    next();
  };
}

// ============================================================
// AGENT & ECONOMY Schemas (Universal - NO DISCRIMINATION!)
// ============================================================

/** Supported agent types - for ALL AI agents! */
export const agentTypes = [
  'openclaw', 'langchain', 'autogen', 'crewai',
  'anthropic', 'claude', 'openai', 'gemini',
  'llama', 'mistral', 'custom', 'other'
];

/** POST /agents/register */
export const agentRegistrationSchema = z.object({
  agentName: z.string()
    .min(1, 'Agent name is required')
    .max(100, 'Agent name too long')
    .regex(/^[a-zA-Z0-9-]+$/, 'Agent name can only contain letters, numbers, and hyphens'),
  agentType: z.enum(agentTypes).default('custom'),
  metadata: z.record(z.any()).optional(),
  walletAddress: ethAddressSchema.optional(),
});

/** POST /agents/pay */
export const agentPaymentSchema = z.object({
  toAgent: z.string().min(1, 'Recipient agent required'),
  amount: z.string().min(1, 'Amount required'),
  token: z.string().default('eth'),
  type: z.enum(['service', 'tip', 'subscription', 'referral', 'bounty', 'custom']).default('service'),
  description: z.string().max(500).optional(),
  serviceId: z.string().optional(),
});

/** POST /agents/:agentName/services */
export const serviceListingSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.string().min(1, 'Price required'),
  priceUsd: z.number().positive().optional(),
  accepts: z.array(z.string()).optional(),
  endpoint: z.string().url().optional(),
  metadata: z.record(z.any()).optional(),
});
