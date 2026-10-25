// API Client for Urumi MCP Gateway

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'member';
  created_at?: number;
}

export interface UpstreamServer {
  id: string;
  name: string;
  url: string;
  credential_type: 'header' | 'bearer' | null;
  credential_key: string | null;
  has_credential: boolean;
  enabled: boolean;
  created_at: number;
  status?: 'connected' | 'disabled' | 'unreachable';
  toolCount?: number;
  error?: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  revoked_at: number | null;
}

export interface AuditLogItem {
  id: string;
  user_id: string;
  username: string;
  upstream_id: string;
  upstream_name: string;
  tool_name: string;
  duration_ms: number;
  success: number;
  error_message: string | null;
  called_at: number;
}

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  _upstreamId?: string;
  _upstreamName?: string;
  _originalName?: string;
}

// Remove credentials left by older dashboard versions that used localStorage.
export function clearLegacyStoredApiKey(): void {
  localStorage.removeItem('urumi_api_key');
}

async function responseError(response: Response): Promise<Error> {
  let message = '';
  try {
    const body = await response.json();
    message = body.error || body.message || '';
  } catch { /* non-JSON proxy responses are reported by status below */ }
  if (response.status === 401 && message) return new Error(message);
  return new Error(message ? `Gateway error (${response.status}): ${message}` : `Gateway returned HTTP ${response.status}.`);
}

async function fetchGateway(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { credentials: 'same-origin', ...init });
  } catch {
    throw new Error('Could not reach the Gateway. Check the dashboard proxy and Gateway availability, then try again.');
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (options.body !== undefined && options.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetchGateway(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return response.json();
}

// ── Auth & Profile ────────────────────────────────────────────────────────
export async function verifyApiKey(apiKey: string): Promise<{ user: User }> {
  const response = await fetchGateway('/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json();
}

export async function fetchSession(): Promise<{ user: User }> {
  const response = await fetchGateway('/auth/session');
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function logoutSession(): Promise<void> {
  const response = await fetchGateway('/auth/logout', { method: 'POST' });
  if (!response.ok) throw await responseError(response);
}

export async function getProfile(): Promise<User> {
  return request<User>('/user/me');
}

// ── Upstream Servers ───────────────────────────────────────────────────────
export async function fetchUpstreams(): Promise<UpstreamServer[]> {
  return request<UpstreamServer[]>('/admin/upstreams/status');
}

export async function createUpstream(data: {
  name: string;
  url: string;
  credential_type?: 'header' | 'bearer';
  credential_key?: string;
  credential_value?: string;
}): Promise<UpstreamServer> {
  return request<UpstreamServer>('/admin/upstreams', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function toggleUpstream(id: string, enabled: boolean): Promise<UpstreamServer> {
  return request<UpstreamServer>(`/admin/upstreams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function updateUpstream(id: string, data: {
  name?: string;
  url?: string;
  enabled?: boolean;
  credential_type?: 'header' | 'bearer' | null;
  credential_key?: string | null;
  credential_value?: string | null;
}): Promise<UpstreamServer> {
  return request<UpstreamServer>(`/admin/upstreams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteUpstream(id: string): Promise<void> {
  return request<void>(`/admin/upstreams/${id}`, {
    method: 'DELETE',
  });
}

// ── Users ──────────────────────────────────────────────────────────────────
export async function fetchUsers(): Promise<User[]> {
  return request<User[]>('/admin/users');
}

export async function createUser(data: { username: string; role: 'admin' | 'member' }): Promise<User> {
  return request<User>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return request<void>(`/admin/users/${id}`, {
    method: 'DELETE',
  });
}

// ── API Keys ───────────────────────────────────────────────────────────────
export async function fetchMyKeys(): Promise<ApiKeyItem[]> {
  return request<ApiKeyItem[]>('/user/keys');
}

export async function createMyKey(name?: string): Promise<{ id: string; key: string; name: string }> {
  return request<{ id: string; key: string; name: string }>('/user/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function revokeMyKey(keyId: string): Promise<void> {
  return request<void>(`/user/keys/${keyId}`, {
    method: 'DELETE',
  });
}

export async function fetchUserKeysAdmin(userId: string): Promise<ApiKeyItem[]> {
  return request<ApiKeyItem[]>(`/admin/users/${userId}/keys`);
}

export async function createKeyForUserAdmin(userId: string, name?: string): Promise<{ id: string; key: string; name: string }> {
  return request<{ id: string; key: string; name: string }>(`/admin/users/${userId}/keys`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function revokeKeyAdmin(keyId: string): Promise<void> {
  return request<void>(`/admin/keys/${keyId}`, {
    method: 'DELETE',
  });
}

// ── Audit Logs ─────────────────────────────────────────────────────────────
export async function fetchAuditLogs(limit = 100): Promise<AuditLogItem[]> {
  const result = await request<{ entries: AuditLogItem[] }>(`/admin/audit?limit=${limit}`);
  return result.entries;
}

// ── Tools & Playground ─────────────────────────────────────────────────────
export async function fetchAggregatedTools(): Promise<{ total: number; upstreamsCount: number; tools: ToolDef[] }> {
  return request<{ total: number; upstreamsCount: number; tools: ToolDef[] }>('/api/tools');
}

export async function executeToolCall(toolName: string, args: Record<string, any>): Promise<any> {
  return request<any>('/api/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ toolName, arguments: args }),
  });
}

// ── Chat Agent ─────────────────────────────────────────────────────────────
export async function sendChatMessage(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, apiKey?: string): Promise<{
  role: 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; upstream: string; args: unknown; result: unknown }>;
}> {
  return request<{
    role: 'assistant';
    content: string;
    toolCalls?: Array<{ name: string; upstream: string; args: unknown; result: unknown }>;
  }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, apiKey }),
  });
}
