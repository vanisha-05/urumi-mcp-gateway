import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../../auth.js';
import { getDb } from '../../db.js';
import { generateApiKey, hashApiKey, keyPrefix } from '../../crypto.js';

export async function userKeyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ── List own API keys ────────────────────────────────────────────────────
  app.get('/user/keys', async request => {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, name, key_prefix, revoked_at, created_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(request.user!.id);
  });

  // ── Get own profile ──────────────────────────────────────────────────────
  app.get('/user/me', async request => {
    return {
      id: request.user!.id,
      username: request.user!.username,
      role: request.user!.role,
    };
  });

  // ── Generate a new key for self ──────────────────────────────────────────
  app.post('/user/keys', async (request, reply) => {
    const body = request.body as { name?: string } | null;
    const rawKey = generateApiKey();
    const id = randomUUID();
    const db = getDb();
    db.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      request.user!.id,
      body?.name ?? 'my-key',
      hashApiKey(rawKey),
      keyPrefix(rawKey),
    );

    return reply.code(201).send({
      id,
      key: rawKey,           // Only time the plaintext key is returned
      key_prefix: keyPrefix(rawKey),
      name: body?.name ?? 'my-key',
    });
  });

  // ── Revoke own key ───────────────────────────────────────────────────────
  app.delete('/user/keys/:keyId', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const db = getDb();

    const row = db
      .prepare('SELECT id, user_id, revoked_at FROM api_keys WHERE id = ?')
      .get(keyId) as { id: string; user_id: string; revoked_at: number | null } | undefined;

    if (!row) return reply.code(404).send({ error: 'Key not found' });
    if (row.user_id !== request.user!.id) {
      return reply.code(403).send({ error: 'You can only revoke your own keys' });
    }
    if (row.revoked_at !== null) {
      return reply.code(400).send({ error: 'Key is already revoked' });
    }

    db.prepare('UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ?').run(keyId);
    return { success: true };
  });
}
