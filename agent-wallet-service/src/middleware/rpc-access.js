/**
 * RPC Access Middleware
 *
 * Free-tier keys use BYO RPC URLs.
 * Pro/Enterprise keys use managed RPC infrastructure.
 */

const RPC_URL_HEADER = 'X-RPC-URL';
const DEFAULT_ALLOWED_RPC_HOSTS = '*.g.alchemy.com,*.alchemy.com';

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeScalar(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function hostMatchesPattern(hostname, pattern) {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
}

export function getAllowedHostPatterns() {
  const configured = process.env.BYO_RPC_ALLOWED_HOSTS || DEFAULT_ALLOWED_RPC_HOSTS;
  return parseCsv(configured);
}

class RpcAccessError extends Error {
  constructor({
    message,
    statusCode = 400,
    errorCode = 'BYO_RPC_ERROR',
    hint,
    details
  }) {
    super(message);
    this.name = 'RpcAccessError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.hint = hint;
    this.details = details;
  }
}

function buildErrorResponse(error) {
  return {
    error: error.message,
    error_code: error.errorCode || 'BYO_RPC_ERROR',
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.details ? { details: error.details } : {})
  };
}

function validateAndNormalizeRpcUrl(rawRpcUrl) {
  const value = String(rawRpcUrl || '').trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RpcAccessError({
      message: 'Invalid rpcUrl. Expected a full URL such as https://base-mainnet.g.alchemy.com/v2/<key>.',
      errorCode: 'BYO_RPC_INVALID_URL',
      hint: `Provide ${RPC_URL_HEADER} header, ?rpcUrl query param, or rpcUrl in request body.`
    });
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const allowInsecureLocal = process.env.ALLOW_INSECURE_BYO_RPC === 'true' && isLocalHost(hostname);

  if (protocol !== 'https:' && !allowInsecureLocal) {
    throw new RpcAccessError({
      message: 'Only HTTPS rpcUrl values are allowed.',
      errorCode: 'BYO_RPC_PROTOCOL_NOT_ALLOWED',
      hint: 'Use an HTTPS endpoint, or set ALLOW_INSECURE_BYO_RPC=true for localhost-only development.'
    });
  }

  const patterns = getAllowedHostPatterns();
  const hostAllowed = patterns.some((pattern) => hostMatchesPattern(hostname, pattern));
  if (!hostAllowed) {
    throw new RpcAccessError({
      message: `rpcUrl host "${hostname}" is not allowed for free-tier BYO RPC.`,
      errorCode: 'BYO_RPC_HOST_NOT_ALLOWED',
      details: {
        allowedHosts: patterns
      }
    });
  }

  return url.toString();
}

function getIncomingRpcUrl(req) {
  const headerValue = normalizeScalar(req.headers?.['x-rpc-url']);
  if (headerValue) return headerValue;

  const queryValue = normalizeScalar(req.query?.rpcUrl);
  if (queryValue) return queryValue;

  const bodyValue = normalizeScalar(req.body?.rpcUrl);
  if (bodyValue) return bodyValue;

  return null;
}

function resolveRpcMode(req) {
  const tier = req.authContext?.tier || 'free';
  const mode = req.authContext?.rpcMode || (tier === 'free' ? 'byo' : 'managed');
  return { tier, rpcMode: mode };
}

function ensureRpcContext(req) {
  if (req.rpcContext) return req.rpcContext;

  const { tier, rpcMode } = resolveRpcMode(req);
  const incomingRpcUrl = getIncomingRpcUrl(req);
  const rpcUrl = rpcMode === 'byo' && incomingRpcUrl
    ? validateAndNormalizeRpcUrl(incomingRpcUrl)
    : null;

  req.rpcContext = { tier, rpcMode, rpcUrl };
  return req.rpcContext;
}

function sendRpcError(res, error) {
  const statusCode = error.statusCode || 400;
  return res.status(statusCode).json(buildErrorResponse(error));
}

export function attachRpcContext(req, res, next) {
  try {
    ensureRpcContext(req);
    next();
  } catch (error) {
    if (error instanceof RpcAccessError) {
      return sendRpcError(res, error);
    }
    next(error);
  }
}

export function requireRpcUrlForByo(req, res, next) {
  try {
    const context = ensureRpcContext(req);
    if (context.rpcMode !== 'byo') return next();
    if (context.rpcUrl) return next();

    throw new RpcAccessError({
      message: 'Free-tier API keys must provide a BYO RPC URL for this endpoint.',
      errorCode: 'BYO_RPC_REQUIRED',
      hint: `Send ${RPC_URL_HEADER} header, ?rpcUrl query param, or rpcUrl in request body.`
    });
  } catch (error) {
    if (error instanceof RpcAccessError) {
      return sendRpcError(res, error);
    }
    next(error);
  }
}

export function blockByoRpcForMultiChain(req, res, next) {
  try {
    const context = ensureRpcContext(req);
    if (context.rpcMode !== 'byo') return next();

    throw new RpcAccessError({
      message: 'Free-tier BYO RPC does not support /balance/all.',
      statusCode: 403,
      errorCode: 'BYO_RPC_MULTI_CHAIN_NOT_SUPPORTED',
      hint: 'Use GET /wallet/:address/balance?chain=<chain>&rpcUrl=<url> for single-chain balance checks.'
    });
  } catch (error) {
    if (error instanceof RpcAccessError) {
      return sendRpcError(res, error);
    }
    next(error);
  }
}

export function getRpcRuntimeOptions(req) {
  const context = ensureRpcContext(req);
  return {
    tenantId: req.tenant?.id,
    tier: context.tier,
    rpcMode: context.rpcMode,
    rpcUrl: context.rpcUrl
  };
}
