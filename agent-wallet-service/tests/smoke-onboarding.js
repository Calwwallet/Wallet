#!/usr/bin/env node

import { spawn, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const API = process.env.AGENT_WALLET_API || 'http://127.0.0.1:3000';
const SERVER_START_TIMEOUT_MS = 15000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${API}/health`);
}

function runCli(args, env = {}) {
  try {
    const output = execFileSync('node', ['cli.js', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf8'
    });
    return { status: 0, output };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    return {
      status: Number.isInteger(error?.status) ? error.status : 1,
      output: `${stdout}${stderr}`
    };
  }
}

async function main() {
  const server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '3000', SHOW_BOOTSTRAP_SECRET: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForHealth();

    // 1) onboarding endpoint shape
    const onboardingRes = await fetch(`${API}/onboarding`);
    assert(onboardingRes.ok, `/onboarding should return 200, got ${onboardingRes.status}`);
    const onboarding = await onboardingRes.json();
    assert(typeof onboarding.service === 'string', 'onboarding.service missing');
    assert(typeof onboarding.hasApiKeys === 'boolean', 'onboarding.hasApiKeys missing/invalid');
    assert(typeof onboarding.apiKeyCount === 'number', 'onboarding.apiKeyCount missing/invalid');
    assert(Array.isArray(onboarding.nextSteps), 'onboarding.nextSteps missing/invalid');
    console.log('✅ onboarding endpoint shape validated');

    // 2) setup flow behavior without API key
    const setupNoKey = runCli(['setup'], { AGENT_WALLET_API: API, AGENT_WALLET_API_KEY: '' });
    assert(setupNoKey.status === 0, `setup without key should exit 0, got ${setupNoKey.status}`);
    assert(setupNoKey.output.includes('Checking server at'), 'setup should check server');
    assert(setupNoKey.output.includes('Auth required'), 'setup without key should indicate auth required');
    console.log('✅ setup without API key validated');

    // 3) protected route error wording
    const listNoKey = runCli(['list'], { AGENT_WALLET_API: API, AGENT_WALLET_API_KEY: '' });
    assert(listNoKey.status !== 0, 'list without key should exit non-zero');
    assert(listNoKey.output.includes('Missing API key.'), 'list without key should show missing key wording');
    assert(listNoKey.output.includes('node cli.js setup --init'), 'missing key wording should suggest setup command');
    console.log('✅ protected route error wording validated');

    // 4) setup flow behavior with API key
    const adminKey = JSON.parse(readFileSync('api-keys.json', 'utf8'))[0]?.key;
    assert(typeof adminKey === 'string' && adminKey.startsWith('sk_'), 'bootstrap admin key missing in api-keys.json');

    const setupWithKey = runCli(['setup'], { AGENT_WALLET_API: API, AGENT_WALLET_API_KEY: adminKey });
    assert(setupWithKey.status === 0, `setup with key should exit 0, got ${setupWithKey.status}`);
    assert(setupWithKey.output.includes('Auth check passed'), 'setup with key should pass auth check');
    console.log('✅ setup with API key validated');

    // 5) setup --init creates scoped key + env template
    const setupInit = runCli(['setup', '--init'], {
      AGENT_WALLET_API: API,
      AGENT_WALLET_ADMIN_KEY: adminKey,
      AGENT_WALLET_API_KEY: ''
    });
    assert(setupInit.status === 0, `setup --init should exit 0, got ${setupInit.status}`);
    assert(setupInit.output.includes('Created scoped API key'), 'setup --init should create scoped key');
    assert(setupInit.output.includes('.env.local'), 'setup --init should mention .env.local');
    console.log('✅ setup --init validated');

    console.log('\n✅ onboarding smoke test passed');
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
    if (!server.killed) server.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('❌ onboarding smoke test failed');
  console.error(err?.stack || err);
  process.exit(1);
});
