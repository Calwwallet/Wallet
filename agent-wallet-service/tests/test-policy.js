/**
 * Policy engine checks
 * Run: node tests/test-policy.js
 */

import {
  setPolicy,
  evaluateTransferPolicy,
  recordPolicySpend
} from '../src/services/policy-engine.js';

const WALLET = '0x1111111111111111111111111111111111111111';
const TEST_TENANT_ID = 'test_tenant';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  // Set policy with tenantId (required for security)
  await setPolicy(WALLET, {
    dailyLimitEth: '0.02',
    perTxLimitEth: '0.01',
    allowedRecipients: ['0x2222222222222222222222222222222222222222'],
    blockedRecipients: ['0x3333333333333333333333333333333333333333']
  }, { tenantId: TEST_TENANT_ID });

  const blocked = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0x3333333333333333333333333333333333333333',
    valueEth: '0.001',
    chain: 'base-sepolia',
    tenantId: TEST_TENANT_ID
  });
  assert(!blocked.allowed && blocked.reason === 'recipient_blocked', 'blocked recipient should fail');

  const tooLarge = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0x2222222222222222222222222222222222222222',
    valueEth: '0.015',
    chain: 'base-sepolia',
    tenantId: TEST_TENANT_ID
  });
  assert(!tooLarge.allowed && tooLarge.reason === 'per_tx_limit_exceeded', 'per tx limit should fail');

  const ok = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0x2222222222222222222222222222222222222222',
    valueEth: '0.005',
    chain: 'base-sepolia',
    tenantId: TEST_TENANT_ID
  });
  assert(ok.allowed, 'allowlisted recipient with small value should pass');

  await recordPolicySpend({ walletAddress: WALLET, valueEth: '0.018', timestamp: '2026-01-01T00:00:00.000Z', tenantId: TEST_TENANT_ID });
  const overDaily = await evaluateTransferPolicy({
    walletAddress: WALLET,
    to: '0x2222222222222222222222222222222222222222',
    valueEth: '0.005',
    chain: 'base-sepolia',
    timestamp: '2026-01-01T12:00:00.000Z',
    tenantId: TEST_TENANT_ID
  });
  assert(!overDaily.allowed && overDaily.reason === 'daily_limit_exceeded', 'daily cap should fail after spend');

  console.log('✅ policy-engine checks passed');
}

run().catch((error) => {
  console.error('❌ policy-engine checks failed:', error.message);
  process.exit(1);
});
