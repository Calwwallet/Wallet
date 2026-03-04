/**
 * Social Identity Service
 * 
 * Links ERC-8004 AI agents to their owners' social media accounts
 * Supports: Twitter/X, GitHub, Discord, Telegram, Email
 * 
 * This enables:
 * - Identity verification through social accounts
 * - Reputation tracking
 * - Owner attribution for AI agents
 */

import { getDb } from './db.js';
import { randomUUID } from 'crypto';

// Supported social platforms
export const SOCIAL_PLATFORMS = {
  TWITTER: 'twitter',
  GITHUB: 'github',
  DISCORD: 'discord',
  TELEGRAM: 'telegram',
  EMAIL: 'email',
  WEBSITE: 'website'
};

// Verification methods
export const VERIFICATION_METHODS = {
  NONE: 'none',           // Unverified link
  SELF_CLAIM: 'self_claim',     // Owner claimed, not verified
  OAUTH: 'oauth',         // Verified via OAuth
  PROOF: 'proof'          // Verified via cryptographic proof
};

/**
 * Link a social account to an ERC-8004 identity
 */
export async function linkSocialAccount(agentId, { platform, username, userId, profileUrl, verified = false }, { tenantId } = {}) {
  const db = getDb();
  
  // Validate platform
  if (!Object.values(SOCIAL_PLATFORMS).includes(platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }
  
  // Check if agent exists
  const agentCheck = await db.query(
    'SELECT id FROM agent_identities WHERE id = $1 AND (tenant_id = $2 OR $2 IS NULL)',
    [agentId, tenantId]
  );
  
  if (agentCheck.rowCount === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  const socialId = randomUUID();
  
  // Check if this social account is already linked to another agent
  const existingLink = await db.query(
    `SELECT id, agent_id FROM social_links 
     WHERE platform = $1 AND platform_user_id = $2 AND tenant_id = $3`,
    [platform, userId || username, tenantId]
  );
  
  if (existingLink.rowCount > 0) {
    throw new Error(`This ${platform} account is already linked to another agent`);
  }
  
  // Insert social link
  await db.query(
    `INSERT INTO social_links (id, agent_id, platform, username, platform_user_id, profile_url, verification_method, verified, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (agent_id, platform, platform_user_id) 
     DO UPDATE SET username = $4, profile_url = $6, updated_at = NOW()`,
    [socialId, agentId, platform, username, userId, profileUrl, verified ? VERIFICATION_METHODS.OAUTH : VERIFICATION_METHODS.SELF_CLAIM, verified, tenantId]
  );
  
  return {
    id: socialId,
    agentId,
    platform,
    username,
    profileUrl,
    verified
  };
}

/**
 * Get all social links for an agent
 */
export async function getSocialLinks(agentId, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT id, platform, username, platform_user_id, profile_url, verification_method, verified, created_at, updated_at
     FROM social_links 
     WHERE agent_id = $1 AND (tenant_id = $2 OR $2 IS NULL)
     ORDER BY verified DESC, created_at DESC`,
    [agentId, tenantId]
  );
  
  return result.rows;
}

/**
 * Remove a social link
 */
export async function unlinkSocialAccount(agentId, platform, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `DELETE FROM social_links 
     WHERE agent_id = $1 AND platform = $2 AND (tenant_id = $3 OR $3 IS NULL)
     RETURNING id`,
    [agentId, platform, tenantId]
  );
  
  return result.rowCount > 0;
}

/**
 * Get agent by social account
 */
export async function getAgentBySocialLink(platform, usernameOrUserId, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT ai.id, ai.agent_name, ai.wallet_address, sl.platform, sl.username, sl.verified
     FROM social_links sl
     JOIN agent_identities ai ON sl.agent_id = ai.id
     WHERE sl.platform = $1 AND (sl.username = $2 OR sl.platform_user_id = $2)
     AND (sl.tenant_id = $3 OR $3 IS NULL)`,
    [platform, usernameOrUserId, tenantId]
  );
  
  return result.rows[0] || null;
}

/**
 * Get all verified social accounts (for reputation)
 */
export async function getVerifiedSocialAccounts(agentId, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT platform, username, profile_url, verified, verification_method
     FROM social_links 
     WHERE agent_id = $1 AND verified = true AND (tenant_id = $2 OR $2 IS NULL)`,
    [agentId, tenantId]
  );
  
  return result.rows;
}

/**
 * Verify social account ownership (stub - would integrate with OAuth)
 */
export async function requestVerification(agentId, platform, { tenantId } = {}) {
  // In production, this would:
  // 1. Generate OAuth URL for the platform
  // 2. Store verification request
  // 3. Handle OAuth callback
  
  return {
    status: 'pending',
    message: `Verification request created for ${platform}. In production, OAuth flow would be initiated.`,
    platform,
    agentId
  };
}

/**
 * Get social presence summary for an agent
 */
export async function getSocialPresence(agentId, { tenantId } = {}) {
  const links = await getSocialLinks(agentId, { tenantId });
  
  const presence = {
    total: links.length,
    verified: links.filter(l => l.verified).length,
    platforms: {}
  };
  
  for (const link of links) {
    presence.platforms[link.platform] = {
      username: link.username,
      profileUrl: link.profile_url,
      verified: link.verified,
      linkedAt: link.created_at
    };
  }
  
  return presence;
}

/**
 * Search agents by social account
 */
export async function searchAgentsBySocial(query, { tenantId } = {}) {
  const db = getDb();
  
  const result = await db.query(
    `SELECT ai.id, ai.agent_name, ai.wallet_address, ai.agent_type, sl.platform, sl.username, sl.verified
     FROM social_links sl
     JOIN agent_identities ai ON sl.agent_id = ai.id
     WHERE sl.username ILIKE $1 AND (sl.tenant_id = $2 OR $2 IS NULL)
     ORDER BY sl.verified DESC, ai.created_at DESC
     LIMIT 20`,
    [`%${query}%`, tenantId]
  );
  
  return result.rows;
}
