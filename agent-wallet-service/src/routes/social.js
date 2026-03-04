/**
 * Social Identity Routes
 * 
 * API endpoints for linking social media accounts to ERC-8004 identities
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { z } from 'zod';
import {
  linkSocialAccount,
  getSocialLinks,
  unlinkSocialAccount,
  getAgentBySocialLink,
  getVerifiedSocialAccounts,
  requestVerification,
  getSocialPresence,
  searchAgentsBySocial,
  SOCIAL_PLATFORMS
} from '../services/social-identity.js';

const router = Router();

// Validation schemas
const linkSocialSchema = z.object({
  platform: z.enum(['twitter', 'github', 'discord', 'telegram', 'email', 'website']),
  username: z.string().min(1).max(255),
  userId: z.string().optional(),
  profileUrl: z.string().url().optional(),
  verified: z.boolean().optional()
});

const unlinkSocialSchema = z.object({
  platform: z.enum(['twitter', 'github', 'discord', 'telegram', 'email', 'website'])
});

const searchSchema = z.object({
  q: z.string().min(1),
  platform: z.enum(['twitter', 'github', 'discord', 'telegram', 'email', 'website']).optional()
});

/**
 * GET /social/platforms
 * List supported social platforms
 */
router.get('/platforms', (req, res) => {
  res.json({
    platforms: Object.values(SOCIAL_PLATFORMS),
    details: {
      twitter: { name: 'Twitter/X', verification: 'OAuth' },
      github: { name: 'GitHub', verification: 'OAuth' },
      discord: { name: 'Discord', verification: 'OAuth' },
      telegram: { name: 'Telegram', verification: 'OAuth' },
      email: { name: 'Email', verification: 'Verification email' },
      website: { name: 'Website', verification: 'DNS TXT record' }
    }
  });
});

/**
 * POST /identity/:agentId/social
 * Link a social account to an agent
 */
router.post('/identity/:agentId/social', requireAuth('write'), validate(linkSocialSchema), async (req, res) => {
  try {
    const { agentId } = req.params;
    const { platform, username, userId, profileUrl, verified } = req.validated.body;

    const result = await linkSocialAccount(agentId, {
      platform,
      username,
      userId,
      profileUrl,
      verified
    }, { tenantId: req.tenant?.id });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /identity/:agentId/social
 * Get all social links for an agent
 */
router.get('/identity/:agentId/social', async (req, res) => {
  try {
    const { agentId } = req.params;
    const links = await getSocialLinks(agentId, { tenantId: req.tenant?.id });

    // Get presence summary
    const presence = await getSocialPresence(agentId, { tenantId: req.tenant?.id });

    res.json({
      agentId,
      links,
      presence
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /identity/:agentId/social/:platform
 * Unlink a social account
 */
router.delete('/identity/:agentId/social/:platform', requireAuth('write'), async (req, res) => {
  try {
    const { agentId, platform } = req.params;

    const result = await unlinkSocialAccount(agentId, platform, { tenantId: req.tenant?.id });

    res.json({
      success: result,
      message: result ? `Unlinked ${platform}` : 'Link not found'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /identity/:agentId/social/verified
 * Get verified social accounts only
 */
router.get('/identity/:agentId/social/verified', async (req, res) => {
  try {
    const { agentId } = req.params;
    const verified = await getVerifiedSocialAccounts(agentId, { tenantId: req.tenant?.id });

    res.json({
      agentId,
      verified
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /identity/:agentId/social/:platform/verify
 * Request verification for a social account
 */
router.post('/identity/:agentId/social/:platform/verify', requireAuth('write'), async (req, res) => {
  try {
    const { agentId, platform } = req.params;

    const result = await requestVerification(agentId, platform, { tenantId: req.tenant?.id });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /social/lookup/:platform/:username
 * Find agent by social account
 */
router.get('/lookup/:platform/:username', async (req, res) => {
  try {
    const { platform, username } = req.params;

    const agent = await getAgentBySocialLink(platform, username, { tenantId: req.tenant?.id });

    if (!agent) {
      return res.status(404).json({ error: 'No agent found with this social account' });
    }

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /social/search
 * Search agents by social account
 */
router.get('/search', async (req, res) => {
  try {
    const { q, platform } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const results = await searchAgentsBySocial(q, { tenantId: req.tenant?.id });

    res.json({
      query: q,
      platform,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
