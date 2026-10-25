import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DbUpstream } from './db.js';
import { decryptCredential } from './crypto.js';

// ── Configurable timeouts ──────────────────────────────────────────────────────
// Tool execution timeout: covers the full callTool / listTools round-trip to the
// upstream MCP server.  WooCommerce requests regularly take 1–4 s; 15 s gives
// comfortable headroom without masking genuine hangs.
export const TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS) || 15_000;

// Connection timeout: just the initial HTTP+MCP handshake.  This should be fast;
// if an upstream is unreachable we want to fail quickly rather than burn the full
// tool timeout waiting for a SYN.
export const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS) || 5_000;

// ── Error classes ──────────────────────────────────────────────────────────────

/** Thrown when an MCP operation exceeds its deadline. */
export class McpTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'McpTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when the gateway cannot establish a connection to an upstream. */
export class McpConnectionError extends Error {
  constructor(upstreamName: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to connect to upstream ${upstreamName}: ${detail}`);
    this.name = 'McpConnectionError';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Race a promise against a timeout; always clears the timer. */
export async function withTimeout<T>(
  p: Promise<T>,
  label: string,
  ms: number = TIMEOUT_MS,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(
          () => reject(new McpTimeoutError(label, ms)),
          ms,
        );
      }),
    ]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

/** Classify an error into a safe, user-facing audit message. */
export function classifyMcpError(err: unknown): string {
  if (err instanceof McpTimeoutError) return 'Gateway upstream timeout';
  if (err instanceof McpConnectionError) return 'Gateway upstream connection failed';
  return 'Gateway tool execution failed';
}

/** Build extra request headers from the upstream credential config. */
function credentialHeaders(upstream: DbUpstream): Record<string, string> {
  if (!upstream.credential_type || !upstream.credential_value_enc) return {};
  const value = decryptCredential(upstream.credential_value_enc);
  if (upstream.credential_type === 'bearer') {
    return { Authorization: `Bearer ${value}` };
  }
  // type === 'header'
  return { [upstream.credential_key ?? 'X-Api-Key']: value };
}

/** Connect an MCP client to an upstream server (caller must close). */
export async function connectUpstream(upstream: DbUpstream): Promise<Client> {
  const client = new Client({ name: 'urumi-gateway', version: '1.0.0' });
  const headers = credentialHeaders(upstream);
  const requestInit: RequestInit | undefined =
    Object.keys(headers).length > 0 ? { headers } : undefined;

  try {
    await withTimeout(
      client.connect(
        new StreamableHTTPClientTransport(new URL(upstream.url), {
          requestInit,
        }),
      ),
      `connect ${upstream.name}`,
      CONNECT_TIMEOUT_MS,
    );
    return client;
  } catch (err) {
    // Always close the client on connection failure to prevent resource leaks.
    await client.close().catch(() => undefined);
    // Wrap non-timeout connection errors so callers can distinguish them.
    if (err instanceof McpTimeoutError) throw err;
    throw new McpConnectionError(upstream.name, err);
  }
}

/** A tool annotated with its upstream provenance. */
export type NamespacedTool = Tool & {
  _upstreamId: string;
  _upstreamName: string;
  _originalName: string;
};

/**
 * List tools from one upstream, prefixing each tool name with
 * `<upstreamId>__` to ensure global uniqueness across the gateway.
 */
export async function listUpstreamTools(
  upstream: DbUpstream,
): Promise<NamespacedTool[]> {
  const client = await connectUpstream(upstream);
  try {
    const { tools } = await withTimeout(
      client.listTools(),
      `listTools ${upstream.name}`,
    );
    return tools.map(tool => ({
      ...tool,
      name: `${upstream.id}__${tool.name}`,
      _upstreamId: upstream.id,
      _upstreamName: upstream.name,
      _originalName: tool.name,
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

// ── In-memory Tool Definition Cache ──────────────────────────────────────────

export const TOOL_CACHE_TTL_MS = Number(process.env.MCP_TOOL_CACHE_TTL_MS) || 300_000; // 5 minutes default

interface CachedUpstreamTools {
  tools: NamespacedTool[];
  fetchedAt: number;
  configSignature: string;
}

const toolCache = new Map<string, CachedUpstreamTools>();
const inFlightFetches = new Map<string, Promise<NamespacedTool[]>>();

/** Compute signature to detect configuration mutations on an upstream. */
export function computeUpstreamSignature(upstream: DbUpstream): string {
  return `${upstream.id}:${upstream.name}:${upstream.url}:${upstream.credential_type ?? ''}:${upstream.credential_key ?? ''}:${upstream.credential_value_enc ?? ''}:${upstream.enabled}`;
}

/**
 * Invalidate the in-memory tool cache.
 * When upstreamId is provided, invalidates that upstream only.
 * When omitted, invalidates the entire cache.
 */
export function invalidateToolCache(upstreamId?: string): void {
  if (upstreamId) {
    toolCache.delete(upstreamId);
    inFlightFetches.delete(upstreamId);
  } else {
    toolCache.clear();
    inFlightFetches.clear();
  }
}

/** Check if tools for an upstream are currently cached and valid. */
export function isToolCacheValid(upstream: DbUpstream, ttlMs = TOOL_CACHE_TTL_MS): boolean {
  const cached = toolCache.get(upstream.id);
  if (!cached) return false;
  if (cached.configSignature !== computeUpstreamSignature(upstream)) return false;
  return Date.now() - cached.fetchedAt < ttlMs;
}

/**
 * Retrieve cached tools for an upstream server, or fetch from upstream if
 * absent/expired/invalidated. Concurrent calls for the same upstream are deduplicated.
 */
export async function getCachedUpstreamTools(
  upstream: DbUpstream,
  options?: {
    forceRefresh?: boolean;
    ttlMs?: number;
    fetcher?: (upstream: DbUpstream) => Promise<NamespacedTool[]>;
  },
): Promise<{ tools: NamespacedTool[]; fromCache: boolean; durationMs: number }> {
  const ttl = options?.ttlMs ?? TOOL_CACHE_TTL_MS;
  const signature = computeUpstreamSignature(upstream);
  const now = Date.now();
  const fetcher = options?.fetcher ?? listUpstreamTools;

  if (!options?.forceRefresh) {
    const cached = toolCache.get(upstream.id);
    if (cached && cached.configSignature === signature && now - cached.fetchedAt < ttl) {
      return { tools: cached.tools, fromCache: true, durationMs: 0 };
    }
  }

  // Deduplicate in-flight requests for the same upstream
  const existingFetch = inFlightFetches.get(upstream.id);
  if (existingFetch && !options?.forceRefresh) {
    const t0 = performance.now();
    const tools = await existingFetch;
    return {
      tools,
      fromCache: true,
      durationMs: Math.round((performance.now() - t0) * 100) / 100,
    };
  }

  const t0 = performance.now();
  const fetchPromise = (async () => {
    try {
      const tools = await fetcher(upstream);
      toolCache.set(upstream.id, {
        tools,
        fetchedAt: Date.now(),
        configSignature: signature,
      });
      return tools;
    } finally {
      inFlightFetches.delete(upstream.id);
    }
  })();

  inFlightFetches.set(upstream.id, fetchPromise);
  const tools = await fetchPromise;
  const durationMs = Math.round((performance.now() - t0) * 100) / 100;
  return { tools, fromCache: false, durationMs };
}

export interface AggregatedToolsResult {
  allTools: NamespacedTool[];
  toolsMap: Map<string, { upstream: DbUpstream; originalName: string; tool: NamespacedTool }>;
  allCached: boolean;
  totalDurationMs: number;
}

/**
 * Retrieve tools across all enabled upstreams in parallel using the in-memory cache.
 * Avoids repeated round-trips and reduces latency by running cache misses concurrently.
 */
export async function getAggregatedTools(
  upstreams: DbUpstream[],
  options?: {
    forceRefresh?: boolean;
    ttlMs?: number;
    fetcher?: (upstream: DbUpstream) => Promise<NamespacedTool[]>;
    logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  },
): Promise<AggregatedToolsResult> {
  const t0 = performance.now();
  const allTools: NamespacedTool[] = [];
  const toolsMap = new Map<string, { upstream: DbUpstream; originalName: string; tool: NamespacedTool }>();

  let allCached = true;
  const results = await Promise.allSettled(
    upstreams.map(async upstream => {
      const result = await getCachedUpstreamTools(upstream, options);
      return { upstream, ...result };
    }),
  );

  for (let i = 0; i < upstreams.length; i++) {
    const upstream = upstreams[i]!;
    const res = results[i]!;
    if (res.status === 'fulfilled') {
      if (!res.value.fromCache) allCached = false;
      for (const t of res.value.tools) {
        allTools.push(t);
        toolsMap.set(t.name, { upstream, originalName: t._originalName, tool: t });
      }
    } else {
      allCached = false;
      options?.logger?.warn(
        { upstreamId: upstream.id, upstreamName: upstream.name, err: res.reason },
        'Failed to list tools from upstream during aggregation',
      );
    }
  }

  const totalDurationMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    allTools,
    toolsMap,
    allCached,
    totalDurationMs,
  };
}
