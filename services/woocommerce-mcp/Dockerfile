# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Compile TypeScript
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests (shared package.json for all services)
COPY package.json package-lock.json tsconfig.json ./

# Install ALL deps including devDependencies (tsc, tsx)
RUN npm ci --ignore-scripts

# Copy WooCommerce MCP source and its dependency (oauth-1.0a already in root)
COPY services/woocommerce-mcp ./services/woocommerce-mcp

# Compile → dist/services/woocommerce-mcp/
RUN npx tsc --outDir dist

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Lean runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="urumi-woocommerce-mcp"
LABEL org.opencontainers.image.description="WooCommerce MCP server — exposes store products and orders as MCP tools"

# Non-root user
RUN addgroup -S urumi && adduser -S urumi -G urumi

WORKDIR /app

# Production dependencies only
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiled output
COPY --from=builder /app/dist/services/woocommerce-mcp ./dist/services/woocommerce-mcp

USER urumi

# Port the Fastify server listens on (must match bootstrap.ts WOOCOMMERCE_MCP_URL default)
EXPOSE 3004

# Health check — woocommerce-mcp exposes /health
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3004/health || exit 1

# Required env vars (injected via Kubernetes Secret / ConfigMap):
#   WOOCOMMERCE_BASE_URL   — e.g. http://urumi-wordpress
#   WOOCOMMERCE_CONSUMER_KEY
#   WOOCOMMERCE_CONSUMER_SECRET
#   MCP_PORT               — optional, defaults to 3004 inside the server code

CMD ["node", "dist/services/woocommerce-mcp/index.js"]
