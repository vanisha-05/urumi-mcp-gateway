# Custom WooCommerce MCP Server Design & Communication

## Overview
The WooCommerce MCP server (`services/woocommerce-mcp`) is a custom-built, in-cluster MCP server that exposes store management capabilities as standard Model Context Protocol (MCP) tools over Streamable HTTP (`/mcp`).

## Communication Choice: REST API with OAuth 1.0a vs. WP-CLI

### Why WooCommerce REST API with OAuth 1.0a was Chosen:
1. **Stateless HTTP Architecture:** The MCP server operates as an autonomous microservice in its own pod. Calling the REST API allows native asynchronous HTTP communication without shared file mounts or `kubectl exec` / SSH overhead.
2. **Cluster Isolation:** Pods run in separate security contexts. The MCP server does not need direct disk or database access to the WordPress container, enforcing the principle of least privilege.
3. **High Concurrency & Evented I/O:** Fastify and Node.js handle concurrent tool executions with sub-second latency, avoiding the process-forking overhead of spawning `wp` CLI subshells for every product or order lookup.
4. **Official Supported Schema:** WooCommerce REST API v3 returns standard, strongly-typed JSON resources that map 1:1 to MCP tool schemas.

### Why Not WP-CLI:
- WP-CLI requires either mounting the entire WordPress filesystem into the MCP pod or granting cluster-wide Kubernetes API access to execute commands inside the WordPress container.
- High memory and CPU consumption due to booting the full WordPress PHP runtime on every tool call.

## Security & Network Isolation
Per the specification:
1. **No External Ingress:** The `urumi-woocommerce-mcp` service is strictly of type `ClusterIP` and has no external Ingress rules.
2. **Kubernetes NetworkPolicy:** A dedicated NetworkPolicy (`urumi-woocommerce-mcp-netpol`) enforces that only pods labeled `app: urumi-gateway` can connect to port `3004`. All other pod and external traffic is blocked.
3. **Encrypted Credentials:** Consumer keys and secrets are stored in Kubernetes Secrets (`urumi-woocommerce-secret`) and mounted as environment variables.

## Supported Tools
- `list_products`: List and search products with optional keyword and pagination filters.
- `get_product`: Retrieve product by ID.
- `create_product`: Create a new product with name, price, description, and publish status.
- `update_product`: Update prices, descriptions, and statuses.
- `delete_product`: Permanently delete products.
- `list_orders`: Retrieve store orders with status and date filters.
- `get_order`: Retrieve detailed order by ID.
- `create_order`: Create new store orders with customer and line items.
- `update_order_status`: Change order status (`processing`, `completed`, `cancelled`, etc.).
