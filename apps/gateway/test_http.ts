import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3001/mcp"),
);

const client = new Client({
  name: "urumi-http-test-client",
  version: "1.0.0",
});

async function main() {
  try {
    await client.connect(transport);
    console.log("Connected to HTTP MCP server.");

    const tools = await client.listTools();
    console.log(
      "Discovered tools:",
      tools.tools.map((tool) => tool.name),
    );

    const result = await client.callTool({
      name: "hello_world",
      arguments: { name: "Vanisha" },
    });

    console.log("Tool result:", result);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("MCP HTTP test failed:", error);
  process.exitCode = 1;
});