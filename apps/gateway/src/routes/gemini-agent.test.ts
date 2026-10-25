import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbUpstream } from '../db.js';
import type { NamespacedTool } from '../mcp-client.js';
import {
  executeGeminiAgent,
  GeminiAgentError,
  functionName,
  toGeminiSchema,
  type GeminiToolTarget,
} from './gemini-agent.js';

const upstream = { id: '7cc6f345-367b-47e7-8105-1ca095bc50a4', name: 'WooCommerce' } as DbUpstream;
const systemUpstream = { id: '2553dc69-7009-4f78-b2df-cd670c97b8a2', name: 'System' } as DbUpstream;

const productTool = {
  upstream,
  originalName: 'list_products',
  tool: {
    name: '7cc6f345-367b-47e7-8105-1ca095bc50a4__list_products',
    _upstreamId: '7cc6f345-367b-47e7-8105-1ca095bc50a4',
    _upstreamName: 'WooCommerce',
    _originalName: 'list_products',
    description: 'List products using optional search and per-page limit.',
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  } as NamespacedTool,
} satisfies GeminiToolTarget;

const systemHealthTool = {
  upstream: systemUpstream,
  originalName: 'get_system_health',
  tool: {
    name: '2553dc69-7009-4f78-b2df-cd670c97b8a2__get_system_health',
    _upstreamId: '2553dc69-7009-4f78-b2df-cd670c97b8a2',
    _upstreamName: 'System',
    _originalName: 'get_system_health',
    description: 'Get current system health status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  } as NamespacedTool,
} satisfies GeminiToolTarget;

function harness(
  responses: unknown[],
  options?: {
    executeTool?: (target: GeminiToolTarget, args: Record<string, unknown>) => Promise<unknown>;
    tools?: GeminiToolTarget[];
    user?: { id: string; username: string };
  },
) {
  const requests: any[] = [];
  const requestMetadata: Array<{ url: string; headers: Headers }> = [];
  const audits: unknown[][] = [];
  const executed: Array<{ target: GeminiToolTarget; args: Record<string, unknown> }> = [];

  const fetcher: typeof fetch = async (_input, init) => {
    requestMetadata.push({ url: String(_input), headers: new Headers(init?.headers) });
    requests.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const db = {
    prepare: () => ({
      run: (...params: unknown[]) => {
        audits.push(params);
      },
    }),
  };

  const defaultExecuteTool = async (target: GeminiToolTarget, args: Record<string, unknown>) => {
    executed.push({ target, args });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify([{ id: 23, name: 'Orbit Camera', price: '1499.00' }]),
        },
      ],
    };
  };

  const executeTool = options?.executeTool ?? defaultExecuteTool;
  const user = options?.user ?? { id: 'user-17', username: 'member-17' };
  const tools = options?.tools ?? [productTool];

  const run = (messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) =>
    executeGeminiAgent({
      apiKey: 'test-only-key',
      messages: messages ?? [
        { role: 'user', content: 'Fetch the latest 3 products and show their names and prices.' },
      ],
      tools,
      user,
      db,
      executeTool,
      fetcher,
    });

  return { run, requests, requestMetadata, audits, executed };
}

const functionCall = (args: unknown, name?: string, id = 'call_test_123') => ({
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: name ?? functionName(productTool),
              args,
              id,
            },
          },
        ],
      },
    },
  ],
});

test('simple final text response without tool call', async () => {
  const h = harness([
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello! I can help you manage your store.' }],
          },
        },
      ],
    },
  ]);
  const result = await h.run([{ role: 'user', content: 'Hello' }]);
  assert.equal(result.content, 'Hello! I can help you manage your store.');
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.turns, 1);
  assert.equal(h.executed.length, 0);
  assert.equal(h.audits.length, 0);
});

