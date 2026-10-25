# Local Domain Approach & Ingress Routing

## Overview
This platform is designed to run seamlessly on local Kubernetes clusters (Kind, k3d, Minikube) and VPS production environments (k3s) using the same ingress-nginx controller and unified Helm templates.

## Architecture

```
                       Client Browser / MCP Clients
                                    │
                                    ▼
                         Kind Ingress (Port 80)
                       [ingressClassName: nginx]
                                    │
     ┌──────────────────────────────┼──────────────────────────────┐
     │                              │                              │
     ▼                              ▼                              ▼
Path: /                        Path: /dashboard               Paths: /mcp, /api, /auth,
Host: localhost                Host: localhost                       /admin, /user, /health
Service: urumi-wordpress:80    Service: urumi-dashboard:80     Host: localhost
                                                              Service: urumi-gateway:3003
```

## Local Domain Resolution

### 1. Default Setup (localhost)
On Kind, port 80 of the host machine is forwarded directly into the ingress-nginx controller via extra port mappings in `kind-config.yaml`:
```yaml
extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
```
Using the default `values-local.yaml`:
- **Storefront:** `http://localhost/` (serves WordPress & WooCommerce)
- **Dashboard:** `http://localhost/dashboard` (serves the React UI)
- **Gateway MCP Endpoint:** `http://localhost/mcp` (Streamable HTTP for external MCP clients)
- **Gateway REST Endpoints:** `http://localhost/auth`, `http://localhost/api`, `http://localhost/admin`

### 2. Virtual Host Setup (Optional Custom Domains)
If preferred, you can map dedicated local domains in your host's `hosts` file (`C:\Windows\System32\drivers\etc\hosts` or `/etc/hosts`):
```text
127.0.0.1  store.local dashboard.local gateway.local
```
Then update `values-local.yaml`:
```yaml
wordpress:
  host: store.local

dashboard:
  host: dashboard.local
  path: /
```

## Production Delta (`values-prod.yaml`)
When deploying to a public VPS (e.g. k3s):
1. **Hostnames:** Replace `localhost` with real domain names (e.g. `store.example.com`, `dashboard.example.com`).
2. **TLS Termination:** Set `ingress.tls: true` and specify `certIssuer: letsencrypt-prod` for automatic Let's Encrypt certificates managed by cert-manager.
3. **StorageClass:** Change `storageClassName` from `standard` (Kind) to `local-path` (k3s default) or cloud persistent disk (`gp2`, `cbs`).
