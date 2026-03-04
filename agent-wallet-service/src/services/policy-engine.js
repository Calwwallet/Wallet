/**
 * Policy Engine Service
 *
 * Transfer guardrails with Human-in-the-Loop (HITL) support:
 * - daily limit (ETH and USD)
 * - per transaction limit (ETH and USD)
 * - allowed recipients (optional allowlist)
 * - blocked recipients (denylist)
 * - allowed contracts (smart contract allowlist)
 * - human-in-the-loop approval for large transactions
 */

import {
  getPolicyStore,
  getPolicyUsageStore,
  persistPolicies,
  persistPolicyUsage,
  getPolicyDb,
  setPolicyDb,
  getPolicyUsageDb,
  setPolicyUsageDb
} from '../repositories/policy-repository.js';

import {
  createPendingApproval,
  getPendingApprovalById,
  getApprovalStatus
} from '../repositories/pending-approval-repository.js';

// Try to import price feed for USD conversion
let tokenToUsd = null;
try {
  const priceFeed = await import('./defi/price-feed.js');
  tokenToUsd = priceFeed.tokenToUsd;
} catch (e) {
  // Price feed not available, USD limits will need manual conversion
}

// Opinionated presets for common safety profiles
const POLICY_PRESETS = {
  safe_default: {
    description: 'Conservative limits suitable for most agents in testnets',
    dailyLimitEth: '0.05',
    perTxLimitEth: '0.01',
    allowedRecipients: [],
    blockedRecipients: [],
    allowedContracts: [],
    requireHumanApproval: false,
    approvalThresholdUsd: null
  },
  micro_payments: {
    description: 'Tiny transfers and experiments, ideal for early agents',
    dailyLimitEth: '0.005',
    perTxLimitEth: '0.001',
    allowedRecipients: [],
    blockedRecipients: [],
    allowedContracts: [],
    requireHumanApproval: false,
    approvalThresholdUsd: null
  },
  high_trust_partner: {
    description: 'Higher limits for trusted, supervised flows',
    dailyLimitEth: '1',
    perTxLimitEth: '0.2',
    allowedRecipients: [],
    blockedRecipients: [],
    allowedContracts: [],
    requireHumanApproval: false,
    approvalThresholdUsd: null
  },
  // NEW: Preset with human-in-the-loop enabled
  hitl_protected: {
    description: 'All transactions over $10 require human approval - maximum protection',
    dailyLimitEth: '0.1',
    perTxLimitEth: '0.02',
    dailyLimitUsd: '10',
    perTxLimitUsd: '5',
    allowedRecipients: [],
    blockedRecipients: [],
    allowedContracts: [],
    requireHumanApproval: true,
    approvalThresholdUsd: '10'
  }
};

const USE_DB = process.env.STORAGE_BACKEND === 'db';
const policies = USE_DB ? null : getPolicyStore();
const policyUsage = USE_DB ? null : getPolicyUsageStore();

function normalizeAddress(address) {
  return (address || '').toLowerCase();
}

function sanitizePolicyInput(input = {}) {
  const dailyLimitEth = input.dailyLimitEth == null || input.dailyLimitEth === ''
    ? null
    : String(input.dailyLimitEth);

  const perTxLimitEth = input.perTxLimitEth == null || input.perTxLimitEth === ''
    ? null
    : String(input.perTxLimitEth);

  return {
    enabled: input.enabled !== false,
    dailyLimitEth,
    perTxLimitEth,
    // NEW: USD limits
    dailyLimitUsd: input.dailyLimitUsd == null ? null : String(input.dailyLimitUsd),
    perTxLimitUsd: input.perTxLimitUsd == null ? null : String(input.perTxLimitUsd),
    // Recipient lists
    allowedRecipients: Array.isArray(input.allowedRecipients)
      ? input.allowedRecipients.map(normalizeAddress).filter(Boolean)
      : [],
    blockedRecipients: Array.isArray(input.blockedRecipients)
      ? input.blockedRecipients.map(normalizeAddress).filter(Boolean)
      : [],
    // NEW: Contract allowlist
    allowedContracts: Array.isArray(input.allowedContracts)
      ? input.allowedContracts.map(normalizeAddress).filter(Boolean)
      : [],
    // NEW: Human-in-the-loop settings
    requireHumanApproval: input.requireHumanApproval === true,
    approvalThresholdEth: input.approvalThresholdEth == null ? null : String(input.approvalThresholdEth),
    approvalThresholdUsd: input.approvalThresholdUsd == null ? null : String(input.approvalThresholdUsd),
    // Metadata
    label: input.label || null,
    description: input.description || null,
    owner: input.owner || null,
    updatedAt: new Date().toISOString()
  };
}

