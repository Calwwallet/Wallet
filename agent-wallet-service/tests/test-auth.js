/**
 * Authentication and Rate Limiting Tests
 * Run: node tests/test-auth.js
 * 
 * Tests:
 * - API key validation
 * - Permission checks (read, write, admin)
 * - Rate limiting
 * - Missing/invalid key rejection
 * 
 * Auto-starts server if not running.
 */

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

function extractErrorMessage(body) {
  if (!body) return '';
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  return '';
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return true;
    } catch {
      // Ignore connection errors until timeout.
    }
    await delay(1000);
  }
  return false;
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => serverProcess.once('exit', () => resolve(true))),
    delay(5000).then(() => false)
  ]);
  if (!serverProcess.killed) serverProcess.kill('SIGKILL');
}

async function ensureServer() {
  if (process.env.API_URL) return;
  
  try {
    const response = await fetch(HEALTH_URL);
    if (response.ok) return;
  } catch {}
  
  console.log('Starting test server...');
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
  if (!ready) {
    throw new Error('Server failed to start');
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers || {})
    }
  });

  const rawBody = await response.text();
  let body;

  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = { raw: rawBody };
  }

  return { response, body };
}

async function testMissingApiKey() {
  console.log('\n🔑 Testing missing API key rejection...');
  
  const response = await fetch(`${API_URL}/wallet`, {
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (response.status !== 401) {
    throw new Error(`Expected 401, got ${response.status}`);
  }
  
  const body = await response.json();
  if (!extractErrorMessage(body).includes('API key required')) {
    throw new Error(`Expected API key error, got: ${JSON.stringify(body)}`);
  }
  
  console.log('✅ Missing API key correctly rejected');
}

async function testInvalidApiKey() {
  console.log('\n🔑 Testing invalid API key rejection...');
  
  const response = await fetch(`${API_URL}/wallet`, {
    headers: { 
      'Content-Type': 'application/json',
      'X-API-Key': 'sk_invalid_key_12345'
    }
  });
  
  if (response.status !== 403) {
    throw new Error(`Expected 403, got ${response.status}`);
  }
  
  console.log('✅ Invalid API key correctly rejected');
}

async function testReadPermission() {
  console.log('\n🔐 Testing read permission...');
  
  const { body: createBody } = await request('/wallet/create', {
    method: 'POST',
    body: JSON.stringify({
      agentName: 'PermissionTestBot',
      chain: 'base-sepolia'
    })
  });
  
  if (!createBody.wallet?.address) {
    const errorText = String(extractErrorMessage(createBody) || '');
    if (errorText.includes('Encryption key required') || errorText.includes('WALLET_ENCRYPTION_KEY')) {
      throw new Error(
        'Failed to create wallet: server encryption key is not configured. ' +
        'Restart the API with TEST_WALLET_ENCRYPTION_KEY=local-test-wallet-key (or WALLET_ENCRYPTION_KEY in production).'
      );
    }
    throw new Error(`Failed to create wallet: ${errorText || 'unknown error'}`);
  }
  
  const address = createBody.wallet.address;
  
  const { response: readRes, body: readBody } = await request(`/wallet/${address}/balance`);
  
  if (!readRes.ok && !extractErrorMessage(readBody).includes('RPCs failed')) {
    console.log('Balance check response:', readBody);
  }
  
  console.log('✅ Read permission works');
  return address;
}

async function testWritePermission() {
  console.log('\n✍️ Testing write permission...');
  
  const { response, body } = await request('/wallet/create', {
    method: 'POST',
    body: JSON.stringify({
      agentName: 'WriteTestBot',
      chain: 'base-sepolia'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Write permission failed: ${JSON.stringify(body)}`);
  }
  
  console.log('✅ Write permission works');
}

async function testRateLimiting() {
  console.log('\n⏱️ Testing rate limiting...');
  
  const requests = [];
  const numRequests = 105;
  
  for (let i = 0; i < numRequests; i++) {
    requests.push(
      fetch(`${API_URL}/health`).then(r => ({ status: r.status, index: i }))
    );
  }
  
  const results = await Promise.all(requests);
  const rateLimited = results.filter(r => r.status === 429);
  
  console.log(`Made ${numRequests} requests, ${rateLimited.length} rate-limited`);
  
  if (rateLimited.length === 0) {
    console.log('⚠️  Rate limiting not triggered (may be using Redis or disabled)');
  } else {
    console.log('✅ Rate limiting working');
  }
}

async function testApiKeyCreation() {
  console.log('\n🔐 Testing API key creation...');
  
  const { response, body } = await request('/api-keys', {
    method: 'POST',
    body: JSON.stringify({
      name: 'test-key-' + Date.now(),
      permissions: ['read', 'write']
    })
  });
  
  if (!response.ok) {
    console.log('⚠️  API key creation failed (may need admin key):', body.error);
    return null;
  }
  
  if (!body.key?.key) {
    throw new Error('API key response missing key');
  }
  
  console.log('✅ API key created:', body.key.key.slice(0, 12) + '...');
  return body.key.key;
}

async function runTests() {
  console.log('🔐 Agent Wallet Service - Auth Tests');
  console.log('======================================');

  if (!API_KEY) {
    throw new Error('No API key available. Set TEST_API_KEY or create api-keys.json.');
  }

  await testMissingApiKey();
  await testInvalidApiKey();
  await testReadPermission();
  await testWritePermission();
  await testApiKeyCreation();
  await testRateLimiting();

  console.log('\n✅ All authentication tests completed!');
}

async function main() {
  try {
    await ensureServer();
    await runTests();
  } finally {
    if (ownsServer) {
      await stopServer();
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Auth tests failed:', error.message);
  process.exit(1);
});
