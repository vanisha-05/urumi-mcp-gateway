import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
        text: `Hello, ${name}! Your MCP server is working.`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();

await server.connect(transport);