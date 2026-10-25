import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.post("/mcp", async (request, reply) => {
  const server = new McpServer({
    name: "urumi-external-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_service_info",
    {
      description: "Returns information about this demo upstream service",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            service: "external-demo",
            status: "operational",
            message: "Second upstream MCP server is working.",
          }),
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

app.listen({ port: 3002, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});