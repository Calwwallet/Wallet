# Phase 3 Feature Specifications

## CLAWwallet Architectural Improvements - Phase 3

**Document Version:** 1.0  
**Generated:** March 2026  
**For:** CLAWwallet Development Team

---

## Table of Contents

1. [Multi-Sig Wallet Requirements](#1-multi-sig-wallet-requirements-and-implementation-details)
2. [DeFi Integrations](#2-defi-integrations)
3. [Additional Blockchain Chains](#3-additional-blockchain-chains-support)
4. [Webhook System Requirements](#4-webhook-system-requirements)

---

## 1. Multi-Sig Wallet Requirements and Implementation Details

### 1.1 Overview

The multi-sig wallet implementation provides M-of-N threshold signature capabilities for collaborative wallet management, enabling AI agents to operate under shared control policies.

### 1.2 Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Multi-Sig Wallet Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User ──────▶ Init ──────────▶ MultiSig Service                    │
│                                           │                          │
│                                           ▼                          │
│                                    Create Smart Contract             │
│                                           │                          │
│                                           ▼                          │
│                                    Return Address                   │
│                                           │                          │
│                                           ▼                          │
│                                    Store Config to DB               │
│                                           │                          │
│                                           ▼                          │
│  User ──────▶ Submit Tx ──────▶ Collect Signatures                  │
│                                           │                          │
│                                           ▼                          │
│                              Threshold Met?                         │
│                                    │                                │
│                           ┌───────┴───────┐                        │
│                           ▼               ▼                         │
│                          Yes              No                        │
│                           │               │                         │
│                           ▼               ▼                        │
│                    Execute           Wait for                       │
│                    Transaction       More Signatures               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Core Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **M-of-N Threshold** | Configure required signatures from N total signers | Required |
| **Role-Based Signing** | Admin, treasury, and operations roles with different permissions | Required |
| **Hardware Wallet Support** | Ledger and Trezor integration for secure key storage | Required |
| **Timelock Transactions** | Delayed execution with configurable grace periods | Required |
| **Transaction Batching** | Combine multiple operations into single execution | Optional |

### 1.4 Implementation Pattern

```javascript
// Extensible multi-sig configuration
const MULTISIG_CONFIG = {
  threshold: 2,           // M-of-N: require 2 of N signatures
  signers: [
    { address: '0x...', role: 'admin' },
    { address: '0x...', role: 'treasury' },
    { address: '0x...', role: 'operations' }
  ],
  timelock: {
    delay: 86400,        // 24 hours in seconds
    gracePeriod: 172800  // 48 hours grace period
  }
};

// Multi-sig transaction submission
async function submitMultiSigTx(wallet, tx, signers) {
  // Create transaction proposal
  const proposal = await createProposal(wallet, tx);
  
  // Collect signatures from required signers
  const signatures = await collectSignatures(proposal, wallet.threshold);
  
  // Execute when threshold met
  if (signatures.length >= wallet.threshold) {
    return await executeTransaction(proposal, signatures);
  }
  
  // Return pending proposal for later execution
  return { status: 'pending', proposalId: proposal.id };
}
```

### 1.5 Database Schema Requirements

```sql
-- Multi-sig wallet configuration
CREATE TABLE multisig_wallets (
  id UUID PRIMARY KEY,
  address VARCHAR(66) NOT NULL,
  chain VARCHAR(32) NOT NULL,
  threshold INTEGER NOT NULL,
  timelock_delay INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Signers configuration
CREATE TABLE multisig_signers (
  id UUID PRIMARY KEY,
  wallet_id UUID REFERENCES multisig_wallets(id),
  address VARCHAR(66) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pending transactions
CREATE TABLE multisig_transactions (
  id UUID PRIMARY KEY,
  wallet_id UUID REFERENCES multisig_wallets(id),
  to_address VARCHAR(66) NOT NULL,
  data BYTEA,
  value VARCHAR(64),
  nonce INTEGER,
  signatures JSONB,
  executed BOOLEAN DEFAULT FALSE,
  executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 1.6 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/multisig/create` | POST | Create a new multi-sig wallet |
| `/multisig/list` | GET | List all multi-sig wallets |
| `/multisig/:address` | GET | Get multi-sig wallet details |
| `/multisig/:address/settings` | PUT | Update multi-sig settings |
| `/multisig/:address/submit` | POST | Submit a new transaction |
| `/multisig/:address/submit-batch` | POST | Submit batch transactions |
| `/multisig/:address/confirm` | POST | Confirm a transaction |
| `/multisig/:address/execute` | POST | Execute a confirmed transaction |
| `/multisig/:address/cancel` | POST | Cancel a pending transaction |
| `/multisig/:address/transactions` | GET | Get all transactions |
| `/multisig/:address/executable` | GET | Get executable transactions |

---

## 2. DeFi Integrations

### 2.1 Integration Priority Matrix

| Integration | Protocol | Use Case | Priority | Effort |
|-------------|----------|----------|----------|--------|
| Token Swaps | 0x, Uniswap | Agent token trading | High | Medium |
| Staking | Lido, Rocket Pool | Agent yield generation | Medium | Medium |
| Lending | Aave | Collateralized loans | Medium | High |
| Cross-chain | Axelar, LayerZero | Multi-chain movements | High | High |
| Price Feeds | Chainlink | Policy valuation | High | Low |

### 2.2 Token Swap Service

```javascript
// DeFi service abstraction for token swaps
class DeFiService {
  constructor(walletService, policyEngine) {
    this.walletService = walletService;
    this.policyEngine = policyEngine;
    this.aggregator = new SwapAggregator([
      new ZeroExAdapter(),
      new UniswapAdapter()
    ]);
  }

  async swap(params) {
    const { 
      fromToken,    // Token address to sell
      toToken,      // Token address to buy
      amount,       // Amount in wei
      chain,        // Blockchain network
      slippage = 0.01  // 1% default slippage
    } = params;

    // Get optimal quote from aggregator
    const quote = await this.aggregator.getQuote({
      sellToken: fromToken,
      buyToken: toToken,
      sellAmount: amount,
      slippagePercentage: slippage,
      chain
    });

    // Validate against policy engine
    await this.policyEngine.evaluate({
      walletAddress: params.walletAddress,
      action: 'defi_swap',
      amount: quote.buyAmount,
      token: toToken
    });

    // Execute via policy-checked transaction
    return this.walletService.send({
      to: quote.to,
      data: quote.data,
      value: quote.value,
      chain
    });
  }

  async getBestRoute(fromToken, toToken, amount, chain) {
    // Compare quotes across multipleDEXs
    const quotes = await Promise.all([
      this.aggregator.getQuote(fromToken, toToken, amount, chain),
      this.uniswap.getQuote(fromToken, toToken, amount),
      this.curve.getQuote(fromToken, toToken, amount)
    ]);
    
    return this.selectBestQuote(quotes);
  }
}
```

### 2.3 Staking Integration

```javascript
// Staking service for yield generation
class StakingService {
  // Lido ETH staking
  async stakeEth(params) {
    const { walletAddress, amount, chain = 'ethereum' } = params;
    
    // Lido contract interface
    const stakingContract = new Contract(
      LIDO_ADDRESSES[chain],
      ['function submit(address referral) external payable'],
      wallet
    );

    return this.walletService.send({
      to: LIDO_ADDRESSES[chain],
      data: stakingContract.interface.encodeFunctionData('submit', [referral]),
      value: amount
    });
  }

  // Stake and wrap for stETH
  async stakeAndWrap(params) {
    const { walletAddress, amount } = params;
    
    // Use ERC20 approve + deposit pattern
    const token = new ERC20(ETH_ADDRESS);
    
    // Approve stETH pool
    await this.walletService.send({
      to: ETH_ADDRESS,
      data: token.interface.encodeFunctionData('approve', [
        STETH_POOL_ADDRESS,
        amount
      ])
    });

    // Deposit
    return this.walletService.send({
      to: STETH_POOL_ADDRESS,
      data: poolInterface.encodeFunctionData('deposit', [amount])
    });
  }

  // Rocket Pool ETH staking
  async stakeRocketPool(params) {
    const { walletAddress, amount } = params;
    
    const depositContract = new Contract(
      ROCKET_POOL_DEPOSIT_ADDRESS,
      ['function deposit() external payable'],
      wallet
    );

    return this.walletService.send({
      to: ROCKET_POOL_DEPOSIT_ADDRESS,
      data: depositContract.interface.encodeFunctionData('deposit'),
      value: amount
    });
  }
}
```

### 2.4 Lending Integration (Aave)

```javascript
// Lending service for collateralized borrowing
class LendingService {
  constructor(aavePool) {
    this.pool = aavePool;
  }

  async supply(params) {
    const { walletAddress, token, amount, chain } = params;
    
    const pool = new Contract(
      AAVE_POOL_ADDRESSES[chain],
      AAVE_ABI,
      wallet
    );

    // Approve token transfer
    await this.approveToken(token, AAVE_POOL_ADDRESSES[chain], amount);

    // Supply to Aave
    return this.walletService.send({
      to: AAVE_POOL_ADDRESSES[chain],
      data: pool.interface.encodeFunctionData('supply', [
        token,
        amount,
        walletAddress,
        0 // referral code
      ])
    });
  }

  async borrow(params) {
    const { walletAddress, token, amount, chain, interestRateMode = 2 } = params;
    
    const pool = new Contract(
      AAVE_POOL_ADDRESSES[chain],
      AAVE_ABI,
      wallet
    );

    return this.walletService.send({
      to: AAVE_POOL_ADDRESSES[chain],
      data: pool.interface.encodeFunctionData('borrow', [
        token,
        amount,
        interestRateMode, // 1 = stable, 2 = variable
        0,
        walletAddress
      ])
    });
  }

  async getAccountHealthFactor(walletAddress, chain) {
    const pool = new Contract(
      AAVE_POOL_ADDRESSES[chain],
      AAVE_ABI,
      wallet
    );

    const data = await pool.getUserAccountData(walletAddress);
    return {
      healthFactor: data.healthFactor,
      totalCollateralBase: data.totalCollateralBase,
      totalDebtBase: data.totalDebtBase,
      availableBorrowsBase: data.availableBorrowsBase,
      currentLiquidationThreshold: data.currentLiquidationThreshold,
      ltv: data.ltv,
      currentLtv: data.currentLtv
    };
  }
}
```

### 2.5 Cross-Chain Integration

```javascript
// Cross-chain messaging service
class CrossChainService {
  // LayerZero implementation
  async sendCrossChain(params) {
    const { 
      fromChain, 
      toChain, 
      walletAddress, 
      token, 
      amount, 
      destinationAddress 
    } = params;

    // LayerZero endpoint
    const endpoint = new Contract(
      LAYERZERO_ENDPOINT,
      LAYERZERO_ABI,
      wallet
    );

    // Configure path
    const dstChainId = this.getLayerZeroChainId(toChain);
    const destination = this.getDestinationUA(dstChainId, destinationAddress);

    // Send tokens cross-chain
    return this.walletService.send({
      to: token, // For bridgable tokens like OFT
      data: tokenInterface.encodeFunctionData('send', [
        destination,  // Destination UA
        amount,       // Amount to send
        '0x',         // Payload
        0,            //Refund address
        '0x'          //ZRO payment
      ]),
      value: this.estimateLayerZeroFee(fromChain, toChain, amount)
    });
  }

  // Axelar implementation
  async sendViaAxelar(params) {
    const { fromChain, toChain, token, amount, destinationAddress } = params;
    
    const gateway = new Contract(
      AXELAR_GATEWAY,
      AXELAR_GATEWAY_ABI,
      wallet
    );

    // Approve tokens to gateway
    await this.approveToken(token, AXELAR_GATEWAY, amount);

    // Send call
    return this.walletService.send({
      to: AXELAR_GATEWAY,
      data: gateway.interface.encodeFunctionData('sendToken', [
        this.getAxelarChainId(toChain),
        destinationAddress,
        token,
        amount
      ])
    });
  }
}
```

### 2.6 Price Feeds (Chainlink)

```javascript
// Price feed service for policy valuation
class PriceFeedService {
  constructor(chainlinkFeeds) {
    this.feeds = chainlinkFeeds;
  }

  async getPrice(tokenPair) {
    const feed = this.feeds[tokenPair];
    if (!feed) throw new Error(`No price feed for ${tokenPair}`);

    const aggregator = new Contract(
      feed.address,
      CHAINLINK_ABI,
      wallet
    );

    const [roundData, decimals] = await Promise.all([
      aggregator.latestRoundData(),
      aggregator.decimals()
    ]);

    return {
      price: roundData.answer,
      decimals: decimals,
      timestamp: roundData.updatedAt,
      roundId: roundData.roundId
    };
  }

  async getValueInUSD(tokenAddress, amount, chain) {
    // Get ETH price
    const ethPrice = await this.getPrice(`ETH/USD`);
    
    // Get token/ETH price if not ETH
    if (tokenAddress !== ETH_ADDRESS) {
      const tokenEthPrice = await this.getPrice(`${tokenAddress}/ETH`);
      return amount * tokenEthPrice.price / tokenEthPrice.decimals * ethPrice.price;
    }
    
    // For ETH directly
    return amount * ethPrice.price;
  }
}
```

### 2.7 DeFi API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/defi/quote` | GET | Get swap quote from DEX |
| `/defi/swap` | POST | Execute a token swap |
| `/defi/stake` | POST | Stake tokens |
| `/defi/unstake` | POST | Unstake tokens |
| `/defi/staking/positions/:walletAddress` | GET | Get staking positions |
| `/defi/supply` | POST | Supply to Aave |
| `/defi/borrow` | POST | Borrow from Aave |
| `/defi/repay` | POST | Repay to Aave |
| `/defi/withdraw` | POST | Withdraw from Aave |
| `/defi/collateral` | POST | Set collateral |
| `/defi/lending/positions/:walletAddress` | GET | Get Aave positions |
| `/defi/crosschain` | POST | Execute cross-chain transfer |
| `/defi/crosschain/routes` | GET | Get available cross-chain routes |
| `/defi/price/:token` | GET | Get token price |
| `/defi/prices` | GET | Get multiple token prices |
| `/defi/info` | GET | Get supported DeFi info |

---

## 3. Additional Blockchain Chains Support

### 3.1 Chain Support Priority

| Chain | Type | Effort | Rationale |
|-------|------|--------|-----------|
| **Solana** | Mainnet | High | Large agent ecosystem, different VM |
| **Aptos** | Mainnet | Medium | Growing Move-based ecosystem |
| **Sui** | Mainnet | Medium | Similar to Aptos |
| **StarkNet** | Mainnet | Medium | Cairo-based, growing DeFi |
| **Polygon zkEVM** | Mainnet | Low | EVM-compatible, low effort |
| **zkSync Era** | Mainnet | Medium | Account abstraction support |

### 3.2 Implementation Pattern

```javascript
// Extensible chain registry
const CHAIN_REGISTRY = {
  // Existing EVM chains
  'base-sepolia': { 
    type: 'evm', 
    parser: evmTxParser,
    chainId: 84532,
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  },
  'ethereum-sepolia': { 
    type: 'evm', 
    parser: evmTxParser,
    chainId: 11155111,
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  },
  
  // New chains to add
  'solana': { 
    type: 'solana', 
    parser: solanaTxParser,
    cluster: 'mainnet-beta',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 }
  },
  'aptos': { 
    type: 'aptos', 
    parser: aptosTxParser,
    chainId: 1,
    nativeCurrency: { name: 'Aptos', symbol: 'APT', decimals: 8 }
  },
  'sui': { 
    type: 'sui', 
    parser: suiTxParser,
    chainId: 1,
    nativeCurrency: { name: 'Sui', symbol: 'SUI', decimals: 9 }
  },
  'starknet': { 
    type: 'starknet', 
    parser: starknetTxParser,
    chainId: '0x1',
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  },
  'polygon-zkevm': { 
    type: 'evm', 
    parser: evmTxParser,
    chainId: 1101,
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  },
  'zksync-era': { 
    type: 'evm', 
    parser: evmTxParser,
    chainId: 324,
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  }
};

function getChainParser(chain) {
  const config = CHAIN_REGISTRY[chain];
  if (!config) throw new Error(`Unsupported chain: ${chain}`);
  return config.parser;
}

function getChainConfig(chain) {
  return CHAIN_REGISTRY[chain];
}

// Wallet creation for different chain types
async function createWalletForChain(agentName, chain) {
  const config = getChainConfig(chain);
  
  switch (config.type) {
    case 'evm':
      return createEvmWallet(agentName, chain);
    case 'solana':
      return createSolanaWallet(agentName);
    case 'aptos':
      return createAptosWallet(agentName);
    case 'sui':
      return createSuiWallet(agentName);
    case 'starknet':
      return createStarknetWallet(agentName);
    default:
      throw new Error(`Unsupported chain type: ${config.type}`);
  }
}
```

### 3.3 Solana-Specific Implementation

```javascript
// Solana wallet service
class SolanaWalletService {
  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL);
  }

  async createWallet() {
    const keypair = Keypair.generate();
    return {
      address: keypair.publicKey.toBase58(),
      privateKey: Buffer.from(keypair.secretKey).toString('hex')
    };
  }

  async getBalance(address) {
    const pubkey = new PublicKey(address);
    const balance = await this.connection.getBalance(pubkey);
    return {
      lamports: balance,
      SOL: balance / 1e9
    };
  }

  async sendTransaction(params) {
    const { fromPrivateKey, toAddress, amount, priorityFee = 5000 } = params;
    
    const keypair = Keypair.fromSecretKey(
      Buffer.from(fromPrivateKey, 'hex')
    );
    
    const transaction = new Transaction();
    
    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amount
      })
    );

    // Set priority fee
    transaction.feePriorityFee = priorityFee;
    
    // Sign and send
    transaction.sign(keypair);
    const signature = await this.connection.sendRawTransaction(
      transaction.serialize()
    );

    return { signature, status: await this.connection.confirmTransaction(signature) };
  }
}
```

### 3.4 Move-Based Chain Implementation (Aptos/Sui)

```javascript
// Aptos wallet service
class AptosWalletService {
  async createWallet() {
    const account = AptosAccount.generate();
    return {
      address: account.address().toString(),
      privateKey: Buffer.from(account.privateKey.toUint8Array()).toString('hex')
    };
  }

  async submitTransaction(params) {
    const { privateKey, toAddress, amount, coinType = '0x1::aptos_coin::AptosCoin' } = params;
    
    const account = new AptosAccount(
      new Uint8Array(Buffer.from(privateKey, 'hex')),
      { address: undefined, publicKey: undefined }
    );
    
    const payload = {
      type: 'entry_function_payload',
      function: '0x1::coin::transfer',
      type_arguments: [coinType],
      arguments: [toAddress, amount.toString()]
    };

    const txn = await this.aptosClient.generateTransaction(
      account.address(),
      payload
    );

    const signedTxn = await this.aptosClient.signTransaction(account, txn);
    const result = await this.aptosClient.submitTransaction(signedTxn);

    return {
      hash: result.hash,
      status: await this.aptosClient.waitForTransaction(result.hash)
    };
  }
}
```

---

## 4. Webhook System Requirements

### 4.1 Overview

The webhook system enables real-time event notifications for wallet activities, transaction status changes, and policy events. This feature requires the Event Queue infrastructure from Phase 2.

**Timeline:** 2 months (Phase 3)

### 4.2 Event Types

| Event | Producer | Consumers | Priority |
|-------|----------|-----------|----------|
| `wallet.created` | Wallet Service | Analytics, Webhooks | High |
| `tx.sent` | Transaction Service | Webhooks, Indexers | High |
| `tx.confirmed` | Transaction Service | Balance cache, Webhooks | High |
| `tx.failed` | Transaction Service | Alerts, Webhooks | High |
| `policy.updated` | Policy Engine | Cache invalidation | Medium |
| `identity.created` | Identity Service | Analytics | Low |

### 4.3 Webhook Implementation

```javascript
// Webhook service
class WebhookService {
  constructor(redis, httpClient) {
    this.redis = redis;
    this.httpClient = httpClient;
    this.queue = 'webhook:delivery';
    this.retryQueue = 'webhook:retry';
  }

  // Register webhook endpoint for tenant
  async registerWebhook(tenantId, url, events, secret) {
    const webhook = {
      id: crypto.randomUUID(),
      tenantId,
      url,
      events,
      secret,
      active: true,
      createdAt: new Date().toISOString()
    };

    await this.redis.set(
      `webhook:${tenantId}:${webhook.id}`,
      JSON.stringify(webhook)
    );

    // Index by event type for efficient lookup
    for (const event of events) {
      await this.redis.sadd(`webhook:events:${tenantId}:${event}`, webhook.id);
    }

    return webhook;
  }

  // Publish event to webhook queue
  async publishEvent(eventType, payload) {
    const event = {
      id: crypto.randomUUID(),
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
      version: '1.0'
    };

    // Get active webhooks for this event
    const webhookIds = await this.redis.smembers(
      `webhook:events:*:${eventType}`
    );

    // Queue deliveries
    for (const webhookId of webhookIds) {
      const webhook = JSON.parse(
        await this.redis.get(`webhook:${webhookId}`)
      );

      if (webhook.active) {
        await this.redis.lpush(this.queue, JSON.stringify({
          webhookId,
          event,
          attempts: 0
        }));
      }
    }
  }

  // Process webhook delivery
  async processDelivery(job) {
    const { webhookId, event, attempts } = job;
    const webhook = JSON.parse(
      await this.redis.get(`webhook:${webhookId}`)
    );

    // Generate signature
    const signature = this.generateSignature(
      JSON.stringify(event),
      webhook.secret
    );

    try {
      const response = await this.httpClient.post(webhook.url, event, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event.type,
          'X-Webhook-Id': event.id
        },
        timeout: 30000
      });

      // Log successful delivery
      await this.logDelivery(webhookId, event, response.status, 'success');

      return { success: true };
    } catch (error) {
      // Handle failure - retry with exponential backoff
      await this.handleDeliveryFailure(webhookId, event, error, attempts);
      
      return { success: false, error: error.message };
    }
  }

  // Retry logic with exponential backoff
  async handleDeliveryFailure(webhookId, event, error, attempts) {
    const maxRetries = 5;
    
    if (attempts < maxRetries) {
      // Exponential backoff: 1min, 5min, 15min, 1hr, 24hr
      const delays = [60, 300, 900, 3600, 86400];
      const delay = delays[attempts];

      await this.redis.lpush(this.retryQueue, JSON.stringify({
        webhookId,
        event,
        attempts: attempts + 1,
        scheduledAt: Date.now() + (delay * 1000)
      }));
    }

    // Log failed delivery
    await this.logDelivery(webhookId, event, error.status, 'failed', error.message);
  }

  generateSignature(payload, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  async logDelivery(webhookId, event, status, outcome, error = null) {
    await this.redis.lpush(
      `webhook:logs:${webhookId}`,
      JSON.stringify({
        eventId: event.id,
        eventType: event.type,
        status,
        outcome,
        error,
        timestamp: new Date().toISOString()
      })
    );
  }
}
```

### 4.4 Webhook API Endpoints

```yaml
# Webhook management endpoints
paths:
  /webhooks:
    post:
      summary: Register a new webhook
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url, events]
              properties:
                url:
                  type: string
                  format: uri
                  example: "https://example.com/webhooks/agent"
                events:
                  type: array
                  items:
                    type: string
                    enum: [wallet.created, tx.sent, tx.confirmed, tx.failed, policy.updated]
                secret:
                  type: string
                  description: "Used to sign webhook payloads"
      responses:
        '201':
          description: Webhook registered

  /webhooks/{webhookId}:
    get:
      summary: Get webhook details
    delete:
      summary: Remove webhook registration

  /webhooks/{webhookId}/deliveries:
    get:
      summary: Get delivery history
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: eventType
          in: query
          schema:
            type: string
```

### 4.5 Webhook Payload Schema

```json
{
  "id": "evt_abc123",
  "type": "tx.confirmed",
  "timestamp": "2026-03-02T12:00:00Z",
  "data": {
    "walletAddress": "0x...",
    "chain": "base-sepolia",
    "transaction": {
      "hash": "0x...",
      "from": "0x...",
      "to": "0x...",
      "value": "1000000000000000000",
      "status": "confirmed",
      "blockNumber": 12345678,
      "timestamp": "2026-03-02T11:59:55Z"
    }
  }
}
```

### 4.6 Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Signature Verification** | HMAC-SHA256 signatures with per-webhook secrets |
| **TLS/SSL** | HTTPS-only webhook endpoints |
| **IP Whitelisting** | Optional IP-based access control |
| **Retry Policy** | Exponential backoff with max 5 retries |
| **Delivery Logging** | Immutable logs for debugging and compliance |

---

## 5. Phase 3 Implementation Timeline

| Task | Effort | Dependencies |
|------|--------|--------------|
| Multi-sig wallets | 3 months | Phase 2 |
| DeFi integrations | 2 months | Phase 1 |
| Additional chains | 1 month each | None |
| Webhook system | 2 months | Event queue |

---

## 6. Implementation Notes

### 6.1 Dependencies

- **Multi-sig wallets** require Phase 2 infrastructure (Event Queue)
- **DeFi integrations** require Phase 1 (policy engine, wallet service)
- **Additional chains** can be implemented in parallel
- **Webhook system** requires Event Queue from Phase 2

### 6.2 Testing Strategy

Each feature should include:
- Unit tests for core logic
- Integration tests for API endpoints
- E2E tests for critical user flows
- Load tests for performance validation

### 6.3 Security Considerations

1. **API Keys**: Use environment variables and secrets management
2. **Private Keys**: Encrypt at rest with KMS/Vault
3. **Webhooks**: Validate signatures and use HTTPS
4. **DeFi**: Integrate policy engine for all transactions
5. **Cross-chain**: Verify bridge contracts and use reputable protocols

---

*End of Phase 3 Specifications*
