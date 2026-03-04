/**
 * API Key Authentication Middleware
 * With rate limiting (100 req/min per key)
 */

import { randomBytes } from 'crypto';
import db from '../services/db.js';

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

// Rate limit store is now in DB (rate_limit_hits table)

// Load or create API keys
function initApiKeys() {
  const count = db.prepare('SELECT COUNT(*) as count FROM api_keys').get().count;
  if (count > 0) return;

  // Create default admin key
  const defaultKey = {
    key: `sk_live_${randomBytes(32).toString('hex')}`,
    name: 'admin',
    createdAt: new Date().toISOString(),
    permissions: JSON.stringify(['read', 'write', 'admin'])
  };

  db.prepare('INSERT INTO api_keys (key, name, permissions, created_at) VALUES (?, ?, ?, ?)').run(
    defaultKey.key, defaultKey.name, defaultKey.permissions, defaultKey.createdAt
  );

  console.log(`🔑 Generated admin API key: ${defaultKey.key}`);
}

initApiKeys();

/**
 * Check rate limit for API key
 */
function checkRateLimit(keyId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Cleanup old hits beyond 2 windows ago
  db.prepare('DELETE FROM rate_limit_hits WHERE timestamp < ?').run(windowStart);

  // Count recent hits
  const hitCount = db.prepare('SELECT COUNT(*) as count FROM rate_limit_hits WHERE key_id = ? AND timestamp > ?').get(keyId, windowStart).count;

  if (hitCount >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestInWindow = db.prepare('SELECT timestamp FROM rate_limit_hits WHERE key_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 1').get(keyId, windowStart);

    return {
      allowed: false,
      remaining: 0,
      resetAt: (oldestInWindow?.timestamp || now) + RATE_LIMIT_WINDOW_MS
    };
  }

  // Add current request
  db.prepare('INSERT INTO rate_limit_hits (key_id, timestamp) VALUES (?, ?)').run(keyId, now);

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - (hitCount + 1),
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

  db.prepare('INSERT INTO api_keys (key, name, permissions, created_at) VALUES (?, ?, ?, ?)').run(
    newKey.key, newKey.name, JSON.stringify(newKey.permissions), newKey.createdAt
  );

  return newKey;
}

/**
 * List all API keys (masked)
 */
export function listApiKeys() {
  const keys = db.prepare('SELECT * FROM api_keys').all();
  return keys.map(k => ({
    key: k.key.slice(0, 12) + '...',
    name: k.name,
    createdAt: k.created_at,
    permissions: JSON.parse(k.permissions)
  }));
}

/**
 * Revoke an API key
 */
export function revokeApiKey(keyPrefix) {
  const result = db.prepare('DELETE FROM api_keys WHERE key LIKE ?').run(`${keyPrefix}%`);
  return result.changes > 0;
}

/**
 * Validate API key
 */
function validateApiKey(providedKey) {
  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(providedKey);
  if (!key) return null;
  return {
    ...key,
    permissions: JSON.parse(key.permissions)
  };
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

    // Get API key from header or query
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        hint: 'Include X-API-Key header or ?apiKey= query param'
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
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey) {
    const key = validateApiKey(apiKey);
    if (key) {
      req.apiKey = key;
    }
  }
  next();
}
