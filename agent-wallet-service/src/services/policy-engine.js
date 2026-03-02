/**
 * Policy Engine Service
 *
 * Lightweight transfer guardrails:
 * - daily limit (ETH)
 * - per transaction limit (ETH)
 * - allowed recipients (optional allowlist)
 * - blocked recipients (denylist)
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

// Opinionated presets for common safety profiles
const POLICY_PRESETS = {
  safe_default: {
    description: 'Conservative limits suitable for most agents in testnets',
    dailyLimitEth: '0.05',
    perTxLimitEth: '0.01',
    allowedRecipients: [],
    blockedRecipients: []
  },
  micro_payments: {
    description: 'Tiny transfers and experiments, ideal for early agents',
    dailyLimitEth: '0.005',
    perTxLimitEth: '0.001',
    allowedRecipients: [],
    blockedRecipients: []
  },
  high_trust_partner: {
    description: 'Higher limits for trusted, supervised flows',
    dailyLimitEth: '1',
    perTxLimitEth: '0.2',
    allowedRecipients: [],
    blockedRecipients: []
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
    allowedRecipients: Array.isArray(input.allowedRecipients)
      ? input.allowedRecipients.map(normalizeAddress).filter(Boolean)
      : [],
    blockedRecipients: Array.isArray(input.blockedRecipients)
      ? input.blockedRecipients.map(normalizeAddress).filter(Boolean)
      : [],
    label: input.label || null,
    description: input.description || null,
    owner: input.owner || null,
    updatedAt: new Date().toISOString()
  };
}

export async function getPolicy(walletAddress, { tenantId } = {}) {
  const key = normalizeAddress(walletAddress);
  if (USE_DB) {
    const found = await getPolicyDb(key, { tenantId });
    return found || {
      enabled: true,
      dailyLimitEth: null,
      perTxLimitEth: null,
      allowedRecipients: [],
      blockedRecipients: [],
      label: null,
      description: null,
      owner: null,
      updatedAt: null
    };
  }

  return policies[key] || {
    enabled: true,
    dailyLimitEth: null,
    perTxLimitEth: null,
    allowedRecipients: [],
    blockedRecipients: [],
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

export async function evaluateTransferPolicy({ walletAddress, to, valueEth, chain, timestamp = new Date().toISOString(), tenantId }) {
  const policy = await getPolicy(walletAddress, { tenantId });
  const recipient = normalizeAddress(to);
  const amount = Number(valueEth || 0);

  if (!policy.enabled) {
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

  if (policy.blockedRecipients.includes(recipient)) {
    return {
      allowed: false,
      reason: 'recipient_blocked',
      policy
    };
  }

  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipient)) {
    return {
      allowed: false,
      reason: 'recipient_not_allowlisted',
      policy
    };
  }

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

  return {
    allowed: true,
    reason: 'ok',
    policy
  };
}
