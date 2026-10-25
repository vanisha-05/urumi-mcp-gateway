import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx.cmd",
  args: ["tsx", "apps/gateway/mcp.ts"],
});

const client = new Client({
  name: "urumi-mcp-test-client",
  version: "1.0.0",
});

async function main() {
  try {
    await client.connect(transport);

    const tools = await client.listTools();
    console.log("Discovered tools:", tools.tools.map((tool) => tool.name));

    const result = await client.callTool({
      name: "hello_world",
      arguments: { name: "Vanisha" },
    });

    console.log("Tool result:", result);
  } finally {
    await client.close();
  }
}

main().catch(console.error);