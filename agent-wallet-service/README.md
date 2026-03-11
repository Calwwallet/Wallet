# Agent Wallet Service

**Stripe for AI Agent Wallets**

Add wallet functionality to any AI agent in seconds. No blockchain SDKs, no key management, no contract deployment.

## 5-minute Quickstart (copy once)

> Goal: start the server, create a scoped API key, create a wallet, and verify balance with one paste.

### 0) Start the service

```bash
npm install
npm start
```

### 1) In a second terminal, run this single block

```bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this copy-once flow."
  echo "Install jq: brew install jq   # macOS"
  echo "         sudo apt-get install jq   # Debian/Ubuntu"
  echo "Or use CLI onboarding instead: node cli.js setup --init"
  exit 1
fi

# Edit only if your server is not on localhost:3000
export AGENT_WALLET_API="http://localhost:3000"

# 1) Obtain bootstrap admin key (one-time setup mode)
#    Run the server once with SHOW_BOOTSTRAP_SECRET=true to print the full key.
#    The key is not stored in plaintext on disk.
export BOOTSTRAP_KEY="<paste_bootstrap_key_from_startup_log>"
echo "bootstrap key: ${BOOTSTRAP_KEY:0:12}..."

# 2) Create scoped app key (read/write)
APP_KEY_JSON="$(curl -sS -X POST "$AGENT_WALLET_API/api-keys" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $BOOTSTRAP_KEY" \
  -d '{"name":"quickstart","permissions":["read","write"]}')"

echo "$APP_KEY_JSON" | jq -e '.success == true and (.key.key | startswith("sk_"))' >/dev/null
export AGENT_WALLET_API_KEY="$(echo "$APP_KEY_JSON" | jq -r '.key.key')"
echo "✅ key created: ${AGENT_WALLET_API_KEY:0:12}..."

# 3) Create wallet
WALLET_JSON="$(curl -sS -X POST "$AGENT_WALLET_API/wallet/create" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AGENT_WALLET_API_KEY" \
  -d '{"agentName":"QuickstartBot","chain":"base-sepolia"}')"

echo "$WALLET_JSON" | jq -e '.success == true and (.wallet.address | startswith("0x"))' >/dev/null
export FROM_WALLET="$(echo "$WALLET_JSON" | jq -r '.wallet.address')"
echo "✅ wallet created: $FROM_WALLET"

# 4) Verify balance
BALANCE_JSON="$(curl -sS "$AGENT_WALLET_API/wallet/$FROM_WALLET/balance?chain=base-sepolia" \
  -H "X-API-Key: $AGENT_WALLET_API_KEY")"

echo "$BALANCE_JSON" | jq -e '.balance.chain == "base-sepolia"' >/dev/null
echo "$BALANCE_JSON" | jq '{chain: .balance.chain, eth: .balance.eth, rpc: .balance.rpc}'
echo "✅ balance verified"
```

### No `jq`?

Use CLI onboarding instead (no JSON parsing required):

```bash
node cli.js setup --init
```

---

## Status: ✅ Production Ready v0.1.0

- Multi-chain support (9 chains)
- ERC-8004 AI Agent Identity
- API key authentication
- Full CLI + SDK

## Features

### 🔗 Multi-Chain Support

| Testnets | Mainnets |
|----------|----------|
| base-sepolia ✓ | base |
| ethereum-sepolia ✓ | ethereum |
| optimism-sepolia ✓ | polygon |
| arbitrum-sepolia ✓ | optimism |
| | arbitrum |

Each chain has fallback RPCs for reliability.

### 🆔 ERC-8004 Agent Identity

On-chain identity for AI agents:
- Verifiable agent IDs
- Capability tracking
- W3C Verifiable Credentials compatible
- Agent types: `assistant`, `autonomous`, `hybrid`

### 🔐 API Key Authentication

- Generate/revoke API keys (header transport only)
- API keys are hashed at rest in `api-keys.json`
- Role-based permissions (read/write/admin)
- Weighted rate limiting built-in (route-aware costs)
- Tier-aware limits (`free`, `pro`, `enterprise`)
- RPC mode by tier:
  - `tier:free` => BYO RPC required on chain-call wallet routes
  - `tier:pro` / `tier:enterprise` => managed RPC
- Rate limit headers: `RateLimit-*`, `X-RateLimit-*`, `Retry-After`

### 🛡️ Policy Engine Guardrails

- Per-wallet transfer limits (`perTxLimitEth`, `dailyLimitEth`)
- Recipient allowlist/denylist
- Policy simulation endpoint before sending funds

## Role-specific snippets

### 1) Backend API service (server-to-server)

