import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { requireAuth } from '../auth.js';
import { getDb, type DbUpstream } from '../db.js';
import { connectUpstream, listUpstreamTools, withTimeout, classifyMcpError, getAggregatedTools } from '../mcp-client.js';

export async function mcpRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (request, reply) => {
      const user = request.user!;
      const db = getDb();

      // Snapshot all upstreams at request time so disabled-server calls can
      // be rejected and attributed in the audit log. Discovery uses enabled only.
      const allUpstreams = db
        .prepare('SELECT * FROM upstream_servers ORDER BY created_at')
        .all() as DbUpstream[];
      const upstreams = allUpstreams.filter(upstream => upstream.enabled === 1);

      const mcpServer = new Server(
        { name: 'urumi-mcp-gateway', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );

      // ── List tools: aggregated from cache/upstreams ───────────────────
      mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        const { allTools, allCached, totalDurationMs } = await getAggregatedTools(upstreams, { logger: app.log });
        app.log.info(
          { stage: 'tool_discovery', route: '/mcp', durationMs: totalDurationMs, toolCount: allTools.length, fromCache: allCached },
          'Tool discovery completed for /mcp',
        );
        return { tools: allTools };
      });

      // ── Call tool: route to the correct upstream, log to audit ─────────
      mcpServer.setRequestHandler(CallToolRequestSchema, async req => {
        const qualifiedName = req.params.name;
        const upstream = allUpstreams.find(u =>
          qualifiedName.startsWith(`${u.id}__`),
        );

        if (!upstream) {
          throw new Error(`Unknown tool: ${qualifiedName}`);
        }

        const entryId = randomUUID();
        const startMs = Date.now();
        if (!upstream.enabled) {
          const error = `Upstream is disabled: ${upstream.name}`;
          db.prepare(
            `INSERT INTO audit_log
               (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          ).run(entryId, user.id, user.username, upstream.id, upstream.name, qualifiedName, 0, error);
          throw new Error(error);
        }

        const originalName = qualifiedName.slice(upstream.id.length + 2);
        let client: Awaited<ReturnType<typeof connectUpstream>> | undefined;
        try {
          client = await connectUpstream(upstream);
          const result = await withTimeout(
            client.callTool({
              name: originalName,
              arguments: req.params.arguments ?? {},
            }),
            `callTool ${qualifiedName}`,
          );

          const failed = Boolean(result.isError);
          db.prepare(
            `INSERT INTO audit_log
               (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            entryId,
            user.id,
            user.username,
            upstream.id,
            upstream.name,
            qualifiedName,
            Date.now() - startMs,
            failed ? 0 : 1,
            failed ? 'Upstream tool returned an MCP error result' : null,
          );

          return result;
        } catch (err) {
          db.prepare(
            `INSERT INTO audit_log
               (id, user_id, username, upstream_id, upstream_name, tool_name,
                duration_ms, success, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          ).run(
            entryId,
            user.id,
            user.username,
            upstream.id,
            upstream.name,
            qualifiedName,
            Date.now() - startMs,
            classifyMcpError(err),
          );
          throw err;
        } finally {
          await client?.close().catch(() => undefined);
        }
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      reply.hijack();
      await mcpServer.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);

      reply.raw.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });
    },
  });
}
