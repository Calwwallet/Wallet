console.log('DEBUG: Starting index.js');
import 'dotenv/config';
console.log('DEBUG: dotenv loaded');
import express from 'express';
console.log('DEBUG: express loaded');
import walletRoutes from './routes/wallet.js';
import identityRoutes from './routes/identity.js';
import ensRoutes from './routes/ens.js';
import multisigRoutes from './routes/multisig.js';
import defiRoutes from './routes/defi.js';
import webhookRoutes from './routes/webhooks.js';
import chainRoutes from './routes/chains.js';
import agentsRoutes from './routes/agents.js';
import explorerRoutes from './routes/explorer.js';
import socialRoutes from './routes/social.js';
import { requireAuth, createApiKey, listApiKeys, revokeApiKey, getOnboardingState } from './middleware/auth.js';
import { getAllWallets } from './services/viem-wallet.js';
import { listIdentities } from './services/agent-identity.js';
import { getHistory } from './services/tx-history.js';
import { getPolicyStats } from './services/policy-engine.js';
import { applyMigrations } from './services/migrations.js';
import { getAllSupportedChains, getChainAvailability } from './services/chain-manager.js';
import { logger, requestLogger, errorLogger } from './services/logger.js';
import pkg from '../package.json' with { type: 'json' };
import { WalletMCPServer } from './mcp-server.js';

// Initialize MCP Server on startup
let mcpServer = null;
async function initMCPServer() {
  if (process.env.ENABLE_MCP !== 'false') {
    try {
      mcpServer = new WalletMCPServer();
      await mcpServer.start();
      logger.info('MCP Server initialized');
    } catch (err) {
      logger.warn({ err }, 'MCP Server failed to initialize - running in HTTP mode only');
    }
  }
}


// If DATABASE_URL is set, run SQL migrations on startup.
if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS !== 'false') {
  try {
    await applyMigrations();
  } catch (err) {
    logger.fatal({ err }, 'Failed to apply database migrations');
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Request logging middleware
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  const availableChains = getAllSupportedChains();
  const chainIds = availableChains.map((chain) => chain.id);
  const testnets = availableChains.filter((chain) => Boolean(chain.testnet)).map((chain) => chain.id);
  const mainnets = availableChains.filter((chain) => !chain.testnet).map((chain) => chain.id);

  res.json({
    status: 'ok',
    service: 'agent-wallet-service',
    version: pkg.version,
    features: ['multi-chain', 'erc-8004', 'api-keys', 'ens', 'policy-engine', 'multisig-wallets', 'defi-integrations', 'webhooks', 'additional-chains'],
    chains: {
      testnets,
      mainnets,
      count: chainIds.length
    },
    chainAvailability: getChainAvailability()
  });
});

