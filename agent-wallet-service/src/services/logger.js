import pino from 'pino';

/**
 * Structured Logging Service
 * Uses Pino for JSON logging with proper log levels
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|private[-_]?key|rpcurl|rpc_url)/i;


function redactUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/([?&](?:apiKey|apikey|rpcUrl|rpcurl|token|secret)=)[^&]*/gi, '$1[REDACTED]');
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = '[REDACTED]';
    } else if (item && typeof item === 'object') {
      redacted[key] = redactSecrets(item);
    } else {
      redacted[key] = item;
    }
  }
  return redacted;
}

/**
 * Create logger instance with proper configuration
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  base: {
    service: 'agent-wallet-service',
    version: process.env.npm_package_version || '0.1.0'
  }
});

/**
 * Create child logger with additional context
 * @param {Object} bindings - Additional bindings for the child logger
 * @returns {pino.Logger} Child logger instance
 */
export function createLogger(bindings) {
  return logger.child(bindings);
}

/**
 * Request logger middleware for Express
 * Logs incoming requests and response times
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  
  // Log request
  logger.info({
    req: {
      method: req.method,
      url: redactUrl(req.url),
      headers: redactSecrets({
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        authorization: req.headers.authorization,
        'x-api-key': req.headers['x-api-key']
      })
    },
    tenantId: req.tenant?.id,
    apiKeyId: req.apiKey?.id
  }, 'Incoming request');

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      res: {
        statusCode: res.statusCode,
        headers: res.getHeaders()
      },
      req: {
        method: req.method,
        url: redactUrl(req.url)
      },
      duration,
      tenantId: req.tenant?.id,
      apiKeyId: req.apiKey?.id
    }, 'Request completed');
  });

  next();
}

/**
 * Error logger middleware
 * Logs errors with stack traces in development
 */
export function errorLogger(err, req, res, next) {
  logger.error({
    err: {
      message: err.message,
      stack: isDevelopment ? err.stack : undefined,
      name: err.name,
      cause: isDevelopment ? err.cause : undefined
    },
    req: {
      method: req.method,
      url: redactUrl(req.url),
      body: isDevelopment ? redactSecrets(req.body) : undefined,
      params: req.params,
      query: redactSecrets(req.query)
    },
    tenantId: req.tenant?.id,
    apiKeyId: req.apiKey?.id
  }, 'Request error');
  
  next(err);
}

// ============================================================
// Application-level loggers
// ============================================================

export const walletLogger = createLogger({ module: 'wallet' });
export const identityLogger = createLogger({ module: 'identity' });
export const ensLogger = createLogger({ module: 'ens' });
export const txLogger = createLogger({ module: 'transaction' });
export const policyLogger = createLogger({ module: 'policy' });
export const authLogger = createLogger({ module: 'auth' });
