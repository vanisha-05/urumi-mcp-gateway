import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import {
  clearSessionCookieValue,
  findUserByApiKey,
  findUserBySession,
  getCookie,
  getSessionCookieValue,
  DASHBOARD_SESSION_COOKIE,
} from '../auth.js';

export function dashboardAuthRoutes(app: FastifyInstance, dbProvider = getDb) {
  app.post('/auth/verify', async (request, reply) => {
    const body = request.body as { apiKey?: string } | null;
    if (!body?.apiKey?.trim()) return reply.code(400).send({ error: 'apiKey is required' });

    const result = findUserByApiKey(dbProvider(), body.apiKey.trim());
    if (!result) return reply.code(401).send({ error: 'Invalid or revoked API key' });

    const secureTransport = request.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', getSessionCookieValue(result.key_id, secureTransport));
    return { user: { id: result.id, username: result.username, role: result.role, created_at: result.created_at } };
  });

  app.get('/auth/session', async (request, reply) => {
    const user = findUserBySession(dbProvider(), getCookie(request, DASHBOARD_SESSION_COOKIE));
    if (!user) return reply.code(401).send({ error: 'Session is missing, invalid, or expired' });
    return { user };
  });

  app.post('/auth/logout', async (request, reply) => {
    const secureTransport = request.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', clearSessionCookieValue(secureTransport));
    return { success: true };
  });
}
