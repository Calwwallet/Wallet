/**
 * ENS Routes
 * Ethereum Name Service registration for agent wallets
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  checkAvailability,
  getPrice,
  prepareRegistration,
  listRegistrations,
  getRegistration
} from '../services/ens.js';

const router = Router();

/**
 * GET /ens/check/:name
 * Check if ENS name is available
 */
router.get('/check/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const { chain = 'ethereum' } = req.query;

    const result = await checkAvailability(name, chain);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /ens/price/:name
 * Get registration price for ENS name
 */
router.get('/price/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const { years = 1, chain = 'ethereum' } = req.query;

    const price = await getPrice(name, parseInt(years), chain);
    res.json(price);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /ens/register
 * Prepare ENS registration (returns commitment + steps)
 */
router.post('/register', requireAuth('write'), async (req, res, next) => {
  try {
    const { name, ownerAddress, years = 1, chain = 'ethereum' } = req.body;

    if (!name || !ownerAddress) {
      return res.status(400).json({ error: 'name and ownerAddress are required' });
    }

    const result = await prepareRegistration({
      name,
      ownerAddress,
      durationYears: years,
      chain
    });

    res.json({
      success: true,
      registration: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /ens/list
 * List all pending/completed ENS registrations
 */
router.get('/list', (req, res) => {
  const registrations = listRegistrations();
  res.json({
    count: registrations.length,
    registrations
  });
});

/**
 * GET /ens/:name
 * Get registration details by name
 */
router.get('/:name', (req, res) => {
  const { name } = req.params;
  const registration = getRegistration(name);

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  res.json(registration);
});

export default router;
