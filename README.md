# Urumi MCP Gateway

## Architecture and local URLs

The custom React/Vite application is served by the `urumi-dashboard` Kubernetes Deployment. In the local Kind ingress, the dashboard is at **http://localhost/dashboard/** and the separate WordPress/WooCommerce storefront is at **http://localhost/**. The shared gateway MCP endpoint is **http://localhost/mcp**. The dashboard API and MCP upstream services are cluster services; upstream MCP servers are not intended as client endpoints.

WordPress uses the MariaDB service and persistent claims for its database and content. The custom WooCommerce MCP service calls the WooCommerce REST API using server-side credentials. The gateway calls the WooCommerce, system, and inventory MCP services over cluster networking. Ingress routes `/mcp` and gateway APIs to the gateway, `/dashboard` to the React app, and `/` to WordPress.

The existing React styling and account, chat, and tool inspection views remain. The dashboard now opens on gateway tools. WooCommerce browsing and checkout belong to WordPress. The dashboard no longer presents local fake checkout orders or fabricated tool results as real store data.

## Current cluster observed

The configured Kind context is `kind-urumi-cluster`. Helm releases exist in both `default` and `urumi`. The original `default` WordPress/MariaDB deployment and claims are a protected recovery source. Do not uninstall or reset it. The `urumi` namespace also has bound database, content, and gateway claims. The local-path PV reclaim policy is `Delete`, so never uninstall this release or delete its claims as a cleanup step.

The ingress controller maps host ports 80 and 443. The storefront, dashboard, dashboard JavaScript/CSS assets, and gateway health URL returned HTTP 200 after the dashboard rollout. The live Vite process on port 5173 was not running when inspected. The updated dashboard image `urumi/dashboard:recovery-20261011` was loaded into Kind and applied directly to the `urumi` dashboard Deployment. The Deployment became Ready. The Helm release itself was not upgraded, and the protected `default` namespace was not changed. Roll the dashboard back with `kubectl rollout undo deployment/urumi-dashboard -n urumi`; reconcile the image change in a later reviewed Helm deployment.

The prior database import was **not repeated**. Read-only checks found 98 tables in both `default` and `urumi`, matching product rows (IDs 16 and 19), and a matching order row (ID 20), with the expected WordPress URLs and WooCommerce settings. This is strong evidence that the attempted import populated `urumi`, but it is not a full row-by-row proof. The SQL backups and content archive in Documents were preserved. WooCommerce's active plugin files were restored only into the `urumi` WordPress content volume from the verified archive; the `default` namespace and its data were not changed.

## Build and chart validation

From the repository root:

```powershell
npm.cmd run build:dashboard
npm.cmd run test:gateway-bootstrap
helm template urumi helm/urumi -f helm/urumi/values-local.yaml --namespace urumi
helm template urumi helm/urumi -f helm/urumi/values-prod.yaml --namespace urumi
```

The dashboard build and five gateway bootstrap tests were completed at the prior checkpoint. Both Helm renders have since been rerun successfully. Current checks returned HTTP 200 for the dashboard, storefront, WooCommerce Store API products, and gateway health. The chart was not applied as an upgrade; dashboard and gateway recovery images were rolled out directly to their Deployments. The Helm release therefore does not yet describe those image tags.

## Secrets and deployments

Do not put database passwords, WooCommerce REST credentials, gateway crypto keys, or an LLM key in values files or source control. The chart defines a safe secret lifecycle:
- **`secrets.create=false` (default):**
  - **Upgrade:** The chart performs a Kubernetes cluster lookup for existing Secret resources (`urumi-gateway-secret`, `woo-db-secret`, `urumi-woocommerce-secret`) in the release namespace and preserves their existing data unchanged under the exact same names and keys. This prevents Helm from deleting existing Secrets or wiping out working credentials with empty strings.
  - **Fresh installation:** Requires external Secrets (`urumi-gateway-secret`, `woo-db-secret`, `urumi-woocommerce-secret`) to be provisioned out-of-band beforehand in the target namespace before running `helm install`.
  - **Offline validation:** Cluster lookups return empty during client-side `helm template`, omitting the Secret resources so template linting and rendering succeed cleanly without errors.
- **`secrets.create=true`:** Secrets are created directly from explicitly supplied configuration passed via CLI or secure values files.

A chart upgrade must be reviewed against the existing Helm release first. Never run `helm uninstall` for either current release.

