import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, type DbUser } from './db.js';
import { hashApiKey, keyPrefix } from './crypto.js';

export const DASHBOARD_SESSION_COOKIE = 'urumi_dashboard_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function sessionSignature(keyId: string): string {
  const secret = process.env.GATEWAY_KEY_HMAC_SECRET;
  if (!secret) throw new Error('GATEWAY_KEY_HMAC_SECRET is not configured');
  return createHmac('sha256', secret).update(`dashboard-session:${keyId}`).digest('base64url');
}

export function createSessionToken(keyId: string, expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS): string {
  const payload = `${keyId}.${expiresAt}`;
  return `${payload}.${sessionSignature(payload)}`;
}

function sessionKeyId(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[1])) return null;
  const [keyId, expiresAt, signature] = parts;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return null;
  const payload = `${keyId}.${expiresAt}`;
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(sessionSignature(payload));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? keyId : null;
}

export function getCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function cookieSecure(secureTransport: boolean): boolean {
  if (process.env.GATEWAY_SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.GATEWAY_SESSION_COOKIE_SECURE === 'false') return false;
  return secureTransport || process.env.NODE_ENV === 'production';
}

export function getSessionCookieValue(keyId: string, secureTransport = false): string {
  const secure = cookieSecure(secureTransport);
  return `${DASHBOARD_SESSION_COOKIE}=${createSessionToken(keyId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieValue(secureTransport = false): string {
  const secure = cookieSecure(secureTransport);
  return `${DASHBOARD_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function findUserByApiKey(db: ReturnType<typeof getDb>, rawKey: string): (DbUser & { key_id: string }) | undefined {
  return db.prepare(
    `SELECT ak.id AS key_id, u.id, u.username, u.role, u.created_at
     FROM api_keys ak JOIN users u ON ak.user_id = u.id
     WHERE ak.key_prefix = ? AND ak.key_hash = ? AND ak.revoked_at IS NULL`,
  ).get(keyPrefix(rawKey), hashApiKey(rawKey)) as (DbUser & { key_id: string }) | undefined;
}

export function findUserBySession(db: ReturnType<typeof getDb>, token: string | undefined): DbUser | undefined {
  const keyId = sessionKeyId(token);
  if (!keyId) return undefined;
  return db.prepare(
    `SELECT u.id, u.username, u.role, u.created_at
     FROM api_keys ak JOIN users u ON ak.user_id = u.id
     WHERE ak.id = ? AND ak.revoked_at IS NULL`,
  ).get(keyId) as DbUser | undefined;
}

// Augment FastifyRequest so downstream handlers can read `request.user`.
declare module 'fastify' {
  interface FastifyRequest {
    user?: DbUser;
  }
}

/** Validates a bearer API key or its signed dashboard cookie. */
export function createRequireAuth(dbProvider = getDb) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const rawKey = auth.slice(7).trim();
      const row = findUserByApiKey(dbProvider(), rawKey);
      if (row) {
        request.user = row;
        return;
      }
      request.log.warn(
        { path: request.url, method: request.method, remoteAddress: request.ip },
        'Rejected missing, invalid, or revoked API key',
      );
      return reply.code(401).send({ error: 'Invalid or revoked API key' });
    }

    const user = findUserBySession(dbProvider(), getCookie(request, DASHBOARD_SESSION_COOKIE));
    if (!user) {
      request.log.warn(
        { path: request.url, method: request.method, remoteAddress: request.ip },
        'Rejected request without a valid API key or dashboard session',
      );
      return reply.code(401).send({ error: 'Authentication required' });
    }

    request.user = user;
  };
}

export const requireAuth = createRequireAuth();

/** Like requireAuth but also enforces the admin role. */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (!reply.sent && request.user?.role !== 'admin') {
    return reply.code(403).send({ error: 'Admin role required' });
  }
}
