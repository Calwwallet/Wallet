/**
 * Environment Configuration Validation
 * 
 * Validates required environment variables on startup and provides
 * typed configuration access throughout the application.
 */

import { logger } from '../services/logger.js';

// Configuration schema with validation rules
const CONFIG_SCHEMA = {
  // Server
  PORT: {
    type: 'number',
    default: 3000,
    min: 1,
    max: 65535,
    description: 'Server port'
  },
  NODE_ENV: {
    type: 'enum',
    values: ['development', 'test', 'production'],
    default: 'development',
    description: 'Environment mode'
  },
  
  // Database
  DATABASE_URL: {
    type: 'string',
    required: false,
    secret: true,
    description: 'PostgreSQL connection URL'
  },
  STORAGE_BACKEND: {
    type: 'enum',
    values: ['json', 'db'],
    default: 'json',
    description: 'Storage backend type'
  },
  
  // Auth
  AUTH_BACKEND: {
    type: 'enum',
    values: ['json', 'db'],
    default: 'json',
    description: 'Authentication backend type'
  },
  API_KEY_HASH_SECRET: {
    type: 'string',
    required: false,
    secret: true,
    minLength: 32,
    description: 'Secret for hashing API keys (required in production)'
  },
  
  // Redis
  REDIS_URL: {
    type: 'string',
    required: false,
    secret: true,
    description: 'Redis connection URL for distributed rate limiting'
  },
  
  // Blockchain
  ALCHEMY_API_KEY: {
    type: 'string',
    required: false,
    secret: true,
    description: 'Alchemy API key for managed RPC'
  },
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: {
    type: 'number',
    default: 60000,
    min: 1000,
    description: 'Rate limit window in milliseconds'
  },
  RATE_LIMIT_MAX_POINTS_FREE: {
    type: 'number',
    default: 100,
    min: 1,
    description: 'Max points per window for free tier'
  },
  RATE_LIMIT_MAX_POINTS_PRO: {
    type: 'number',
    default: 300,
    min: 1,
    description: 'Max points per window for pro tier'
  },
  RATE_LIMIT_MAX_POINTS_ENTERPRISE: {
    type: 'number',
    default: 1000,
    min: 1,
    description: 'Max points per window for enterprise tier'
  },
  
  // Security
  BYO_RPC_ALLOWED_HOSTS: {
    type: 'string',
    default: '*.g.alchemy.com,*.alchemy.com',
    description: 'Comma-separated list of allowed BYO RPC host patterns'
  },
  SHOW_BOOTSTRAP_SECRET: {
    type: 'boolean',
    default: false,
    description: 'Show full bootstrap API key on startup'
  },
  ALLOW_QUERY_API_KEY_FALLBACK: {
    type: 'boolean',
    default: false,
    description: 'Development-only fallback to accept ?apiKey= query parameter'
  },
  
  // Features
  ENABLE_MCP: {
    type: 'boolean',
    default: true,
    description: 'Enable MCP server'
  },
  RUN_MIGRATIONS: {
    type: 'boolean',
    default: true,
    description: 'Run database migrations on startup'
  },
  
  // Encryption
  ENCRYPTION_KEY: {
    type: 'string',
    required: false,
    secret: true,
    minLength: 32,
    description: 'Encryption key for wallet private keys'
  },
  
  // Tenant
  DEFAULT_TENANT_ID: {
    type: 'string',
    default: 'tenant_default',
    description: 'Default tenant ID for multi-tenant setups'
  }
};

/**
 * Parse and validate a single configuration value
 */
