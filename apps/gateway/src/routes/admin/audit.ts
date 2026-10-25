import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../auth.js';
import { getDb } from '../../db.js';

export async function adminAuditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/audit
   * Query params: limit, offset, userId, upstreamId, success (0|1)
   */
  app.get('/admin/audit', async request => {
    const q = request.query as {
      limit?: string;
      offset?: string;
      userId?: string;
      upstreamId?: string;
      success?: string;
    };

    const limit = Math.min(Number(q.limit ?? 50), 200);
    const offset = Number(q.offset ?? 0);

    const db = getDb();
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (q.userId) {
      conditions.push('user_id = ?');
      filterParams.push(q.userId);
    }
    if (q.upstreamId) {
      conditions.push('upstream_id = ?');
      filterParams.push(q.upstreamId);
    }
    if (q.success !== undefined) {
      conditions.push('success = ?');
      filterParams.push(Number(q.success));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const entries = db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY called_at DESC LIMIT ? OFFSET ?`)
      .all(...filterParams, limit, offset);

    const { total } = db
      .prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`)
      .get(...filterParams) as { total: number };

    return { total, limit, offset, entries };
  });
}
