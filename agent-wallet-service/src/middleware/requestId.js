/**
 * Request ID Middleware
 * Adds unique request ID to each request for tracing
 */

import { v4 as uuidv4 } from 'crypto';

/**
 * Generate or extract request ID
 * Uses X-Request-Id header if provided, otherwise generates UUID
 */
function getRequestId(req) {
  // Check for existing request ID header
  const existingId = req.headers['x-request-id'];
  if (existingId && typeof existingId === 'string' && existingId.length > 0) {
    return existingId.slice(0, 64); // Limit length
  }
  
  // Generate new UUID (using crypto for performance)
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Express middleware to add request ID to request and response
 * Also adds timing information
 */
export function requestIdMiddleware(req, res, next) {
  const requestId = getRequestId(req);
  
  // Add to request object
  req.id = requestId;
  req.requestId = requestId;
  
  // Add to response headers
  res.setHeader('X-Request-ID', requestId);
  
  // Track request start time for duration calculation
  req._startTime = Date.now();
  
  next();
}

/**
 * Create request-scoped logger with request ID
 * Usage: const log = reqLog(req);
 */
export function reqLog(req) {
  const { logger, createLogger } = require('../services/logger.js');
  
  return createLogger({
    requestId: req.requestId || req.id,
    tenantId: req.tenant?.id,
    apiKeyName: req.apiKey?.name
  });
}

export default requestIdMiddleware;