function parseValue(key, schema, rawValue) {
  let value = rawValue ?? schema.default;
  
  if (value === undefined && schema.required) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  
  if (value === undefined) {
    return undefined;
  }
  
  switch (schema.type) {
    case 'number':
      value = Number(value);
      if (isNaN(value)) {
        throw new Error(`Environment variable ${key} must be a number`);
      }
      if (schema.min !== undefined && value < schema.min) {
        throw new Error(`Environment variable ${key} must be >= ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        throw new Error(`Environment variable ${key} must be <= ${schema.max}`);
      }
      break;
      
    case 'boolean':
      if (typeof value === 'string') {
        value = value.toLowerCase() === 'true' || value === '1';
      }
      break;
      
    case 'enum':
      if (!schema.values.includes(value)) {
        throw new Error(`Environment variable ${key} must be one of: ${schema.values.join(', ')}`);
      }
      break;
      
    case 'string':
      if (schema.minLength && value.length < schema.minLength) {
        throw new Error(`Environment variable ${key} must be at least ${schema.minLength} characters`);
      }
      break;
  }
  
  return value;
}

/**
 * Validate all configuration and return typed config object
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];
  const config = {};
  const secrets = [];
  
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    try {
      const rawValue = process.env[key];
      config[key] = parseValue(key, schema, rawValue);
      
      if (schema.secret && rawValue) {
        secrets.push(key);
      }
    } catch (error) {
      errors.push({ key, error: error.message });
    }
  }
  
  // Production-specific validations
  if (config.NODE_ENV === 'production') {
    if (!config.API_KEY_HASH_SECRET) {
      errors.push({
        key: 'API_KEY_HASH_SECRET',
        error: 'Required in production for secure API key storage'
      });
    }
    
    if (!config.ENCRYPTION_KEY) {
      warnings.push({
        key: 'ENCRYPTION_KEY',
        message: 'Recommended in production for wallet key encryption'
      });
    }
    
    if (config.SHOW_BOOTSTRAP_SECRET) {
      warnings.push({
        key: 'SHOW_BOOTSTRAP_SECRET',
        message: 'Should be false in production'
      });
    }

    if (config.ALLOW_QUERY_API_KEY_FALLBACK) {
      warnings.push({
        key: 'ALLOW_QUERY_API_KEY_FALLBACK',
        message: 'Ignored in production; keep disabled for secure header-only auth'
      });
    }
  }
  
  // Database consistency checks
  if (config.STORAGE_BACKEND === 'db' && !config.DATABASE_URL) {
    errors.push({
      key: 'DATABASE_URL',
      error: 'Required when STORAGE_BACKEND is "db"'
    });
  }
  
  if (config.AUTH_BACKEND === 'db' && !config.DATABASE_URL) {
    errors.push({
      key: 'DATABASE_URL',
      error: 'Required when AUTH_BACKEND is "db"'
    });
  }
  
  return {
    config,
    errors,
    warnings,
    secrets
  };
}

/**
 * Log configuration status on startup
 */
export function logConfigStatus() {
  const { config, errors, warnings, secrets } = validateConfig();
  
  if (errors.length > 0) {
    logger.error({ errors }, 'Configuration validation failed');
    throw new Error(`Configuration errors: ${errors.map(e => e.key).join(', ')}`);
  }
  
  if (warnings.length > 0) {
    logger.warn({ warnings }, 'Configuration warnings');
  }
  
  // Log non-secret configuration
  const safeConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (secrets.includes(key)) {
      safeConfig[key] = '***';
    } else {
      safeConfig[key] = value;
    }
  }
  
  logger.info({ config: safeConfig }, 'Configuration loaded');
  
  return config;
}

/**
 * Get configuration value with type safety
 */
export function getConfig(key) {
  const schema = CONFIG_SCHEMA[key];
  if (!schema) {
    throw new Error(`Unknown configuration key: ${key}`);
  }
  
  return parseValue(key, schema, process.env[key]);
}

/**
 * Get all configuration as typed object
 */
export function getAllConfig() {
  const { config } = validateConfig();
  return config;
}

// Export configuration schema for documentation
export { CONFIG_SCHEMA };

export default {
  validateConfig,
  logConfigStatus,
  getConfig,
  getAllConfig,
  CONFIG_SCHEMA
};
