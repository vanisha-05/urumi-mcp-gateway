# Production VPS (k3s) Deployment Guide

## Overview
The platform uses a single unified Helm chart (`helm/urumi`) for both local development (Kind) and production deployment (k3s VPS). Environment differences are managed purely through Helm values files:
- **Local:** `helm/urumi/values-local.yaml`
- **Production:** `helm/urumi/values-prod.yaml`

## Key Differences Between Local and Production

| Feature | Local (Kind) | Production (k3s VPS) |
|---|---|---|
| **Hostnames** | `localhost` / path routing | Real DNS (e.g. `store.example.com`, `dashboard.example.com`) |
| **TLS / SSL** | Disabled (`tls: false`) | Enabled via `cert-manager` ClusterIssuer (`letsencrypt-prod`) |
| **StorageClass** | `standard` | `local-path` (k3s built-in) or CSI volume |
| **Image Pull Policy** | `Never` (pre-loaded into Kind) | `Always` (pulled from container registry) |
| **Upstream Network Isolation** | NetworkPolicy enabled | NetworkPolicy enabled |
| **Database Credentials** | Local defaults | Strong randomly generated passwords in Secrets |

## Step-by-Step Production Deployment

### 1. Install k3s & Helm on VPS
```bash
curl -sfL https://get.k3s.io | sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### 2. Install cert-manager
```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace --set installCRDs=true
```

### 3. Configure Production Secrets
Create the production secrets with strong randomly generated tokens:
```bash
kubectl create secret generic urumi-gateway-secret \
  --from-literal=GATEWAY_KEY_HMAC_SECRET=$(openssl rand -hex 32) \
  --from-literal=GATEWAY_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --from-literal=GEMINI_API_KEY="your-gemini-api-key"

kubectl create secret generic woo-db-secret \
  --from-literal=mariadb-root-password=$(openssl rand -hex 16) \
  --from-literal=mariadb-password=$(openssl rand -hex 16)

kubectl create secret generic urumi-woocommerce-secret \
  --from-literal=WOOCOMMERCE_BASE_URL="http://urumi-wordpress" \
  --from-literal=WOOCOMMERCE_CONSUMER_KEY="ck_..." \
  --from-literal=WOOCOMMERCE_CONSUMER_SECRET="cs_..."
```

> **Important:** For a fresh installation when `secrets.create=false` (default), all three external Secrets (`urumi-gateway-secret`, `woo-db-secret`, `urumi-woocommerce-secret`) must exist beforehand in the target namespace before running `helm install`. During subsequent `helm upgrade` operations with `secrets.create=false`, the chart automatically discovers existing Secrets in the cluster and preserves their data unchanged.

### 4. Deploy via Helm
```bash
helm upgrade --install urumi ./helm/urumi -f ./helm/urumi/values-prod.yaml
```

### 5. Upgrades & Safe Rollbacks
- **Upgrade:** `helm upgrade urumi ./helm/urumi -f ./helm/urumi/values-prod.yaml`
- **Rollback:** `helm rollback urumi <previous-revision-number>`
- Persistent volumes for MariaDB, WordPress content, and SQLite gateway database are preserved across upgrades and rollbacks.
