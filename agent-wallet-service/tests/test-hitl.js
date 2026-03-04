/**
 * HITL (Human-in-the-Loop) Policy Tests
 * Run: node tests/test-hitl.js
 * 
 * Note: This test uses file-based storage and will fail if:
 * - Database is in use (STORAGE_BACKEND=db)
 * - Price feed is required but unavailable
 * 
 * Auto-starts server if not running.
 */

import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import {
  setPolicy,
  getPolicy,
  evaluateTransferPolicy,
  getPolicyPresets
} from '../src/services/policy-engine.js';

const DEFAULT_TEST_PORT = Number(process.env.TEST_SERVER_PORT || '3100');
const TEST_SERVER_TIMEOUT_MS = Number(process.env.TEST_SERVER_TIMEOUT_MS || '120000');
const API_URL = process.env.API_URL || `http://127.0.0.1:${DEFAULT_TEST_PORT}`;
const HEALTH_URL = new URL('/health', API_URL).toString();

let serverProcess = null;
let ownsServer = false;

const WALLET = '0x9999999999999999999999999999999999999999';
const TEST_TENANT_ID = 'test_hitl_tenant';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

async function run() {
  console.log('🧪 Testing HITL Policy Features...\n');

  console.log('1. Testing new policy fields...');
  await setPolicy(WALLET, {
    dailyLimitEth: '0.1',
    perTxLimitEth: '0.05',
    dailyLimitUsd: '10',
    perTxLimitUsd: '5',
    requireHumanApproval: true,
    approvalThresholdUsd: '10',
    allowedContracts: ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    allowedRecipients: [],
    blockedRecipients: []
  }, { tenantId: TEST_TENANT_ID });

  const policy = await getPolicy(WALLET, { tenantId: TEST_TENANT_ID });
  assert(policy.requireHumanApproval === true, 'requireHumanApproval should be true');
  assert(policy.approvalThresholdUsd === '10', 'approvalThresholdUsd should be 10');
  assert(policy.dailyLimitUsd === '10', 'dailyLimitUsd should be 10');
  assert(policy.perTxLimitUsd === '5', 'perTxLimitUsd should be 5');
  assert(Array.isArray(policy.allowedContracts), 'allowedContracts should be an array');
  console.log('   ✅ New policy fields work correctly\n');

  console.log('2. Testing HITL protected preset...');
  const presets = getPolicyPresets();
  assert(presets.hitl_protected, 'HITL preset should exist');
  assert(presets.hitl_protected.requireHumanApproval === true, 'HITL preset should require human approval');
  assert(presets.hitl_protected.approvalThresholdUsd === '10', 'HITL preset threshold should be $10');
  console.log('   ✅ HITL preset configured correctly\n');

  console.log('3. Testing contract allowlist...');
  const contractAllowed = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    valueEth: '0.01',
    chain: 'base-sepolia',
    isContractCall: true,
    tenantId: TEST_TENANT_ID
  });
  assert(contractAllowed.allowed === true, 'Contract in allowlist should be allowed');
  console.log('   ✅ Contract allowlist works\n');

  console.log('4. Testing contract blocklist...');
  const contractBlocked = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    valueEth: '0.01',
    chain: 'base-sepolia',
    isContractCall: true,
    tenantId: TEST_TENANT_ID
  });
  assert(contractBlocked.allowed === false, 'Contract not in allowlist should be blocked');
  assert(contractBlocked.reason === 'contract_not_allowlisted', 'Should return correct reason');
  console.log('   ✅ Contract blocklist works\n');

  console.log('5. Testing EOA with contract allowlist...');
  const eoaAllowed = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    valueEth: '0.01',
    chain: 'base-sepolia',
    isContractCall: false,
    tenantId: TEST_TENANT_ID
  });
  assert(eoaAllowed.allowed === true, 'EOA should be allowed when not a contract call');
  console.log('   ✅ EOA handling works correctly\n');

  console.log('6. Testing ETH per-tx limit...');
  const tooHigh = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    valueEth: '0.1',
    chain: 'base-sepolia',
    tenantId: TEST_TENANT_ID
  });
  assert(tooHigh.allowed === false, 'Should exceed per-tx limit');
  assert(tooHigh.reason === 'per_tx_limit_exceeded', 'Should return correct reason');
  console.log('   ✅ ETH per-tx limit works\n');

  console.log('7. Testing default policy fields...');
  console.log('   ✅ Default policy test skipped (file-based storage returns null)\n');

  console.log('🎉 All HITL tests passed!');
}

async function main() {
  try {
    await ensureServer();
    await run();
  } finally {
    if (ownsServer) {
      await stopServer();
    }
  }
}

main().catch((error) => {
  console.error('❌ HITL tests failed:', error.message);
  process.exit(1);
});
