/**
 * API Key Authentication Middleware
 * With rate limiting (100 req/min per key)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const API_KEYS_FILE = join(process.cwd(), 'api-keys.json');
const ONBOARDING_PATH = '/onboarding';
const ALLOW_QUERY_API_KEY = process.env.ALLOW_QUERY_API_KEY === 'true';

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

// In-memory rate limit store (resets on restart)
const rateLimitStore = new Map();

// Clean up stale rate limits every minute
setInterval(() => {
  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [keyId, requests] of rateLimitStore.entries()) {
    const recent = requests.filter(time => time > windowStart);
    if (recent.length === 0) {
      rateLimitStore.delete(keyId);
    } else {
      rateLimitStore.set(keyId, recent);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Load or create API keys
function loadApiKeys() {
  if (existsSync(API_KEYS_FILE)) {
    return JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'));
  }
  // Create default admin key
  const defaultKey = {
    key: `sk_live_${randomBytes(32).toString('hex')}`,
    name: 'admin',
    createdAt: new Date().toISOString(),
    permissions: ['read', 'write', 'admin']
  };
  writeFileSync(API_KEYS_FILE, JSON.stringify([defaultKey], null, 2));
  const showSecret = process.env.SHOW_BOOTSTRAP_SECRET === 'true';
  const preview = `${defaultKey.key.slice(0, 12)}...`;
  if (showSecret) {
    console.log(`🔑 Generated admin API key: ${defaultKey.key}`);
  } else {
    console.log(`🔑 Generated admin API key: ${preview} (set SHOW_BOOTSTRAP_SECRET=true to print full key)`);
  }
  return [defaultKey];
}

function saveApiKeys(keys) {
  writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2));
}

let apiKeys = loadApiKeys();

/**
 * Check rate limit for API key
 */
function checkRateLimit(keyId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Get or create request history
  if (!rateLimitStore.has(keyId)) {
    rateLimitStore.set(keyId, []);
  }

  const requests = rateLimitStore.get(keyId);

  // Remove old requests outside window
  const recentRequests = requests.filter(time => time > windowStart);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: recentRequests[0] + RATE_LIMIT_WINDOW_MS
    };
  }

  // Add current request
  recentRequests.push(now);
  rateLimitStore.set(keyId, recentRequests);

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - recentRequests.length,
    resetAt: now + RATE_LIMIT_WINDOW_MS
  };
}

/**
 * Generate a new API key
 */
export function createApiKey(name, permissions = ['read', 'write']) {
  const newKey = {
    key: `sk_${randomBytes(32).toString('hex')}`,
    name,
    createdAt: new Date().toISOString(),
    permissions
  };
  apiKeys.push(newKey);
  saveApiKeys(apiKeys);
  return newKey;
}

/**
 * List all API keys (masked)
 */
export function listApiKeys() {
  return apiKeys.map(k => ({
    key: k.key.slice(0, 12) + '...',
    name: k.name,
    createdAt: k.createdAt,
    permissions: k.permissions
  }));
}

/**
 * Onboarding state helper
 */
export function getOnboardingState() {
  return {
    hasApiKeys: apiKeys.length > 0,
    apiKeyCount: apiKeys.length,
    firstKeyPrefix: apiKeys[0]?.key?.slice(0, 12) || null,
    docsPath: '/README.md#quick-start',
    onboardingPath: ONBOARDING_PATH
  };
}

/**
 * Revoke an API key
 */
export function revokeApiKey(keyPrefix) {
  const index = apiKeys.findIndex(k => k.key.startsWith(keyPrefix));
  if (index === -1) return false;
  apiKeys.splice(index, 1);
  saveApiKeys(apiKeys);
  return true;
}

/**
 * Validate API key
 */
function validateApiKey(providedKey) {
  const key = apiKeys.find(k => k.key === providedKey);
  if (!key) return null;
  return key;
}

/**
 * Auth middleware - check for valid API key and rate limit
 */
export function requireAuth(requiredPermission = 'read') {
  return (req, res, next) => {
    // Skip auth for health check
    if (req.path === '/health') {
      return next();
    }

    // Get API key from header (query fallback is opt-in for local dev only)
    const apiKey = req.headers['x-api-key'] || (ALLOW_QUERY_API_KEY ? req.query.apiKey : undefined);

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        hint: ALLOW_QUERY_API_KEY
          ? 'Include X-API-Key header or ?apiKey= query param'
          : 'Include X-API-Key header',
        setup: {
          onboarding: ONBOARDING_PATH,
          docs: '/README.md#quick-start',
          next: [
            'GET /onboarding for setup steps and copy/paste curl commands',
            'Create an API key with POST /api-keys using an admin key',
            'Retry with header: X-API-Key: sk_...'
          ]
        }
      });
    }

    const key = validateApiKey(apiKey);
    if (!key) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // Check rate limit
    const rateLimit = checkRateLimit(key.key);
    res.set('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    res.set('X-RateLimit-Remaining', rateLimit.remaining);
    res.set('X-RateLimit-Reset', rateLimit.resetAt);

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: RATE_LIMIT_MAX_REQUESTS,
        resetAt: new Date(rateLimit.resetAt).toISOString()
      });
    }

    // Check permission
    if (requiredPermission === 'write' && !key.permissions.includes('write') && !key.permissions.includes('admin')) {
      return res.status(403).json({ error: 'Write permission required' });
    }

    if (requiredPermission === 'admin' && !key.permissions.includes('admin')) {
      return res.status(403).json({ error: 'Admin permission required' });
    }

    // Attach key info to request
    req.apiKey = key;
    next();
  };
}

/**
 * Optional auth - doesn't block but tracks usage
 */
export function optionalAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || (ALLOW_QUERY_API_KEY ? req.query.apiKey : undefined);
  if (apiKey) {
    const key = validateApiKey(apiKey);
    if (key) {
      req.apiKey = key;
    }
  }
  next();
}
