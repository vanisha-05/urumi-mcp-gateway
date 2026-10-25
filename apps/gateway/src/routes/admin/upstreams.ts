import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../../auth.js';
import { getDb, type DbUpstream } from '../../db.js';
import { encryptCredential } from '../../crypto.js';
import { connectUpstream, withTimeout, invalidateToolCache } from '../../mcp-client.js';

/** Strip the encrypted credential from API responses. */
function sanitize(row: DbUpstream) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    credential_type: row.credential_type,
    credential_key: row.credential_key,
    has_credential: row.credential_value_enc !== null,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}

export async function adminUpstreamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ── List all upstream servers ────────────────────────────────────────────
  app.get('/admin/upstreams', async () => {
    const db = getDb();
    return (
      db.prepare('SELECT * FROM upstream_servers ORDER BY created_at').all() as DbUpstream[]
    ).map(sanitize);
  });

  // ── Live connectivity status for all upstreams ───────────────────────────
  app.get('/admin/upstreams/status', async () => {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM upstream_servers ORDER BY created_at')
      .all() as DbUpstream[];

    return Promise.all(
      rows.map(async upstream => {
        if (!upstream.enabled) {
          return { ...sanitize(upstream), status: 'disabled', toolCount: 0 };
        }
        try {
          const client = await connectUpstream(upstream);
          const { tools } = await withTimeout(
            client.listTools(),
            `probe ${upstream.name}`,
          );
          await client.close().catch(() => undefined);
          return { ...sanitize(upstream), status: 'connected', toolCount: tools.length };
        } catch (err) {
          return {
            ...sanitize(upstream),
            status: 'unreachable',
            toolCount: 0,
            error: String(err),
          };
        }
      }),
    );
  });

  // ── Add a new upstream server ────────────────────────────────────────────
  app.post('/admin/upstreams', async (request, reply) => {
    const body = request.body as {
      name?: string;
      url?: string;
      credential_type?: 'header' | 'bearer';
      credential_key?: string;
      credential_value?: string;
    };

    if (!body?.name || !body?.url) {
      return reply.code(400).send({ error: 'name and url are required' });
    }
    try {
      new URL(body.url);
    } catch {
      return reply.code(400).send({ error: 'Invalid URL' });
    }

    const db = getDb();
    const id = randomUUID();
    const credEnc = body.credential_value
      ? encryptCredential(body.credential_value)
      : null;

    db.prepare(
      `INSERT INTO upstream_servers
         (id, name, url, credential_type, credential_key, credential_value_enc)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.name,
      body.url,
      body.credential_type ?? null,
      body.credential_key ?? null,
      credEnc,
    );

    invalidateToolCache();

    const row = db
      .prepare('SELECT * FROM upstream_servers WHERE id = ?')
      .get(id) as DbUpstream;
    return reply.code(201).send(sanitize(row));
  });

  // ── Update an upstream server ────────────────────────────────────────────
  app.patch('/admin/upstreams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      url?: string;
      enabled?: boolean;
      credential_type?: 'header' | 'bearer' | null;
      credential_key?: string | null;
      credential_value?: string | null;
    };

    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM upstream_servers WHERE id = ?')
      .get(id) as DbUpstream | undefined;
    if (!existing) return reply.code(404).send({ error: 'Upstream not found' });

    if (body?.url) {
      try {
        new URL(body.url);
      } catch {
        return reply.code(400).send({ error: 'Invalid URL' });
      }
    }

    const updates: Record<string, unknown> = {};
    if (body?.name !== undefined) updates.name = body.name;
    if (body?.url !== undefined) updates.url = body.url;
    if (body?.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
    if (body && 'credential_type' in body)
      updates.credential_type = body.credential_type ?? null;
    if (body && 'credential_key' in body)
      updates.credential_key = body.credential_key ?? null;
    if (body && 'credential_value' in body) {
      updates.credential_value_enc = body.credential_value
        ? encryptCredential(body.credential_value)
        : null;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No updatable fields provided' });
    }

    const sets = Object.keys(updates)
      .map(k => `${k} = ?`)
      .join(', ');
    db.prepare(`UPDATE upstream_servers SET ${sets} WHERE id = ?`).run(
      ...Object.values(updates),
      id,
    );

    invalidateToolCache(id);

    const row = db
      .prepare('SELECT * FROM upstream_servers WHERE id = ?')
      .get(id) as DbUpstream;
    return sanitize(row);
  });

  // ── Delete an upstream server ────────────────────────────────────────────
  app.delete('/admin/upstreams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    if (!db.prepare('SELECT id FROM upstream_servers WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Upstream not found' });
    }
    db.prepare('DELETE FROM upstream_servers WHERE id = ?').run(id);
    invalidateToolCache(id);
    return { success: true };
  });
}
