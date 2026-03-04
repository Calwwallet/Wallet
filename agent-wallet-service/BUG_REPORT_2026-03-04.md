# Wallet Program Bug Report (2026-03-04)

Tested project: `agent-wallet-service`  
Path: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service`  
Commit: `443e3a3`  
Runtime: Node `v22.22.0`, npm `10.9.4`

## Summary

I ran the wallet service through automated scripts and manual API/CLI flows.  
There are 5 reproducible issues, including 1 startup blocker and 2 quickstart/onboarding breakages.

## Findings

### 1) CRITICAL: Service fails to boot (ESM export mismatch)

- Severity: Critical
- Repro:
1. `cd /home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service`
2. `node src/index.js`
- Expected: Service starts and binds to configured port.
- Actual: Process exits with `SyntaxError`:
  - `src/services/viem-wallet.js` imports named exports not provided by `src/middleware/rpc-access.js`.
- Evidence:
  - Import site: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/src/services/viem-wallet.js:84`
  - Missing exports in file: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/src/middleware/rpc-access.js:24`, `:28`, `:37` (functions exist but are not exported)
- Impact: Server cannot start, blocking all API/CLI functionality.

### 2) HIGH: Documented quickstart fails without encryption env var

- Severity: High
- Repro:
1. Start service with default env (`npm start` / `node src/index.js`)
2. Use bootstrap key and call `POST /wallet/create` as documented in quickstart.
- Expected: Wallet creation succeeds per README quickstart flow.
- Actual: API returns error:
  - `{"error":"FATAL: Encryption key required. Set WALLET_ENCRYPTION_KEY for production or TEST_WALLET_ENCRYPTION_KEY for testing."}`
- Evidence:
  - Quickstart implies just `npm install` + `npm start`: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/README.md:13`
  - Quickstart wallet create step: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/README.md:48`
  - Runtime hard fail path: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/src/services/encryption.js:28`
- Impact: New-user onboarding path is broken unless undocumented env is set first.

### 3) HIGH: `tests/smoke-onboarding.js` fails on expected unauthenticated CLI path

- Severity: High
- Repro:
1. `node tests/smoke-onboarding.js`
- Expected: Test validates unauthenticated `cli.js list` output text and continues.
- Actual: Test aborts early because `execFileSync` throws on non-zero exit from `cli.js list`.
- Evidence:
  - `runCli` uses `execFileSync` with no error handling: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/tests/smoke-onboarding.js:26`
  - Failing call: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/tests/smoke-onboarding.js:61`
  - CLI actually prints expected message but exits `1` (captured manually):
    - `Missing API key. Set AGENT_WALLET_API_KEY...`
- Impact: Onboarding smoke test is flaky/incorrect and can fail despite user-facing wording being correct.

### 4) MEDIUM: `tests/test-auth.js` fails in default local run (no test encryption key setup)

- Severity: Medium
- Repro:
1. Start service without `WALLET_ENCRYPTION_KEY`/`TEST_WALLET_ENCRYPTION_KEY`
2. Run `API_URL=http://127.0.0.1:3000 node tests/test-auth.js`
- Expected: Auth suite either self-configures test key or fails fast with clear setup guidance.
- Actual: Suite fails during wallet creation with generic `Failed to create wallet`, backend returns encryption-key fatal.
- Evidence:
  - Wallet creation expectation path: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/tests/test-auth.js:98`
  - No test-key fallback in this script.
  - Contrast: `tests/run-tests.js` auto-sets `TEST_WALLET_ENCRYPTION_KEY`: `/home/sanjay/Desktop/CLAWwallet/Claw-wallet/agent-wallet-service/tests/run-tests.js:67`
- Impact: Standalone auth test is unreliable for contributors following its own header comment (`Run: node tests/test-auth.js`).

### 5) MEDIUM: Declared chain integrations are unavailable at runtime (dependency mismatch)

- Severity: Medium
- Repro:
1. Start service.
2. Observe startup warnings:
   - `Chain service "aptos" unavailable: Cannot find package 'aptos' ...`
   - `Chain service "sui" unavailable: Cannot find package '@mysten/sui' ...`
   - `Chain service "starknet" unavailable: Cannot find package 'starknet' ...`
3. Run `npm ls aptos @mysten/sui starknet --depth=0` -> empty.
- Expected: Dependencies declared in `package.json` are installable/resolved, or marked optional with graceful disable semantics.
- Actual: Chain features advertised in health/features are partially disabled by missing modules.
- Impact: Multi-chain behavior is degraded and potentially misleading to users/operators.

## Test Runs Performed

- `npm test` (with elevated runtime to allow localhost bind): passed core suite once in an earlier state.
- `node tests/smoke-onboarding.js`: failed reproducibly (Issue #3).
- `node tests/test-hitl.js`: passed.
- `API_URL=http://127.0.0.1:3000 node tests/test-auth.js`: failed reproducibly (Issue #4).
- Manual CLI/API checks:
  - `cli.js list` without API key returns proper message but exits non-zero.
  - `POST /wallet/create` fails without encryption env var and succeeds with `TEST_WALLET_ENCRYPTION_KEY`.

## Notes

- The repository is in a heavily dirty state with many pre-existing changes, which may contribute to inconsistencies between runs.
