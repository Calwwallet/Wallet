import pino from 'pino';

/**
 * Structured Logging Service
 * Uses Pino for JSON logging with proper log levels
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

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
      url: req.url,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type']
      },
      // Don't log sensitive headers
      authorization: req.headers.authorization ? '[REDACTED]' : undefined,
      'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : undefined
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
        url: req.url
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
      url: req.url,
      body: isDevelopment ? req.body : undefined,
      params: req.params,
      query: req.query
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
