import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve('.env');
const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
const names = ['GATEWAY_KEY_HMAC_SECRET', 'GATEWAY_ENCRYPTION_KEY'] as const;
const missing = names.filter(name => !new RegExp(`^\\s*${name}\\s*=\\s*\\S+`, 'm').test(existing));
if (missing.length === 0) {
  process.stdout.write('Gateway secrets are already configured; no changes made.\n');
} else {
  let updated = existing;
  const additions: string[] = [];
  for (const name of missing) {
    const line = `${name}=${randomBytes(32).toString('hex')}`;
    const assignment = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
    if (assignment.test(updated)) updated = updated.replace(assignment, line);
    else additions.push(line);
  }
  const prefix = updated.length > 0 && !updated.endsWith('\n') ? '\n' : '';
  writeFileSync(path, `${updated}${prefix}${additions.length ? `${additions.join('\n')}\n` : ''}`, { mode: 0o600 });
  process.stdout.write(`Generated ${missing.length} missing gateway secret(s) in .env. Values were not printed.\n`);
}
