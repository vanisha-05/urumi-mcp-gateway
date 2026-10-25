# Tool Name Collision Resolution Scheme

## The Problem
When multiple upstream MCP servers are connected to a single gateway, two or more servers may expose a tool with the same identical name (for example, both a WooCommerce MCP server and an Inventory MCP server might expose a tool named `search_products` or `get_status`).

## The Collision Resolution Scheme

To guarantee uniqueness across all upstream servers while maintaining clear provenance, the gateway uses a **deterministic namespacing scheme**:

$$\text{Qualified Tool Name} = \langle\text{upstream\_id}\rangle\text{\_\_}\langle\text{tool\_name}\rangle$$

### Example
- Upstream server 1 (`5fbd8afa-8ab5-4473-9a02-697f15bd25f8`):
  Original name: `create_product`
  Exposed name: `5fbd8afa-8ab5-4473-9a02-697f15bd25f8__create_product`
- Upstream server 2 (`c327f2ed-537e-45cf-9a1d-595d40dced78`):
  Original name: `get_system_health`
  Exposed name: `c327f2ed-537e-45cf-9a1d-595d40dced78__get_system_health`

## Gateway Execution & Routing Logic
When an incoming request (`tools/call` over MCP or `POST /api/tools/execute`) arrives:
1. The gateway parses the tool name by splitting on the double-underscore delimiter (`__`).
2. The prefix identifies the registered upstream server ID in SQLite.
3. The remaining suffix is the exact tool name sent to the upstream MCP client.
4. If an upstream is disabled or unreachable, the gateway immediately returns a clear error without degrading routing to other upstream servers.
5. In dashboard user interfaces, the UI cleanly separates `_upstreamName` and `_originalName` for human readability while executing with the qualified identifier behind the scenes.
