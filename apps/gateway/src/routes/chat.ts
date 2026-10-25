import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { getDb, type DbUpstream } from '../db.js';
import { connectUpstream, withTimeout, classifyMcpError, getAggregatedTools, type NamespacedTool } from '../mcp-client.js';
import { executeGeminiAgent, GeminiAgentError } from './gemini-agent.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ── List all available tools across enabled upstreams ─────────────────────
  app.get('/api/tools', async () => {
    const db = getDb();
    const upstreams = db
      .prepare('SELECT * FROM upstream_servers WHERE enabled = 1 ORDER BY created_at')
      .all() as DbUpstream[];

    const { allTools, allCached, totalDurationMs } = await getAggregatedTools(upstreams, { logger: app.log });
    app.log.info(
      { stage: 'tool_discovery', route: '/api/tools', durationMs: totalDurationMs, toolCount: allTools.length, fromCache: allCached },
      'Tool discovery completed for /api/tools',
    );

    return {
      total: allTools.length,
      upstreamsCount: upstreams.length,
      tools: allTools,
    };
  });

  // ── Execute a tool directly from dashboard UI ─────────────────────────────
  app.post('/api/tools/execute', async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      toolName?: string;
      arguments?: Record<string, unknown>;
    };

    if (!body?.toolName) {
      return reply.code(400).send({ error: 'toolName is required' });
    }

    const qualifiedName = body.toolName;
    const db = getDb();
    const upstreams = db
      .prepare('SELECT * FROM upstream_servers WHERE enabled = 1')
      .all() as DbUpstream[];

    const upstream = upstreams.find(u => qualifiedName.startsWith(`${u.id}__`));
    if (!upstream) {
      return reply.code(404).send({ error: `No active upstream matches tool: ${qualifiedName}` });
    }

    const originalName = qualifiedName.slice(upstream.id.length + 2);
    const startMonotonic = performance.now();
    const entryId = randomUUID();

    try {
      const client = await connectUpstream(upstream);
      let result;
      try {
        result = await withTimeout(
          client.callTool({
            name: originalName,
            arguments: body.arguments ?? {},
          }),
          `execute ${qualifiedName}`,
        );
      } finally {
        await client.close().catch(() => undefined);
      }

      const durationMs = Math.round((performance.now() - startMonotonic) * 100) / 100;
      const failed = Boolean(result.isError);
      db.prepare(
        `INSERT INTO audit_log
           (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(entryId, user.id, user.username, upstream.id, upstream.name, qualifiedName, Math.round(durationMs),
        failed ? 0 : 1, failed ? 'Upstream tool returned an MCP error result' : null);

      app.log.info({
        stage: 'mcp_tool_execution',
        route: '/api/tools/execute',
        tool: qualifiedName,
        upstream: upstream.name,
        durationMs,
        success: !failed,
      }, 'MCP tool execution completed');

      return {
        success: true,
        tool: qualifiedName,
        upstream: upstream.name,
        durationMs,
        result,
      };
    } catch (err: unknown) {
      const durationMs = Math.round((performance.now() - startMonotonic) * 100) / 100;
      const errMsg = classifyMcpError(err);

      db.prepare(
        `INSERT INTO audit_log
           (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(entryId, user.id, user.username, upstream.id, upstream.name, qualifiedName, Math.round(durationMs), errMsg);

      app.log.warn({
        stage: 'mcp_tool_execution',
        route: '/api/tools/execute',
        tool: qualifiedName,
        upstream: upstream.name,
        durationMs,
        success: false,
        error: errMsg,
      }, 'MCP tool execution failed');

      return reply.code(500).send({
        success: false,
        tool: qualifiedName,
        error: errMsg,
        durationMs,
      });
    }
  });

  // ── Chat Agent Loop ───────────────────────────────────────────────────────
  app.post('/api/chat', async (request, reply) => {
    const chatStart = performance.now();
    const user = request.user!;
    const body = request.body as {
      messages?: ChatMessage[];
    };

    const messages = body?.messages || [];
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'messages array cannot be empty' });
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || typeof lastMessage.content !== 'string') {
      return reply.code(400).send({ error: 'Last message must be from user' });
    }

    const db = getDb();
    const upstreams = db
      .prepare('SELECT * FROM upstream_servers WHERE enabled = 1')
      .all() as DbUpstream[];

    const discoveryStart = performance.now();
    const { allTools, toolsMap, allCached } = await getAggregatedTools(upstreams, { logger: app.log });
    const discoveryDurationMs = Math.round((performance.now() - discoveryStart) * 100) / 100;
    app.log.info(
      { stage: 'tool_discovery', route: '/api/chat', durationMs: discoveryDurationMs, toolCount: allTools.length, fromCache: allCached },
      'Tool discovery completed for /api/chat',
    );

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return reply.code(500).send({
        error: 'GEMINI_API_KEY is not configured on the Gateway.',
        provider: 'gemini',
      });
    }

    try {
      const result = await executeGeminiAgent({
        apiKey,
        messages,
        tools: Array.from(toolsMap.values()),
        user,
        db,
        executeTool: (target, args) => callToolHelper(target, args, user, db, app.log),
        logger: app.log,
      });
      const totalDurationMs = Math.round((performance.now() - chatStart) * 100) / 100;
      app.log.info(
        { stage: 'agent_chat_total', mode: 'gemini', turns: result.turns, toolCallCount: result.toolCalls.length, durationMs: totalDurationMs },
        'Chat completed with Gemini',
      );
      return reply.send({ role: 'assistant', content: result.content, toolCalls: result.toolCalls, provider: 'gemini' });
    } catch (error) {
      const totalDurationMs = Math.round((performance.now() - chatStart) * 100) / 100;
      const failure = error instanceof GeminiAgentError ? error : new GeminiAgentError('Gemini chat failed unexpectedly.');
      app.log.warn({
        stage: 'agent_chat_total',
        mode: 'gemini-failed',
        statusCode: failure.statusCode,
        reason: failure.message,
        durationMs: totalDurationMs,
      }, 'Gemini chat request failed');
      return reply.code(failure.statusCode).send({ error: failure.message, provider: 'gemini' });
    }
  });
}

