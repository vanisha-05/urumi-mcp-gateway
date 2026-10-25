# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build Vite React app
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dashboard package files
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./

# Install ALL deps (incl. vite, tsc)
RUN npm ci --ignore-scripts

# Copy source
COPY apps/dashboard ./

# Build static assets → /app/dist
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Serve with nginx
# ──────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="urumi-dashboard"
LABEL org.opencontainers.image.description="Urumi MCP Gateway — React dashboard served via nginx"

# Remove default nginx html and config
RUN rm -rf /usr/share/nginx/html/*

# Copy built static assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config: serve SPA with proxy_pass to gateway for /api /admin /auth /mcp /user
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
