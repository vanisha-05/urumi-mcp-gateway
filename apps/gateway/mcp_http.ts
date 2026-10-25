import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({ logger: true });

app.post("/mcp", async (request, reply) => {
  const server = new McpServer({
    name: "urumi-mcp-gateway",
    version: "1.0.0",
  });

  server.registerTool(
    "hello_world",
    {
      description: "A test tool for the Urumi MCP Gateway",
      inputSchema: {
        name: z.string().describe("Name of the person to greet"),
      },
    },
    async ({ name }) => ({
      content: [
        {
          type: "text",
          text: `Hello, ${name}! Your HTTP MCP server is working.`,
        },
      ],
    }),
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

const start = async () => {
  await app.listen({ port: 3001, host: "0.0.0.0" });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});