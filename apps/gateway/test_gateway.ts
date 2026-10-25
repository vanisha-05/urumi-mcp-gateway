import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3003/mcp"),
);

const client = new Client({
  name: "urumi-gateway-test-client",
  version: "1.0.0",
});

async function main() {
  try {
    await client.connect(transport);
    console.log("Connected to MCP Gateway.");

    const result = await client.listTools();

    console.log(
      "Aggregated tools:",
      result.tools.map((tool) => tool.name),
    );

    const helloResult = await client.callTool({
      name: "demo__hello_world",
      arguments: { name: "Vanisha" },
    });

    console.log("Hello tool result:", helloResult);

    const serviceResult = await client.callTool({
      name: "external__get_service_info",
      arguments: {},
    });

    console.log("Service info result:", serviceResult);

    // Test the real WooCommerce store through the gateway.
    const wooResult = await client.callTool({
      name: "woocommerce__list_products",
      arguments: {
        search: "Demo Wireless Mouse",
        per_page: 5,
      },
    });

    console.log(
      "WooCommerce product result:",
      JSON.stringify(wooResult, null, 2),
    );
  } catch (error) {
    console.error("Gateway test failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(console.error);