test('valid model tool arguments execute selected tool and preserve functionCall id and name in response', async () => {
  const expectedFnName = functionName(productTool);
  const h = harness([
    functionCall({ per_page: 3 }, expectedFnName, 'call_abc_456'),
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Found 1 product: Orbit Camera (₹1,499.00).' }],
          },
        },
      ],
    },
  ]);
  const result = await h.run();
  assert.equal(h.executed.length, 1);
  assert.equal(h.executed[0]?.target.originalName, 'list_products');
  assert.deepEqual(h.executed[0]?.args, { per_page: 3 });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.turns, 2);

  // Check declaration schema
  const schema = h.requests[0].tools[0].functionDeclarations[0].parameters;
  assert.equal('function_declarations' in h.requests[0].tools[0], false);
  assert.equal(schema.type, 'OBJECT');
  assert.equal(schema.properties.per_page.type, 'INTEGER');
  assert.equal('additionalProperties' in schema, false);

  // Verify functionCall id and name matching in the follow-up turn
  const secondContents = h.requests[1].contents;
  assert.equal(secondContents[1].role, 'model');
  assert.equal(secondContents[2].role, 'user');
  const responsePart = secondContents[2].parts[0].functionResponse;
  assert.equal(responsePart.name, expectedFnName);
  assert.equal(responsePart.id, 'call_abc_456');
  assert.deepEqual(responsePart.response.result, {
    content: [{ id: 23, name: 'Orbit Camera', price: '1499.00' }],
    isError: false,
  });
});

test('multiple parallel tool calls are matched by their respective IDs and names', async () => {
  const prodFnName = functionName(productTool);
  const sysFnName = functionName(systemHealthTool);

  const h = harness(
    [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: prodFnName,
                    args: { per_page: 2 },
                    id: 'call_prod_001',
                  },
                },
                {
                  functionCall: {
                    name: sysFnName,
                    args: {},
                    id: 'call_sys_002',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Products and system health checked.' }],
            },
          },
        ],
      },
    ],
    {
      tools: [productTool, systemHealthTool],
      executeTool: async (target, args) => {
        h.executed.push({ target, args });
        if (target.originalName === 'list_products') {
          return { content: [{ type: 'text', text: JSON.stringify([{ id: 1, name: 'T-Shirt' }]) }] };
        }
        return { status: 'healthy', uptime: 3600 };
      },
    },
  );

  const result = await h.run();
  assert.equal(h.executed.length, 2);
  assert.equal(result.toolCalls.length, 2);

  const followUpParts = h.requests[1].contents[2].parts;
  assert.equal(followUpParts.length, 2);

  // Part 1
  assert.equal(followUpParts[0].functionResponse.name, prodFnName);
  assert.equal(followUpParts[0].functionResponse.id, 'call_prod_001');

  // Part 2
  assert.equal(followUpParts[1].functionResponse.name, sysFnName);
  assert.equal(followUpParts[1].functionResponse.id, 'call_sys_002');
  assert.deepEqual(followUpParts[1].functionResponse.response.result, {
    status: 'healthy',
    uptime: 3600,
  });
});

test('malformed model arguments are rejected, audited, and returned to Gemini without executing', async () => {
  const h = harness([
    functionCall({ per_page: 'three', search: 'latest products' }, undefined, 'call_bad_args'),
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'I could not safely run that request.' }],
          },
        },
      ],
    },
  ]);
  const result = await h.run();
  assert.equal(h.executed.length, 0);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0]?.[1], 'user-17');
  assert.equal(h.audits[0]?.[2], 'member-17');
  assert.match(String(h.audits[0]?.[4]), /input schema/);

  // Verify rejection response part preserves id and function name
  const responsePart = h.requests[1].contents[2].parts[0].functionResponse;
  assert.equal(responsePart.id, 'call_bad_args');
  assert.match(responsePart.response.error, /input schema/);
  assert.equal(result.content, 'I could not safely run that request.');
});

test('unknown tool names are rejected, audited, and reported to Gemini with id preserved', async () => {
  const h = harness([
    functionCall({}, 'unknown_nonexistent_tool', 'call_unknown_999'),
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'I do not have access to that tool.' }],
          },
        },
      ],
    },
  ]);
  const result = await h.run();
  assert.equal(h.executed.length, 0);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0]?.[3], 'unknown_nonexistent_tool');
  assert.match(String(h.audits[0]?.[4]), /Unknown tool name/);

  const responsePart = h.requests[1].contents[2].parts[0].functionResponse;
  assert.equal(responsePart.id, 'call_unknown_999');
  assert.equal(responsePart.name, 'unknown_nonexistent_tool');
  assert.match(responsePart.response.error, /Unknown tool name/);
});

test('tool execution errors are caught, returned to Gemini, and recorded safely', async () => {
  const h = harness(
    [
      functionCall({ per_page: 5 }, undefined, 'call_err_777'),
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'The tool failed to respond.' }],
            },
          },
        ],
      },
    ],
    {
      executeTool: async () => {
        throw new Error('Connection refused to upstream WooCommerce');
      },
    },
  );

  const result = await h.run();
  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0]?.result, { error: 'Connection refused to upstream WooCommerce' });

  const responsePart = h.requests[1].contents[2].parts[0].functionResponse;
  assert.equal(responsePart.id, 'call_err_777');
  assert.equal(responsePart.response.error, 'Connection refused to upstream WooCommerce');
});