export async function getPolicy(walletAddress, { tenantId } = {}) {
  const key = normalizeAddress(walletAddress);

  // SECURITY: Require tenantId for policy access to ensure proper isolation
  // If tenantId is not provided, don't reveal whether a policy exists
  if (!tenantId && USE_DB) {
    console.warn('SECURITY: getPolicy called without tenantId - denying access for security');
    return null;
  }

  if (USE_DB) {
    const found = await getPolicyDb(key, { tenantId });
    // If tenantId is provided but no policy exists for this wallet/tenant, return null
    // This ensures proper tenant isolation - don't reveal policy existence to other tenants
    if (!found && tenantId) {
      return null;
    }
    return found || {
      enabled: true,
      dailyLimitEth: null,
      perTxLimitEth: null,
      dailyLimitUsd: null,
      perTxLimitUsd: null,
      allowedRecipients: [],
      blockedRecipients: [],
      allowedContracts: [],
      requireHumanApproval: false,
      approvalThresholdEth: null,
      approvalThresholdUsd: null,
      label: null,
      description: null,
      owner: null,
      updatedAt: null
    };
  }

  // For file-based storage, also return null when tenantId is provided and no policy exists
  // SECURITY: Never reveal policies without tenantId
  if (!tenantId) {
    return null;
  }

  const policy = policies[key];
  if (!policy && tenantId) {
    return null;
  }

  return policy || {
    enabled: true,
    dailyLimitEth: null,
    perTxLimitEth: null,
    dailyLimitUsd: null,
    perTxLimitUsd: null,
    allowedRecipients: [],
    blockedRecipients: [],
    allowedContracts: [],
    requireHumanApproval: false,
    approvalThresholdEth: null,
    approvalThresholdUsd: null,
    label: null,
    description: null,
    owner: null,
    updatedAt: null
  };
}

export async function setPolicy(walletAddress, policyInput, { tenantId } = {}) {
  const key = normalizeAddress(walletAddress);
  if (!key) {
    throw new Error('walletAddress is required');
  }

  // SECURITY: Require tenantId for setting policies to ensure proper isolation
  if (!tenantId) {
    throw new Error('tenantId is required to set policy');
  }

  const next = sanitizePolicyInput(policyInput);
  if (USE_DB) {
    await setPolicyDb(key, next, { tenantId });
    return next;
  }

  policies[key] = next;
  persistPolicies();
  return next;
}

export function getPolicyPresets() {
  return POLICY_PRESETS;
}

export async function applyPolicyPreset(walletAddress, presetName, overrides = {}, { tenantId } = {}) {
  const base = POLICY_PRESETS[presetName];
  if (!base) {
    throw new Error(`Unknown policy preset "${presetName}". Available presets: ${Object.keys(POLICY_PRESETS).join(', ')}`);
  }
  const merged = {
    ...base,
    ...overrides
  };
  return setPolicy(walletAddress, merged, { tenantId });
}

export function getPolicyStats() {
  if (USE_DB) {
    return {
      walletCount: null,
      usageWalletCount: null
    };
  }
  return {
    walletCount: Object.keys(policies).length,
    usageWalletCount: Object.keys(policyUsage).length
  };
}

async function getDailySpentEth(walletAddress, dayKey, { tenantId } = {}) {
  const key = normalizeAddress(walletAddress);
  if (USE_DB) {
    const usage = await getPolicyUsageDb(key, { tenantId });
    return Number(usage?.[dayKey] || 0);
  }
  return Number(policyUsage[key]?.[dayKey] || 0);
}

