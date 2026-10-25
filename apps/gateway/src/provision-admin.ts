import 'dotenv/config';
import { getDb } from './db.js';
import { validateCryptoConfig } from './crypto.js';
import { provisionAdminKey } from './bootstrap.js';

try {
  validateCryptoConfig();
  const username = process.argv[2] ?? 'admin';
  if (process.argv.length > 3) throw new Error('Usage: npm run provision:admin -- [admin-username]');
  const key = provisionAdminKey(getDb(), username);
  process.stdout.write(`New API key for admin '${username}' (shown once; save it now):\n${key}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Admin provisioning failed.'}\n`);
  process.exitCode = 1;
}
