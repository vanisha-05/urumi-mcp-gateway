# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build (TypeScript → CommonJS / ESM via tsc)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifest first (gateway shares the root node_modules)
COPY package.json package-lock.json ./

# Install ALL deps (including devDeps needed for tsc)
RUN npm ci --ignore-scripts

# Copy source (only what's needed for the gateway)
COPY tsconfig.json ./
COPY apps/gateway ./apps/gateway

# Compile TypeScript using root tsconfig → dist/apps/gateway/
RUN npx tsc

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Production image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="urumi-gateway"
LABEL org.opencontainers.image.description="Urumi MCP Gateway — aggregates upstream MCP servers behind a single authenticated endpoint"

# Run as non-root
RUN addgroup -S urumi && adduser -S urumi -G urumi

WORKDIR /app

# Copy compiled output from builder
# Only copy the gateway's compiled output
COPY --from=builder /app/dist/apps/gateway ./dist/apps/gateway

# Copy production manifests and install prod deps only
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The SQLite DB lives here — mount a PVC over this path in Kubernetes
RUN mkdir -p /app/data && chown urumi:urumi /app/data
VOLUME ["/app/data"]

USER urumi

EXPOSE 3003

# Health check — gateway exposes /health
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "dist/apps/gateway/src/server.js"]
