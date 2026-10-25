import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: "urumi-system-mcp",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

app.route({
  method: ["GET", "POST", "DELETE"],
  url: "/mcp",
  handler: async (request, reply) => {
    const server = new McpServer({
      name: "system-mcp",
      version: "1.0.0",
    });

    server.registerTool(
      "get_system_health",
      {
        description: "Returns system status, memory usage, and platform details",
        inputSchema: {},
      },
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "healthy",
              nodeVersion: process.version,
              platform: process.platform,
              memory: process.memoryUsage(),
              uptimeSeconds: Math.floor(process.uptime()),
            }, null, 2),
          },
        ],
      }),
    );

    server.registerTool(
      "echo",
      {
        description: "Echoes back the input message for testing connectivity",
        inputSchema: {
          message: z.string().describe("Message to echo back"),
        },
      },
      async ({ message }) => ({
        content: [
          {
            type: "text",
            text: `Echo response: ${message}`,
          },
        ],
      }),
    );

    server.registerTool(
      "calculate",
      {
        description: "Performs mathematical calculations safely",
        inputSchema: {
          operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("Math operation"),
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        },
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add": result = a + b; break;
          case "subtract": result = a - b; break;
          case "multiply": result = a * b; break;
          case "divide":
            if (b === 0) throw new Error("Division by zero");
            result = a / b;
            break;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ operation, a, b, result }),
            },
          ],
        };
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);

    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
  },
});

const port = Number(process.env.SYSTEM_MCP_PORT || 3001);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
