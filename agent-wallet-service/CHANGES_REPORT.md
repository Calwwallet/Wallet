## CLAWwallet Changes Report

### Date: March 2026

### Summary
This report documents all bug fixes applied to the CLAWwallet Agent Wallet Service.

### Bugs Fixed

#### HIGH PRIORITY

1. **API Key Exposure in Query Parameters** (src/middleware/auth.js)
   - Issue: API keys could be passed in URL query parameters when ALLOW_QUERY_API_KEY=true, causing them to be logged in server access logs
   - Fix: Removed ALLOW_QUERY_API_KEY constant and modified requireAuth() and optionalAuth() to only accept API keys from headers

2. **Inconsistent RPC Fallback in Transaction Sending** (src/services/viem-wallet.js)
   - Issue: Created client with fallback but then created walletClient using only rpcs[0], defeating the fallback mechanism
   - Fix: Modified signTransaction() to use the client from createClientWithFallback instead of creating a new walletClient

3. **Missing Tenant Isolation in Policy Engine** (src/services/policy-engine.js)
   - Issue: Returned default permissive policy even when tenant doesn't own the wallet
   - Fix: Updated getPolicy() to return null when policy doesn't exist and tenantId is provided

4. **Policy Bypass via Policy Disabling** (src/services/policy-engine.js)
   - Issue: When policy disabled, transactions allowed without any limits tracked
   - Fix: Updated evaluateTransferPolicy() to still track transactions for audit even when policy is disabled

#### MEDIUM PRIORITY

5. **Unused Import** (src/routes/identity.js:16)
   - Issue: signTransaction imported but never used
   - Fix: Removed unused import

6. **Unauthenticated Wallet List Endpoint** (src/routes/wallet.js:80)
   - Issue: /wallet/list didn't require authentication
   - Fix: Added requireAuth('read') middleware

7. **Unauthenticated Identity List Endpoint** (src/routes/identity.js:80)
   - Issue: /identity/list didn't require authentication
   - Fix: Added requireAuth('read') middleware

8. **Broken Async IIFE Pattern** (src/routes/identity.js)
   - Issue: Async IIFE returns immediately before completion, errors not caught properly
   - Fix: Refactored 3 routes (PATCH /:agentId/capability, POST /:agentId/revoke, GET /:agentId/credential) to use proper async/await pattern

9. **Health Endpoint Exposes Sensitive Stats** (src/index.js)
   - Issue: Health endpoint exposed wallet/identity counts to all clients
   - Fix: Simplified /health endpoint to only return basic status (service name, version, features, chains)

10. **Race Condition in Rate Limiting** (src/middleware/auth.js)
    - Issue: In-memory rate limiting has race condition between check and update
    - Fix: Added mutex locks to checkRateLimitInMemory() to prevent race conditions

11. **Broken Async IIFE Pattern** (src/index.js:261-266)
    - Issue: Same async IIFE anti-pattern in API key routes
    - Fix: Refactored 3 API key management routes (POST, GET, DELETE /api-keys) to use proper async/await

### Files Modified
- src/middleware/auth.js
- src/services/viem-wallet.js
- src/services/policy-engine.js
- src/routes/identity.js
- src/routes/wallet.js
- src/index.js
