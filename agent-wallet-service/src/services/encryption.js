/**
 * Encryption Service
 * AES-256-GCM for private keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync } from 'fs';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
let cachedEncryptionKey = null;

// Get or generate encryption key
function getEncryptionKey() {
  if (cachedEncryptionKey) return cachedEncryptionKey;

  let key = process.env.WALLET_ENCRYPTION_KEY;

  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: WALLET_ENCRYPTION_KEY environment variable is required in production.');
    }
    console.warn('⚠️  WALLET_ENCRYPTION_KEY not set. Using derived key from API key.');
    // Fallback: derive from first API key (not ideal but better than nothing)
    const apiKeys = JSON.parse(readFileSync('api-keys.json', 'utf-8'));
    if (apiKeys.length > 0) {
      key = apiKeys[0].key;
    } else {
      throw new Error('No encryption key available. Set WALLET_ENCRYPTION_KEY env var.');
    }
  }

  // Derive 32-byte key using scrypt
  const salt = process.env.WALLET_ENCRYPTION_SALT || 'agent-wallet-service-salt';
  cachedEncryptionKey = scryptSync(key, salt, 32);
  return cachedEncryptionKey;
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
