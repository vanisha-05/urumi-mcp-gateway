import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let _db: Database.Database | undefined;

export function openDatabase(path = process.env.GATEWAY_DB_PATH ?? './data/gateway.db'): Database.Database {
  const dbPath = resolve(path);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = openDatabase();
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      role        TEXT NOT NULL
                    CHECK(role IN ('admin','member'))
                    DEFAULT 'member',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL,
      key_prefix  TEXT NOT NULL,
      revoked_at  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
      ON api_keys(key_prefix);

    CREATE TABLE IF NOT EXISTS upstream_servers (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      url                 TEXT NOT NULL,
      credential_type     TEXT
                            CHECK(credential_type IN ('header','bearer')
                              OR credential_type IS NULL),
      credential_key      TEXT,
      credential_value_enc TEXT,
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id              TEXT PRIMARY KEY,
      user_id         TEXT,
      username        TEXT,
      upstream_id     TEXT,
      upstream_name   TEXT,
      tool_name       TEXT NOT NULL,
      called_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      duration_ms     INTEGER,
      success         INTEGER NOT NULL DEFAULT 1,
      error_message   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_called_at
      ON audit_log(called_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id
      ON audit_log(user_id);
  `);
}

// ─── Exported types ───────────────────────────────────────────────────────────

export type DbUser = {
  id: string;
  username: string;
  role: 'admin' | 'member';
  created_at: number;
};

export type DbApiKey = {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  revoked_at: number | null;
  created_at: number;
};

export type DbUpstream = {
  id: string;
  name: string;
  url: string;
  credential_type: 'header' | 'bearer' | null;
  credential_key: string | null;
  credential_value_enc: string | null;
  enabled: number;
  created_at: number;
};

export type DbAuditEntry = {
  id: string;
  user_id: string | null;
  username: string | null;
  upstream_id: string | null;
  upstream_name: string | null;
  tool_name: string;
  called_at: number;
  duration_ms: number | null;
  success: number;
  error_message: string | null;
};
