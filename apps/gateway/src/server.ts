import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb } from './db.js';
import { validateCryptoConfig } from './crypto.js';
import { bootstrap } from './bootstrap.js';
import { adminUpstreamRoutes } from './routes/admin/upstreams.js';
import { adminUserRoutes } from './routes/admin/users.js';
import { adminKeyRoutes } from './routes/admin/keys.js';
import { adminAuditRoutes } from './routes/admin/audit.js';
import { userKeyRoutes } from './routes/user/keys.js';
import { mcpRoutes } from './routes/mcp.js';
import { chatRoutes } from './routes/chat.js';
import { dashboardAuthRoutes } from './routes/auth.js';

const app = Fastify({ logger: true });

// Allow dashboard (and external tools) to call the gateway from a browser.
await app.register(cors, { origin: true, credentials: true });

// Register all route modules.
await app.register(adminUpstreamRoutes);
await app.register(adminUserRoutes);
await app.register(adminKeyRoutes);
await app.register(adminAuditRoutes);
await app.register(userKeyRoutes);
await app.register(mcpRoutes);
await app.register(chatRoutes);
await app.register(async instance => dashboardAuthRoutes(instance));

// â”€â”€ Public health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', async () => ({
  status: 'ok',
  service: 'urumi-mcp-gateway',
  ts: Date.now(),
}));

// â”€â”€ Dashboard Auth Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
validateCryptoConfig();
bootstrap(getDb());

const port = Number(process.env.GATEWAY_PORT ?? 3003);
app.listen({ port, host: '0.0.0.0' }).catch(err => {
  app.log.error(err);
  process.exit(1);
});
