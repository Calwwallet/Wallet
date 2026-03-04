/**
 * MCP (Model Context Protocol) Server for Agent Wallet Service
 * 
 * This module exposes wallet functionality as MCP tools that AI agents can use.
 * It provides tools for:
 * - Creating wallets
 * - Getting balances
 * - Signing transactions
 * - Managing identities
 * - Viewing transaction history
 * - Managing policies
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getAllWallets,
  createWallet as viemCreateWallet,
  getBalance,
  signTransaction as viemSignTransaction,
  getWalletByAddress,
  importWallet
} from './services/viem-wallet.js';
import { listIdentities, createAgentIdentity as createIdentity } from './services/agent-identity.js';
import { getHistory } from './services/tx-history.js';
import {
  getPolicyStats,
  getPolicy,
  setPolicy,
  getPolicyPresets,
  applyPolicyPreset,
  evaluateTransferPolicy
} from './services/policy-engine.js';
import { logger } from './services/logger.js';

/**
 * Wallet MCP Server
 * Provides tools for AI agents to interact with the wallet service
 */
class WalletMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'agent-wallet-service',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
    this.setupHandlers();
  }

  setupTools() {
    // Define available MCP tools
    this.tools = [
      {
        name: 'create_wallet',
        description: 'Create a new wallet for an AI agent',
        inputSchema: {
          type: 'object',
          properties: {
            agentName: {
              type: 'string',
              description: 'Name/identifier for the agent wallet'
            },
            chain: {
              type: 'string',
              enum: ['base-sepolia', 'base', 'ethereum', 'ethereum-sepolia', 'optimism-sepolia', 'arbitrum-sepolia'],
              description: 'Blockchain network to create the wallet on',
              default: 'base-sepolia'
            }
          },
          required: ['agentName']
        }
      },
      {
        name: 'get_balance',
        description: 'Get the ETH balance of a wallet address',
        inputSchema: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Ethereum wallet address'
            },
            chain: {
              type: 'string',
              description: 'Chain name (optional, will try to detect from wallet)'
            }
          },
          required: ['address']
        }
      },
      {
        name: 'sign_transaction',
        description: 'Sign and send an Ethereum transaction',
        inputSchema: {
          type: 'object',
          properties: {
            walletAddress: {
              type: 'string',
              description: 'The wallet address to sign with'
            },
            to: {
              type: 'string',
              description: 'Recipient address'
            },
            value: {
              type: 'string',
              description: 'Amount in ETH (will be converted to wei)'
            },
            data: {
              type: 'string',
              description: 'Optional transaction data (hex encoded)'
            },
            chain: {
              type: 'string',
              description: 'Chain name (optional)'
            }
          },
          required: ['walletAddress', 'to', 'value']
        }
      },
      {
        name: 'list_identities',
        description: 'List all agent identities (ERC-8004)',
        inputSchema: {
          type: 'object',
          properties: {
            walletAddress: {
              type: 'string',
              description: 'Optional: Filter by wallet address'
            }
          }
        }
      },
      {
        name: 'create_identity',
        description: 'Create a new ERC-8004 identity for an agent',
        inputSchema: {
          type: 'object',
          properties: {
            walletAddress: {
              type: 'string',
              description: 'Wallet address to associate the identity with'
            },
            agentName: {
              type: 'string',
              description: 'Name of the agent'
            },
            agentType: {
              type: 'string',
              enum: ['assistant', 'agent', 'bot', 'service'],
              description: 'Type of agent',
              default: 'assistant'
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Capabilities for the identity',
              default: ['wallet', 'messaging']
            }
          },
          required: ['walletAddress', 'agentName']
        }
      },
      {
        name: 'get_transaction_history',
        description: 'Get transaction history for a wallet',
        inputSchema: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Wallet address (optional if walletId provided)'
            },
            walletId: {
              type: 'string',
              description: 'Wallet ID (optional if address provided)'
            },
            limit: {
              type: 'number',
              description: 'Number of transactions to return',
              default: 20
            }
          }
        }
      },
      {
        name: 'list_wallets',
        description: 'List all wallets managed by the service',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'manage_policies',
        description: 'View or update wallet policies',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'get-stats', 'get', 'set', 'apply-preset', 'evaluate'],
              description: 'Policy action to perform'
            },
            walletAddress: {
              type: 'string',
              description: 'Wallet address (required for get, set, apply-preset, evaluate actions)'
            },
            policy: {
              type: 'string',
              description: 'Policy JSON string (for set action)'
            },
            presetName: {
              type: 'string',
              description: 'Preset name to apply (for apply-preset action)'
            },
            to: {
              type: 'string',
              description: 'Recipient address (for evaluate action)'
            },
            value: {
              type: 'string',
              description: 'Value in ETH (for evaluate action)'
            }
          },
          required: ['action']
        }
      },
      {
        name: 'import_wallet',
        description: 'Import an existing wallet using a private key',
        inputSchema: {
          type: 'object',
          properties: {
            privateKey: {
              type: 'string',
              description: 'Private key to import (with 0x prefix)'
            },
            agentName: {
              type: 'string',
              description: 'Name for the imported wallet'
            },
            chain: {
              type: 'string',
              description: 'Chain for the wallet',
              default: 'base-sepolia'
            }
          },
          required: ['privateKey', 'agentName']
        }
      }
    ];
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result;

        switch (name) {
          case 'create_wallet':
            result = await this.handleCreateWallet(args);
            break;
          case 'get_balance':
            result = await this.handleGetBalance(args);
            break;
          case 'sign_transaction':
            result = await this.handleSignTransaction(args);
            break;
          case 'list_identities':
            result = await this.handleListIdentities(args);
            break;
          case 'create_identity':
            result = await this.handleCreateIdentity(args);
            break;
          case 'get_transaction_history':
            result = await this.handleGetTransactionHistory(args);
            break;
          case 'list_wallets':
            result = await this.handleListWallets(args);
            break;
          case 'manage_policies':
            result = await this.handleManagePolicies(args);
            break;
          case 'import_wallet':
            result = await this.handleImportWallet(args);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error({ error, tool: name }, 'MCP tool error');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async handleCreateWallet(args) {
    const { agentName, chain = 'base-sepolia' } = args;
    const wallet = await viemCreateWallet({ agentName, chain });
    return {
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        agentName,
        chain: wallet.chain || chain,
        createdAt: new Date().toISOString()
      }
    };
  }

  async handleGetBalance(args) {
    const { address, chain } = args;
    const balance = await getBalance(address, chain);
    return {
      address,
      chain: chain || 'base-sepolia',
      balance: balance.toString(),
      balanceFormatted: (Number(balance) / 1e18).toFixed(6)
    };
  }

  async handleSignTransaction(args) {
    const { walletAddress, to, value, data = '0x', chain } = args;

    const signedTx = await viemSignTransaction({
      from: walletAddress,
      to,
      value,
      data,
      chain,
      context: { source: 'mcp' }
    });

    return {
      success: true,
      transactionHash: signedTx.hash,
      transaction: {
        from: walletAddress,
        to,
        value,
        data,
        chain: chain || 'base-sepolia'
      }
    };
  }

  async handleListIdentities(args) {
    const { walletAddress } = args;
    const identities = await listIdentities(walletAddress);
    return { identities };
  }

  async handleCreateIdentity(args) {
    const { walletAddress, agentName, agentType = 'assistant', capabilities = ['wallet', 'messaging'] } = args;
    const identity = await createIdentity(walletAddress, agentName, agentType, capabilities);
    return {
      success: true,
      identity
    };
  }

  async handleGetTransactionHistory(args) {
    const { address, walletId, limit = 20 } = args;

    let history;
    if (address || walletId) {
      history = await getHistory({ address, walletId, limit });
    } else {
      history = await getHistory({ limit });
    }

    return { transactions: history };
  }

  async handleListWallets() {
    const wallets = await getAllWallets();
    return {
      wallets: wallets.map(w => ({
        id: w.id,
        address: w.address,
        agentName: w.agentName,
        chain: w.chain,
        createdAt: w.createdAt
      }))
    };
  }

  async handleManagePolicies(args) {
    const { action, walletAddress, policy, presetName, to, value } = args;

    switch (action) {
      case 'get-stats': {
        const stats = getPolicyStats();
        return { stats };
      }
      case 'get': {
        if (!walletAddress) {
          throw new Error('walletAddress is required for get action');
        }
        const policyData = await getPolicy(walletAddress);
        return { walletAddress, policy: policyData };
      }
      case 'set': {
        if (!walletAddress) {
          throw new Error('walletAddress is required for set action');
        }
        if (!policy) {
          throw new Error('policy is required for set action');
        }
        const parsedPolicy = typeof policy === 'string' ? JSON.parse(policy) : policy;
        await setPolicy(walletAddress, parsedPolicy);
        return { success: true, message: `Policy set for ${walletAddress}` };
      }
      case 'apply-preset': {
        if (!walletAddress) {
          throw new Error('walletAddress is required for apply-preset action');
        }
        if (!presetName) {
          throw new Error('presetName is required for apply-preset action');
        }
        await applyPolicyPreset(walletAddress, presetName);
        return { success: true, message: `Applied preset "${presetName}" to ${walletAddress}` };
      }
      case 'evaluate': {
        if (!walletAddress) {
          throw new Error('walletAddress is required for evaluate action');
        }
        if (!to || !value) {
          throw new Error('to and value are required for evaluate action');
        }
        const evaluation = await evaluateTransferPolicy({
          walletAddress,
          to,
          valueEth: value
        });
        return { evaluation };
      }
      case 'list': {
        // Get all available presets
        const presets = getPolicyPresets();
        return { presets };
      }
      default:
        throw new Error(`Unknown policy action: ${action}`);
    }
  }

  async handleImportWallet(args) {
    const { privateKey, agentName, chain = 'base-sepolia' } = args;
    const wallet = await importWallet({ privateKey, agentName, chain });
    return {
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        agentName,
        chain
      }
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('MCP Server started on stdio');
  }

  async stop() {
    await this.server.close();
    logger.info('MCP Server stopped');
  }
}

// Export for use in main server
export { WalletMCPServer };

// Standalone mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const mcpServer = new WalletMCPServer();
  mcpServer.start().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
