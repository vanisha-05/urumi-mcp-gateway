import OAuth from "oauth-1.0a";
import { createHmac } from "node:crypto";
import dotenv from "dotenv";
import Fastify from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

dotenv.config();

const app = Fastify({ logger: true });

type WooRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

async function wooRequest(
  path: string,
  options: WooRequestOptions = {},
): Promise<unknown> {
  const baseUrl = process.env.WOOCOMMERCE_BASE_URL;
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

  if (!baseUrl || !consumerKey || !consumerSecret) {
    throw new Error(
      "WooCommerce configuration is missing. Check your local environment variables.",
    );
  }

  const method = options.method ?? "GET";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const requestUrl = new URL(
    `${baseUrl.replace(/\/+$/, "")}/wp-json/wc/v3${normalizedPath}`,
  );

  // Collect existing query parameters, such as search and per_page.
  const queryParameters = Object.fromEntries(
    requestUrl.searchParams.entries(),
  );

  // Configure OAuth 1.0a for the WooCommerce REST API.
  // When running inside Kubernetes, baseUrl is http://urumi-wordpress, but WordPress signs
  // requests matching its siteurl (e.g. http://localhost). We sign with the public URL and send Host header.
  const publicBaseUrl = process.env.WOOCOMMERCE_PUBLIC_URL || (baseUrl.includes("urumi-wordpress") ? "http://localhost" : baseUrl);
  const publicUrlObj = new URL(publicBaseUrl);
  const signUrl = `${publicUrlObj.origin}${requestUrl.pathname}`;

  const oauth = new OAuth({
    consumer: {
      key: consumerKey,
      secret: consumerSecret,
    },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, signingKey) {
      return createHmac("sha1", signingKey)
        .update(baseString)
        .digest("base64");
    },
  });

  // Sign the request URL, HTTP method, and query parameters.
  const signedParameters = oauth.authorize({
    url: signUrl,
    method,
    data: queryParameters,
  });

  // Add the OAuth parameters to the query string.
  for (const [key, value] of Object.entries(signedParameters)) {
    requestUrl.searchParams.set(key, String(value));
  }

  const response = await fetch(requestUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Host": publicUrlObj.host,
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : response.statusText;

    throw new Error(
      `WooCommerce API error (${response.status}): ${message}`,
    );
  }

  return result;
}

function toolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const orderStatuses = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "woocommerce-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "list_products",
    {
      description: "List WooCommerce products, optionally searching by name or filtering by status.",
      inputSchema: {
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(100).optional(),
        status: z.enum(["any", "draft", "pending", "private", "publish"]).optional(),
      },
    },
    async ({ search, page, per_page, status }) => {
      const params = new URLSearchParams();

      if (search) params.set("search", search);
      if (page) params.set("page", String(page));
      if (status) params.set("status", status);
      params.set("per_page", String(per_page ?? 10));

      const data = await wooRequest(`/products?${params}`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "get_product",
    {
      description: "Retrieve a WooCommerce product by its numeric ID.",
      inputSchema: {
        product_id: z.number().int().positive(),
      },
    },
    async ({ product_id }) => {
      const data = await wooRequest(`/products/${product_id}`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a WooCommerce product.",
      inputSchema: {
        name: z.string().min(1),
        regular_price: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["draft", "publish"]).optional(),
      },
    },
    async ({ name, regular_price, description, status }) => {
      const data = await wooRequest("/products", {
        method: "POST",
        body: {
          name,
          regular_price,
          description: description ?? "",
          status: status ?? "draft",
          type: "simple",
        },
      });

      return toolResult(data);
    },
  );

  server.registerTool(
    "update_product",
    {
      description: "Update an existing WooCommerce product.",
      inputSchema: {
        product_id: z.number().int().positive(),
        name: z.string().optional(),
        regular_price: z.string().optional(),
        sale_price: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["draft", "publish", "private", "pending"]).optional(),
      },
    },
    async ({ product_id, ...updates }) => {
      const data = await wooRequest(`/products/${product_id}`, {
        method: "PUT",
        body: updates,
      });

      return toolResult(data);
    },
  );

  server.registerTool(
    "delete_product",
    {
      description: "Delete a WooCommerce product by its numeric ID.",
      inputSchema: {
        product_id: z.number().int().positive(),
        force: z.boolean().optional(),
      },
    },
    async ({ product_id, force }) => {
      const params = force ? "?force=true" : "";
      const data = await wooRequest(`/products/${product_id}${params}`, {
        method: "DELETE",
      });

      return toolResult(data);
    },
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List WooCommerce orders. Optional ISO dates filter order creation time.",
      inputSchema: {
        status: z.enum(orderStatuses).optional(),
        after: z.string().optional(),
        before: z.string().optional(),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ status, after, before, page, per_page }) => {
      const params = new URLSearchParams();

      if (status) params.set("status", status);
      if (after) params.set("after", after);
      if (before) params.set("before", before);
      if (page) params.set("page", String(page));

      params.set("per_page", String(per_page ?? 10));

      const data = await wooRequest(`/orders?${params}`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Retrieve a WooCommerce order by its numeric ID.",
      inputSchema: {
        order_id: z.number().int().positive(),
      },
    },
    async ({ order_id }) => {
      const data = await wooRequest(`/orders/${order_id}`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "create_order",
    {
      description: "Create a new WooCommerce order.",
      inputSchema: {
        status: z.enum(orderStatuses).optional(),
        billing: z
          .object({
            first_name: z.string().optional(),
            last_name: z.string().optional(),
            email: z.string().optional(),
          })
          .optional(),
        line_items: z.array(
          z.object({
            product_id: z.number().int().positive(),
            quantity: z.number().int().positive(),
          }),
        ),
      },
    },
    async (orderData) => {
      const data = await wooRequest("/orders", {
        method: "POST",
        body: orderData,
      });

      return toolResult(data);
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Update the status of a WooCommerce order.",
      inputSchema: {
        order_id: z.number().int().positive(),
        status: z.enum(orderStatuses),
      },
    },
    async ({ order_id, status }) => {
      const data = await wooRequest(`/orders/${order_id}`, {
        method: "PUT",
        body: { status },
      });

      return toolResult(data);
    },
  );

  return server;
}

app.get("/health", async () => {
  return {
    status: "ok",
    service: "woocommerce-mcp",
  };
});

app.get("/", async () => {
  return {
    status: "ok",
    service: "woocommerce-mcp",
  };
});

app.route({
  method: ["GET", "POST", "DELETE"],
  url: "/mcp",
  handler: async (request, reply) => {
    const server = createMcpServer();
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
  },
});

const port = Number(process.env.WOOCOMMERCE_MCP_PORT || process.env.PORT || 3004);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});