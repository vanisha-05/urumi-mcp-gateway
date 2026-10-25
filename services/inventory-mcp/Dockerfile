# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Compile TypeScript
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY services/inventory-mcp ./services/inventory-mcp
RUN npx tsc --outDir dist

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Lean runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="urumi-inventory-mcp"
LABEL org.opencontainers.image.description="Warehouse & inventory MCP server — exposes stock check and shipping tools"

RUN addgroup -S urumi && adduser -S urumi -G urumi

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist/services/inventory-mcp ./dist/services/inventory-mcp

USER urumi

EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist/services/inventory-mcp/index.js"]