export async function recordPolicySpend({ walletAddress, valueEth, timestamp = new Date().toISOString(), tenantId }) {
  const key = normalizeAddress(walletAddress);
  if (!key) return;

  const dayKey = timestamp.slice(0, 10);
  const amount = Number(valueEth || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;

  if (USE_DB) {
    const existing = (await getPolicyUsageDb(key, { tenantId })) || {};
    const current = Number(existing[dayKey] || 0);
    const next = { ...existing, [dayKey]: current + amount };
    await setPolicyUsageDb(key, next, { tenantId });
    return;
  }

  if (!policyUsage[key]) {
    policyUsage[key] = {};
  }

  const current = Number(policyUsage[key][dayKey] || 0);
  policyUsage[key][dayKey] = current + amount;
  persistPolicyUsage();
}

/**
 * Record USD spending for daily USD limit tracking
 * This is separate from ETH tracking since USD limits require price conversion
 */
export async function recordPolicySpendUsd({ walletAddress, valueUsd, timestamp = new Date().toISOString(), tenantId }) {
  const key = normalizeAddress(walletAddress);
  if (!key || !Number.isFinite(valueUsd) || valueUsd <= 0) return;

  const dayKey = timestamp.slice(0, 10);

  if (USE_DB) {
    const existing = (await getPolicyUsageDb(key, { tenantId })) || {};
    const dailyUsd = existing.dailyUsd || {};
    const currentUsd = Number(dailyUsd[dayKey] || 0);
    const next = { ...existing, dailyUsd: { ...dailyUsd, [dayKey]: currentUsd + valueUsd } };
    await setPolicyUsageDb(key, next, { tenantId });
    return;
  }

  // In-memory mode
  if (!policyUsage[key]) {
    policyUsage[key] = {};
  }
  if (!policyUsage[key].dailyUsd) {
    policyUsage[key].dailyUsd = {};
  }
  const currentUsd = Number(policyUsage[key].dailyUsd[dayKey] || 0);
  policyUsage[key].dailyUsd[dayKey] = currentUsd + valueUsd;
  persistPolicyUsage();
}

export async function evaluateTransferPolicy({
  walletAddress,
  to,
  valueEth,
  chain = 'ethereum',
  timestamp = new Date().toISOString(),
  tenantId,
  fromAddress,
  token = 'ETH',
  data = null,
  method = null,
  isContractCall = false,
  metadata = {}
}) {
  const policy = await getPolicy(walletAddress, { tenantId });
  const recipient = normalizeAddress(to);
  const amount = Number(valueEth || 0);

  // Calculate USD value if price feed is available
  let valueUsd = null;
  if (tokenToUsd && amount > 0) {
    try {
      const usdResult = await tokenToUsd(chain, token, String(amount));
      valueUsd = parseFloat(usdResult.usdValue);
    } catch (e) {
      // Price feed unavailable, continue without USD conversion
    }
  }

  if (!policy.enabled) {
    // Even when disabled, still track the transaction for audit purposes
    await recordPolicySpend({ walletAddress, valueEth, timestamp, tenantId });
    // Also record USD spending if available
    if (valueUsd) {
      await recordPolicySpendUsd({ walletAddress, valueUsd, timestamp, tenantId });
    }
    return {
      allowed: true,
      reason: 'policy_disabled',
      policy
    };
  }

  if (!recipient) {
    return {
      allowed: false,
      reason: 'invalid_recipient',
      policy
    };
  }

  if (!Number.isFinite(amount) || amount < 0) {
    return {
      allowed: false,
      reason: 'invalid_value',
      policy
    };
  }

  // Check blocked recipients
  if (policy.blockedRecipients.includes(recipient)) {
    return {
      allowed: false,
      reason: 'recipient_blocked',
      policy
    };
  }

  // Check allowed recipients (EOA allowlist)
  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipient)) {
    return {
      allowed: false,
      reason: 'recipient_not_allowlisted',
      policy
    };
  }

  // NEW: Check contract allowlist
  if (isContractCall && policy.allowedContracts && policy.allowedContracts.length > 0) {
    if (!policy.allowedContracts.includes(recipient)) {
      return {
        allowed: false,
        reason: 'contract_not_allowlisted',
        policy,
        context: {
          allowedContracts: policy.allowedContracts,
          attemptedContract: recipient
        }
      };
    }
  }

  // Check per-transaction ETH limit
  if (policy.perTxLimitEth != null && amount > Number(policy.perTxLimitEth)) {
    return {
      allowed: false,
      reason: 'per_tx_limit_exceeded',
      policy,
      context: {
        perTxLimitEth: policy.perTxLimitEth,
        attemptedValueEth: String(valueEth)
      }
    };
  }

  // NEW: Check per-transaction USD limit
  if (policy.perTxLimitUsd != null && valueUsd !== null && valueUsd > Number(policy.perTxLimitUsd)) {
    return {
      allowed: false,
      reason: 'per_tx_usd_limit_exceeded',
      policy,
      context: {
        perTxLimitUsd: policy.perTxLimitUsd,
        attemptedValueUsd: valueUsd.toFixed(2)
      }
    };
  }

  // Check daily ETH limit
  if (policy.dailyLimitEth != null) {
    const dayKey = timestamp.slice(0, 10);
    const spentToday = await getDailySpentEth(walletAddress, dayKey, { tenantId });
    const projected = spentToday + amount;
    const dailyLimit = Number(policy.dailyLimitEth);

    if (projected > dailyLimit) {
      return {
        allowed: false,
        reason: 'daily_limit_exceeded',
        policy,
        context: {
          dayKey,
          spentTodayEth: spentToday,
          projectedSpendEth: projected,
          dailyLimitEth: dailyLimit,
          chain
        }
      };
    }
  }

  // NEW: Check daily USD limit
  if (policy.dailyLimitUsd != null && valueUsd !== null) {
    const dayKey = timestamp.slice(0, 10);
    const usage = USE_DB ? await getPolicyUsageDb(walletAddress, { tenantId }) : (policyUsage[normalizeAddress(walletAddress)] || {});
    const spentUsdToday = Number(usage?.dailyUsd?.[dayKey] || 0);
    const projectedUsd = spentUsdToday + valueUsd;
    const dailyLimitUsd = Number(policy.dailyLimitUsd);

    if (projectedUsd > dailyLimitUsd) {
      return {
        allowed: false,
        reason: 'daily_usd_limit_exceeded',
        policy,
        context: {
          dayKey,
          spentTodayUsd: spentUsdToday.toFixed(2),
          projectedSpendUsd: projectedUsd.toFixed(2),
          dailyLimitUsd: dailyLimitUsd.toFixed(2),
          chain
        }
      };
    }
  }

  // NEW: Check if human approval is required
  if (policy.requireHumanApproval) {
    const thresholdEth = policy.approvalThresholdEth ? Number(policy.approvalThresholdEth) : null;
    const thresholdUsd = policy.approvalThresholdUsd ? Number(policy.approvalThresholdUsd) : null;

    const exceedsEthThreshold = thresholdEth !== null && amount > thresholdEth;
    const exceedsUsdThreshold = thresholdUsd !== null && valueUsd !== null && valueUsd > thresholdUsd;

    if (exceedsEthThreshold || exceedsUsdThreshold) {
      // Create a pending approval
      try {
        const pendingApproval = await createPendingApproval({
          tenantId,
          walletAddress: normalizeAddress(walletAddress),
          fromAddress: fromAddress || walletAddress,
          toAddress: recipient,
          valueEth: String(valueEth),
          valueUsd: valueUsd !== null ? valueUsd : undefined,
          chain,
          token,
          data,
          method,
          priority: (thresholdUsd && valueUsd > thresholdUsd * 2) ? 'high' : 'normal',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
          metadata
        });

        return {
          allowed: false,
          reason: 'requires_human_approval',
          policy,
          pendingApprovalId: pendingApproval.id,
          context: {
            thresholdEth: policy.approvalThresholdEth,
            thresholdUsd: policy.approvalThresholdUsd,
            attemptedValueEth: String(valueEth),
            attemptedValueUsd: valueUsd !== null ? valueUsd.toFixed(2) : null,
            chain,
            expiresAt: pendingApproval.expires_at
          }
        };
      } catch (e) {
        // If we can't create a pending approval, reject the transaction
        return {
          allowed: false,
          reason: 'approval_system_unavailable',
          policy,
          error: e.message
        };
      }
    }
  }

  return {
    allowed: true,
    reason: 'ok',
    policy,
    context: {
      valueUsd,
      dailyLimitUsd: policy.dailyLimitUsd
    }
  };
}

/**
 * Check the status of a pending approval
 * Used by agents to poll for human approval
 */
export async function checkPendingApproval(approvalId, { tenantId } = {}) {
  if (!approvalId) {
    return { allowed: false, reason: 'approval_id_required' };
  }

  try {
    const approval = await getApprovalStatus(approvalId, { tenantId });

    if (!approval) {
      return { allowed: false, reason: 'approval_not_found' };
    }

    if (approval.status === 'approved') {
      return {
        allowed: true,
        reason: 'approved',
        approvedAt: approval.approved_at,
        approvedBy: approval.approved_by
      };
    } else if (approval.status === 'rejected') {
      return {
        allowed: false,
        reason: 'rejected',
        rejectedAt: approval.rejected_at,
        rejectionReason: approval.rejection_reason
      };
    } else if (approval.status === 'expired') {
      return {
        allowed: false,
        reason: 'expired'
      };
    } else {
      // Still pending
      return {
        allowed: false,
        reason: 'pending',
        status: 'pending'
      };
    }
  } catch (e) {
    return {
      allowed: false,
      reason: 'approval_check_failed',
      error: e.message
    };
  }
}
