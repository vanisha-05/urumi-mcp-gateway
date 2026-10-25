import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
const app = Fastify({ logger: true });
function hasValidAdminToken(
  authorization: string | undefined,
): boolean {
  const expectedToken = process.env.GATEWAY_ADMIN_TOKEN;

  if (!expectedToken || !authorization) {
    return false;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization);

  if (!match) {
    return false;
  }

  const provided = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");

  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
app.get("/admin/upstreams", async (request, reply) => {
  if (!hasValidAdminToken(request.headers.authorization)) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  return upstreams.map((upstream) => ({
    id: upstream.id,
    url: upstream.url,
    enabled: upstream.enabled,
  }));
});

app.patch("/admin/upstreams/:id", async (request, reply) => {
  if (!hasValidAdminToken(request.headers.authorization)) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }
  const { id } = request.params as { id: string };
  const body = request.body as { enabled?: unknown } | null;

  if (!body || typeof body.enabled !== "boolean") {
    return reply.code(400).send({
      error: "Request body must include enabled: true or enabled: false",
    });
  }

  const upstream = upstreams.find((item) => item.id === id);

  if (!upstream) {
    return reply.code(404).send({
      error: `Upstream '${id}' not found`,
    });
  }

  upstream.enabled = body.enabled;

  return {
    id: upstream.id,
    enabled: upstream.enabled,
  };
});

type Upstream = {
  id: string;
  url: string;
  enabled: boolean;
};

let upstreams: Upstream[] = [
  {
    id: "demo",
    url: "http://localhost:3001/mcp",
    enabled: true,
  },
  {
    id: "external",
    url: "http://localhost:3002/mcp",
    enabled: true,
  },
  {
    id: "woocommerce",
    url: "http://localhost:3004/mcp",
    enabled: true,
  },
];

async function connectToUpstream(url: string): Promise<Client> {
  const client = new Client({
    name: "urumi-gateway-client",
    version: "1.0.0",
  });

  try {
    await withTimeout(
      client.connect(
        new StreamableHTTPClientTransport(new URL(url)),
      ),
      `Connecting to ${url}`,
    );

    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
const UPSTREAM_TIMEOUT_MS = 15_000;

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${operation} timed out after ${UPSTREAM_TIMEOUT_MS} ms`,
            ),
          );
        }, UPSTREAM_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
app.post("/mcp", async (request, reply) => {
  const server = new Server(
    {
      name: "urumi-mcp-gateway",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Aggregate tools from each available upstream server.
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      const aggregatedTools: Tool[] = [];

      for (const upstream of upstreams) {
        if (!upstream.enabled) continue;
        let client: Client | undefined;

        try {
          client = await connectToUpstream(upstream.url);
          const result = await withTimeout(
            client.listTools(),
            `Listing tools from ${upstream.id}`,
          );

          for (const tool of result.tools) {
            aggregatedTools.push({
              ...tool,
              name: `${upstream.id}__${tool.name}`,
            });
          }
        } catch (error) {
          app.log.warn(
            { upstream: upstream.id, error },
            "Skipping unavailable upstream",
          );
        } finally {
          if (client) {
            await client.close().catch(() => undefined);
          }
        }
      }

      return { tools: aggregatedTools };
    },
  );

  // Route each tool call to its original upstream.
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const qualifiedName = request.params.name;
      const upstream = upstreams.find(
        (item) =>
          item.enabled &&
          qualifiedName.startsWith(`${item.id}__`),
      );
      if (!upstream) {
        throw new Error(`Unknown gateway tool: ${qualifiedName}`);
      }

      const originalName = qualifiedName.slice(
        upstream.id.length + 2,
      );

      const client = await connectToUpstream(upstream.url);

      try {
        return await withTimeout(
          client.callTool({
            name: originalName,
            arguments: request.params.arguments ?? {},
          }),
          `Calling ${qualifiedName} on ${upstream.id}`,
        );
      } finally {
        await client.close().catch(() => undefined);
      }
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  reply.hijack();

  await server.connect(transport);

  await transport.handleRequest(
    request.raw,
    reply.raw,
    request.body,
  );

  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
});

app.listen({ port: 3003, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});