For a safe upgrade, first back up the gateway SQLite PVC and confirm the WordPress and MariaDB claims remain bound. Render the exact chart and values, inspect the diff with `helm diff` if available, and verify using a server-side dry run (`helm upgrade --dry-run=server --hide-secret urumi ./helm/urumi -n urumi -f ./helm/urumi/values-local.yaml`) that existing Secret objects will be retained and PVC names and storage settings do not change. Use `helm rollback urumi <revision> -n urumi` if an application upgrade fails; do not assume rollback restores changed database contents. Production uses the same chart with `helm/urumi/values-prod.yaml`, real hostnames, TLS, and the k3s storage class. Set up external secrets for that cluster before deploying.

## Recovery acceptance results

The custom WooCommerce MCP service is a private `ClusterIP` service on port 3004, with an Ingress network policy allowing gateway pods. Its required product/order tools were exercised against the live WooCommerce REST API. The gateway exposes one Streamable HTTP endpoint at `http://localhost/mcp`; its upstream tool names use `<upstream UUID>__<tool name>` prefixes.

## Local demo flow

1. Open the dashboard at `http://localhost/dashboard/` and issue or use a member API key. Keys are shown only when issued; members can manage their own keys in the dashboard.
2. In dashboard chat, ask: `Create a product named "Demo Product" with price 25`.
3. Open `http://localhost/`, find the product, add it to the cart, and complete checkout using Cash on Delivery.
4. Ask chat: `Show today's orders and check warehouse stock for SKU-100`. The response shows the WooCommerce and inventory tool calls and results; their audit entries are associated with the logged-in user.
5. An external MCP client should use only `http://localhost/mcp` with the member's `Authorization: Bearer <member API key>` header. Do not configure upstream service URLs or credentials in that client.

Real store data was created and queried during acceptance: MCP created product ID 21 (INR 10); the storefront Store API cart and COD checkout created order ID 22; MCP listed the order and changed its status to on-hold. The authenticated chat agent created product ID 23 (INR 11), visible through the storefront product API. The chat also called WooCommerce orders and inventory stock tools in one request. These acceptance records remain in the store.

The gateway returned tools from WooCommerce, System & Utilities, and Warehouse & Inventory. An authenticated MCP client discovered and called tools through the gateway; it never connected to an upstream URL. Admin/member role enforcement, hashed API-key storage, one-time key issuance, revocation (the next request returned 401), and member attribution on successful audit rows were checked. A temporary duplicate registration confirmed tool names stay unique through UUID prefixes; add, edit, disable, and remove controls were exercised. A dead temporary URL became `unreachable` without hiding unrelated tools. A disabled upstream disappeared from discovery and rejected direct invocation. Stopping the enabled system MCP pod made its status `unreachable`; WooCommerce and inventory remained connected. A disabled-tool call produced a failure audit row, and rejected key requests produced secret-free security log entries.

## Remaining limitations and safe deployment notes

- No `GEMINI_API_KEY` is configured. The deployed chat uses its deterministic local intent router for product/order/inventory requests. Arbitrary LLM reasoning has not been tested; configure the key as a Kubernetes Secret only if needed. Do not send it from the browser.
- Per-user tool-level allow/deny permissions are not implemented; admin/member role checks are enforced, and authenticated members currently discover the enabled upstream tool set.
- The protocol-level client queried orders and exercised tools across multiple upstreams in the same gateway session. A separate third-party MCP Inspector/Claude/Cursor installation and a natural-language external multi-tool prompt were not tested.
- Local and production-like Helm values render, but no full Helm upgrade or k3s deployment was performed. Reconcile the directly applied recovery image tags in a reviewed Helm change before relying on a Helm rollback to represent the running workloads.
- Every current PV is Bound and has reclaim policy `Delete`. Do not uninstall either Helm release, delete claims/PVs, or clean namespaces. The original `default` store is a protected recovery source.
- The MariaDB Deployment has readiness and resource settings but no liveness probe. Other current workloads have readiness/liveness probes and resource requests/limits.
- Rotate any credential that may have been exposed previously. No credential value is included here. Production still needs real DNS, TLS/issuer configuration, a storage class, and externally provisioned Kubernetes Secrets.

No database import, PVC/PV deletion, namespace deletion, production rollout, or frontend change was performed in this continuation.
