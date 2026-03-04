/**
 * ERC-8004: AI Agent Identity
 * 
 * On-chain identity for AI agents
 * https://eips.ethereum.org/EIPS/eip-8004
 */

import { randomBytes, createHash } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { decrypt } from './encryption.js';
import { getWalletByAddress as getWalletForIdentity } from './viem-wallet.js';
import {
  getIdentityStore,
  persistIdentityStore,
  getIdentityById,
  setIdentity,
  getAllIdentities,
  getIdentityByIdDb,
  setIdentityDb,
  getAllIdentitiesDb
} from '../repositories/identity-repository.js';

// ERC-8004-inspired identity schema metadata
const ERC8004_SCHEMA = {
  version: '1.0.0',
  standard: 'ERC-8004',
  agentTypes: ['assistant', 'autonomous', 'hybrid'],
  capabilities: ['wallet', 'messaging', 'data_access', 'code_execution', 'external_api']
};

// Process-local identity store is managed by the repository
const USE_DB = process.env.STORAGE_BACKEND === 'db';
const identities = USE_DB ? null : getIdentityStore();

// ============================================================
// SHARED HELPER FUNCTIONS
// ============================================================

/**
 * Get the signing account for an agent's wallet
 * @param {string} walletAddress - The wallet address to sign with
 * @param {string} tenantId - Optional tenant ID for multi-tenant lookups
 * @returns {Promise<{ account: import('viem').Account, walletAddress: string }>}
 * @throws Error if wallet not found
 */
async function getSigningAccountForWallet(walletAddress, tenantId) {
  const wallet = await getWalletForIdentity(walletAddress, { tenantId });
  if (!wallet) {
    throw new Error('Wallet for identity not found');
  }

  const privateKey = decrypt(wallet.privateKey);
  const account = privateKeyToAccount(privateKey);
  return { account, walletAddress: wallet.address };
}

/**
 * Generate unique agent ID (ERC-8004 compliant)
 */
function generateAgentId(walletAddress, agentName) {
  const timestamp = Date.now();
  const salt = randomBytes(32).toString('hex');
  const hashInput = `${walletAddress}:${agentName}:${timestamp}:${salt}`;
  const idHash = createHash('sha256').update(hashInput).digest('hex');
  
  return {
    id: `agent:${idHash.slice(0, 16)}`,
    hash: `0x${idHash}`,
    timestamp,
    salt
  };
}

/**
 * Create ERC-8004 agent identity
 */
export async function createAgentIdentity({
  walletAddress,
  agentName,
  description,
  agentType = 'assistant',
  capabilities = ['wallet'],
  metadata = {},
  owner,
  chain = 'base-sepolia',
  tenantId
}) {
  try {
    // Validate agent type
    if (!ERC8004_SCHEMA.agentTypes.includes(agentType)) {
      throw new Error(`Invalid agent type. Must be: ${ERC8004_SCHEMA.agentTypes.join(', ')}`);
    }

    // Generate identity
    const agentId = generateAgentId(walletAddress, agentName);
    
    const identity = {
      // ERC-8004 required fields
      '@context': 'https://eips.ethereum.org/EIPS/eip-8004',
      id: agentId.id,
      version: ERC8004_SCHEMA.version,
      schemaVersion: '1.0.0',
      
      // Agent identification
      name: agentName,
      description: description || `${agentName} AI Agent`,
      type: agentType,
      
      // Ownership & control
      wallet: walletAddress,
      owner: owner || walletAddress,
      
      // Capabilities (what this agent can do)
      capabilities: capabilities.map(cap => ({
        type: cap,
        granted: true,
        grantedAt: new Date().toISOString()
      })),
      
      // Metadata
      metadata: {
        createdAt: new Date().toISOString(),
        chain,
        standard: 'ERC-8004',
        ...metadata
      },
      
      // Verification
      verification: {
        hash: agentId.hash,
        timestamp: agentId.timestamp,
        salt: agentId.salt
      }
    };

    // Store identity
    if (USE_DB) {
      await setIdentityDb(agentId.id, identity, { tenantId });
    } else {
      identities[agentId.id] = identity;
      persistIdentityStore();
    }

    console.log(`✅ Created ERC-8004 identity: ${agentId.id}`);

    return identity;
  } catch (error) {
    console.error('Failed to create identity:', error);
    throw error;
  }
}

/**
 * Get agent identity by ID
 */
export async function getIdentity(agentId, { tenantId } = {}) {
  return USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : getIdentityById(agentId);
}

/**
 * Get all identities for a wallet
 */
export async function getIdentitiesByWallet(walletAddress, { tenantId } = {}) {
  const all = USE_DB ? await getAllIdentitiesDb({ tenantId }) : getAllIdentities();
  return all.filter((id) => id.wallet.toLowerCase() === walletAddress.toLowerCase());
}