test('empty tool results are handled safely', async () => {
  const h = harness(
    [
      functionCall({ per_page: 5 }),
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'No products found.' }],
            },
          },
        ],
      },
    ],
    {
      executeTool: async () => ({ content: [] }),
    },
  );

  const result = await h.run();
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.content, 'No products found.');
});

test('Gemini API key is sent only in x-goog-api-key header and uses default model endpoint', async () => {
  const h = harness([{ candidates: [{ content: { role: 'model', parts: [{ text: 'Ready.' }] } }] }]);
  await h.run();
  const request = h.requestMetadata[0]!;
  assert.equal(request.headers.get('x-goog-api-key'), 'test-only-key');
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.url.includes('test-only-key'), false);
  assert.match(request.url, /models\/gemini-3\.5-flash-lite:generateContent/);
});

test('final JSON code fences and answer wrappers are normalized for display', async () => {
  const h = harness([
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: '```json\n{"answer":"Found three products."}\n```' }],
          },
        },
      ],
    },
  ]);
  const result = await h.run();
  assert.equal(result.content, 'Found three products.');
  assert.equal(result.toolCalls.length, 0);
});

test('HTTP 429 quota exhaustion or rate limit returns sanitized diagnostic message', async () => {
  const base = {
    apiKey: 'test-only-key',
    messages: [{ role: 'user' as const, content: 'List products' }],
    tools: [productTool],
    user: { id: 'user-17', username: 'member-17' },
    db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };

  await assert.rejects(
    executeGeminiAgent({
      ...base,
      fetcher: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Quota exceeded for QuotaId: generate-content-requests-per-day',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiAgentError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.upstreamStatus, 429);
      assert.equal(error.upstreamCode, 'RESOURCE_EXHAUSTED');
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, /quota exhausted|rate limit/i);
      return true;
    },
  );
});

test('Gemini timeout error produces HTTP 504 with sanitized timeout message', async () => {
  const base = {
    apiKey: 'test-only-key',
    messages: [{ role: 'user' as const, content: 'List products' }],
    tools: [productTool],
    user: { id: 'user-17', username: 'member-17' },
    db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };

  await assert.rejects(
    executeGeminiAgent({
      ...base,
      timeoutMs: 100,
      fetcher: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiAgentError);
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test('Gemini network and malformed response failures are safe and explicit', async () => {
  const base = {
    apiKey: 'test-only-key',
    messages: [{ role: 'user' as const, content: 'List products' }],
    tools: [productTool],
    user: { id: 'user-17', username: 'member-17' },
    db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };

  await assert.rejects(
    executeGeminiAgent({
      ...base,
      fetcher: async () => {
        throw Object.assign(new Error('contains sensitive request text'), {
          cause: { code: 'ENOTFOUND', message: 'key=must-not-appear' },
        });
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiAgentError);
      assert.match(error.message, /could not be reached \(ENOTFOUND\)/);
      assert.doesNotMatch(error.message, /sensitive|must-not-appear|key=/i);
      return true;
    },
  );

  await assert.rejects(
    executeGeminiAgent({
      ...base,
      fetcher: async () => new Response('not json', { status: 200 }),
    }),
    (error: unknown) => error instanceof GeminiAgentError && /malformed JSON/.test(error.message),
  );
});

test('HTTP 400 exposes sanitized upstream diagnostics without echoing request data', async () => {
  const secretPrompt = 'private prompt should not be logged';
  const key = 'test-only-key';
  const errorBody = {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message: `Invalid JSON payload for ${secretPrompt}; key=${key}.`,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'INVALID_SCHEMA_FIELD',
          metadata: { key, prompt: secretPrompt },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.BadRequest',
          fieldViolations: [
            {
              field: 'tools[0].functionDeclarations[0].parameters.properties.count',
              description: `Unknown name "minLength" at 'tools[0].functionDeclarations[0].parameters.properties.count': key=${key}, prompt=${secretPrompt}`,
            },
          ],
        },
      ],
    },
  };
  const errorBase = {
    apiKey: key,
    messages: [{ role: 'user' as const, content: secretPrompt }],
    tools: [productTool],
    user: { id: 'user-17', username: 'member-17' },
    db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
    fetcher: async (input: RequestInfo | URL) => {
      const requestedUrl = String(input);
      assert.equal(requestedUrl.includes(key), false);
      assert.equal(new URL(requestedUrl).searchParams.has('key'), false);
      return new Response(JSON.stringify(errorBody), { status: 400 });
    },
  };
  await assert.rejects(executeGeminiAgent(errorBase), (error: unknown) => {
    assert.ok(error instanceof GeminiAgentError);
    assert.equal(error.statusCode, 502);
    assert.equal(error.upstreamStatus, 400);
    assert.equal(error.upstreamCode, 'INVALID_ARGUMENT');
    assert.equal(error.upstreamErrorCode, 400);
    assert.deepEqual(error.upstreamReasons, ['INVALID_SCHEMA_FIELD']);
    assert.equal(
      error.upstreamMessage,
      "Unknown request field 'minLength' at 'tools[0].functionDeclarations[0].parameters.properties.count'.",
    );
    assert.match(error.message, /HTTP 400/);
    assert.match(error.message, /INVALID_SCHEMA_FIELD/);
    assert.match(error.message, /parameters\.properties\.count/);
    assert.doesNotMatch(error.message, new RegExp(secretPrompt));
    assert.doesNotMatch(error.message, new RegExp(key));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secretPrompt));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(key));
    return true;
  });
});

