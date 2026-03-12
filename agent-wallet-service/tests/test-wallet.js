/**
 * Smoke tests for Agent Wallet Service
 * Run: node tests/test-wallet.js
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

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


function extractErrorCode(body) {
  if (!body) return '';
  if (typeof body.error_code === 'string') return body.error_code;
  if (body.error && typeof body.error.code === 'string') return body.error.code;
  return '';
}

function extractErrorMessage(body) {
  if (!body) return '';
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  return '';
}

if (!API_KEY) {
  throw new Error('No API key available. Set TEST_API_KEY or create api-keys.json.');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

async function testHealth() {
  console.log('\n📊 Testing health endpoint...');
  const res = await fetch(`${API_URL}/health`);
  const data = await res.json();
  console.log('Health:', data.status, data.version);
  return res.ok;
}

async function testCreateWallet() {
  console.log('\n🔐 Testing wallet creation...');
  const { response, body } = await request('/wallet/create', {
    method: 'POST',
    body: JSON.stringify({
      agentName: 'TestAgent',
      chain: 'base-sepolia'
    })
  });

  if (!response.ok) {
    throw new Error(`Wallet creation failed: ${JSON.stringify(body)}`);
  }

  console.log('Wallet created:', body.wallet.address);
  return body.wallet.address;
}

async function testGetWalletByAddress(address) {
  console.log('\n📍 Testing wallet lookup returns 200 for known address...');
  const { response, body } = await request(`/wallet/${address}`);

  assert(response.status === 200, `Expected /wallet/:address to return 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert(body.address?.toLowerCase() === address.toLowerCase(), `Expected matching wallet address in response: ${JSON.stringify(body)}`);
}

async function testGetWalletByAddressLowercase(address) {
  console.log('\n🔡 Testing wallet lookup accepts non-checksummed lowercase address...');
  const lowercaseAddress = address.toLowerCase();
  const { response, body } = await request(`/wallet/${lowercaseAddress}`);

  assert(response.status === 200, `Expected /wallet/:address lowercase lookup to return 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert(body.address?.toLowerCase() === lowercaseAddress, `Expected matching wallet address for lowercase lookup: ${JSON.stringify(body)}`);
}

async function testGetWalletByAddressNotFound() {
  console.log('\n🚫 Testing wallet lookup returns 404 for unknown address...');
  const missing = '0x0000000000000000000000000000000000000001';
  const { response, body } = await request(`/wallet/${missing}`);

  assert(response.status === 404, `Expected 404 for unknown wallet, got ${response.status}: ${JSON.stringify(body)}`);
  assert(extractErrorCode(body) === 'WALLET_NOT_FOUND', `Expected WALLET_NOT_FOUND, got: ${JSON.stringify(body)}`);
}

async function testGetWalletByAddressInvalidFormat() {
  console.log('\n🧪 Testing wallet lookup returns 404 for invalid address format...');
  const { response, body } = await request('/wallet/not-a-wallet-address');

  assert(response.status === 404, `Expected 404 for invalid address format, got ${response.status}: ${JSON.stringify(body)}`);
  assert(extractErrorCode(body) === 'WALLET_NOT_FOUND', `Expected WALLET_NOT_FOUND for invalid address, got: ${JSON.stringify(body)}`);
}

async function testGetBalance(address) {
  console.log('\n💰 Testing balance check...');
  const { response, body } = await request(`/wallet/${address}/balance`);

  if (!response.ok) {
    const message = extractErrorMessage(body) || JSON.stringify(body);
    if (message.includes('All RPCs failed')) {
      console.warn('⚠️ Skipping balance assertion due to unavailable RPC endpoints.');
      return;
    }
    throw new Error(`Balance check failed: ${JSON.stringify(body)}`);
  }

  console.log('Balance:', body.balance.eth, body.balance.chain);
}

async function testCreateIdentity(walletAddress) {
  console.log('\n🆔 Testing identity creation (canonical endpoint /identity/create)...');
  const { response, body } = await request('/identity/create', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress,
      agentName: 'Test Agent',
      description: 'A test AI agent',
      agentType: 'assistant'
    })
  });

  if (!response.ok) {
    throw new Error(`Identity creation failed: ${JSON.stringify(body)}`);
  }

  if (!body?.identity?.id) {
    throw new Error(`Identity response missing id: ${JSON.stringify(body)}`);
  }

  console.log('Identity created:', body.identity.id);
}

async function testLegacyIdentityPathNotAvailable(walletAddress) {
  console.log('\n🧭 Testing legacy identity path is not used/available...');
  const { response } = await request('/identity/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress,
      agentName: 'Legacy Test Agent',
      description: 'legacy path check',
      agentType: 'assistant'
    })
  });

  assert(response.status === 404, `Expected legacy identity path to return 404, got ${response.status}`);
}

async function testProtectedEndpointRequiresApiKey(address) {
  console.log('\n🔒 Testing protected endpoint rejects missing X-API-Key...');
  const response = await fetch(`${API_URL}/wallet/${address}`);
  const body = await response.json();

  assert(response.status === 401, `Expected 401 when X-API-Key is missing, got ${response.status}: ${JSON.stringify(body)}`);
}


async function runTests() {
  console.log('🦞 Agent Wallet Service Smoke Tests');
  console.log('===================================');

  const healthy = await testHealth();
  if (!healthy) {
    throw new Error('Server not running. Start with: npm start');
  }

  const address = await testCreateWallet();
  await testGetWalletByAddress(address);
  await testGetWalletByAddressLowercase(address);
  await testGetWalletByAddressNotFound();
  await testGetWalletByAddressInvalidFormat();
  await testGetBalance(address);
  await testProtectedEndpointRequiresApiKey(address);
  await testCreateIdentity(address);
  await testLegacyIdentityPathNotAvailable(address);

  console.log('\n✅ All tests completed!');
}

runTests().catch((error) => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
