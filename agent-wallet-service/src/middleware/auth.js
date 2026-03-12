/**
 * API Key Authentication Middleware
 * With weighted, tier-aware rate limiting.
 */

import { randomBytes, randomUUID } from 'crypto';
import { loadApiKeysRaw, saveApiKeys } from '../repositories/api-key-repository.js';
import { getRedis } from '../services/redis.js';
import { getDb } from '../services/db.js';
import { hashApiKey } from '../utils/api-key-hash.js';
import { sendError } from '../utils/error-envelope.js';
const ONBOARDING_PATH = '/onboarding';

const USE_DB_AUTH = process.env.AUTH_BACKEND === 'db' || process.env.STORAGE_BACKEND === 'db';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default tenant';
const ALLOW_QUERY_API_KEY_FALLBACK = process.env.ALLOW_QUERY_API_KEY_FALLBACK === 'true' && process.env.NODE_ENV !== 'production';

function getPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const RATE_LIMIT_WINDOW_MS = getPositiveIntEnv('RATE_LIMIT_WINDOW_MS', 60 * 1000);
const RATE_LIMIT_DEFAULT_TIER = process.env.RATE_LIMIT_DEFAULT_TIER || 'free';
const RATE_LIMIT_MAX_POINTS_BY_TIER = {
  free: getPositiveIntEnv('RATE_LIMIT_MAX_POINTS_FREE', 100),
  pro: getPositiveIntEnv('RATE_LIMIT_MAX_POINTS_PRO', 300),
  enterprise: getPositiveIntEnv('RATE_LIMIT_MAX_POINTS_ENTERPRISE', 1000)
};
const RATE_LIMIT_COST_READ = getPositiveIntEnv('RATE_LIMIT_COST_READ', 1);
const RATE_LIMIT_COST_WRITE = getPositiveIntEnv('RATE_LIMIT_COST_WRITE', 2);
const RATE_LIMIT_COST_EXPENSIVE = getPositiveIntEnv('RATE_LIMIT_COST_EXPENSIVE', 10);

const EXPENSIVE_ROUTE_RULES = [
  { method: 'POST', pattern: /^\/wallet\/[^/]+\/(send|sweep)$/ },
  { method: 'POST', pattern: /^\/defi\/(swap|stake|unstake|supply|borrow|repay|withdraw|collateral|crosschain)$/ },
  { method: 'POST', pattern: /^\/multisig\/[^/]+\/(submit|submit-batch|execute|confirm|cancel)$/ },
  { method: 'GET', pattern: /^\/wallet\/[^/]+\/balance\/all$/ }
];

// In-memory rate limit store (resets on restart)
const rateLimitStore = new Map();

const RATE_LIMIT_STRATEGY = (process.env.RATE_LIMIT_STRATEGY || 'memory').toLowerCase();
const USE_REDIS_RATE_LIMIT = RATE_LIMIT_STRATEGY === 'redis';
let redisClient = null;
if (USE_REDIS_RATE_LIMIT) {
  if (!process.env.REDIS_URL) {
    console.warn('RATE_LIMIT_STRATEGY=redis but REDIS_URL is not set. Falling back to in-memory rate limiting.');
  }
  try {
    redisClient = process.env.REDIS_URL ? getRedis() : null;
  } catch (err) {
    console.warn('Redis not configured correctly, falling back to in-memory rate limiting:', err.message);
    redisClient = null;
  }
}

