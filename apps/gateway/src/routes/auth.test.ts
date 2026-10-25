import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { hashApiKey, keyPrefix } from '../crypto.js';
import { createRequireAuth, DASHBOARD_SESSION_COOKIE } from '../auth.js';
import { dashboardAuthRoutes } from './auth.js';

process.env.GATEWAY_KEY_HMAC_SECRET = 'test-only-dashboard-session-secret-32-bytes';
process.env.GATEWAY_SESSION_COOKIE_SECURE = 'false';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'urumi-auth-test-'));
  const db = openDatabase(join(directory, 'test.db'));
  const app = Fastify();
  dashboardAuthRoutes(app, () => db);
  app.get('/protected', { preHandler: createRequireAuth(() => db) }, async request => ({ user: request.user }));
  const rawKey = 'urumi_test_key_for_dashboard_login';
  db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)').run('user-1', 'admin', 'admin');
  db.prepare('INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)')
    .run('key-1', 'user-1', 'test', hashApiKey(rawKey), keyPrefix(rawKey));
  return { app, db, directory, rawKey, close: async () => { await app.close(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('successful login sets an HttpOnly session that restores after a fresh request', async () => {
  const ctx = setup();
  try {
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/verify', payload: { apiKey: ctx.rawKey } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.username, 'admin');
    const setCookie = login.headers['set-cookie'] as string;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';', 1)[0];

    const restored = await ctx.app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().user.id, 'user-1');
    const protectedResponse = await ctx.app.inject({ method: 'GET', url: '/protected', headers: { cookie } });
    assert.equal(protectedResponse.statusCode, 200);
  } finally { await ctx.close(); }
});

test('logout clears the session cookie and stops session restoration', async () => {
  const ctx = setup();
  try {
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/verify', payload: { apiKey: ctx.rawKey } });
    const cookie = (login.headers['set-cookie'] as string).split(';', 1)[0];
    const logout = await ctx.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers['set-cookie'] as string, /Max-Age=0/);
    const cleared = await ctx.app.inject({ method: 'GET', url: '/auth/session', headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=` } });
    assert.equal(cleared.statusCode, 401);
  } finally { await ctx.close(); }
});

test('invalid API keys return a precise unauthorized response', async () => {
  const ctx = setup();
  try {
    const response = await ctx.app.inject({ method: 'POST', url: '/auth/verify', payload: { apiKey: 'urumi_invalid' } });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'Invalid or revoked API key' });
  } finally { await ctx.close(); }
});

test('revoking a key invalidates its existing dashboard session', async () => {
  const ctx = setup();
  try {
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/verify', payload: { apiKey: ctx.rawKey } });
    const cookie = (login.headers['set-cookie'] as string).split(';', 1)[0];
    ctx.db.prepare('UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ?').run('key-1');
    const restored = await ctx.app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    const protectedResponse = await ctx.app.inject({ method: 'GET', url: '/protected', headers: { cookie } });
    assert.equal(restored.statusCode, 401);
    assert.equal(protectedResponse.statusCode, 401);
  } finally { await ctx.close(); }
});
