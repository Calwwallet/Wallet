<p align="center">
  <img src="docs/images/claw-mascot.png" alt="Claw Wallet Mascot" width="200" />
</p>

<h1 align="center">🦞 Claw Wallet</h1>

<p align="center">
  <strong>Stripe for AI Agent Wallets</strong> — Add wallet functionality to any AI agent in seconds.
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

## 🤔 Why Claw Wallet?

**The Problem:** AI agents need wallets, but setting up blockchain infrastructure is painful:
- Managing private keys securely 🔐
- Supporting multiple chains 🔗
- Handling transaction signing ✍️
- Implementing spending policies 🛡️
- Building everything from scratch 🏗️

**The Solution:** Claw Wallet gives your AI agents instant access to multi-chain wallets through a simple HTTP API.

<p align="center">
  <img src="docs/images/ai-agent-comic.png" alt="AI Agent using Claw Wallet" width="400" />
</p>

> *"Simplify your agent wallets. Namaste."* 🦞🙏

<p align="center">
  <img src="docs/images/lobster-monk-meme.png" alt="Lobster Monk Wisdom" width="350" />
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔗 **Multi-Chain** | Ethereum, Base, Polygon, Optimism, Arbitrum, Solana, Sui, Aptos, Starknet, zkSync |
| 🆔 **ERC-8004 Identity** | On-chain identity for AI agents with W3C Verifiable Credentials |
| 🔐 **API Key Auth** | Role-based permissions with tiered rate limiting |
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
# Clone the repo
git clone https://github.com/Vibes-me/Claw-wallet.git
cd Claw-wallet/agent-wallet-service

# Install dependencies
npm install

# Start the service
npm start
```

The service will:
- Start on port 3000 (configurable via `PORT`)
- Generate an admin API key on first run
- Print the key prefix (e.g., `sk_live_abc123...`)

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
  -d '{
    "agentName": "MyFirstAgent",
    "chain": "base-sepolia"
  }'
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

### 💰 Create a Wallet

```bash
# Create wallet on Base Sepolia (testnet)
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{
    "agentName": "TradingBot",
    "chain": "base-sepolia"
  }'

# Create wallet on Ethereum mainnet
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{
    "agentName": "VaultKeeper",
    "chain": "ethereum"
  }'

# Create wallet on Solana
curl -X POST http://localhost:3000/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_YOUR_KEY" \
  -d '{
    "agentName": "SolanaBot",
    "chain": "solana-devnet"
  }'
```

### 💵 Check Balance

```bash
# Get ETH balance
curl http://localhost:3000/wallet/0x742d35.../balance \
  -H "X-API-Key: sk_live_YOUR_KEY"

# Response
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
    "to": "0xRecipientAddress...",
    "value": "0.001"
  }'

# Response
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

# Response
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
  // Authenticate
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

// Events: tx:pending, tx:confirmed, tx:failed, 
//         wallet:created, approval:required, etc.
```

### 📋 List All Supported Chains

```bash
curl http://localhost:3000/wallet/chains \
  -H "X-API-Key: sk_live_YOUR_KEY"

