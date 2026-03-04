import Redis from 'ioredis';
import { logger } from './logger.js';

let client = null;

// Cache TTL configurations (in seconds)
export const CACHE_TTL = {
  WALLET_METADATA: 3600,      // 1 hour
  BALANCE: 30,                 // 30 seconds
  CHAIN_CONFIG: 300,           // 5 minutes
  POLICY_RULES: 300,           // 5 minutes
  ENS_RESOLUTION: 86400        // 24 hours
};

export function getRedis() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is required to use Redis-backed features.');
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      if (times > 3) {
        logger.warn({ times }, 'Redis connection retry failed');
        return null; // Stop retrying
      }
      return Math.min(times * 100, 3000);
    },
    lazyConnect: true
  });

  client.on('error', (err) => {
    logger.error({ err }, 'Redis error');
  });

  client.on('connect', () => {
    logger.info('Redis connected');
  });

  return client;
}

// ============================================================
// Cache Helper Functions
// ============================================================

/**
 * Get a value from cache
 */
export async function cacheGet(key) {
  try {
    const redis = getRedis();
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.warn({ key, error: error.message }, 'Cache get failed');
    return null;
  }
}

/**
 * Set a value in cache with TTL
 */
export async function cacheSet(key, value, ttl = CACHE_TTL.BALANCE) {
  try {
    const redis = getRedis();
    await redis.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.warn({ key, error: error.message }, 'Cache set failed');
    return false;
  }
}

/**
 * Delete a key from cache
 */
export async function cacheDelete(key) {
  try {
    const redis = getRedis();
    await redis.del(key);
    return true;
  } catch (error) {
    logger.warn({ key, error: error.message }, 'Cache delete failed');
    return false;
  }
}

/**
 * Delete keys matching a pattern
 */
export async function cacheDeletePattern(pattern) {
  try {
    const redis = getRedis();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  } catch (error) {
    logger.warn({ pattern, error: error.message }, 'Cache delete pattern failed');
    return 0;
  }
}

// ============================================================
// Specialized Cache Functions
// ============================================================

/**
 * Cache wallet metadata
 */
export async function getCachedWalletMetadata(address, tenantId) {
  const key = `wallet:metadata:${tenantId || 'default'}:${address.toLowerCase()}`;
  return cacheGet(key);
}

export async function setCachedWalletMetadata(address, tenantId, data) {
  const key = `wallet:metadata:${tenantId || 'default'}:${address.toLowerCase()}`;
  return cacheSet(key, data, CACHE_TTL.WALLET_METADATA);
}

/**
 * Cache wallet balance
 */
export async function getCachedBalance(address, chain) {
  const key = `wallet:balance:${chain || 'default'}:${address.toLowerCase()}`;
  return cacheGet(key);
}

export async function setCachedBalance(address, chain, data) {
  const key = `wallet:balance:${chain || 'default'}:${address.toLowerCase()}`;
  return cacheSet(key, data, CACHE_TTL.BALANCE);
}

/**
 * Invalidate balance cache when a transaction occurs
 */
export async function invalidateBalanceCache(address, chain) {
  await cacheDelete(`wallet:balance:${chain || 'default'}:${address.toLowerCase()}`);
}

/**
 * Cache policy rules
 */
export async function getCachedPolicy(address, tenantId) {
  const key = `policy:${tenantId || 'default'}:${address.toLowerCase()}`;
  return cacheGet(key);
}

export async function setCachedPolicy(address, tenantId, data) {
  const key = `policy:${tenantId || 'default'}:${address.toLowerCase()}`;
  return cacheSet(key, data, CACHE_TTL.POLICY_RULES);
}

export async function invalidatePolicyCache(address, tenantId) {
  await cacheDelete(`policy:${tenantId || 'default'}:${address.toLowerCase()}`);
}

/**
 * Cache chain config / RPC health
 */
export async function getCachedChainConfig(chain) {
  const key = `chain:config:${chain}`;
  return cacheGet(key);
}

export async function setCachedChainConfig(chain, data) {
  const key = `chain:config:${chain}`;
  return cacheSet(key, data, CACHE_TTL.CHAIN_CONFIG);
}