/**
 * List all identities
 */
export async function listIdentities({ tenantId } = {}) {
  return USE_DB ? await getAllIdentitiesDb({ tenantId }) : getAllIdentities();
}

/**
 * Update agent capability
 */
export async function updateCapability(agentId, capability, granted, { tenantId } = {}) {
  const identity = USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : identities[agentId];
  if (!identity) throw new Error('Identity not found');

  const capIndex = identity.capabilities.findIndex(c => c.type === capability);
  
  if (capIndex >= 0) {
    identity.capabilities[capIndex].granted = granted;
    identity.capabilities[capIndex].updatedAt = new Date().toISOString();
  } else if (granted) {
    identity.capabilities.push({
      type: capability,
      granted: true,
      grantedAt: new Date().toISOString()
    });
  }

  identity.metadata.updatedAt = new Date().toISOString();
  if (USE_DB) {
    await setIdentityDb(agentId, identity, { tenantId });
  } else {
    identities[agentId] = identity;
    persistIdentityStore();
  }

  return identity;
}

/**
 * Revoke agent identity
 */
export async function revokeIdentity(agentId, { tenantId } = {}) {
  const identity = USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : identities[agentId];
  if (!identity) return false;

  identity.metadata.revokedAt = new Date().toISOString();
  identity.metadata.status = 'revoked';

  if (USE_DB) {
    await setIdentityDb(agentId, identity, { tenantId });
  } else {
    identities[agentId] = identity;
    persistIdentityStore();
  }

  return true;
}

/**
 * Generate verification proof signed by the agent wallet.
 */
export async function generateVerificationProof(agentId, { tenantId } = {}) {
  const identity = USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : identities[agentId];
  if (!identity) throw new Error('Identity not found');

  const timestamp = Date.now();
  const message = JSON.stringify({
    agentId: identity.id,
    wallet: identity.wallet,
    timestamp
  });

  const { account } = await getSigningAccountForWallet(identity.wallet, tenantId);
  const signature = await account.signMessage({ message });

  return {
    agentId: identity.id,
    wallet: identity.wallet,
    message,
    timestamp,
    signature,
    algorithm: 'secp256k1',
    valid: true
  };
}

/**
 * Export identity as unsigned verifiable credential (W3C compatible)
 */
export async function exportVerifiableCredential(agentId, { tenantId } = {}) {
  const identity = USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : (identities || {})[agentId];
  if (!identity) throw new Error('Identity not found');

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://eips.ethereum.org/EIPS/eip-8004'
    ],
    id: identity.id,
    type: ['VerifiableCredential', 'AgentIdentityCredential'],
    issuer: identity.wallet,
    issuanceDate: identity.metadata.createdAt,
    credentialSubject: {
      id: identity.id,
      name: identity.name,
      type: identity.type,
      capabilities: identity.capabilities
    },
    proof: {
      type: 'EthereumEip712Signature2021',
      verificationMethod: identity.wallet,
      proofPurpose: 'assertionMethod'
    }
  };
}

/**
 * Issue a verifiable credential signed by the agent wallet.
 */
export async function issueVerifiableCredential(agentId, { tenantId } = {}) {
  const identity = USE_DB ? await getIdentityByIdDb(agentId, { tenantId }) : identities[agentId];
  if (!identity) throw new Error('Identity not found');
  const base = USE_DB ? (() => {
    // Build VC from fetched identity without relying on in-memory store
    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://eips.ethereum.org/EIPS/eip-8004'
      ],
      id: identity.id,
      type: ['VerifiableCredential', 'AgentIdentityCredential'],
      issuer: identity.wallet,
      issuanceDate: identity.metadata.createdAt,
      credentialSubject: {
        id: identity.id,
        name: identity.name,
        type: identity.type,
        capabilities: identity.capabilities
      },
      proof: {
        type: 'EthereumEip712Signature2021',
        verificationMethod: identity.wallet,
        proofPurpose: 'assertionMethod'
      }
    };
  })() : exportVerifiableCredential(agentId);

  const { account } = await getSigningAccountForWallet(identity.wallet, tenantId);

  const issuanceTime = new Date().toISOString();
  const toSign = JSON.stringify({
    vcId: base.id,
    subject: base.credentialSubject?.id,
    issuer: base.issuer,
    issuanceDate: issuanceTime
  });

  const signature = await account.signMessage({ message: toSign });

  return {
    ...base,
    issuanceDate: issuanceTime,
    proof: {
      ...base.proof,
      created: issuanceTime,
      jws: signature
    }
  };
}

/**
 * Get supported capabilities
 */
export function getSupportedCapabilities() {
  return ERC8004_SCHEMA.capabilities;
}

/**
 * Get agent types
 */
export function getAgentTypes() {
  return ERC8004_SCHEMA.agentTypes;
}