```bash
# health
curl -s http://localhost:3000/health

# check a wallet balance
curl -s "http://localhost:3000/wallet/0xYourWallet/balance?chain=base-sepolia" \
  -H "X-API-Key: $API_KEY"
```

### 2) CLI-only operator

```bash
# via package script
npm run cli -- create OpsBot base-sepolia
npm run cli -- list
npm run cli -- chains
npm run cli -- balance 0xYourWallet
npm run cli -- send 0xFrom 0xTo 0.001
```

### 3) SDK integration (Node)

```javascript
import AgentWallet from './sdk.js';

const wallet = new AgentWallet('http://localhost:3000');

const created = await wallet.createWallet('SdkBot');
const balance = await wallet.getBalance(created.wallet.address);
const tx = await wallet.send(created.wallet.address, '0x000000000000000000000000000000000000dead', '0.000001');
console.log({ created, balance, tx });
```

### Free tier: BYO RPC (Alchemy)

Create a free key:

```bash
curl -X POST http://localhost:3000/api-keys \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $BOOTSTRAP_KEY" \
  -d '{"name":"free-key","permissions":["read","write","tier:free"]}'
```

Use that key with your own RPC URL on chain-call wallet routes:

```bash
curl "http://localhost:3000/wallet/$FROM_WALLET/balance?chain=base-sepolia" \
  -H "X-API-Key: $FREE_KEY" \
  -H "X-RPC-URL: https://base-sepolia.g.alchemy.com/v2/<ALCHEMY_KEY>"
```

Supported BYO input fields:
- Header: `X-RPC-URL`
- Query: `?rpcUrl=...`
- Body: `{ "rpcUrl": "..." }`

### First-run onboarding

Use the **copy-once quickstart** at the top of this README, or run:

```bash
node cli.js setup --init
```

## CLI Usage

```bash
# Wallet commands
node cli.js create MyBot base-sepolia
node cli.js balance 0x...
node cli.js balances 0x...          # All chains
node cli.js send 0xfrom 0xto 0.001
node cli.js sweep 0xfrom 0xto       # Send all funds
node cli.js estimate 0xfrom 0xto 0.001
node cli.js list
node cli.js chains

# Identity commands (ERC-8004)
node cli.js identity create 0xwallet BotName assistant
node cli.js identity list
node cli.js identity get agent:xxx
node cli.js identity wallet 0xaddress

# ENS commands
node cli.js ens list
node cli.js ens get myagent.eth
node cli.js ens check myagent.eth

# Setup helper
node cli.js setup
node cli.js setup --init   # health + onboarding + scoped key + .env.local

# Demo
node cli.js demo
```

## API Endpoints (runtime)

### Core + API key management

```
GET    /                                 Service metadata
GET    /health                           Health + features + endpoint index
POST   /api-keys                         Create API key (admin)
GET    /api-keys                         List API keys (admin)
DELETE /api-keys/:prefix                 Revoke API key (admin)
```

### Wallet

```
POST /wallet/create                      Create new wallet
POST /wallet/import                      Import from private key
GET  /wallet/list                        List all wallets
GET  /wallet/chains                      Supported chains
GET  /wallet/fees                        Fee configuration
GET  /wallet/history                     Global transaction history
GET  /wallet/tx/:hash                    Transaction status/receipt (free tier requires BYO rpcUrl)
POST /wallet/estimate-gas                Estimate gas cost (free tier requires BYO rpcUrl)

GET  /wallet/:address                    Wallet details
GET  /wallet/:address/balance            Balance on wallet chain (or ?chain=) (free tier requires BYO rpcUrl)
GET  /wallet/:address/balance/all        Balance across all chains (managed tiers only)
GET  /wallet/:address/history            Wallet transaction history
POST /wallet/:address/send               Send transaction (free tier requires BYO rpcUrl)
POST /wallet/:address/sweep              Sweep all funds (free tier requires BYO rpcUrl)
```

### Identity (ERC-8004)

```
POST  /identity/create                   Create agent identity
GET   /identity/list                     List all identities
GET   /identity/types                    Agent types
GET   /identity/capabilities             Supported capabilities
GET   /identity/wallet/:address          Identities by wallet
GET   /identity/:agentId                 Get identity
PATCH /identity/:agentId/capability      Update capability
POST  /identity/:agentId/revoke          Revoke identity
GET   /identity/:agentId/credential      W3C Verifiable Credential
```

### ENS

```
GET  /ens/check/:name                    Check ENS availability
GET  /ens/price/:name                    Get registration price
POST /ens/register                       Register ENS name
GET  /ens/list                           List managed ENS names
GET  /ens/:name                          Resolve ENS details
```

## Error envelope

All API errors now use a single response shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "agentName", "message": "Required" }
    ]
  }
}
```

Examples by status code:

```json
// 401
{ "error": { "code": "API_KEY_REQUIRED", "message": "API key required" } }

