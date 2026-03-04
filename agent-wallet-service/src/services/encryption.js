/**
 * Encryption Service
 * AES-256-GCM for private keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
let cachedEncryptionKey = null;

// Get or generate encryption key
function getEncryptionKey() {
  if (cachedEncryptionKey) return cachedEncryptionKey;

  let key = process.env.WALLET_ENCRYPTION_KEY;

  if (!key) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      throw new Error('FATAL: WALLET_ENCRYPTION_KEY environment variable is required in production.');
    }
    
    // In non-production, allow explicit test key or a deterministic local fallback
    const testKeyMaterial = process.env.TEST_WALLET_ENCRYPTION_KEY || 'local-dev-wallet-key';
    
    const envSalt = process.env.WALLET_ENCRYPTION_SALT || 'agent-wallet-service-salt';
    cachedEncryptionKey = scryptSync(testKeyMaterial, envSalt, 32);
    if (process.env.TEST_WALLET_ENCRYPTION_KEY) {
      console.warn('⚠️  Using TEST_WALLET_ENCRYPTION_KEY. Set WALLET_ENCRYPTION_KEY for production.');
    } else {
      console.warn('⚠️  WALLET_ENCRYPTION_KEY not set; using local development fallback key. Set TEST_WALLET_ENCRYPTION_KEY (or WALLET_ENCRYPTION_KEY) explicitly.');
    }
    return cachedEncryptionKey;
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
