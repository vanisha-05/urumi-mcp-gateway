import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  withTimeout,
  McpTimeoutError,
  McpConnectionError,
  classifyMcpError,
  TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  getCachedUpstreamTools,
  getAggregatedTools,
  invalidateToolCache,
  computeUpstreamSignature,
  isToolCacheValid,
  type NamespacedTool,
} from './mcp-client.js';
import type { DbUpstream } from './db.js';

// ── withTimeout ────────────────────────────────────────────────────────────────

describe('withTimeout', () => {
  it('resolves when the promise settles within the deadline', async () => {
    const result = await withTimeout(
      new Promise<string>(resolve => setTimeout(() => resolve('ok'), 10)),
      'fast-op',
      500,
    );
    assert.equal(result, 'ok');
  });

  it('allows slow calls that finish within the configured timeout', async () => {
    // Simulates a WooCommerce call taking ~200 ms against a 500 ms timeout.
    const result = await withTimeout(
      new Promise<number>(resolve => setTimeout(() => resolve(42), 200)),
      'slow-woo',
      500,
    );
    assert.equal(result, 42);
  });

  it('rejects with McpTimeoutError when the deadline is exceeded', async () => {
    await assert.rejects(
      () => withTimeout(
        new Promise<void>(() => { /* never resolves */ }),
        'stuck-op',
        50,
      ),
      (err: unknown) => {
        assert.ok(err instanceof McpTimeoutError);
        assert.ok(err.message.includes('stuck-op'));
        assert.ok(err.message.includes('50ms'));
        assert.equal(err.timeoutMs, 50);
        return true;
      },
    );
  });

  it('propagates the underlying error when the promise rejects before timeout', async () => {
    await assert.rejects(
      () => withTimeout(
        Promise.reject(new Error('upstream boom')),
        'call-op',
        5000,
      ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!(err instanceof McpTimeoutError));
        assert.equal(err.message, 'upstream boom');
        return true;
      },
    );
  });

  it('clears the timer even when the promise rejects', async () => {
    // If the timer leaked we'd see an unhandled rejection from the timeout
    // firing after the promise already rejected.  The test runner will catch
    // unhandled rejections and fail the suite.
    await assert.rejects(
      () => withTimeout(
        Promise.reject(new Error('fast fail')),
        'cleanup-test',
        50,
      ),
    );
    // Wait long enough for a leaked timer to fire.
    await new Promise(r => setTimeout(r, 100));
  });

  it('uses the module default TIMEOUT_MS when no explicit ms is given', () => {
    // The default is set by the env var or 15_000.
    assert.equal(TIMEOUT_MS, 15_000);
  });

  it('exposes a separate, shorter CONNECT_TIMEOUT_MS', () => {
    assert.equal(CONNECT_TIMEOUT_MS, 5_000);
  });
});

// ── McpTimeoutError ────────────────────────────────────────────────────────────

describe('McpTimeoutError', () => {
  it('is an instance of Error with the correct name and fields', () => {
    const err = new McpTimeoutError('callTool list_products', 15000);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof McpTimeoutError);
    assert.equal(err.name, 'McpTimeoutError');
    assert.equal(err.timeoutMs, 15000);
    assert.ok(err.message.includes('callTool list_products'));
    assert.ok(err.message.includes('15000ms'));
  });
});

// ── McpConnectionError ─────────────────────────────────────────────────────────

describe('McpConnectionError', () => {
  it('wraps a cause into a readable message', () => {
    const err = new McpConnectionError('WooCommerce', new Error('ECONNREFUSED'));
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'McpConnectionError');
    assert.ok(err.message.includes('WooCommerce'));
    assert.ok(err.message.includes('ECONNREFUSED'));
  });

  it('handles non-Error cause values', () => {
    const err = new McpConnectionError('Inventory', 'socket hang up');
    assert.ok(err.message.includes('socket hang up'));
  });
});

// ── classifyMcpError ───────────────────────────────────────────────────────────

describe('classifyMcpError', () => {
  it('returns timeout message for McpTimeoutError', () => {
    assert.equal(
      classifyMcpError(new McpTimeoutError('op', 5000)),
      'Gateway upstream timeout',
    );
  });

  it('returns connection message for McpConnectionError', () => {
    assert.equal(
      classifyMcpError(new McpConnectionError('x', 'oops')),
      'Gateway upstream connection failed',
    );
  });

  it('returns generic message for other errors', () => {
    assert.equal(classifyMcpError(new Error('surprise')), 'Gateway tool execution failed');
  });

  it('returns generic message for non-Error values', () => {
    assert.equal(classifyMcpError('a string'), 'Gateway tool execution failed');
    assert.equal(classifyMcpError(null), 'Gateway tool execution failed');
  });
});

// ── Client cleanup on timeout ──────────────────────────────────────────────────

describe('client cleanup', () => {
  it('callers can close a client even after a timeout (no throw from close)', async () => {
    // Simulates the pattern used in routes: withTimeout rejects with
    // McpTimeoutError, and the finally block calls client.close().
    const closeFn = mock.fn(async () => { /* no-op */ });
    const fakeClient = { close: closeFn };

    try {
      await withTimeout(
        new Promise<void>(() => { /* never resolves */ }),
        'tool-exec',
        20,
      );
    } catch {
      // expected
    } finally {
      await fakeClient.close().catch(() => undefined);
    }

    assert.equal(closeFn.mock.calls.length, 1);
  });

  it('close errors are swallowed by the .catch() pattern', async () => {
    const closeFn = mock.fn(async () => { throw new Error('close exploded'); });
    const fakeClient = { close: closeFn };

    // Should not throw
    await fakeClient.close().catch(() => undefined);
    assert.equal(closeFn.mock.calls.length, 1);
  });
});