test('functionName ensures names start with a letter or underscore and trims to 128 characters', () => {
  assert.match(functionName(productTool), /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/);
  // Tools starting with digits must get prefixed
  const digitTool = {
    ...productTool,
    tool: { ...productTool.tool, name: '9abc__tool' },
  } satisfies GeminiToolTarget;
  assert.equal(functionName(digitTool).startsWith('_9abc'), true);

  // Tools starting with letters remain unchanged
  const letterTool = {
    ...productTool,
    tool: { ...productTool.tool, name: 'abc__tool' },
  } satisfies GeminiToolTarget;
  assert.equal(functionName(letterTool), 'abc__tool');
});

test('toGeminiSchema handles empty schemas, enums, type arrays with null, and unsupported fields', () => {
  // Empty schema
  assert.deepEqual(toGeminiSchema({}), { type: 'OBJECT', properties: {} });
  assert.deepEqual(toGeminiSchema(null), { type: 'OBJECT', properties: {} });

  // Unsupported fields stripped
  const cleaned: any = toGeminiSchema({
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'ProductQuery',
    additionalProperties: false,
    default: { search: '' },
    type: 'object',
    properties: {
      search: {
        type: ['string', 'null'],
        description: 'Search keyword',
      },
      status: {
        type: 'string',
        enum: ['draft', 'publish', 123],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['search'],
  });

  assert.equal('$schema' in cleaned, false);
  assert.equal('title' in cleaned, false);
  assert.equal('additionalProperties' in cleaned, false);
  assert.equal('default' in cleaned, false);
  assert.equal(cleaned.type, 'OBJECT');
  assert.equal(cleaned.properties.search.type, 'STRING');
  assert.equal(cleaned.properties.search.nullable, true);
  assert.deepEqual(cleaned.properties.status.enum, ['draft', 'publish', '123']);
  assert.equal(cleaned.properties.tags.type, 'ARRAY');
  assert.equal(cleaned.properties.tags.items.type, 'STRING');
  assert.deepEqual(cleaned.required, ['search']);
});

test('executeGeminiAgent logs each Gemini API request duration using monotonic timing', async () => {
  const logs: any[] = [];
  const testLogger = {
    info: (obj: unknown, msg?: string) => logs.push({ level: 'info', obj, msg }),
    warn: (obj: unknown, msg?: string) => logs.push({ level: 'warn', obj, msg }),
    error: (obj: unknown, msg?: string) => logs.push({ level: 'error', obj, msg }),
  };

  const fetcher: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Found 2 products.' }] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await executeGeminiAgent({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [productTool],
    user: { id: 'u1', username: 'user1' },
    db: { prepare: () => ({ run: () => {} }) },
    executeTool: async () => ({}),
    fetcher,
    logger: testLogger,
  });

  assert.equal(result.content, 'Found 2 products.');
  const apiLog = logs.find(l => l.obj?.stage === 'gemini_api_request');
  assert.ok(apiLog, 'Expected a log with stage: gemini_api_request');
  assert.equal(apiLog.obj.turn, 1);
  assert.ok(typeof apiLog.obj.durationMs === 'number');
  assert.ok(apiLog.obj.durationMs >= 0);
  assert.equal(apiLog.obj.model, 'gemini-3.5-flash-lite');
});
