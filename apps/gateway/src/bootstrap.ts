import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateApiKey, hashApiKey, keyPrefix } from './crypto.js';

export function bootstrap(db: Database.Database, env: NodeJS.ProcessEnv = process.env): void {
  const seed = db.transaction(() => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    if (count === 0) {
      const adminId = randomUUID();
      db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)').run(adminId, 'admin', 'admin');
    }

    const defaults = [
      ['WooCommerce Store', env.WOOCOMMERCE_MCP_URL ?? 'http://localhost:3004/mcp'],
      ['System & Utilities', env.SYSTEM_MCP_URL ?? 'http://localhost:3001/mcp'],
      ['Warehouse & Inventory', env.INVENTORY_MCP_URL ?? 'http://localhost:3002/mcp'],
    ];
    const insert = db.prepare('INSERT INTO upstream_servers (id, name, url, enabled) SELECT ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM upstream_servers WHERE name = ?)');
    for (const [name, url] of defaults) insert.run(randomUUID(), name, url, name);
  });
  seed();
}

/** Add a new admin key locally; never revokes or changes existing keys. */
export function provisionAdminKey(db: Database.Database, username = 'admin'): string {
  return db.transaction(() => {
    const admin = db.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin'").get(username) as { id: string } | undefined;
    if (!admin) throw new Error(`Admin user '${username}' was not found.`);
    const apiKey = generateApiKey();
    db.prepare('INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), admin.id, 'locally-provisioned', hashApiKey(apiKey), keyPrefix(apiKey));
    return apiKey;
  })();
}
