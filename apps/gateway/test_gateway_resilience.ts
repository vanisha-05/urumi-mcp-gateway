import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({
  name: "urumi-resilience-test",
  version: "1.0.0",
});

async function main() {
  try {
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost:3003/mcp"),
    );

    await client.connect(transport);
    console.log("Connected to gateway.");

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);

    console.log("Available tools:", names);

    console.log(
      "Second upstream tools absent:",
      !names.includes("external__get_service_info"),
    );

    const hello = await client.callTool({
      name: "demo__hello_world",
      arguments: { name: "Vanisha" },
    });

    console.log("First upstream still works:", hello);

    const products = await client.callTool({
      name: "woocommerce__list_products",
      arguments: {
        search: "Demo Wireless Mouse",
        per_page: 5,
      },
    });

    console.log(
      "WooCommerce still works:",
      !products.isError,
    );
  } catch (error) {
    console.error("Resilience test failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(console.error);