async function callToolHelper(
  target: { upstream: DbUpstream; originalName: string; tool: NamespacedTool },
  args: Record<string, unknown>,
  user: { id: string; username: string },
  db: ReturnType<typeof getDb>,
  logger?: FastifyInstance['log'],
) {
  const startMonotonic = performance.now();
  const entryId = randomUUID();
  let client: Awaited<ReturnType<typeof connectUpstream>> | undefined;
  try {
    client = await connectUpstream(target.upstream);
    const res = await withTimeout(
      client.callTool({
        name: target.originalName,
        arguments: args,
      }),
      `callTool ${target.tool.name}`,
    );

    const durationMs = Math.round((performance.now() - startMonotonic) * 100) / 100;
    const failed = Boolean(res.isError);
    db.prepare(
      `INSERT INTO audit_log
         (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(entryId, user.id, user.username, target.upstream.id, target.upstream.name, target.tool.name,
      Math.round(durationMs), failed ? 0 : 1,
      failed ? 'Upstream tool returned an MCP error result' : null);

    logger?.info({
      stage: 'mcp_tool_execution',
      tool: target.tool.name,
      upstream: target.upstream.name,
      durationMs,
      success: !failed,
    }, 'MCP tool execution completed');

    return res;
  } catch (err) {
    const durationMs = Math.round((performance.now() - startMonotonic) * 100) / 100;
    const errMsg = classifyMcpError(err);
    db.prepare(
      `INSERT INTO audit_log
         (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(entryId, user.id, user.username, target.upstream.id, target.upstream.name, target.tool.name,
      Math.round(durationMs), errMsg);

    logger?.warn({
      stage: 'mcp_tool_execution',
      tool: target.tool.name,
      upstream: target.upstream.name,
      durationMs,
      success: false,
      error: errMsg,
    }, 'MCP tool execution failed');

    throw err;
  } finally {
    await client?.close().catch(() => undefined);
  }
}
