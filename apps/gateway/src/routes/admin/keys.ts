import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../../auth.js';
import { getDb } from '../../db.js';
import { generateApiKey, hashApiKey, keyPrefix } from '../../crypto.js';

export async function adminKeyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ── List keys for a specific user ────────────────────────────────────────
  app.get('/admin/users/:userId/keys', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const db = getDb();
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return db
      .prepare(
        `SELECT id, name, key_prefix, revoked_at, created_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(userId);
  });

  // ── Issue a key for any user (admin-only) ────────────────────────────────
  app.post('/admin/users/:userId/keys', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { name?: string } | null;
    const db = getDb();

    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const rawKey = generateApiKey();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, userId, body?.name ?? 'admin-issued', hashApiKey(rawKey), keyPrefix(rawKey));

    return reply.code(201).send({
      id,
      key: rawKey,           // Only time the plaintext key is returned
      key_prefix: keyPrefix(rawKey),
      name: body?.name ?? 'admin-issued',
    });
  });

  // ── Revoke any key (admin-only) ──────────────────────────────────────────
  app.delete('/admin/keys/:keyId', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const db = getDb();

    const row = db
      .prepare('SELECT id, revoked_at FROM api_keys WHERE id = ?')
      .get(keyId) as { id: string; revoked_at: number | null } | undefined;

    if (!row) return reply.code(404).send({ error: 'Key not found' });
    if (row.revoked_at !== null) {
      return reply.code(400).send({ error: 'Key is already revoked' });
    }

    db.prepare('UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ?').run(keyId);
    return { success: true, keyId };
  });
}
