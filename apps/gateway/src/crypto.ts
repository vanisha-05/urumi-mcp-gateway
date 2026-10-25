import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

// ─── API Key helpers ──────────────────────────────────────────────────────────

const KEY_PREFIX = 'urumi_';
// Prefix length for index-hint lookup: "urumi_" (6) + 8 random chars = 14 chars
const PREFIX_LEN = KEY_PREFIX.length + 8;

/** Generate a new cryptographically random API key. */
export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function validateCryptoConfig(env: NodeJS.ProcessEnv = process.env): void {
  const secret = env.GATEWAY_KEY_HMAC_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('GATEWAY_KEY_HMAC_SECRET is required and must contain at least 32 UTF-8 bytes. Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  const encryptionKey = env.GATEWAY_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('GATEWAY_ENCRYPTION_KEY is required and must be exactly 64 hexadecimal characters (32 bytes). Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  const port = env.GATEWAY_PORT;
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error('GATEWAY_PORT must be an integer between 1 and 65535.');
  }
}

function hmacSecret(): string {
  const s = process.env.GATEWAY_KEY_HMAC_SECRET;
  if (!s) throw new Error('GATEWAY_KEY_HMAC_SECRET env var is not set');
  return s;
}

/** Stable HMAC-SHA256 hash of the key – stored in DB for lookup. */
export function hashApiKey(key: string): string {
  return createHmac('sha256', hmacSecret()).update(key).digest('hex');
}

/** Short prefix stored for O(1) index narrowing before hash comparison. */
export function keyPrefix(key: string): string {
  return key.slice(0, PREFIX_LEN);
}

// ─── Credential encryption (AES-256-GCM) ─────────────────────────────────────

const CIPHER = 'aes-256-gcm' as const;

function encKey(): Buffer {
  const hex = process.env.GATEWAY_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'GATEWAY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a credential value (e.g. bearer token, header value).
 * Returns a dot-separated string: ivHex.authTagHex.ciphertextHex
 */
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, encKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join('.');
}

/** Decrypt a credential produced by {@link encryptCredential}. */
export function decryptCredential(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = createDecipheriv(CIPHER, encKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