// Clean up stale in-memory rate limits every window
setInterval(() => {
  const now = Date.now();
  for (const [keyId, state] of rateLimitStore.entries()) {
    if (now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(keyId);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// JSON auth backend state
function loadApiKeysJson() {
  const existing = loadApiKeysRaw();
  if (existing.length > 0) return existing;

  const rawKey = `sk_live_${randomBytes(32).toString('hex')}`;
  const defaultKey = {
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 12),
    name: 'admin',
    createdAt: new Date().toISOString(),
    permissions: ['read', 'write', 'admin']
  };
  saveApiKeys([defaultKey]);

  const showSecret = process.env.SHOW_BOOTSTRAP_SECRET === 'true' && process.env.NODE_ENV !== 'production';
  const preview = `${rawKey.slice(0, 12)}...`;
  if (showSecret) {
    console.log(`🔑 Generated admin API key: ${rawKey}`);
  } else {
    console.log(`🔑 Generated admin API key: ${preview} (set SHOW_BOOTSTRAP_SECRET=true to print full key)`);
  }

  return [defaultKey];
}

let apiKeys = USE_DB_AUTH ? [] : loadApiKeysJson();

let dbInitPromise = null;
async function initDbAuth() {
  if (!USE_DB_AUTH) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    const db = getDb();

    // Ensure default tenant exists
    await db.query(
      `insert into tenants(id, name) values ($1, $2)
       on conflict (id) do update set name = excluded.name`,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME]
    );

    // Ensure at least one admin key exists for default tenant
    const existing = await db.query(
      `select id from api_keys where tenant_id = $1 and revoked_at is null limit 1`,
      [DEFAULT_TENANT_ID]
    );

    if (existing.rowCount === 0) {
      const rawKey = `sk_live_${randomBytes(32).toString('hex')}`;
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12);
      const id = `ak_${randomUUID()}`;

      await db.query(
        `insert into api_keys(id, tenant_id, key_hash, key_prefix, name, permissions)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, DEFAULT_TENANT_ID, keyHash, keyPrefix, 'admin', JSON.stringify(['read', 'write', 'admin'])]
      );

      const showSecret = process.env.SHOW_BOOTSTRAP_SECRET === 'true' && process.env.NODE_ENV !== 'production';
      const preview = `${rawKey.slice(0, 12)}...`;
      if (showSecret) {
        console.log(`🔑 Generated admin API key: ${rawKey}`);
      } else {
        console.log(`🔑 Generated admin API key: ${preview} (set SHOW_BOOTSTRAP_SECRET=true to print full key)`);
      }
    }
  })();

  return dbInitPromise;
}

const REDIS_RATE_LIMIT_LUA = `
local key = KEYS[1]
local weight = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')

if current == 0 then
  redis.call('SET', key, weight, 'PX', ttl, 'NX')
  local pttl = redis.call('PTTL', key)
  return { weight, pttl }
end

local updated = redis.call('INCRBY', key, weight)
local pttl = redis.call('PTTL', key)

if pttl < 0 then
  redis.call('PEXPIRE', key, ttl)
  pttl = ttl
end

return { updated, pttl }
`;

function resolveRateLimitTier(permissions = []) {
  const normalized = Array.isArray(permissions) ? permissions : [];
  for (const permission of normalized) {
    if (typeof permission === 'string' && permission.startsWith('tier:')) {
      const tier = permission.slice('tier:'.length).trim().toLowerCase();
      if (RATE_LIMIT_MAX_POINTS_BY_TIER[tier]) return tier;
    }
  }
  if (normalized.includes('admin')) return 'enterprise';
  if (normalized.includes('write')) return 'pro';
  return RATE_LIMIT_MAX_POINTS_BY_TIER[RATE_LIMIT_DEFAULT_TIER] ? RATE_LIMIT_DEFAULT_TIER : 'free';
}

function resolveRpcMode(permissions = [], tier = 'free') {
  const normalized = Array.isArray(permissions) ? permissions : [];
  for (const permission of normalized) {
    if (typeof permission !== 'string') continue;
    if (!permission.startsWith('rpc:')) continue;
    const mode = permission.slice('rpc:'.length).trim().toLowerCase();
    if (mode === 'byo' || mode === 'managed') {
      return mode;
    }
  }

  if (tier === 'free') return 'byo';
  return 'managed';
}

function resolveRateLimitLimit(tier) {
  return RATE_LIMIT_MAX_POINTS_BY_TIER[tier] || RATE_LIMIT_MAX_POINTS_BY_TIER.free;
}

function getNormalizedRequestPath(req) {
  const original = typeof req.originalUrl === 'string'
    ? req.originalUrl
    : `${req.baseUrl || ''}${req.path || ''}`;
  return (original.split('?')[0] || '/').toLowerCase();
}

function getRequestCost(req) {
  const path = getNormalizedRequestPath(req);
  const method = (req.method || 'GET').toUpperCase();
  for (const rule of EXPENSIVE_ROUTE_RULES) {
    if (rule.method === method && rule.pattern.test(path)) {
      return RATE_LIMIT_COST_EXPENSIVE;
    }
  }
  return ['GET', 'HEAD', 'OPTIONS'].includes(method)
    ? RATE_LIMIT_COST_READ
    : RATE_LIMIT_COST_WRITE;
}

function buildRateLimitKey({ keyId, tier, tenantId }) {
  // Include tenantId to ensure rate limits are per-tenant, not shared across tenants
  const tenantPart = tenantId || 'default';
  return `rl:v2:${tier}:${tenantPart}:${keyId}`;
}

function checkRateLimitInMemory(keyId, { limit, cost }) {
  const now = Date.now();
  let state = rateLimitStore.get(keyId);

  if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
    state = { windowStart: now, count: 0 };
  }

  const nextCount = state.count + cost;
  const resetAt = state.windowStart + RATE_LIMIT_WINDOW_MS;

  if (nextCount > limit) {
    rateLimitStore.set(keyId, state);
    return {
      allowed: false,
      limit,
      cost,
      remaining: 0,
      resetAt
    };
  }

  state.count = nextCount;
  rateLimitStore.set(keyId, state);
  return {
    allowed: true,
    limit,
    cost,
    remaining: Math.max(limit - state.count, 0),
    resetAt
  };
}

async function checkRateLimitRedis(keyId, { limit, cost }) {
  if (!redisClient) {
    return checkRateLimitInMemory(keyId, { limit, cost });
  }
  const now = Date.now();
  const key = keyId;
  const result = await redisClient.eval(
    REDIS_RATE_LIMIT_LUA,
    1,
    key,
    String(cost),
    String(RATE_LIMIT_WINDOW_MS)
  );

  const count = Number(Array.isArray(result) ? result[0] : 0);
  const ttl = Math.max(Number(Array.isArray(result) ? result[1] : RATE_LIMIT_WINDOW_MS), 0);
  return {
    allowed: count <= limit,
    limit,
    cost,
    remaining: Math.max(limit - count, 0),
    resetAt: now + ttl
  };
}

async function checkRateLimit(keyId, { limit, cost }) {
  if (USE_REDIS_RATE_LIMIT && redisClient) {
    try {
      return await checkRateLimitRedis(keyId, { limit, cost });
    } catch (err) {
      console.warn('Redis rate limit check failed, falling back to memory:', err.message);
      return checkRateLimitInMemory(keyId, { limit, cost });
    }
  }
  return checkRateLimitInMemory(keyId, { limit, cost });
}

/**
 * Generate a new API key
 */
export async function createApiKey(name, permissions = ['read', 'write'], { tenantId } = {}) {
  if (USE_DB_AUTH) {
    await initDbAuth();
    const db = getDb();
    const rawKey = `sk_${randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const id = `ak_${randomUUID()}`;
    const resolvedTenant = tenantId || DEFAULT_TENANT_ID;

    await db.query(
      `insert into api_keys(id, tenant_id, key_hash, key_prefix, name, permissions)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, resolvedTenant, keyHash, keyPrefix, name, JSON.stringify(permissions)]
    );

    return {
      key: rawKey,
      name,
      createdAt: new Date().toISOString(),
      permissions
    };
  }

  const rawKey = `sk_${randomBytes(32).toString('hex')}`;
  const newKey = {
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 12),
    name,
    createdAt: new Date().toISOString(),
    permissions
  };
  apiKeys.push(newKey);
  saveApiKeys(apiKeys);
  return {
    key: rawKey,
    name,
    createdAt: newKey.createdAt,
    permissions
  };
}

/**
 * List all API keys (masked)
 */
export async function listApiKeys({ tenantId } = {}) {
  if (USE_DB_AUTH) {
    await initDbAuth();
    const db = getDb();
    const resolvedTenant = tenantId || DEFAULT_TENANT_ID;
    const res = await db.query(
      `select key_prefix, name, created_at, permissions
       from api_keys
       where tenant_id = $1 and revoked_at is null
       order by created_at desc`,
      [resolvedTenant]
    );

    return res.rows.map((k) => ({
      key: `${k.key_prefix}...`,
      name: k.name,
      createdAt: k.created_at,
      permissions: k.permissions
    }));
  }

  return apiKeys.map(k => ({
    key: `${k.keyPrefix}...`,
    name: k.name,
    createdAt: k.createdAt,
    permissions: k.permissions
  }));
}

/**
 * Onboarding state helper
 */
export async function getOnboardingState() {
  if (USE_DB_AUTH) {
    await initDbAuth();
    const db = getDb();
    const res = await db.query(
      `select count(*)::int as count, min(key_prefix) as first_prefix
       from api_keys where tenant_id = $1 and revoked_at is null`,
      [DEFAULT_TENANT_ID]
    );
    const count = res.rows?.[0]?.count || 0;
    const first = res.rows?.[0]?.first_prefix || null;
    return {
      hasApiKeys: count > 0,
      apiKeyCount: count,
      firstKeyPrefix: first,
      docsPath: '/README.md#quick-start',
      onboardingPath: ONBOARDING_PATH
    };
  }

  return {
    hasApiKeys: apiKeys.length > 0,
    apiKeyCount: apiKeys.length,
    firstKeyPrefix: apiKeys[0]?.keyPrefix || null,
    docsPath: '/README.md#quick-start',
    onboardingPath: ONBOARDING_PATH
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyPrefix, { tenantId } = {}) {
  if (USE_DB_AUTH) {
    await initDbAuth();
    const db = getDb();
    const resolvedTenant = tenantId || DEFAULT_TENANT_ID;
    const res = await db.query(
      `update api_keys
       set revoked_at = now()
       where tenant_id = $1 and key_prefix = $2 and revoked_at is null`,
      [resolvedTenant, keyPrefix]
    );
    return res.rowCount > 0;
  }

  const index = apiKeys.findIndex(k => k.keyPrefix === keyPrefix || k.keyPrefix.startsWith(keyPrefix));
  if (index === -1) return false;
  apiKeys.splice(index, 1);
  saveApiKeys(apiKeys);
  return true;
}

/**
 * Validate API key
 */
function validateApiKeyJson(providedKey) {
  const providedHash = hashApiKey(providedKey);
  const key = apiKeys.find(k => k.keyHash === providedHash);
  if (!key) return null;
  return key;
}

async function validateApiKeyDb(providedKey) {
  await initDbAuth();
  const db = getDb();
  const keyHash = hashApiKey(providedKey);
  const res = await db.query(
    `select ak.id, ak.tenant_id, ak.name, ak.permissions, t.name as tenant_name
     from api_keys ak
     join tenants t on t.id = ak.tenant_id
     where ak.key_hash = $1 and ak.revoked_at is null
     limit 1`,
    [keyHash]
  );

  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  return {
    id: row.id,
    name: row.name,
    permissions: row.permissions,
    tenant: { id: row.tenant_id, name: row.tenant_name }
  };
}

function buildRateLimitSubject({ isDbAuth, key, req }) {
  if (isDbAuth && req.tenant?.id && req.apiKey?.id) {
    return `${req.tenant.id}:${req.apiKey.id}`;
  }
  if (isDbAuth) {
    return `db_fallback:${key?.id || 'unknown'}`;
  }
  return key?.keyHash || 'anonymous';
}

function hasPermission(requiredPermission, permissions = []) {
  if (requiredPermission === 'read') return true;
  if (requiredPermission === 'write') {
    return permissions.includes('write') || permissions.includes('admin');
  }
  if (requiredPermission === 'admin') {
    return permissions.includes('admin');
  }
  return false;
}

function setRateLimitHeaders(res, rateLimit) {
  const resetInSeconds = Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  const limit = String(rateLimit.limit);
  const remaining = String(Math.max(rateLimit.remaining, 0));
  const reset = String(resetInSeconds);

  // RFC-style headers
  res.set('RateLimit-Limit', limit);
  res.set('RateLimit-Remaining', remaining);
  res.set('RateLimit-Reset', reset);
  res.set('RateLimit-Policy', `${rateLimit.limit};w=${Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)}`);

  // Backward-compatible headers
  res.set('X-RateLimit-Limit', limit);
  res.set('X-RateLimit-Remaining', remaining);
  res.set('X-RateLimit-Reset', String(rateLimit.resetAt));
  res.set('X-RateLimit-Cost', String(rateLimit.cost));
  res.set('X-RateLimit-Strategy', redisClient ? 'redis' : 'memory');

  return resetInSeconds;
}

function setPlanHeaders(res, { tier, rpcMode }) {
  res.set('X-Plan-Tier', tier);
  res.set('X-RPC-Mode', rpcMode);
}

/**
 * Auth middleware - check for valid API key and rate limit
 */
export function requireAuth(requiredPermission = 'read') {
  return async (req, res, next) => {
    // Skip auth for health check
    if (req.path === '/health') {
      return next();
    }

    // Avoid duplicate auth/rate-limit checks when requireAuth is stacked
    if (req.authContext?.authenticated) {
      if (!hasPermission(requiredPermission, req.authContext.permissions)) {
        return sendError(
          res,
          403,
          requiredPermission === 'admin' ? 'ADMIN_PERMISSION_REQUIRED' : 'WRITE_PERMISSION_REQUIRED',
          requiredPermission === 'admin' ? 'Admin permission required' : 'Write permission required'
        );
      }
      return next();
    }

    // Get API key from header only
    const apiKeyFromHeader = req.headers['x-api-key'];
    const apiKeyFromQuery = req.query?.apiKey;
    const apiKey = apiKeyFromHeader || (ALLOW_QUERY_API_KEY_FALLBACK ? apiKeyFromQuery : undefined);

    if (!ALLOW_QUERY_API_KEY_FALLBACK && !apiKeyFromHeader && apiKeyFromQuery) {
      return res.status(401).json({
        error: 'API key query parameter is not supported',
        error_code: 'API_KEY_QUERY_REJECTED',
        hint: 'Use X-API-Key header only'
      });
    }

    if (!apiKey) {
      return sendError(res, 401, 'API_KEY_REQUIRED', 'API key required', {
        hint: 'Include X-API-Key header',
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

    const key = USE_DB_AUTH
      ? await validateApiKeyDb(apiKey)
      : validateApiKeyJson(apiKey);

    if (!key) {
      return sendError(res, 403, 'API_KEY_INVALID', 'Invalid API key', { docs_url: '/README.md#api-keys' });
    }

    if (USE_DB_AUTH) {
      req.tenant = key.tenant;
      req.apiKey = { id: key.id, name: key.name, permissions: key.permissions };
    } else {
      req.apiKey = key;
    }

    const permissions = USE_DB_AUTH ? req.apiKey.permissions : key.permissions;
    const tier = resolveRateLimitTier(permissions);
    const rpcMode = resolveRpcMode(permissions, tier);
    const limit = resolveRateLimitLimit(tier);
    const cost = getRequestCost(req);
    const subject = buildRateLimitSubject({ isDbAuth: USE_DB_AUTH, key, req });
    const tenantId = USE_DB_AUTH && key.tenant ? key.tenant.id : null;
    const rateKey = buildRateLimitKey({ keyId: subject, tier, tenantId });
    const rateLimit = await checkRateLimit(rateKey, { limit, cost });
    const retryAfterSeconds = setRateLimitHeaders(res, rateLimit);
    setPlanHeaders(res, { tier, rpcMode });

    if (!rateLimit.allowed) {
      res.set('Retry-After', String(retryAfterSeconds));
      return sendError(res, 429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', {
        tier,
        rpcMode,
        limit,
        cost,
        remaining: rateLimit.remaining,
        reset: retryAfterSeconds,
        retryAfter: `${retryAfterSeconds} seconds`,
        resetAt: new Date(rateLimit.resetAt).toISOString(),
        strategy: redisClient ? 'redis' : 'memory'
      });
    }

    if (!hasPermission(requiredPermission, permissions)) {
      return sendError(
        res,
        403,
        requiredPermission === 'admin' ? 'ADMIN_PERMISSION_REQUIRED' : 'WRITE_PERMISSION_REQUIRED',
        requiredPermission === 'admin' ? 'Admin permission required' : 'Write permission required'
      );
    }

    req.authContext = {
      authenticated: true,
      permissions,
      tier,
      rpcMode,
      subject
    };

    next();
  };
}

/**
 * Optional auth - doesn't block but tracks usage
 *
 * Validates API key and applies rate accounting when present, but never blocks
 * the request. Use requireAuth() when auth must be enforced.
 */
export function optionalAuth(req, res, next) {
  (async () => {
    try {
      if (req.authContext?.authenticated) {
        return;
      }

      const apiKeyFromHeader = req.headers['x-api-key'];
      const apiKeyFromQuery = req.query?.apiKey;
      const apiKey = apiKeyFromHeader || (ALLOW_QUERY_API_KEY_FALLBACK ? apiKeyFromQuery : undefined);
      if (!apiKey) return;

      const key = USE_DB_AUTH
        ? await validateApiKeyDb(apiKey)
        : validateApiKeyJson(apiKey);

      if (!key) return;

      if (USE_DB_AUTH) {
        req.tenant = key.tenant;
        req.apiKey = { id: key.id, name: key.name, permissions: key.permissions };
      } else {
        req.apiKey = key;
      }

      const permissions = USE_DB_AUTH ? req.apiKey.permissions : key.permissions;
      const tier = resolveRateLimitTier(permissions);
      const rpcMode = resolveRpcMode(permissions, tier);
      const limit = resolveRateLimitLimit(tier);
      const cost = getRequestCost(req);
      const subject = buildRateLimitSubject({ isDbAuth: USE_DB_AUTH, key, req });
      const tenantId = USE_DB_AUTH && key.tenant ? key.tenant.id : null;
      const rateKey = buildRateLimitKey({ keyId: subject, tier, tenantId });
      const rateLimit = await checkRateLimit(rateKey, { limit, cost });
      const retryAfterSeconds = setRateLimitHeaders(res, rateLimit);
      setPlanHeaders(res, { tier, rpcMode });

      req.authContext = {
        authenticated: true,
        permissions,
        tier,
        rpcMode,
        subject
      };

      if (!rateLimit.allowed) {
        res.set('Retry-After', String(retryAfterSeconds));
        console.warn('Optional auth rate limit exceeded for key:', key.name || subject);
      }
    } catch (err) {
      console.warn('optionalAuth validation error:', err.message);
    } finally {
      next();
    }
  })();
}
