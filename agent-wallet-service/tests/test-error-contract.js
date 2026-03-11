import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_TEST_PORT = Number(process.env.TEST_SERVER_PORT || '3100');
const TEST_SERVER_TIMEOUT_MS = Number(process.env.TEST_SERVER_TIMEOUT_MS || '120000');
const API_URL = process.env.API_URL || `http://127.0.0.1:${DEFAULT_TEST_PORT}`;
const HEALTH_URL = new URL('/health', API_URL).toString();

let serverProcess = null;
let ownsServer = false;

function resolveApiKey() {
  if (process.env.TEST_API_KEY) return process.env.TEST_API_KEY;
  const keysPath = join(process.cwd(), 'api-keys.json');
  try {
    const keys = JSON.parse(readFileSync(keysPath, 'utf-8'));
    return keys?.[0]?.key;
  } catch {
    return null;
  }
}

const API_KEY = resolveApiKey();

function assertErrorEnvelope(body, expectedCode = null) {
  if (!body?.error || typeof body.error !== 'object') {
    throw new Error(`Expected error envelope object, got: ${JSON.stringify(body)}`);
  }
  if (typeof body.error.code !== 'string' || typeof body.error.message !== 'string') {
    throw new Error(`Expected error.code and error.message strings, got: ${JSON.stringify(body)}`);
  }
  if (expectedCode && body.error.code !== expectedCode) {
    throw new Error(`Expected error code ${expectedCode}, got ${body.error.code}`);
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return true;
    } catch {}
    await delay(1000);
  }
  return false;
}

async function ensureServer() {
  if (process.env.API_URL) return;
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) return;
  } catch {}

  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(DEFAULT_TEST_PORT),
      TEST_WALLET_ENCRYPTION_KEY: 'local-test-wallet-key'
    },
    stdio: 'inherit'
  });
  ownsServer = true;

  const ready = await waitForHealth(TEST_SERVER_TIMEOUT_MS);
  if (!ready) throw new Error('Server failed to start');
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => serverProcess.once('exit', resolve)),
    delay(5000)
  ]);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}

async function run() {
  if (!API_KEY) throw new Error('No API key available. Set TEST_API_KEY or create api-keys.json.');
  await ensureServer();

  const invalidPayloadCases = [
    ['wallet', '/wallet/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }, body: JSON.stringify({}) }],
    ['identity', '/identity/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }, body: JSON.stringify({}) }],
    ['api-keys', '/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }, body: JSON.stringify({}) }]
  ];

  for (const [name, path, options] of invalidPayloadCases) {
    const { response, body } = await request(path, options);
    if (response.status !== 400) throw new Error(`${name} expected 400, got ${response.status}`);
    assertErrorEnvelope(body, 'VALIDATION_ERROR');
  }

  const unauthorized = await request('/wallet/list');
  if (unauthorized.response.status !== 401) throw new Error(`expected 401, got ${unauthorized.response.status}`);
  assertErrorEnvelope(unauthorized.body, 'API_KEY_REQUIRED');

  const forbidden = await request('/wallet/list', { headers: { 'X-API-Key': 'sk_invalid_123' } });
  if (forbidden.response.status !== 403) throw new Error(`expected 403, got ${forbidden.response.status}`);
  assertErrorEnvelope(forbidden.body, 'API_KEY_INVALID');

  const notFound = await request('/identity/agent-does-not-exist', { headers: { 'X-API-Key': API_KEY } });
  if (notFound.response.status !== 404) throw new Error(`expected 404, got ${notFound.response.status}`);
  assertErrorEnvelope(notFound.body, 'IDENTITY_NOT_FOUND');


  const freeKeyRes = await request('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ name: `contract-test-${Date.now()}`, permissions: ['read', 'tier:free'] })
  });
  if (freeKeyRes.response.status !== 200 || !freeKeyRes.body?.key?.key) {
    throw new Error(`failed to create scoped key for rate-limit test: ${JSON.stringify(freeKeyRes.body)}`);
  }
  const RATE_KEY = freeKeyRes.body.key.key;

  let rateLimited = null;
  for (let i = 0; i < 120; i++) {
    const hit = await request('/wallet/list', { headers: { 'X-API-Key': RATE_KEY } });
    if (hit.response.status === 429) {
      rateLimited = hit;
      break;
    }
  }
  if (!rateLimited) throw new Error('expected to trigger 429 rate limit but did not');
  assertErrorEnvelope(rateLimited.body, 'RATE_LIMIT_EXCEEDED');

  const internal = await request('/identity/agent-does-not-exist/proof', { method: 'POST', headers: { 'X-API-Key': API_KEY } });
  if (internal.response.status !== 500) throw new Error(`expected 500, got ${internal.response.status}`);
  assertErrorEnvelope(internal.body);

  console.log('✅ Error contract tests passed');
}

run().catch(async (error) => {
  console.error(`❌ Error contract tests failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (ownsServer) await stopServer();
});
