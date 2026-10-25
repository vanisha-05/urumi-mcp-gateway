import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbUpstream } from '../db.js';
import type { NamespacedTool } from '../mcp-client.js';
import { executeOllamaAgent, OllamaAgentError, type OllamaToolTarget } from './ollama-agent.js';

const upstream = { id: 'upstream-1', name: 'WooCommerce' } as DbUpstream;
const productTool = {
  upstream,
  originalName: 'list_products',
  tool: {
    name: 'upstream-1__list_products',
    _upstreamId: 'upstream-1', _upstreamName: 'WooCommerce', _originalName: 'list_products',
    description: 'List products.',
    inputSchema: { type: 'object', properties: { per_page: { type: 'integer', minimum: 1, maximum: 100 }, status: { type: 'string', enum: ['draft', 'publish'] } }, required: ['per_page'], additionalProperties: false },
  } as NamespacedTool,
} satisfies OllamaToolTarget;

function harness(responses: unknown[]) {
  const requests: any[] = [];
  const audits: unknown[][] = [];
  const executed: Array<{ target: OllamaToolTarget; args: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const db = { prepare: () => ({ run: (...params: unknown[]) => { audits.push(params); } }) };
  const executeTool = async (target: OllamaToolTarget, args: Record<string, unknown>) => {
    executed.push({ target, args });
    return { content: [{ type: 'text', text: JSON.stringify([{ name: 'Orbit Camera' }]) }] };
  };
  const run = () => executeOllamaAgent({
    messages: [{ role: 'user', content: 'Show the latest product.' }], tools: [productTool],
    user: { id: 'user-17', username: 'member-17' }, db, executeTool, fetcher,
  });
  return { run, requests, audits, executed };
}

const toolCall = (args: unknown, name = 'upstream-1__list_products') => ({
  message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] },
});
const answer = (content: string) => ({ message: { role: 'assistant', content } });

test('normal text response uses native non-streaming Ollama chat with defaults', async () => {
  const h = harness([answer('Ready.')]);
  const result = await h.run();
  assert.equal(result.content, 'Ready.');
  assert.equal(h.requests[0].model, 'qwen3:4b');
  assert.equal(h.requests[0].stream, false);
  assert.equal(h.requests[0].messages.at(-1).content, 'Show the latest product.');
  assert.equal(h.requests[0].tools[0].function.parameters.properties.per_page.type, 'integer');
  assert.deepEqual(h.requests[0].tools[0].function.parameters.properties.status.enum, ['draft', 'publish']);
});

test('tool results use Ollama tool message and continue to final answer with audit attribution', async () => {
  const h = harness([toolCall({ per_page: 3 }), answer('Orbit Camera is available.')]);
  const result = await h.run();
  assert.equal(result.content, 'Orbit Camera is available.');
  assert.deepEqual(h.executed[0]?.args, { per_page: 3 });
  assert.equal(h.requests[1].messages.at(-2).role, 'assistant');
  assert.equal(h.requests[1].messages.at(-1).role, 'tool');
  assert.match(h.requests[1].messages.at(-1).content, /Orbit Camera/);
  assert.equal(h.audits.length, 0);
  assert.equal(result.toolCalls.length, 1);
});

test('invalid arguments and unknown tool names are audited and never executed', async () => {
  const h = harness([toolCall({ per_page: 3, status: 'unknown' }), toolCall({ per_page: 3 }, 'made_up'), answer('I could not safely run those calls.')]);
  const result = await h.run();
  assert.equal(result.content, 'I could not safely run those calls.');
  assert.equal(h.executed.length, 0);
  assert.equal(h.audits.length, 2);
  for (const row of h.audits) {
    assert.equal(row[1], 'user-17');
    assert.equal(row[2], 'member-17');
    assert.match(String(row[4]), /input schema|Unknown tool name/);
  }
});

test('Ollama HTTP, network, malformed JSON, and malformed tool response errors are safe', async () => {
  const base = {
    messages: [{ role: 'user' as const, content: 'List products' }], tools: [productTool],
    user: { id: 'user-17', username: 'member-17' }, db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };
  await assert.rejects(executeOllamaAgent({ ...base, fetcher: async () => new Response('', { status: 503 }) }),
    (error: unknown) => error instanceof OllamaAgentError && /HTTP 503/.test(error.message));
  await assert.rejects(executeOllamaAgent({ ...base, fetcher: async () => { throw new Error('secret URL and credential'); } }),
    (error: unknown) => error instanceof OllamaAgentError && !/secret|credential/.test(error.message));
  await assert.rejects(executeOllamaAgent({ ...base, fetcher: async () => new Response('not json') }),
    (error: unknown) => error instanceof OllamaAgentError && /malformed JSON/.test(error.message));
  await assert.rejects(executeOllamaAgent({ ...base, fetcher: async () => new Response(JSON.stringify({ message: { tool_calls: 'bad' } })) }),
    (error: unknown) => error instanceof OllamaAgentError && /malformed tool calls/.test(error.message));
});

test('Ollama timeout error produces HTTP 504 with elapsed seconds message', async () => {
  const base = {
    messages: [{ role: 'user' as const, content: 'List products' }], tools: [productTool],
    user: { id: 'user-17', username: 'member-17' }, db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };
  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  await assert.rejects(
    executeOllamaAgent({ ...base, timeoutMs: 120_000, fetcher: async () => { throw abortErr; } }),
    (error: unknown) => error instanceof OllamaAgentError && error.statusCode === 504 && /timed out after 120 s/.test(error.message),
  );
});

test('embedded tool call in content is extracted and executed when tool_calls array is missing', async () => {
  const embeddedTool = {
    message: {
      role: 'assistant',
      content: '<tool_call>\n{"name": "upstream-1__list_products", "arguments": {"per_page": 2}}\n</tool_call>',
    },
  };
  const h = harness([embeddedTool, answer('Found 2 products.')]);
  const result = await h.run();
  assert.equal(result.content, 'Found 2 products.');
  assert.equal(h.executed.length, 1);
  assert.deepEqual(h.executed[0]?.args, { per_page: 2 });
});

test('done_reason length (token exhaustion) throws OllamaAgentError 502 with token limit message', async () => {
  const base = {
    messages: [{ role: 'user' as const, content: 'List products' }], tools: [productTool],
    user: { id: 'user-17', username: 'member-17' }, db: { prepare: () => ({ run: () => undefined }) },
    executeTool: async () => ({}),
  };
  // Simulate Ollama stopping mid-generation due to num_predict exhaustion
  const tokenExhausted = { message: { role: 'assistant', content: 'Thinking...' }, done_reason: 'length' };
  await assert.rejects(
    executeOllamaAgent({ ...base, fetcher: async () => new Response(JSON.stringify(tokenExhausted), { status: 200 }) }),
    (error: unknown) => error instanceof OllamaAgentError && error.statusCode === 502 && /token limit/.test(error.message),
  );
});
