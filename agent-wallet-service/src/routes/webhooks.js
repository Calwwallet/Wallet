/**
 * Webhooks Routes
 * 
 * API endpoints for webhook management
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { z } from 'zod';
import {
  registerWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getWebhookEvents,
  WEBHOOK_EVENTS
} from '../services/webhook-service.js';

const router = Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const registerWebhookSchema = z.object({
  url: z.string().url('Invalid URL format'),
  events: z.array(z.string()).min(1, 'At least one event is required'),
  name: z.string().optional(),
  description: z.string().optional(),
  secret: z.string().optional()
});

const updateWebhookSchema = z.object({
  url: z.string().url('Invalid URL format').optional(),
  events: z.array(z.string()).min(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  active: z.boolean().optional()
});

// ============================================================
// ROUTES
// ============================================================

/**
 * GET /webhooks/events
 * Get available webhook events
 */
router.get('/events', requireAuth('read'), async (req, res) => {
  try {
    const events = getWebhookEvents();
    res.json({
      success: true,
      events
    });
  } catch (error) {
    console.error('Get webhook events error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhooks
 * Register a new webhook
 */
router.post('/', requireAuth('write'), async (req, res) => {
  try {
    const validation = registerWebhookSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }
    
    const { url, events, name, description, secret } = validation.data;
    
    const webhook = await registerWebhook({
      url,
      events,
      name,
      description,
      secret,
      tenantId: req.tenant?.id
    });
    
    res.status(201).json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('Register webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /webhooks
 * List all webhooks
 */
router.get('/', requireAuth('read'), async (req, res) => {
  try {
    const webhooks = listWebhooks({ tenantId: req.tenant?.id });
    
    res.json({
      success: true,
      count: webhooks.length,
      webhooks
    });
  } catch (error) {
    console.error('List webhooks error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /webhooks/:id
 * Get webhook by ID
 */
router.get('/:id', requireAuth('read'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const webhook = getWebhook(id, { tenantId: req.tenant?.id });
    
    if (!webhook) {
      return res.status(404).json({ error: `Webhook not found: ${id}` });
    }
    
    res.json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('Get webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /webhooks/:id
 * Update webhook
 */
router.put('/:id', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const validation = updateWebhookSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }
    
    const webhook = await updateWebhook(id, validation.data, {
      tenantId: req.tenant?.id
    });
    
    res.json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('Update webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /webhooks/:id
 * Delete webhook
 */
router.delete('/:id', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;
    
    await deleteWebhook(id, { tenantId: req.tenant?.id });
    
    res.json({
      success: true,
      message: 'Webhook deleted'
    });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/:id/test
 * Test webhook
 */
router.post('/:id/test', requireAuth('write'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await testWebhook(id, { tenantId: req.tenant?.id });
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
