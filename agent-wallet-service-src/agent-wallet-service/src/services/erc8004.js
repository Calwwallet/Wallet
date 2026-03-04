/**
 * ERC-8004 Identity Service
 * 
 * Manages on-chain agent identity registration
 * 
 * Deployed Contracts (ETH Sepolia):
 * - IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 * - ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */

import db from './db.js';
import { createHash } from 'crypto';
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ERC-8004 contract addresses (Sepolia testnet)
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

// ERC-8004 Identity Registry ABI (minimal)
const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [{ name: 'agentURI', type: 'string' }],
    name: 'register',
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'agentId', type: 'uint256' }],
    name: 'getAgentURI',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'agentId', type: 'uint256' }],
    name: 'getAgentWallet',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    name: 'setAgentWallet',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

/**
 * Mock IPFS upload
 */
async function uploadToIPFS(metadata) {
  // In a real implementation, use pinata or a local IPFS node
  console.log('📦 Mock: Uploading metadata to IPFS...');
  const hash = 'Qm' + createHash('sha256').update(JSON.stringify(metadata)).digest('hex').slice(0, 44);
  return `ipfs://${hash}`;
}


/**
 * Create agent registration metadata
 */
function createAgentMetadata({ name, description, walletAddress }) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name,
    description,
    image: 'ipfs://QmPlaceholderAgentAvatar', // TODO: real avatar upload
    services: [
      {
        name: 'api',
        endpoint: 'https://api.openclaw.ai/agents/mr-claw'
      }
    ],
    supportedTrust: ['reputation'],
    active: true,
    walletAddress
  };
}

/**
 * Register an agent record locally
 */
export async function registerAgent({ agentId, name, description, walletAddress }) {
  // Create metadata
  const metadata = createAgentMetadata({ name, description, walletAddress });
  const agentURI = JSON.stringify(metadata);

  const registrationId = agentId || `agent_${Date.now()}`;

  db.prepare('INSERT OR IGNORE INTO erc8004_registrations (id, name, address, uri, on_chain) VALUES (?, ?, ?, ?, ?)').run(
    registrationId, name, walletAddress, agentURI, 0
  );

  console.log(`✅ Locally registered agent: ${name} (${registrationId})`);

  return {
    id: registrationId,
    name,
    walletAddress,
    agentURI,
    onChain: false
  };
}

/**
 * Get agent info
 */
export async function getAgent(agentId) {
  const row = db.prepare('SELECT * FROM erc8004_registrations WHERE id = ?').get(agentId);
  if (!row) throw new Error(`Agent not found: ${agentId}`);
  return {
    ...row,
    onChain: !!row.on_chain
  };
}

/**
 * Get all registered agents
 */
export function getAllAgents() {
  const rows = db.prepare('SELECT * FROM erc8004_registrations').all();
  return rows.map(r => ({
    ...r,
    onChain: !!r.on_chain
  }));
}

/**
 * Register on-chain with viem
 */
export async function registerOnChain(agentId, privateKey, chain = 'sepolia') {
  const agent = await getAgent(agentId);
  const metadata = JSON.parse(agent.uri);

  // 1. Upload metadata to IPFS (mock)
  const ipfsURI = await uploadToIPFS(metadata);

  // 2. Setup wallet client
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: sepolia, // ERC-8004 contracts are currently on Sepolia
    transport: http()
  });

  // 3. Call register on-chain
  console.log(`🚀 Broadcasting registration for ${agentId} on-chain...`);
  const hash = await client.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [ipfsURI]
  });

  // 4. Update local DB
  db.prepare('UPDATE erc8004_registrations SET on_chain = 1, tx_hash = ?, uri = ? WHERE id = ?').run(
    hash, ipfsURI, agentId
  );

  return {
    success: true,
    txHash: hash,
    ipfsURI,
    explorer: `https://sepolia.etherscan.io/tx/${hash}`
  };
}
