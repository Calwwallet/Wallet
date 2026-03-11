import assert from 'assert';
import { requireAuth, createApiKey } from '../src/middleware/auth.js';
import { requestLogger, logger, redactSecrets } from '../src/services/logger.js';

function createMockRes() {
  const handlers = {};
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeaders() {
      return this.headers;
    },
    on(event, cb) {
      handlers[event] = cb;
    },
    emit(event) {
      if (handlers[event]) handlers[event]();
    }
  };
}

async function runAuth(req, requiredPermission = 'read') {
  const res = createMockRes();
  let nextCalled = false;
  const middleware = requireAuth(requiredPermission);
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

async function testQueryParamRejected() {
  const req = {
    path: '/wallet',
    originalUrl: '/wallet?apiKey=sk_bad',
    method: 'GET',
    headers: {},
    query: { apiKey: 'sk_bad' }
  };

  const { res, nextCalled } = await runAuth(req);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error_code, 'API_KEY_QUERY_REJECTED');
  console.log('✅ query param API key rejected');
}

async function testHeaderAccepted() {
  const created = await createApiKey('security-test-key', ['read']);

  const req = {
    path: '/wallet',
    originalUrl: '/wallet',
    method: 'GET',
    headers: { 'x-api-key': created.key },
    query: {}
  };

  const { res, nextCalled } = await runAuth(req);
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert(req.authContext?.authenticated);
  console.log('✅ header API key accepted');
}

function testLogRedaction() {
  const raw = {
    apiKey: 'sk_very_secret_key',
    nested: {
      authorization: 'Bearer abc',
      token: 'abc123'
    },
    safe: 'ok'
  };
  const redacted = redactSecrets(raw);
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.nested.authorization, '[REDACTED]');
  assert.equal(redacted.nested.token, '[REDACTED]');
  assert.equal(redacted.safe, 'ok');

  const events = [];
  const originalInfo = logger.info.bind(logger);
  logger.info = (obj, msg) => {
    events.push({ obj, msg });
  };

  const req = {
    method: 'POST',
    url: '/wallet?apiKey=sk_query_secret',
    headers: {
      host: 'localhost',
      'user-agent': 'test',
      'content-type': 'application/json',
      'x-api-key': 'sk_header_secret'
    },
    query: { apiKey: 'sk_query_secret' },
    params: {},
    body: { token: 'body-secret' }
  };
  const res = createMockRes();

  requestLogger(req, res, () => {});

  logger.info = originalInfo;

  assert(events.length >= 1);
  const first = events[0].obj;
  assert.equal(first.req.headers['x-api-key'], '[REDACTED]');
  assert(!JSON.stringify(first).includes('sk_header_secret'));
  assert(!JSON.stringify(first).includes('sk_query_secret'));
  console.log('✅ logs redact raw key material');
}

async function main() {
  await testQueryParamRejected();
  await testHeaderAccepted();
  testLogRedaction();
  console.log('\n✅ auth security tests passed');
}

main().catch((error) => {
  console.error('❌ auth security tests failed:', error.message);
  process.exit(1);
});
