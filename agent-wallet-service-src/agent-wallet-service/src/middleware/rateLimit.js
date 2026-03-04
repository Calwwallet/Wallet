/**
 * Simple Rate Limiting Middleware
 */

const requests = new Map();

// Clean up old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requests) {
    if (now - data.windowStart > 60000) {
      requests.delete(key);
    }
  }
}, 60000);

/**
 * Rate limit middleware
 */
export function rateLimit(options = {}) {
  const {
    windowMs = 60000,      // 1 minute window
    maxRequests = 100,     // max requests per window
    keyGenerator = (req) => req.apiKey?.key || req.ip || 'anonymous'
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, {
        count: 1,
        windowStart: now
      });
      return next();
    }

    const data = requests.get(key);

    // Reset window if expired
    if (now - data.windowStart > windowMs) {
      data.count = 1;
      data.windowStart = now;
      return next();
    }

    // Check limit
    if (data.count >= maxRequests) {
      const retryAfter = Math.ceil((data.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: `${retryAfter} seconds`,
        limit: maxRequests,
        window: `${windowMs / 1000} seconds`
      });
    }

    data.count++;
    next();
  };
}

/**
 * Stricter rate limit for expensive operations
 */
export function strictRateLimit(req, res, next) {
  return rateLimit({ maxRequests: 10, windowMs: 60000 })(req, res, next);
}