// ── In-memory Tool Caching & Aggregation ───────────────────────────────────────

describe('tool caching and aggregation', () => {
  const dummyUpstream: DbUpstream = {
    id: 'test-upstream-1',
    name: 'WooCommerce Test',
    url: 'http://localhost:3004/mcp',
    credential_type: 'bearer',
    credential_key: null,
    credential_value_enc: 'enc_token_123',
    enabled: 1,
    created_at: Date.now(),
  };

  const sampleTools: NamespacedTool[] = [
    {
      name: 'test-upstream-1__list_products',
      description: 'List products',
      inputSchema: { type: 'object' },
      _upstreamId: dummyUpstream.id,
      _upstreamName: dummyUpstream.name,
      _originalName: 'list_products',
    },
  ];

  beforeEach(() => {
    invalidateToolCache();
  });

  afterEach(() => {
    invalidateToolCache();
  });

  it('populates cache on first call and serves subsequent call from cache', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return sampleTools;
    };

    const first = await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(first.fromCache, false);
    assert.equal(callCount, 1);
    assert.deepEqual(first.tools, sampleTools);
    assert.equal(isToolCacheValid(dummyUpstream), true);

    const second = await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(second.fromCache, true);
    assert.equal(callCount, 1); // Not called again!
    assert.deepEqual(second.tools, sampleTools);
  });

  it('forceRefresh bypasses cache and updates cached entry', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return sampleTools;
    };

    await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(callCount, 1);

    const refreshed = await getCachedUpstreamTools(dummyUpstream, { fetcher, forceRefresh: true });
    assert.equal(refreshed.fromCache, false);
    assert.equal(callCount, 2);
  });

  it('invalidateToolCache clears cache for specific upstream and all upstreams', async () => {
    const fetcher = async () => sampleTools;
    await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(isToolCacheValid(dummyUpstream), true);

    invalidateToolCache(dummyUpstream.id);
    assert.equal(isToolCacheValid(dummyUpstream), false);

    await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(isToolCacheValid(dummyUpstream), true);

    invalidateToolCache(); // All
    assert.equal(isToolCacheValid(dummyUpstream), false);
  });

  it('invalidates cache when upstream configuration signature changes', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return sampleTools;
    };

    await getCachedUpstreamTools(dummyUpstream, { fetcher });
    assert.equal(callCount, 1);

    // Change the upstream URL
    const mutatedUpstream: DbUpstream = {
      ...dummyUpstream,
      url: 'http://localhost:9999/mcp',
    };

    const result = await getCachedUpstreamTools(mutatedUpstream, { fetcher });
    assert.equal(result.fromCache, false);
    assert.equal(callCount, 2);
  });

  it('refetches when cached tools exceed ttlMs', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return sampleTools;
    };

    await getCachedUpstreamTools(dummyUpstream, { fetcher, ttlMs: 10 });
    assert.equal(callCount, 1);

    // Sleep past TTL
    await new Promise(resolve => setTimeout(resolve, 25));

    const result = await getCachedUpstreamTools(dummyUpstream, { fetcher, ttlMs: 10 });
    assert.equal(result.fromCache, false);
    assert.equal(callCount, 2);
  });

  it('deduplicates concurrent in-flight fetches for the same upstream', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return sampleTools;
    };

    // Fire 3 concurrent requests simultaneously
    const [r1, r2, r3] = await Promise.all([
      getCachedUpstreamTools(dummyUpstream, { fetcher }),
      getCachedUpstreamTools(dummyUpstream, { fetcher }),
      getCachedUpstreamTools(dummyUpstream, { fetcher }),
    ]);

    assert.equal(callCount, 1);
    assert.deepEqual(r1.tools, sampleTools);
    assert.deepEqual(r2.tools, sampleTools);
    assert.deepEqual(r3.tools, sampleTools);
  });

  it('getAggregatedTools fetches multiple upstreams concurrently and handles failures gracefully', async () => {
    const upstream1: DbUpstream = { ...dummyUpstream, id: 'up-1', name: 'Upstream 1' };
    const upstream2: DbUpstream = { ...dummyUpstream, id: 'up-2', name: 'Upstream 2' };
    const upstream3: DbUpstream = { ...dummyUpstream, id: 'up-3', name: 'Upstream 3' };

    const fetcher = async (u: DbUpstream): Promise<NamespacedTool[]> => {
      if (u.id === 'up-3') {
        throw new Error('Connection refused to Upstream 3');
      }
      return [
        {
          name: `${u.id}__tool`,
          description: `Tool for ${u.name}`,
          inputSchema: { type: 'object' as const },
          _upstreamId: u.id,
          _upstreamName: u.name,
          _originalName: 'tool',
        },
      ];
    };

    const warnings: unknown[] = [];
    const logger = {
      info: () => {},
      warn: (obj: unknown) => { warnings.push(obj); },
    };

    const res = await getAggregatedTools([upstream1, upstream2, upstream3], { fetcher, logger });

    assert.equal(res.allTools.length, 2);
    assert.equal(res.toolsMap.size, 2);
    assert.ok(res.toolsMap.has('up-1__tool'));
    assert.ok(res.toolsMap.has('up-2__tool'));
    assert.equal(res.allCached, false);
    assert.ok(res.totalDurationMs >= 0);
    assert.equal(warnings.length, 1);
  });
});
