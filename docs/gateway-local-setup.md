# Local gateway setup

1. Copy `.env.example` to `.env` if you need the documented local settings.
2. Run `npm run setup:secrets` from the repository root. It creates cryptographically random values for missing `GATEWAY_KEY_HMAC_SECRET` and `GATEWAY_ENCRYPTION_KEY` entries in the ignored `.env` file. It does not print values or replace configured entries. Keep this file private and back up both values; changing either value makes stored API-key hashes or encrypted upstream credentials unreadable.
3. Start the gateway with `npm run start:gateway`.
4. In a separate terminal, run `npm run provision:admin` to provision an API key for the default admin. The CLI adds a new key and displays it once in that terminal. Save it securely. This is a local operator command; it is not exposed by an HTTP route and it never revokes existing keys.

The gateway requires both crypto variables. `GATEWAY_PORT` defaults to `3003`; when set, it must be an integer from 1 through 65535. `GATEWAY_DB_PATH` defaults to `./data/gateway.db`. The three MCP URLs are optional and default to the local service URLs listed in `.env.example`. The WooCommerce MCP process separately requires its store URL and API credentials.

If an earlier failed start left the `admin` user without an API key, do not delete the user or database. Start the gateway normally, then run the local provisioning command above. It attaches a new key to that existing admin without changing any existing key. For another admin username, run `npm run provision:admin -- admin-username`.

The first-start user and default upstream records are committed in one SQLite transaction. Repeated starts retain existing users, keys, and upstreams; missing default upstream entries are added without duplicating existing names. Startup logs do not contain API keys or secret values.

## Dashboard gateway and session

The Vite dashboard at `http://localhost:5173/` proxies Gateway requests to `http://localhost` by default. In the Kind setup, this is the ingress on port 80 and routes requests to the in-cluster `urumi-gateway` service and its configured SQLite PVC. This matches `http://localhost/dashboard/`. To use a separately hosted Gateway instead, set `VITE_GATEWAY_ORIGIN` for the Vite process (for example, `http://localhost:3003`).

Dashboard login exchanges the API key for a seven-day, signed, HttpOnly cookie containing only the API key ID. The raw API key is not stored in browser storage. The Gateway checks the referenced key is still active on each authenticated request, so revocation immediately invalidates existing dashboard sessions. Logout expires the browser cookie. The cookie remains a bearer credential if stolen; HttpOnly prevents JavaScript from reading it, and SameSite=Lax limits cross-site sending. Production deployments should serve the dashboard over HTTPS so the Gateway can mark the cookie Secure. Local Kind HTTP sets no Secure attribute so the cookie works on localhost.
