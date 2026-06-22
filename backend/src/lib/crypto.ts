import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
import { logger } from './logger.js';

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `nxk_${randomBytes(32).toString('hex')}`;
  const prefix = key.substring(0, 12);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// AES-256-GCM encryption for sensitive data at rest (gateway tokens, LLM API keys)
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: ENCRYPTION_KEY must be a 64-char hex string in production (32 bytes)');
    }
    logger.warn('ENCRYPTION_KEY not set or invalid — sensitive data stored as plaintext. Set a 64-char hex ENCRYPTION_KEY in .env');
    return Buffer.alloc(0);
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext string. Returns "enc:<iv>:<authTag>:<ciphertext>" format.
 * If no encryption key is configured, returns plaintext (dev mode only).
 */
export function encryptField(plaintext: string): string {
  const key = getEncryptionKey();
  if (key.length === 0) return `plain:${plaintext}`;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted string. Handles both encrypted ("enc:...") and plaintext (legacy) formats.
 */
export function decryptField(ciphertext: string): string {
  if (ciphertext.startsWith('plain:')) {
    return ciphertext.slice(6);
  }
  if (!ciphertext.startsWith('enc:')) {
    return ciphertext;
  }

  const key = getEncryptionKey();
  if (key.length === 0) {
    throw new Error('Cannot decrypt: ENCRYPTION_KEY not configured');
  }

  const parts = ciphertext.split(':');
  const version = parts[1];
  if (version !== 'v1') throw new Error(`Unknown encryption version: ${version}`);
  if (parts.length !== 5) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(parts[2], 'hex');
  const authTag = Buffer.from(parts[3], 'hex');
  const encrypted = Buffer.from(parts[4], 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}
