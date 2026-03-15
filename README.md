<p align="center">
  <img src="docs/images/claw-mascot.png" alt="Claw Wallet Mascot" width="180" />
</p>

<h1 align="center">🦞 Claw Wallet</h1>

<p align="center">
  <strong>Stripe for AI Agent Wallets</strong><br>
  <em>Give your AI agents secure, multi-chain wallets in seconds.</em>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-api-examples">API Examples</a> •
  <a href="#-python-sdk">Python SDK</a> •
  <a href="#-documentation">Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/python-%3E%3D3.8-blue" alt="Python" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="License" />
  <img src="https://img.shields.io/badge/chains-10%2B-purple" alt="Chains" />
</p>

---

<p align="center">
  <img src="docs/images/how-it-works-comic.png" alt="How Claw Wallet Works" width="100%" />
</p>

---

## 🤔 Why Claw Wallet?

Building wallet infrastructure for AI agents is hard. You need to:

| Problem | Claw Wallet Solution |
|---------|---------------------|
| 🔐 Manage private keys securely | Encrypted storage with AES-256-GCM |
| 🔗 Support multiple blockchains | 10+ chains: EVM, Solana, Sui, Aptos, Starknet |
| ✍️ Handle transaction signing | Simple REST API, no SDK complexity |
| 🛡️ Implement spending policies | Built-in policy engine with HITL approvals |
| 🏗️ Build from scratch | Deploy in minutes, not months |

<p align="center">
  <img src="docs/images/ai-agent-comic.png" alt="AI Agent using Claw Wallet" width="380" />
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔗 **Multi-Chain Support** | Ethereum, Base, Polygon, Optimism, Arbitrum, Solana, Sui, Aptos, Starknet, zkSync |
| 🆔 **ERC-8004 Identity** | On-chain identity for AI agents with W3C Verifiable Credentials |
| 🔐 **API Key Authentication** | Role-based permissions with tiered rate limiting |
| 🛡️ **Policy Engine** | Spending limits, recipient allowlists, Human-in-the-Loop approvals |
| 🔌 **MCP Server** | Model Context Protocol integration for AI assistants |
| 📊 **Dashboard UI** | React-based management interface |
| 🐍 **Python SDK** | Full-featured Python client with LangChain support |
| 🔔 **WebSocket** | Real-time transaction notifications |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or bun
- (Optional) PostgreSQL for persistent storage
- (Optional) Redis for distributed rate limiting

### 1. Install & Run

```bash
# Clone the repository
git clone https://github.com/Vibes-me/Claw-wallet.git
cd Claw-wallet/agent-wallet-service

# Install dependencies
npm install

# Start the service
npm start
```

The service will:
- Start on **port 3000** (configurable via `PORT`)
- Generate an **admin API key** on first run
- Print the key prefix (e.g., `sk_live_abc123...`)
- Enable **WebSocket server** at `/ws`

### 2. Get Your API Key

```bash
# Option A: Show full key on startup
SHOW_BOOTSTRAP_SECRET=true npm start

# Option B: Read from generated file
node -e "console.log(JSON.parse(require('fs').readFileSync('api-keys.json','utf8'))[0].key)"
```

### 3. Create Your First Wallet

```bash
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{"agentName": "MyFirstAgent", "chain": "base-sepolia"}'
```

**Response:**

```json
{
  "wallet": {
    "id": "wallet_1710123456789_abc123def",
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8bE21",
    "chain": "base-sepolia",
    "agentName": "MyFirstAgent",
    "createdAt": "2024-03-11T00:00:00.000Z"
  }
}
```

---

## 📖 API Examples

### 🔑 Authentication

All API requests require an API key in the `X-API-Key` header:

```bash
curl http://localhost:3000/wallet/list \
  -H "X-API-Key: sk_live_YOUR_KEY"
```

### 💰 Create Wallets

```bash
# Create wallet on Base Sepolia (testnet)
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{"agentName": "TradingBot", "chain": "base-sepolia"}'

# Create wallet on Ethereum mainnet
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{"agentName": "VaultKeeper", "chain": "ethereum"}'

# Create wallet on Solana
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{"agentName": "SolanaBot", "chain": "solana-devnet"}'

# Create wallet on Sui
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{"agentName": "SuiBot", "chain": "sui-testnet"}'
```

### 💵 Check Balance

```bash
curl http://localhost:3000/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f8bE21/balance \
  -H "X-API-Key: sk_live_YOUR_KEY"
```

**Response:**

```json
{
  "address": "0x742d35...",
  "balance": {
    "eth": "0.05",
    "wei": "50000000000000000"
  },
  "chain": "base-sepolia"
}
```

### 📤 Send Transaction

```bash
curl -X POST http://localhost:3000/wallet/0x742d35.../send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -H "X-RPC-URL: https://base-sepolia.g.alchemy.com/v2/YOUR_KEY" \
  -d '{
    "to": "0xRecipientAddress",
    "value": "0.001"
  }'
```

**Response:**

```json
{
  "hash": "0xabc123...",
  "from": "0x742d35...",
  "to": "0xRecipientAddress...",
  "value": "0.001",
  "chain": "base-sepolia",
  "status": "pending"
}
```

