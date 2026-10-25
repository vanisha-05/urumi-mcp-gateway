import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db.js';
import { bootstrap, provisionAdminKey } from './bootstrap.js';
import { hashApiKey, validateCryptoConfig } from './crypto.js';

const validEnv: NodeJS.ProcessEnv = {
  GATEWAY_KEY_HMAC_SECRET: 'test-only-secret-with-at-least-32-bytes',
  GATEWAY_ENCRYPTION_KEY: 'a'.repeat(64),
};
// Crypto helpers intentionally read process.env; keep these values test-only.
process.env.GATEWAY_KEY_HMAC_SECRET = validEnv.GATEWAY_KEY_HMAC_SECRET;
process.env.GATEWAY_ENCRYPTION_KEY = validEnv.GATEWAY_ENCRYPTION_KEY;

function withDb(run: (db: ReturnType<typeof openDatabase>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'urumi-gateway-test-'));
  const db = openDatabase(join(dir, 'test.db'));
  try { run(db); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('validates required crypto configuration without revealing supplied values', () => {
  assert.throws(() => validateCryptoConfig({}), /GATEWAY_KEY_HMAC_SECRET is required/);
  assert.throws(() => validateCryptoConfig({ ...validEnv, GATEWAY_KEY_HMAC_SECRET: 'short' }), /at least 32 UTF-8 bytes/);
  assert.throws(() => validateCryptoConfig({ ...validEnv, GATEWAY_ENCRYPTION_KEY: 'z'.repeat(64) }), /64 hexadecimal characters/);
  assert.throws(() => validateCryptoConfig({ ...validEnv, GATEWAY_ENCRYPTION_KEY: 'a'.repeat(63) }), /64 hexadecimal characters/);
  assert.throws(() => validateCryptoConfig({ ...validEnv, GATEWAY_PORT: '70000' }), /GATEWAY_PORT/);
  assert.doesNotThrow(() => validateCryptoConfig(validEnv));
});

test('fresh bootstrap is atomic, creates admin/defaults without credentials, and logs no API key', () => {
  withDb(db => {
    const captured: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => captured.push(args.join(' '));
    try { bootstrap(db, validEnv); } finally { console.info = original; }
    assert.equal((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c, 1);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c, 0);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM upstream_servers').get() as { c: number }).c, 3);
    assert.doesNotMatch(captured.join('\n'), /urumi_[A-Za-z0-9_-]{20,}/);
  });
});

test('interrupted bootstrap with an admin but no key remains intact and can be recovered locally', () => {
  withDb(db => {
    db.prepare("INSERT INTO users (id, username, role) VALUES ('existing-admin', 'admin', 'admin')").run();
    bootstrap(db, validEnv);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c, 1);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c, 0);
    const key = provisionAdminKey(db);
    const saved = db.prepare('SELECT key_hash FROM api_keys').get() as { key_hash: string };
    assert.equal(saved.key_hash, hashApiKey(key));
    assert.ok(key.startsWith('urumi_'));
  });
});

test('repeat bootstrap is idempotent and provisioning preserves all existing keys', () => {
  withDb(db => {
    bootstrap(db, validEnv);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c, 0);
    const upstreamCount = (db.prepare('SELECT COUNT(*) c FROM upstream_servers').get() as { c: number }).c;
    const originalKey = provisionAdminKey(db);
    const before = db.prepare('SELECT id, key_hash, key_prefix FROM api_keys').get() as { id: string; key_hash: string; key_prefix: string };
    assert.equal(before.key_hash, hashApiKey(originalKey));
    bootstrap(db, validEnv);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c, 1);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM upstream_servers').get() as { c: number }).c, upstreamCount);
    provisionAdminKey(db);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c, 2);
    assert.deepEqual(db.prepare('SELECT id, key_hash, key_prefix FROM api_keys WHERE id = ?').get(before.id), before);
  });
});

test('provisioning refuses non-admin targets and does not mutate keys on failure', () => {
  withDb(db => {
    bootstrap(db, validEnv);
    const countBefore = (db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c;
    assert.throws(() => provisionAdminKey(db, 'missing'), /was not found/);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM api_keys').get() as { c: number }).c, countBefore);
  });
});
