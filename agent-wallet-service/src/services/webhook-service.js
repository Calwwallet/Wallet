/**
 * Webhook Service
 * 
 * Webhook system for notifying external services about:
 * - Wallet events (created, funded, etc.)
 * - Transaction events (sent, confirmed, failed)
 * - Policy events (limit reached, blocked)
 * - DeFi events (swaps, staking, etc.)
 */

import 'dotenv/config';
import { encrypt, decrypt } from './encryption.js';

// ============================================================
// WEBHOOK TYPES
// ============================================================

export const WEBHOOK_EVENTS = {
  // Wallet events
  WALLET_CREATED: 'wallet.created',
  WALLET_FUNDED: 'wallet.funded',
  WALLET_DELETED: 'wallet.deleted',
  
  // Transaction events
  TRANSACTION_PENDING: 'transaction.pending',
  TRANSACTION_CONFIRMED: 'transaction.confirmed',
  TRANSACTION_FAILED: 'transaction.failed',
  
  // Policy events
  POLICY_LIMIT_REACHED: 'policy.limit_reached',
  POLICY_BLOCKED: 'policy.blocked',
  POLICY_UPDATED: 'policy.updated',
  
  // Identity events
  IDENTITY_CREATED: 'identity.created',
  IDENTITY_VERIFIED: 'identity.verified',
  
  // Multi-sig events
  MULTISIG_CREATED: 'multisig.created',
  MULTISIG_TRANSACTION_SUBMITTED: 'multisig.transaction_submitted',
  MULTISIG_TRANSACTION_CONFIRMED: 'multisig.transaction_confirmed',
  MULTISIG_TRANSACTION_EXECUTED: 'multisig.transaction_executed',
  
  // DeFi events
  DEFI_SWAP_EXECUTED: 'defi.swap_executed',
  DEFI_STAKE_EXECUTED: 'defi.stake_executed',
  DEFI_UNSTAKE_EXECUTED: 'defi.unstake_executed',
  DEFI_SUPPLY_EXECUTED: 'defi.supply_executed',
  DEFI_BORROW_EXECUTED: 'defi.borrow_executed',
  DEFI_REPAY_EXECUTED: 'defi.repay_executed',
  DEFI_WITHDRAW_EXECUTED: 'defi.withdraw_executed',
  DEFI_CROSSCHAIN_EXECUTED: 'defi.crosschain_executed'
};

// ============================================================
// WEBHOOK STORAGE
// ============================================================

// In-memory storage (would use database in production)
const webhooks = new Map();
const webhookEvents = new Map();

// ============================================================
// WEBHOOK MANAGEMENT
// ============================================================

/**
 * Register a webhook
 */
export async function registerWebhook({ url, events, secret, tenantId, name, description }) {
  if (!url) {
    throw new Error('Webhook URL is required');
  }
  
  if (!events || events.length === 0) {
    throw new Error('At least one event type is required');
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  
  // Validate event types
  for (const event of events) {
    if (!Object.values(WEBHOOK_EVENTS).includes(event)) {
      throw new Error(`Invalid event type: ${event}`);
    }
  }
  
  // Generate webhook ID
  const id = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Generate secret if not provided
  const webhookSecret = secret || generateSecret();
  
  // Store webhook
  const webhook = {
    id,
    url,
    events,
    secret: encrypt(webhookSecret),
    tenantId,
    name: name || 'Unnamed Webhook',
    description: description || '',
    active: true,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    failureCount: 0
  };
  
  webhooks.set(id, webhook);
  
  // Register event mappings
  for (const event of events) {
    if (!webhookEvents.has(event)) {
      webhookEvents.set(event, new Set());
    }
    webhookEvents.get(event).add(id);
  }
  
  return {
    id,
    url,
    events,
    name: webhook.name,
    secret: webhookSecret, // Only returned on creation
    active: true
  };
}

/**
 * List webhooks
 */
export function listWebhooks({ tenantId } = {}) {
  const result = [];
  
  for (const [id, webhook] of webhooks) {
    if (tenantId && webhook.tenantId !== tenantId) {
      continue;
    }
    result.push({
      id,
      url: webhook.url,
      events: webhook.events,
      name: webhook.name,
      description: webhook.description,
      active: webhook.active,
      createdAt: webhook.createdAt,
      lastTriggered: webhook.lastTriggered,
      failureCount: webhook.failureCount
    });
  }
  
  return result;
}

/**
 * Get webhook by ID
 */
export function getWebhook(id, { tenantId } = {}) {
  const webhook = webhooks.get(id);
  
  if (!webhook) {
    return null;
  }
  
  if (tenantId && webhook.tenantId !== tenantId) {
    return null;
  }
  
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    name: webhook.name,
    description: webhook.description,
    active: webhook.active,
    createdAt: webhook.createdAt,
    lastTriggered: webhook.lastTriggered,
    failureCount: webhook.failureCount
  };
}

/**
 * Update webhook
 */