### 🆔 Create Agent Identity (ERC-8004)

```bash
curl -X POST http://localhost:3000/identity/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{
    "walletAddress": "0x742d35...",
    "agentName": "TradingBot",
    "description": "An AI trading agent",
    "agentType": "assistant"
  }'
```

**Response:**

```json
{
  "identity": {
    "id": "agent:base-sepolia:0x742d35...",
    "address": "0x742d35...",
    "agentName": "TradingBot",
    "description": "An AI trading agent",
    "createdAt": "2024-03-11T00:00:00.000Z"
  }
}
```

### 🛡️ Set Spending Policy

```bash
curl -X PUT http://localhost:3000/wallet/policy/0x742d35... \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{
    "maxTransactionValue": "0.1",
    "dailyLimit": "1.0",
    "allowedRecipients": ["0xAllowed1...", "0xAllowed2..."],
    "requireApproval": true
  }'
```

### 📡 WebSocket Real-Time Updates

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Authenticate with your API key
  ws.send(JSON.stringify({
    type: 'auth',
    data: { apiKey: 'sk_live_...' }
  }));
  
  // Subscribe to wallet events
  ws.send(JSON.stringify({
    type: 'subscribe',
    data: { walletAddress: '0x742d35...' }
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Event:', msg.type, msg.data);
};

// Available events:
// - tx:pending     - Transaction submitted
// - tx:confirmed   - Transaction confirmed on chain
// - tx:failed      - Transaction failed
// - wallet:created - New wallet created
// - approval:required - HITL approval needed
```

### 📋 List Supported Chains

```bash
curl http://localhost:3000/wallet/chains \
  -H "X-API-Key: sk_live_YOUR_KEY"
```

**Response:**

```json
{
  "chains": [
    { "id": "ethereum", "name": "Ethereum", "testnet": false },
    { "id": "base", "name": "Base", "testnet": false },
    { "id": "base-sepolia", "name": "Base Sepolia", "testnet": true },
    { "id": "polygon", "name": "Polygon", "testnet": false },
    { "id": "optimism", "name": "Optimism", "testnet": false },
    { "id": "arbitrum", "name": "Arbitrum", "testnet": false },
    { "id": "solana", "name": "Solana", "testnet": false },
    { "id": "solana-devnet", "name": "Solana Devnet", "testnet": true },
    { "id": "sui", "name": "Sui", "testnet": false },
    { "id": "sui-testnet", "name": "Sui Testnet", "testnet": true },
    { "id": "aptos", "name": "Aptos", "testnet": false },
    { "id": "starknet", "name": "Starknet", "testnet": false }
  ]
}
```

---

## 🐍 Python SDK

### Installation

```bash
pip install claw-wallet
```

### Basic Usage

```python
from claw_wallet import WalletClient

# Initialize the client
client = WalletClient(
    api_key="sk_live_...",
    base_url="http://localhost:3000"
)

# Create a wallet
wallet = client.create_wallet("MyAgent", chain="base-sepolia")
print(f"Created wallet: {wallet.address}")

# Check balance
balance = client.get_balance(wallet.address)
print(f"Balance: {balance.eth} ETH")

# Send a transaction
tx = client.send_transaction(
    from_address=wallet.address,
    to_address="0xRecipient...",
    value_eth="0.001"
)
print(f"Transaction hash: {tx.hash}")

# Create an agent identity
identity = client.create_identity(
    wallet_address=wallet.address,
    agent_name="MyAgent",
    description="An AI assistant for trading"
)
print(f"Identity ID: {identity.id}")
```

### LangChain Integration

```python
from claw_wallet.langchain import ClawWalletTool
from langchain.agents import initialize_agent
from langchain_openai import ChatOpenAI

# Create the wallet tool
wallet_tool = ClawWalletTool(
    api_key="sk_live_...",
    base_url="http://localhost:3000"
)

# Add to your LangChain agent
llm = ChatOpenAI(model="gpt-4")
agent = initialize_agent(
    tools=[wallet_tool],
    llm=llm,
    agent="zero-shot-react-description"
)

# Your AI agent can now create wallets and send transactions!
result = agent.run("Create a wallet on Base Sepolia and show me the address")
print(result)
```

---

## 🔌 API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health and supported chains |
| `GET` | `/onboarding` | Setup instructions and examples |
| `POST` | `/api-keys` | Create new API key (admin only) |
| `GET` | `/api-keys` | List all API keys (admin only) |
| `DELETE` | `/api-keys/:prefix` | Revoke an API key (admin only) |

### Wallet Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/wallet/create` | Create a new wallet |
| `POST` | `/wallet/import` | Import wallet from private key |
| `GET` | `/wallet/list` | List all wallets |
| `GET` | `/wallet/:address` | Get wallet details |
| `GET` | `/wallet/:address/balance` | Get wallet balance |
| `POST` | `/wallet/:address/send` | Send a transaction |
| `POST` | `/wallet/:address/sweep` | Sweep all funds to another address |
| `GET` | `/wallet/chains` | List all supported chains |

### Identity (ERC-8004)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/identity/create` | Create an agent identity |
| `GET` | `/identity/list` | List all identities |
| `GET` | `/identity/:agentId` | Get identity details |
| `GET` | `/identity/:agentId/credential` | Get W3C Verifiable Credential |

### Policy Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/wallet/policy/:address` | Get wallet spending policy |
| `PUT` | `/wallet/policy/:address` | Set wallet spending policy |
| `POST` | `/wallet/policy/:address/evaluate` | Test policy against a transaction |

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `DATABASE_URL` | PostgreSQL connection URL | - |
| `REDIS_URL` | Redis connection URL | - |
| `ALCHEMY_API_KEY` | Alchemy API key for managed RPC | - |
| `API_KEY_HASH_SECRET` | Secret for hashing API keys | (random in dev) |
| `STORAGE_BACKEND` | Storage mode (`json` or `db`) | `json` |
| `AUTH_BACKEND` | Auth storage mode (`json` or `db`) | `json` |
| `ENABLE_MCP` | Enable MCP server | `true` |

### Tiers & Rate Limits

| Tier | Points/Min | RPC Mode | Permissions |
|------|------------|----------|-------------|
| `tier:free` | 100 | BYO RPC required | `read`, `write` |
| `tier:pro` | 300 | Managed RPC | `read`, `write` |
| `tier:enterprise` | 1000 | Managed RPC | `read`, `write`, `admin` |

---

## 🐳 Docker Deployment

```bash
# Build the image
cd agent-wallet-service
docker build -t claw-wallet .

# Run with environment variables
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e API_KEY_HASH_SECRET=your-secret-key \
  -e ALCHEMY_API_KEY=your-alchemy-key \
  claw-wallet

# Or use docker-compose
docker-compose up -d
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:wallet      # Wallet operations
npm run test:auth        # Authentication
npm run test:policy      # Policy engine
npm run test:hitl        # Human-in-the-Loop
npm run test:rate-limit  # Rate limiting
```

---

## 🛡️ Security

For coordinated vulnerability disclosure, see [SECURITY.md](SECURITY.md).

| Feature | Implementation |
|---------|----------------|
| **Private Keys** | Encrypted at rest using AES-256-GCM |
| **API Keys** | Hashed using HMAC-SHA256 in database mode |
| **Rate Limiting** | Tier-aware with Redis support for distributed deployments |
| **BYO RPC** | Whitelisted hosts only (configurable) |
| **Policy Engine** | Per-transaction and daily spending limits |
| **HITL** | Human-in-the-Loop approval for high-value transactions |

---

## 📁 Project Structure

```
claw-wallet/
├── agent-wallet-service/          # Main Node.js backend
│   ├── src/
│   │   ├── index.js              # Express server entry point
│   │   ├── routes/               # API route handlers
│   │   │   ├── wallet.js         # Wallet CRUD & transactions
│   │   │   ├── identity.js       # ERC-8004 identity management
│   │   │   ├── ens.js            # ENS registration & resolution
│   │   │   ├── multisig.js       # Multi-signature wallets
│   │   │   ├── defi.js           # DeFi integrations
│   │   │   └── ...
│   │   ├── services/             # Business logic
│   │   │   ├── viem-wallet.js    # Core wallet operations
│   │   │   ├── agent-identity.js # ERC-8004 implementation
│   │   │   ├── policy-engine.js  # Spending policies
│   │   │   ├── chain-manager.js  # Multi-chain coordination
│   │   │   └── ...
│   │   ├── middleware/           # Express middleware
│   │   └── repositories/         # Data access layer
│   ├── tests/                    # Test suites
│   └── Dockerfile
│
├── agent-wallet-service-python/   # Python SDK
│   └── claw_wallet/
│       ├── client.py             # Main API client
│       ├── models.py             # Data models
│       ├── exceptions.py         # Custom exceptions
│       └── langchain/            # LangChain integration
│
├── agent-wallet-service-dashboard/ # React Dashboard UI
│   └── src/
│
└── docs/                          # Documentation
    ├── images/                    # README images
    └── releases/                  # Release notes
```

---

## 🧭 Open Core Model

### Open Source (this repo)

- ✅ Core SDK/client functionality (JavaScript + Python)
- ✅ Core wallet service APIs and policy baseline
- ✅ Basic self-host deployment artifacts (Docker + docs)

### Paid / Commercial

- 💼 Managed cloud control plane
- 💼 Enterprise policy and compliance modules
- 💼 SLA-backed operations, advanced analytics, and hosted governance

See [OPEN_CORE_STRATEGY.md](OPEN_CORE_STRATEGY.md) for details.

---

## 🤝 Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <img src="docs/images/lobster-monk-meme.png" alt="Lobster Monk Wisdom" width="320" />
</p>

<p align="center">
  <em>"Simplify your agent wallets. Namaste."</em> 🦞🙏
</p>

---

<p align="center">
  <strong>🦞 Built by Mr. Claw</strong>
</p>

<p align="center">
  <em>Give your AI agents the power of secure, multi-chain wallets in seconds.</em>
</p>
