import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({
  name: "woocommerce-mcp-test-client",
  version: "1.0.0",
});

async function main() {
  try {
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost:3004/mcp"),
    );

    await client.connect(transport);
    console.log("Connected to WooCommerce MCP server.");

    const tools = await client.listTools();

    console.log(
      "Available WooCommerce tools:",
      tools.tools.map((tool) => tool.name),
    );

    const result = await client.callTool({
      name: "list_products",
      arguments: {
        search: "Demo Wireless Mouse",
        per_page: 5,
      },
    });

    console.log(
      "Product search result:",
      JSON.stringify(result, null, 2),
    );

    // Test get_product with ID 16
    const productResult = await client.callTool({
      name: "get_product",
      arguments: {
        product_id: 16,
      },
    });

    console.log(
      "Get product #16 result:",
      JSON.stringify(productResult, null, 2),
    );

    // Test list_orders
    const ordersResult = await client.callTool({
      name: "list_orders",
      arguments: {
        per_page: 5,
      },
    });

    console.log(
      "List orders result:",
      JSON.stringify(ordersResult, null, 2),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("WooCommerce MCP test failed:", error);
  process.exitCode = 1;
});