export async function updateWebhook(id, updates, { tenantId } = {}) {
  const webhook = webhooks.get(id);
  
  if (!webhook) {
    throw new Error(`Webhook not found: ${id}`);
  }
  
  if (tenantId && webhook.tenantId !== tenantId) {
    throw new Error('Unauthorized');
  }
  
  // Update allowed fields
  if (updates.url !== undefined) {
    try {
      new URL(updates.url);
    } catch {
      throw new Error('Invalid webhook URL');
    }
    webhook.url = updates.url;
  }
  
  if (updates.events !== undefined) {
    // Validate event types
    for (const event of updates.events) {
      if (!Object.values(WEBHOOK_EVENTS).includes(event)) {
        throw new Error(`Invalid event type: ${event}`);
      }
    }
    
    // Remove old event mappings
    for (const event of webhook.events) {
      webhookEvents.get(event)?.delete(id);
    }
    
    // Add new event mappings
    webhook.events = updates.events;
    for (const event of updates.events) {
      if (!webhookEvents.has(event)) {
        webhookEvents.set(event, new Set());
      }
      webhookEvents.get(event).add(id);
    }
  }
  
  if (updates.name !== undefined) {
    webhook.name = updates.name;
  }
  
  if (updates.description !== undefined) {
    webhook.description = updates.description;
  }
  
  if (updates.active !== undefined) {
    webhook.active = updates.active;
  }
  
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    name: webhook.name,
    active: webhook.active
  };
}

/**
 * Delete webhook
 */
export function deleteWebhook(id, { tenantId } = {}) {
  const webhook = webhooks.get(id);
  
  if (!webhook) {
    throw new Error(`Webhook not found: ${id}`);
  }
  
  if (tenantId && webhook.tenantId !== tenantId) {
    throw new Error('Unauthorized');
  }
  
  // Remove event mappings
  for (const event of webhook.events) {
    webhookEvents.get(event)?.delete(id);
  }
  
  webhooks.delete(id);
  
  return { success: true };
}

/**
 * Test webhook
 */
export async function testWebhook(id, { tenantId } = {}) {
  const webhook = webhooks.get(id);
  
  if (!webhook) {
    throw new Error(`Webhook not found: ${id}`);
  }
  
  if (tenantId && webhook.tenantId !== tenantId) {
    throw new Error('Unauthorized');
  }
  
  // Send test event
  const result = await sendWebhook(webhook, {
    event: 'webhook.test',
    data: {
      message: 'This is a test webhook',
      webhookId: id,
      timestamp: new Date().toISOString()
    }
  });
  
  return result;
}

// ============================================================
// WEBHOOK DELIVERY
// ============================================================

/**
 * Trigger an event
 */
export async function triggerEvent(event, data, { tenantId } = {}) {
  // Get webhooks subscribed to this event
  const subscribedWebhooks = webhookEvents.get(event);
  
  if (!subscribedWebhooks || subscribedWebhooks.size === 0) {
    return { delivered: 0, failed: 0 };
  }
  
  let delivered = 0;
  let failed = 0;
  
  for (const webhookId of subscribedWebhooks) {
    const webhook = webhooks.get(webhookId);
    
    // Check if webhook is active
    if (!webhook || !webhook.active) {
      continue;
    }
    
    // Check tenant isolation
    if (tenantId && webhook.tenantId !== tenantId) {
      continue;
    }
    
    // Send webhook
    const success = await sendWebhook(webhook, { event, data });
    
    if (success) {
      delivered++;
    } else {
      failed++;
    }
  }
  
  return { delivered, failed };
}

/**
 * Send webhook to a specific URL
 */
async function sendWebhook(webhook, payload) {
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const secret = decrypt(webhook.secret);
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': payload.event,
          'X-Webhook-Id': webhook.id,
          'X-Webhook-Signature': generateSignature(payload, secret)
        },
        body: JSON.stringify({
          id: `evt_${Date.now()}`,
          type: payload.event,
          timestamp: new Date().toISOString(),
          data: payload.data
        }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      if (response.ok) {
        // Update last triggered
        webhook.lastTriggered = new Date().toISOString();
        webhook.failureCount = 0;
        return true;
      }
      
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error;
      
      // Don't retry on abort
      if (error.name === 'AbortError') {
        break;
      }
    }
    
    // Wait before retry
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  // Update failure count
  webhook.failureCount++;
  console.error(`Webhook delivery failed: ${webhook.id}`, lastError?.message);
  
  return false;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function generateSecret() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return 'whsec_' + Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateSignature(payload, secret) {
  // Simple HMAC-like signature (in production, use crypto.createHmac)
  const data = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);
  
  // Simple hash-based signature (for demo purposes)
  let hash = 0;
  const str = data + secret;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `sha256=${Math.abs(hash).toString(16)}`;
}

// ============================================================
// CONVENIENCE METHODS
// ============================================================

/**
 * Trigger wallet created event
 */
