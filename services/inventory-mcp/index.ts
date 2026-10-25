import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: "urumi-inventory-mcp",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

// In-memory mock warehouse inventory
const warehouseStock: Record<string, { sku: string; name: string; quantity: number; location: string }> = {
  "SKU-DEMO-MOUSE": { sku: "SKU-DEMO-MOUSE", name: "Demo Wireless Mouse", quantity: 142, location: "Aisle 3, Shelf B2" },
  "SKU-KEYBOARD-RGB": { sku: "SKU-KEYBOARD-RGB", name: "Mechanical Gaming Keyboard", quantity: 58, location: "Aisle 4, Shelf A1" },
  "SKU-USB-HUB": { sku: "SKU-USB-HUB", name: "7-in-1 USB-C Hub", quantity: 230, location: "Aisle 1, Shelf C5" },
  "SKU-HEADSET-PRO": { sku: "SKU-HEADSET-PRO", name: "Pro Noise-Cancelling Headset", quantity: 19, location: "Aisle 2, Shelf D3" },
};

app.route({
  method: ["GET", "POST", "DELETE"],
  url: "/mcp",
  handler: async (request, reply) => {
    const server = new McpServer({
      name: "inventory-mcp",
      version: "1.0.0",
    });

    server.registerTool(
      "check_warehouse_stock",
      {
        description: "Checks real-time physical inventory stock level and warehouse aisle/shelf location by SKU or product name",
        inputSchema: {
          query: z.string().describe("SKU code or product name to search"),
        },
      },
      async ({ query }) => {
        const q = query.toLowerCase();
        const matches = Object.values(warehouseStock).filter(
          item => item.sku.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                found: matches.length > 0,
                results: matches,
                message: matches.length === 0 ? `No warehouse inventory found for query "${query}".` : undefined,
              }, null, 2),
            },
          ],
        };
      },
    );

    server.registerTool(
      "update_warehouse_bin",
      {
        description: "Updates quantity adjustment or physical aisle/shelf location for a warehouse SKU",
        inputSchema: {
          sku: z.string().describe("SKU identifier"),
          quantityAdjustment: z.number().optional().describe("Delta to adjust (+5 or -3)"),
          newLocation: z.string().optional().describe("New warehouse bin/shelf location"),
        },
      },
      async ({ sku, quantityAdjustment, newLocation }) => {
        let item = warehouseStock[sku];
        if (!item) {
          item = { sku, name: sku, quantity: 0, location: newLocation || "Unassigned" };
          warehouseStock[sku] = item;
        }

        if (quantityAdjustment !== undefined) {
          item.quantity = Math.max(0, item.quantity + quantityAdjustment);
        }
        if (newLocation !== undefined) {
          item.location = newLocation;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                sku: item.sku,
                currentStock: item.quantity,
                location: item.location,
              }, null, 2),
            },
          ],
        };
      },
    );

    server.registerTool(
      "estimate_shipping_rate",
      {
        description: "Estimates shipping carrier rates (Standard, Express, Overnight) for an order weight and destination country",
        inputSchema: {
          weightKg: z.number().describe("Total parcel weight in kg"),
          countryCode: z.string().describe("Two-letter destination country code (e.g., US, CA, GB, IN)"),
        },
      },
      async ({ weightKg, countryCode }) => {
        const baseRate = countryCode.toUpperCase() === "US" ? 8.50 : 18.00;
        const weightMultiplier = Math.max(1, weightKg * 1.5);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                destination: countryCode.toUpperCase(),
                weightKg,
                rates: [
                  { service: "Economy Ground", carrier: "DHL / USPS", costUsd: +(baseRate * weightMultiplier).toFixed(2), etaDays: "4-7 business days" },
                  { service: "Priority Air", carrier: "FedEx", costUsd: +(baseRate * weightMultiplier * 1.6).toFixed(2), etaDays: "2-3 business days" },
                  { service: "Express Overnight", carrier: "UPS", costUsd: +(baseRate * weightMultiplier * 2.8).toFixed(2), etaDays: "Next business day" },
                ],
              }, null, 2),
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

const port = Number(process.env.INVENTORY_MCP_PORT || 3002);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