# Response
{
  "chains": [
    { "id": "ethereum", "name": "Ethereum", "testnet": false },
    { "id": "base", "name": "Base", "testnet": false },
    { "id": "base-sepolia", "name": "Base Sepolia", "testnet": true },
    { "id": "solana-devnet", "name": "Solana Devnet", "testnet": true },
    ...
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

# Initialize client
client = WalletClient(
    api_key="sk_live_...",
    base_url="http://localhost:3000"
)

# Create a wallet
wallet = client.create_wallet("MyAgent", chain="base-sepolia")
print(f"Created: {wallet.address}")

# Check balance
balance = client.get_balance(wallet.address)
print(f"Balance: {balance.eth} ETH")

# Send transaction
tx = client.send_transaction(
    from_address=wallet.address,
    to_address="0xRecipient...",
    value_eth="0.001"
)
print(f"TX: {tx.hash}")

# Create agent identity
identity = client.create_identity(
    wallet_address=wallet.address,
    agent_name="MyAgent",
    description="An AI assistant"
)
print(f"Identity: {identity.id}")
```

### LangChain Integration

```python
from claw_wallet.langchain import ClawWalletTool
from langchain.agents import initialize_agent

# Create wallet tool for LangChain agent
wallet_tool = ClawWalletTool(
    api_key="sk_live_...",
    base_url="http://localhost:3000"
)

# Add to your LangChain agent
agent = initialize_agent(
    tools=[wallet_tool],
    llm=your_llm,
    agent="zero-shot-react-description"
)

# Agent can now create wallets and send transactions!
agent.run("Create a wallet on Base Sepolia and show me the address")
```

---

## 🔌 API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health & supported chains |
| `GET` | `/onboarding` | Setup instructions |
| `POST` | `/api-keys` | Create new API key (admin) |
| `GET` | `/api-keys` | List API keys (admin) |
| `DELETE` | `/api-keys/:prefix` | Revoke API key (admin) |

### Wallet Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/wallet/create` | Create new wallet |
| `POST` | `/wallet/import` | Import from private key |
| `GET` | `/wallet/list` | List all wallets |
| `GET` | `/wallet/:address` | Get wallet details |
| `GET` | `/wallet/:address/balance` | Get balance |
| `POST` | `/wallet/:address/send` | Send transaction |
| `POST` | `/wallet/:address/sweep` | Sweep all funds |
| `GET` | `/wallet/chains` | List supported chains |

### Identity (ERC-8004)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/identity/create` | Create agent identity |
| `GET` | `/identity/list` | List all identities |
| `GET` | `/identity/:agentId` | Get identity details |
| `GET` | `/identity/:agentId/credential` | W3C Verifiable Credential |

### Policy Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/wallet/policy/:address` | Get wallet policy |
| `PUT` | `/wallet/policy/:address` | Set policy |
| `POST` | `/wallet/policy/:address/evaluate` | Test policy |

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL URL | - |
| `REDIS_URL` | Redis URL | - |
| `ALCHEMY_API_KEY` | Alchemy API key | - |
| `API_KEY_HASH_SECRET` | Key hashing secret | (random in dev) |
| `STORAGE_BACKEND` | Storage mode (`json`/`db`) | `json` |
| `ENABLE_MCP` | Enable MCP server | `true` |

### Tiers & Rate Limits

| Tier | Points/Min | RPC Mode | Permissions |
|------|------------|----------|-------------|
| `tier:free` | 100 | BYO RPC | `read`, `write` |
| `tier:pro` | 300 | Managed | `read`, `write` |
| `tier:enterprise` | 1000 | Managed | `read`, `write`, `admin` |

---

## 🐳 Docker Deployment

```bash
# Build
cd agent-wallet-service
docker build -t claw-wallet .

# Run with environment variables
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e API_KEY_HASH_SECRET=your-secret \
  -e ALCHEMY_API_KEY=your-key \
  claw-wallet

# Or with docker-compose
docker-compose up -d
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:wallet
npm run test:auth
npm run test:policy
npm run test:hitl
npm run test:rate-limit
```

---

## 🛡️ Security

For coordinated vulnerability disclosure, see [SECURITY.md](SECURITY.md).

| Feature | Implementation |
|---------|----------------|
| Private Keys | Encrypted at rest using AES-256-GCM |
| API Keys | Hashed using HMAC-SHA256 in database mode |
| Rate Limiting | Tier-aware with Redis support |
| BYO RPC | Whitelisted hosts only |
| Policy Engine | Per-transaction and daily spending limits |
| HITL | Human-in-the-Loop for high-value approvals |

---

## 📁 Project Structure

```
claw-wallet/
├── agent-wallet-service/          # Main Node.js backend
│   ├── src/
│   │   ├── index.js              # Express server
│   │   ├── routes/               # API handlers
│   │   ├── services/             # Business logic
│   │   ├── middleware/           # Auth, validation
│   │   └── repositories/         # Data access
│   ├── tests/                    # Test suites
│   └── Dockerfile
│
├── agent-wallet-service-python/   # Python SDK
│   └── claw_wallet/
│       ├── client.py
│       ├── models.py
│       └── langchain/
│
├── agent-wallet-service-dashboard/ # React Dashboard
│   └── src/
│
└── docs/                          # Documentation & images
    └── images/
```

---

## 🧭 Open Source vs Paid

### Open Source (this repo)
- ✅ Core SDK/client functionality (JS + Python)
- ✅ Core wallet service APIs and policy baseline
- ✅ Basic self-host deployment artifacts

### Paid / Commercial
- 💼 Managed cloud control plane
- 💼 Enterprise policy and compliance modules
- 💼 SLA-backed operations and analytics

See [OPEN_CORE_STRATEGY.md](OPEN_CORE_STRATEGY.md) for details.

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <img src="docs/images/claw-mascot.png" alt="Claw Mascot" width="100" />
</p>

<p align="center">
  <strong>🦞 Built by Mr. Claw</strong>
</p>

<p align="center">
  <em>Give your AI agents the power of secure, multi-chain wallets in seconds.</em>
</p>