// 403
{ "error": { "code": "API_KEY_INVALID", "message": "Invalid API key" } }

// 404
{ "error": { "code": "IDENTITY_NOT_FOUND", "message": "Identity not found" } }

// 429
{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Rate limit exceeded" } }

// 500
{ "error": { "code": "INTERNAL_ERROR", "message": "Internal server error" } }
```

## Common errors

| Error case | HTTP status | Typical message | What to do |
|---|---:|---|---|
| Missing API key | 401 | `API key required` | Send `X-API-Key` header. Query param auth is rejected by default. |
| Invalid API key | 403 | `Invalid API key` | Ensure the key exists and has not been revoked. |
| Free-tier missing RPC URL | 400 | `Free-tier API keys must provide a BYO RPC URL` | Send `X-RPC-URL` header (or `rpcUrl` query/body). |
| Free-tier balance/all call | 403 | `BYO RPC does not support /balance/all` | Use `GET /wallet/:address/balance?chain=...&rpcUrl=...` instead. |
| Invalid chain | 400 or 500 | `Unsupported chain` / chain validation error | Call `GET /wallet/chains` and use one of the returned chain IDs. |
| Insufficient funds | 500 | `insufficient funds` | Fund the sender on the same chain and reduce transfer amount to account for gas. |
| RPC fallback failures | 500 | `All RPC endpoints failed` / transport errors | Retry shortly; verify RPC/network connectivity and try another supported chain. |

## Rate limit tuning

- Set `RATE_LIMIT_WINDOW_MS` (default: `60000`).
- Set per-tier limits:
  - `RATE_LIMIT_MAX_POINTS_FREE` (default: `100`)
  - `RATE_LIMIT_MAX_POINTS_PRO` (default: `300`)
  - `RATE_LIMIT_MAX_POINTS_ENTERPRISE` (default: `1000`)
- Set request costs:
  - `RATE_LIMIT_COST_READ` (default: `1`)
  - `RATE_LIMIT_COST_WRITE` (default: `2`)
  - `RATE_LIMIT_COST_EXPENSIVE` (default: `10`)
- Assign tier on key creation via permission tag, e.g. `["read","write","tier:pro"]`.
- Free-tier (`tier:free`) keys must provide BYO RPC URL (`X-RPC-URL`, `rpcUrl` query/body).
- Restrict BYO hosts via `BYO_RPC_ALLOWED_HOSTS` (default: `*.g.alchemy.com,*.alchemy.com`).

## Security migration notes

- `api-keys.json` now stores `{ keyHash, keyPrefix, ... }` only. Plain API keys are never persisted.
- If you already had plaintext `api-keys.json` entries, they are migrated to hashed records on startup.
- Query parameter auth (`?apiKey=`) is disabled by default. Use `X-API-Key` header.
- Temporary local fallback is available only in non-production by setting `ALLOW_QUERY_API_KEY_FALLBACK=true`.
- `SHOW_BOOTSTRAP_SECRET=true` is intended for explicit one-time setup only and is ignored in production.

## Architecture

```
src/
├── index.js                    Express server
├── routes/
│   ├── wallet.js               Wallet endpoints
│   └── identity.js             ERC-8004 endpoints
├── services/
│   ├── viem-wallet.js          Core wallet ops
│   ├── agent-identity.js       ERC-8004 identity
│   ├── fee-collector.js        Fee calculations
│   └── tx-history.js           Transaction logging
└── middleware/
    ├── auth.js                 API key auth + weighted rate limiting
    └── rateLimit.js            Legacy simple limiter (unused)
```

## Live Transaction

First successful transaction on Base Sepolia:
```
0x7f8feba9bd220fdee58499422135f2cafab818a829d76e72d17273e50d3e3a6c
```

## Coming Soon

- [ ] Public deployment
- [ ] NPM package
- [ ] Web dashboard
- [ ] Webhook notifications
- [ ] Multi-signature wallets

## Positioning

> "Add a wallet to any agent in 60 seconds. Your agent can hold funds, pay for services, and earn fees — without touching a single blockchain SDK, managing private keys, or deploying smart contracts."

---

Built by Mr. Claw 🦞


## Policy Example

```bash
# Set policy for a wallet
curl -X PUT http://localhost:3000/wallet/policy/$FROM_WALLET \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "dailyLimitEth": "0.05",
    "perTxLimitEth": "0.01",
    "allowedRecipients": ["0xabc..."],
    "blockedRecipients": []
  }'

# Check if a transfer would pass policy
curl -X POST http://localhost:3000/wallet/policy/$FROM_WALLET/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"to":"0xabc...","value":"0.005","chain":"base-sepolia"}'
```
