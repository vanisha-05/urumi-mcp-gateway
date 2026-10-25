import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../../auth.js';
import { getDb, type DbUser } from '../../db.js';

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ── List all users ───────────────────────────────────────────────────────
  app.get('/admin/users', async () => {
    return getDb()
      .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at')
      .all();
  });

  // ── Create / invite a user ───────────────────────────────────────────────
  app.post('/admin/users', async (request, reply) => {
    const body = request.body as { username?: string; role?: string };
    if (!body?.username) {
      return reply.code(400).send({ error: 'username is required' });
    }
    const role = body.role === 'admin' ? 'admin' : 'member';

    const db = getDb();
    const id = randomUUID();
    try {
      db.prepare(
        'INSERT INTO users (id, username, role) VALUES (?, ?, ?)',
      ).run(id, body.username, role);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'Username already exists' });
      }
      throw err;
    }

    return reply.code(201).send(
      db
        .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
        .get(id),
    );
  });

  // ── Delete a user ────────────────────────────────────────────────────────
  app.delete('/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const user = db
      .prepare('SELECT id, role FROM users WHERE id = ?')
      .get(id) as DbUser | undefined;
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // Prevent deleting the last admin.
    if (user.role === 'admin') {
      const adminCount = (
        db
          .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'")
          .get() as { c: number }
      ).c;
      if (adminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last admin user' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  });
}