export async function onWalletCreated(wallet, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.WALLET_CREATED, wallet, { tenantId });
}

/**
 * Trigger wallet funded event
 */
export async function onWalletFunded(wallet, amount, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.WALLET_FUNDED, { wallet, amount }, { tenantId });
}

/**
 * Trigger transaction confirmed event
 */
export async function onTransactionConfirmed(tx, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.TRANSACTION_CONFIRMED, tx, { tenantId });
}

/**
 * Trigger transaction failed event
 */
export async function onTransactionFailed(tx, error, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.TRANSACTION_FAILED, { tx, error: error.message }, { tenantId });
}

/**
 * Trigger policy blocked event
 */
export async function onPolicyBlocked(policy, tx, reason, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.POLICY_BLOCKED, { policy, tx, reason }, { tenantId });
}

/**
 * Trigger DeFi swap event
 */
export async function onDefiSwapExecuted(swap, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.DEFI_SWAP_EXECUTED, swap, { tenantId });
}

/**
 * Trigger DeFi stake event
 */
export async function onDefiStakeExecuted(stake, { tenantId } = {}) {
  return triggerEvent(WEBHOOK_EVENTS.DEFI_STAKE_EXECUTED, stake, { tenantId });
}

/**
 * Get available webhook events
 */
export function getWebhookEvents() {
  return Object.entries(WEBHOOK_EVENTS).map(([name, value]) => ({
    name,
    value,
    description: getEventDescription(value)
  }));
}

function getEventDescription(event) {
  const descriptions = {
    [WEBHOOK_EVENTS.WALLET_CREATED]: 'Triggered when a new wallet is created',
    [WEBHOOK_EVENTS.WALLET_FUNDED]: 'Triggered when a wallet receives funds',
    [WEBHOOK_EVENTS.WALLET_DELETED]: 'Triggered when a wallet is deleted',
    [WEBHOOK_EVENTS.TRANSACTION_PENDING]: 'Triggered when a transaction is pending',
    [WEBHOOK_EVENTS.TRANSACTION_CONFIRMED]: 'Triggered when a transaction is confirmed',
    [WEBHOOK_EVENTS.TRANSACTION_FAILED]: 'Triggered when a transaction fails',
    [WEBHOOK_EVENTS.POLICY_LIMIT_REACHED]: 'Triggered when a policy limit is reached',
    [WEBHOOK_EVENTS.POLICY_BLOCKED]: 'Triggered when a transaction is blocked by policy',
    [WEBHOOK_EVENTS.POLICY_UPDATED]: 'Triggered when a policy is updated',
    [WEBHOOK_EVENTS.IDENTITY_CREATED]: 'Triggered when an identity is created',
    [WEBHOOK_EVENTS.IDENTITY_VERIFIED]: 'Triggered when an identity is verified',
    [WEBHOOK_EVENTS.MULTISIG_CREATED]: 'Triggered when a multi-sig wallet is created',
    [WEBHOOK_EVENTS.MULTISIG_TRANSACTION_SUBMITTED]: 'Triggered when a multi-sig transaction is submitted',
    [WEBHOOK_EVENTS.MULTISIG_TRANSACTION_CONFIRMED]: 'Triggered when a multi-sig transaction is confirmed',
    [WEBHOOK_EVENTS.MULTISIG_TRANSACTION_EXECUTED]: 'Triggered when a multi-sig transaction is executed',
    [WEBHOOK_EVENTS.DEFI_SWAP_EXECUTED]: 'Triggered when a token swap is executed',
    [WEBHOOK_EVENTS.DEFI_STAKE_EXECUTED]: 'Triggered when a staking operation is executed',
    [WEBHOOK_EVENTS.DEFI_UNSTAKE_EXECUTED]: 'Triggered when an unstaking operation is executed',
    [WEBHOOK_EVENTS.DEFI_SUPPLY_EXECUTED]: 'Triggered when assets are supplied to a lending protocol',
    [WEBHOOK_EVENTS.DEFI_BORROW_EXECUTED]: 'Triggered when assets are borrowed',
    [WEBHOOK_EVENTS.DEFI_REPAY_EXECUTED]: 'Triggered when debt is repaid',
    [WEBHOOK_EVENTS.DEFI_WITHDRAW_EXECUTED]: 'Triggered when assets are withdrawn from lending',
    [WEBHOOK_EVENTS.DEFI_CROSSCHAIN_EXECUTED]: 'Triggered when a cross-chain transfer is executed'
  };
  
  return descriptions[event] || 'Custom event';
}

export default {
  // Constants
  WEBHOOK_EVENTS,
  
  // Management
  registerWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  
  // Triggering
  triggerEvent,
  
  // Convenience methods
  onWalletCreated,
  onWalletFunded,
  onTransactionConfirmed,
  onTransactionFailed,
  onPolicyBlocked,
  onDefiSwapExecuted,
  onDefiStakeExecuted,
  
  // Utility
  getWebhookEvents
};
