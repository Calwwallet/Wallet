/**
 * Encryption Service
 * AES-256-GCM for private keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import db from './db.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Get or generate encryption key
function getEncryptionKey() {
  let key = process.env.WALLET_ENCRYPTION_KEY;

  if (!key) {
    console.warn('⚠️  WALLET_ENCRYPTION_KEY not set. Using derived key from API key.');
    // Fallback: derive from first API key (not ideal but better than nothing)
    const apiKeyRow = db.prepare('SELECT key FROM api_keys LIMIT 1').get();
    if (apiKeyRow) {
      key = apiKeyRow.key;
    } else {
      throw new Error('No encryption key available. Set WALLET_ENCRYPTION_KEY env var.');
    }
  }

  // Derive 32-byte key using scrypt
  const salt = process.env.WALLET_ENCRYPTION_SALT || 'agent-wallet-service-salt';
  return scryptSync(key, salt, 32);
}

/**
 * Encrypt a private key
 */
export function encrypt(text) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a private key
 */
export function decrypt(encryptedData) {
  const key = getEncryptionKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    // Legacy: unencrypted data
    return encryptedData;
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if data is encrypted
 */
export function isEncrypted(data) {
  const parts = data.split(':');
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2;
}