// Public routes (no auth required)
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const acceptsHtml = req.accepts(['html', 'json']) === 'html';

  const payload = {
    name: 'Agent Wallet Service',
    version: pkg.version,
    docs: 'https://github.com/mrclaw/agent-wallet-service',
    quickstart: [
      '1) Start the service: npm start',
      '2) Run CLI onboarding: node cli.js setup --init',
      '3) Create a wallet: node cli.js create MyBot base-sepolia'
    ],
    links: {
      health: `${baseUrl}/health`,
      onboarding: `${baseUrl}/onboarding`,
      docs: 'https://github.com/mrclaw/agent-wallet-service#readme'
    },
    auth: 'API key required for most endpoints. Use X-API-Key header.'
  };

  if (acceptsHtml) {
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Agent Wallet Service</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2rem; background: #050816; color: #f9fafb; }
      .card { max-width: 800px; margin: 0 auto; background: radial-gradient(circle at top left, #1f2937, #020617); border-radius: 24px; padding: 2rem 2.5rem; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.3); }
      h1 { font-size: 1.9rem; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem; }
      h1 span.logo { font-size: 1.7rem; }
      h2 { font-size: 1.1rem; margin-top: 1.75rem; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; }
      .badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.7rem; border-radius: 999px; font-size: 0.75rem; background: rgba(15, 118, 110, 0.12); color: #a5f3fc; border: 1px solid rgba(45, 212, 191, 0.3); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.82rem; padding: 0.15rem 0.4rem; border-radius: 0.35rem; background: rgba(15, 23, 42, 0.9); color: #e5e7eb; }
      pre { background: rgba(15, 23, 42, 0.9); padding: 0.85rem 1rem; border-radius: 0.75rem; overflow-x: auto; font-size: 0.85rem; border: 1px solid rgba(31, 41, 55, 0.9); }
      a { color: #7dd3fc; text-decoration: none; }
      a:hover { text-decoration: underline; }
      ul { padding-left: 1.2rem; margin: 0.25rem 0 0.25rem; }
      li { margin: 0.15rem 0; }
      .grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.1fr); gap: 1.25rem; margin-top: 0.75rem; }
      .pill { padding: 0.2rem 0.55rem; border-radius: 999px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(51, 65, 85, 0.9); font-size: 0.75rem; display: inline-block; margin-right: 0.35rem; margin-bottom: 0.25rem; }
      .muted { color: #9ca3af; font-size: 0.8rem; margin-top: 1rem; }
      @media (max-width: 768px) {
        body { padding: 1.2rem; }
        .card { padding: 1.4rem 1.3rem; border-radius: 18px; }
        .grid { grid-template-columns: minmax(0, 1fr); }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1><span class="logo">🦞</span> Agent Wallet Service <span class="badge">v${pkg.version} · multi-chain</span></h1>
      <p>Give your human and AI agents safe wallets in seconds — no blockchain SDKs, no key management, no contract deployments.</p>

      <h2>Quickstart (local)</h2>
      <pre><code>npm install
npm start            # start the service
node cli.js setup --init
node cli.js create MyBot base-sepolia</code></pre>

      <div class="grid">
        <section>
          <h2>Copy-paste for humans</h2>
          <ul>
            <li>🩺 Health: <a href="${baseUrl}/health">${baseUrl}/health</a></li>
            <li>🚀 Onboarding: <a href="${baseUrl}/onboarding">${baseUrl}/onboarding</a></li>
            <li>📘 Docs: <a href="https://github.com/mrclaw/agent-wallet-service">GitHub README</a></li>
          </ul>
          <p style="margin-top: 0.5rem;">Auth header: <code>X-API-Key: sk_...</code></p>
        </section>
        <section>
          <h2>Drop-in for agents</h2>
          <pre><code>import AgentWallet from './sdk.js';

const wallet = new AgentWallet({
  baseUrl: '${baseUrl}',
  apiKey: process.env.AGENT_WALLET_API_KEY
});</code></pre>
        </section>
      </div>

      <h2>Capabilities</h2>
      <div>
        <span class="pill">Wallets · multi-chain</span>
        <span class="pill">ERC-8004 identities</span>
        <span class="pill">API keys &amp; rate limits</span>
        <span class="pill">Policy guardrails</span>
        <span class="pill">ENS helpers</span>
        <span class="pill">Multi-sig wallets</span>
        <span class="pill">DeFi integrations</span>
        <span class="pill">Webhooks</span>
      </div>

      <p class="muted">Tip: hit <code>/onboarding</code> for ready-to-run curl commands, or run <code>node cli.js demo</code> for an end-to-end flow.</p>
    </main>
  </body>
</html>`);
  } else {
    res.json(payload);
  }
});

// Simple JSON dashboard for agents/UX
app.get('/dashboard', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    service: 'agent-wallet-service',
    ui: 'minimal-dashboard',
    links: {
      health: `${baseUrl}/health`,
      onboarding: `${baseUrl}/onboarding`,
      wallets: `${baseUrl}/wallet/list`,
      identities: `${baseUrl}/identity/list`,
      history: `${baseUrl}/wallet/history`
    }
  });
});


app.get('/onboarding', async (req, res) => {
  const state = await getOnboardingState();
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.json({
    service: 'agent-wallet-service',
    rpcPlans: {
      free: 'BYO RPC required on chain-call endpoints',
      pro: 'Managed RPC included',
      enterprise: 'Managed RPC included'
    },
    hasApiKeys: state.hasApiKeys,
    apiKeyCount: state.apiKeyCount,
    keyPreview: state.firstKeyPrefix,
    docs: state.docsPath,
    onboardingPath: state.onboardingPath,
    nextSteps: state.hasApiKeys
      ? [
        'Use your existing API key with header: X-API-Key: sk_...',
        'If your key is tier:free, include X-RPC-URL on balance/send/sweep/estimate/tx routes',
        'Create a wallet with POST /wallet/create',
        'Check balances with GET /wallet/:address/balance'
      ]
      : [
        'Start the service once to bootstrap an admin API key',
        'Set SHOW_BOOTSTRAP_SECRET=true to print full bootstrap key if needed',
        'Use POST /api-keys to create scoped keys for apps/bots'
      ],
    examples: {
      createApiKey: {
        description: 'Create a free-tier API key (BYO RPC)',
        curl: `curl -X POST ${baseUrl}/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <ADMIN_API_KEY>" \
  -d '{"name":"my-bot-free","permissions":["read","write","tier:free"]}'`
      },
      createApiKeyPro: {
        description: 'Create a pro-tier API key (managed RPC)',
        curl: `curl -X POST ${baseUrl}/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <ADMIN_API_KEY>" \
  -d '{"name":"my-bot-pro","permissions":["read","write","tier:pro"]}'`
      },
      createWallet: {
        description: 'Create a wallet on Base Sepolia',
        curl: `curl -X POST ${baseUrl}/wallet/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <API_KEY>" \
  -d '{"agentName":"MyBot","chain":"base-sepolia"}'`
      },
      checkBalance: {
        description: 'Check wallet balance (free tier requires X-RPC-URL)',
        curl: `curl ${baseUrl}/wallet/<ADDRESS>/balance \
  -H "X-API-Key: <API_KEY>" \
  -H "X-RPC-URL: https://base-sepolia.g.alchemy.com/v2/<ALCHEMY_KEY>"`
      }
    }
  });
});

