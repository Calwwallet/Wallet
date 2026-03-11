import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const DEFAULT_TEST_PORT = Number(process.env.TEST_SERVER_PORT || '3100');
const TEST_SERVER_TIMEOUT_MS = Number(process.env.TEST_SERVER_TIMEOUT_MS || '120000');
const API_URL = process.env.API_URL || `http://127.0.0.1:${DEFAULT_TEST_PORT}`;
const HEALTH_URL = new URL('/health', API_URL).toString();
const API_KEYS_FILE = join(process.cwd(), 'api-keys.json');

// Generate a deterministic test API key for CI
const TEST_API_KEY = process.env.TEST_API_KEY || `sk_test_${randomBytes(32).toString('hex')}`;

function createTestApiKeyFile() {
  // Create API key file with raw key that the repository will normalize
  const keyRecord = {
    key: TEST_API_KEY,
    keyPrefix: TEST_API_KEY.slice(0, 12),
    name: 'test-admin',
    createdAt: new Date().toISOString(),
    permissions: ['read', 'write', 'admin']
  };

  writeFileSync(API_KEYS_FILE, JSON.stringify([keyRecord], null, 2));
  console.log(`🔑 Created test API key: ${TEST_API_KEY.slice(0, 12)}...`);
}

function cleanupTestApiKeyFile() {
  try {
    if (existsSync(API_KEYS_FILE)) {
      unlinkSync(API_KEYS_FILE);
    }
  } catch {
    // Ignore cleanup errors
  }
}

function runNodeScript(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptPath} failed (${signal || code})`));
    });
  });
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

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;

  serverProcess.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => {
      serverProcess.once('exit', () => resolve(true));
    }),
    delay(5000).then(() => false)
  ]);

  if (!exited && !serverProcess.killed) {
    serverProcess.kill('SIGKILL');
  }
}

async function main() {
  let serverProcess = null;
  let ownsServer = false;

  try {
    // Pass TEST_API_KEY to all test scripts
    const testEnv = { ...process.env, API_URL, TEST_API_KEY };

    if (!process.env.API_URL) {
      // Create the API key file before starting the server
      // This ensures the server uses our known test key
      createTestApiKeyFile();

      const serverEnv = { 
        ...process.env, 
        PORT: String(DEFAULT_TEST_PORT),
        NODE_ENV: process.env.NODE_ENV || 'development',  // Ensure NODE_ENV is set for tests
        TEST_API_KEY  // Pass to server for logging
      };
      if (!serverEnv.WALLET_ENCRYPTION_KEY && !serverEnv.TEST_WALLET_ENCRYPTION_KEY) {
        serverEnv.TEST_WALLET_ENCRYPTION_KEY = 'local-test-wallet-key';
      }

      console.log(`Starting test server on ${API_URL}...`);
      serverProcess = spawn(process.execPath, ['src/index.js'], {
        cwd: process.cwd(),
        env: serverEnv,
        stdio: 'inherit'
      });
      ownsServer = true;

      const ready = await waitForHealth(TEST_SERVER_TIMEOUT_MS);
      if (!ready) {
        throw new Error(`Server did not become ready at ${HEALTH_URL} within ${TEST_SERVER_TIMEOUT_MS}ms`);
      }
    } else {
      console.log(`Using external API_URL: ${API_URL}`);
    }

    await runNodeScript('tests/test-policy.js', testEnv);
    await runNodeScript('tests/test-wallet.js', testEnv);
    await runNodeScript('tests/test-error-contract.js', testEnv);
    await runNodeScript('tests/test-metadata-version.js', testEnv);
  } finally {
    if (ownsServer) {
      await stopServer(serverProcess);
      cleanupTestApiKeyFile();
    }
  }
}

main().catch((error) => {
  console.error(`\n❌ Test runner failed: ${error.message}`);
  process.exit(1);
});