// API Key management (admin only)
app.post('/api-keys', requireAuth('admin'), async (req, res) => {
  try {
    const { name, permissions } = req.body;
    const key = await createApiKey(name, permissions, { tenantId: req.tenant?.id });
    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api-keys', requireAuth('admin'), async (req, res) => {
  try {
    const keys = await listApiKeys({ tenantId: req.tenant?.id });
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api-keys/:prefix', requireAuth('admin'), async (req, res) => {
  try {
    const revoked = await revokeApiKey(req.params.prefix, { tenantId: req.tenant?.id });
    res.json({ success: revoked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protected routes (auth required)
app.use('/wallet', requireAuth('read'), walletRoutes);
app.use('/identity', requireAuth('read'), identityRoutes);
app.use('/ens', requireAuth('read'), ensRoutes);
app.use('/multisig', requireAuth('read'), multisigRoutes);
app.use('/defi', requireAuth('read'), defiRoutes);
app.use('/webhooks', requireAuth('read'), webhookRoutes);
app.use('/chains', requireAuth('read'), chainRoutes);
app.use('/agents', requireAuth('read'), agentsRoutes);
app.use('/explorer', requireAuth('read'), explorerRoutes);
app.use('/social', requireAuth('read'), socialRoutes);

// MCP Server endpoint (info only - actual MCP runs via stdio)
app.get('/mcp', (req, res) => {
  res.json({
    status: mcpServer ? 'running' : 'disabled',
    protocol: 'Model Context Protocol v1',
    tools: [
      'create_wallet',
      'get_balance',
      'sign_transaction',
      'list_identities',
      'create_identity',
      'get_transaction_history',
      'list_wallets',
      'manage_policies',
      'export_private_key'
    ],
    usage: 'Run with: node src/mcp-server.js (standalone) or use HTTP API endpoints'
  });
});

// Error handler
app.use((err, req, res, next) => {
  errorLogger(err, req, res, () => { });
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Graceful shutdown handling
let server;

server = app.listen(PORT, async () => {
  const baseUrl = `http://localhost:${PORT}`;

  // Initialize MCP Server
  await initMCPServer();

  logger.info({ port: PORT, baseUrl, version: pkg.version }, 'Agent Wallet Service started');
  console.log(`🦞 Agent Wallet Service running on port ${PORT}`);
  console.log(`   URL: ${baseUrl}`);
  console.log(`   Health: ${baseUrl}/health`);
  console.log(`   Onboarding: ${baseUrl}/onboarding`);
  console.log(`   MCP: ${baseUrl}/mcp`);
  console.log(`   Features: multi-chain, erc-8004, api-keys, mcp`);
});

const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      console.log('📝 HTTP server closed');

      // Close MCP server
      if (mcpServer) {
        try {
          await mcpServer.stop();
          console.log('📝 MCP server stopped');
        } catch (err) {
          console.error('Error stopping MCP server:', err);
        }
      }

      // Close database connections
      try {
        const { getDb } = await import('./services/db.js');
        const db = getDb();
        if (db) {
          await db.end();
          console.log('📝 Database connection closed');
        }
      } catch (err) {
        // Database may not be configured
      }

      // Close Redis connections
      try {
        const { getRedis } = await import('./services/redis.js');
        const redis = getRedis();
        if (redis) {
          await redis.quit();
          console.log('📝 Redis connection closed');
        }
      } catch (err) {
        // Redis may not be configured
      }

      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
