import { Ajv, type AnySchema } from 'ajv';
import { randomUUID } from 'node:crypto';
import type { DbUpstream } from '../db.js';
import type { NamespacedTool } from '../mcp-client.js';

export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaToolTarget {
  upstream: DbUpstream;
  originalName: string;
  tool: NamespacedTool;
}

export interface OllamaToolCallResult {
  name: string;
  upstream: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface OllamaUser {
  id: string;
  username: string;
}

interface AuditDatabase {
  prepare(sql: string): { run(...params: unknown[]): unknown };
}

interface OllamaFunctionCall {
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

interface OllamaAssistantMessage {
  role?: string;
  content?: string;
  tool_calls?: OllamaFunctionCall[];
}

const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_MODEL_TURNS = 6;
const ajv = new Ajv({ allErrors: true, strict: false });

// qwen3 thinking toggle — must be top-level in the Ollama /api/chat payload,
// NOT nested inside options. Disabling thinking frees all num_predict tokens
// for the actual answer and tool call JSON.
const OLLAMA_THINK = false;

const SYSTEM_PROMPT = [
  'You are the assistant for the Urumi MCP Gateway.',
  'Use declared Gateway tools for live WooCommerce, warehouse, and system data.',
  'Never invent products, orders, stock levels, or tool results.',
  'Use only tools that are relevant to the user request.',
  'When store, order, warehouse, or system data is requested, invoke the appropriate tool call immediately.',
  'Follow each tool input schema and pass structured arguments, never the entire user request as a filter value.',
  'For a request for the latest N records, set the relevant result-limit parameter to N.',
  'Do not perform create, update, or delete actions unless the user explicitly asks for that action.',
  'After receiving tool results, use those results to answer the user clearly and concisely based purely on the real data.',
].join(' ');

export class OllamaAgentError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message);
    this.name = 'OllamaAgentError';
  }
}

export async function executeOllamaAgent(options: {
  messages: OllamaChatMessage[];
  tools: OllamaToolTarget[];
  user: OllamaUser;
  db: AuditDatabase;
  executeTool: (
    target: OllamaToolTarget,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  fetcher?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{
  content: string;
  toolCalls: OllamaToolCallResult[];
  turns: number;
}> {
  const {
    messages,
    tools,
    user,
    db,
    executeTool,
  } = options;

  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (
    options.baseUrl ??
    process.env.OLLAMA_BASE_URL ??
    'http://host.docker.internal:11434'
  ).replace(/\/+$/, '');
  const model = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen3:4b';
  const timeoutMs = options.timeoutMs ?? (
    process.env.OLLAMA_TIMEOUT_MS
      ? Number(process.env.OLLAMA_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  );

  const toolsByFunctionName = new Map<string, OllamaToolTarget>();
  const declarations = tools.map(target => {
    const name = functionName(target);

    if (toolsByFunctionName.has(name)) {
      throw new OllamaAgentError(
        'Two Gateway tools resolve to the same local model function name.',
      );
    }

    toolsByFunctionName.set(name, target);

    return {
      type: 'function',
      function: {
        name,
        description: target.tool.description || `Tool ${target.tool.name}`,
        parameters: toOllamaSchema(
          target.tool.inputSchema || { type: 'object', properties: {} },
        ),
      },
    };
  });

  const conversation: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
      .filter(message =>
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
      )
      .map(message => ({
        role: message.role,
        content: message.content,
      })),
  ];

  const toolCalls: OllamaToolCallResult[] = [];

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
    let response: Response;

    let reqElapsedMs = 0;
    try {
      const reqStart = Date.now();
      response = await fetcher(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: conversation,
          stream: false,
          // think: false suppresses qwen3 chain-of-thought reasoning mode.
          // It MUST be a top-level key — placing it inside `options` has no effect.
          think: OLLAMA_THINK,
          options: {
            temperature: 0.1,
            top_p: 0.9,
            // 4096 tokens to accommodate tool call JSON + final answer.
            // qwen3 reasoning mode would exhaust 1024 tokens before answering.
            num_predict: 4096,
          },
          ...(declarations.length ? { tools: declarations } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      reqElapsedMs = Date.now() - reqStart;
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new OllamaAgentError(
          `Ollama inference timed out after ${Math.round(timeoutMs / 1000)} s on turn ${turn + 1}. CPU inference is slow; increase OLLAMA_TIMEOUT_MS or use a smaller model.`,
          504,
        );
      }
      // Do not expose URL, credentials, or internal error details in the message.
      throw new OllamaAgentError(
        `Could not connect to the local Ollama API (turn ${turn + 1}). Verify Ollama is running and OLLAMA_BASE_URL is reachable from the Gateway pod.`,
        502,
      );
    }

    if (!response.ok) {
      throw new OllamaAgentError(
        `The local Ollama API returned HTTP ${response.status}.`,
        response.status >= 500 ? 502 : response.status,
      );
    }

    let payload: { message?: OllamaAssistantMessage; done_reason?: string };

    try {
      payload = await response.json() as { message?: OllamaAssistantMessage; done_reason?: string };
    } catch {
      throw new OllamaAgentError('Ollama returned malformed JSON.');
    }

    // Detect token exhaustion: num_predict hit before the model finished.
    if (payload.done_reason === 'length') {
      throw new OllamaAgentError(
        `Ollama stopped generating because the response hit the token limit (turn ${turn + 1}). ` +
        'The model may be in thinking mode or the prompt is too large. ' +
        'Ensure think:false is supported by the installed Ollama version.',
        502,
      );
    }

    const assistantMessage = payload.message;
    void reqElapsedMs; // available for future diagnostic logging if needed

    if (!assistantMessage || typeof assistantMessage !== 'object') {
      throw new OllamaAgentError('Ollama returned no usable assistant message.');
    }

    if (assistantMessage.tool_calls !== undefined && !Array.isArray(assistantMessage.tool_calls)) {
      throw new OllamaAgentError('Ollama returned malformed tool calls.');
    }

    const calls = extractToolCalls(assistantMessage);

    if (calls.length === 0) {
      const content = cleanFinalAnswer(
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '',
      );

      if (!content) {
        throw new OllamaAgentError(
          'Ollama returned neither a final answer nor a tool call.',
        );
      }

      return { content, toolCalls, turns: turn + 1 };
    }

    // Preserve the assistant's tool-call message before appending tool results.
    conversation.push({
      role: 'assistant',
      content: assistantMessage.content ?? '',
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call?.function?.name ?? '';
      const target = toolsByFunctionName.get(name);
      const args = parseArguments(call?.function?.arguments);

      const validation = target && args
        ? validateArguments(target, args)
        : {
            valid: false,
            message: target
              ? 'Tool arguments must be a JSON object.'
              : 'Unknown tool name returned by the model.',
          };

      if (!target || !args || !validation.valid) {
        const reason = validation.message;
        recordRejectedCall(db, user, name || '(missing function name)', reason);

        toolCalls.push({
          name: name || 'unknown_tool',
          upstream: target?.upstream.name ?? 'unknown',
          args: args ?? {},
          result: { error: reason },
        });

        conversation.push({
          role: 'tool',
          content: JSON.stringify({ error: reason }),
        });

        continue;
      }

      try {
        const rawResult = await executeTool(target, args);
        const result = normalizeToolResult(rawResult);

        toolCalls.push({
          name: target.tool.name,
          upstream: target.upstream.name,
          args,
          result,
        });

        conversation.push({
          role: 'tool',
          content: serializeForModel(result),
        });
      } catch {
        const message = 'The Gateway tool execution failed.';

        toolCalls.push({
          name: target.tool.name,
          upstream: target.upstream.name,
          args,
          result: { error: message },
        });

        conversation.push({
          role: 'tool',
          content: JSON.stringify({ error: message }),
        });
      }
    }

    if (turn === MAX_MODEL_TURNS - 1) {
      return {
        content:
          'The local model reached its tool-calling limit before producing a final answer. Completed tool results are available below.',
        toolCalls,
        turns: turn + 1,
      };
    }
  }

  throw new OllamaAgentError(
    'The local model did not complete a response within the tool-calling limit.',
  );
}

function functionName(target: OllamaToolTarget): string {
  return target.tool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function toOllamaSchema(schema: unknown): Record<string, unknown> {
  if (!isObject(schema) || Object.keys(schema).length === 0) {
    return { type: 'object', properties: {} };
  }

  const supported = new Set([
    'type',
    'description',
    'enum',
    'items',
    'properties',
    'required',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'pattern',
    'additionalProperties',
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!supported.has(key)) continue;

    if (key === 'properties' && isObject(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          toOllamaSchema(child),
        ]),
      );
    } else if (key === 'items') {
      result.items = toOllamaSchema(value);
    } else if (key === 'additionalProperties' && isObject(value)) {
      result.additionalProperties = toOllamaSchema(value);
    } else if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((item): item is string =>
        typeof item === 'string',
      );
      result.type = types.find(type => type !== 'null') ?? 'object';

      if (types.includes('null')) result.nullable = true;
    } else {
      result[key] = value;
    }
  }

  if (!result.type) result.type = 'object';
  if (result.type === 'object' && !result.properties) {
    result.properties = {};
  }

  return result;
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateArguments(
  target: OllamaToolTarget,
  value: Record<string, unknown>,
): { valid: boolean; message: string } {
  try {
    const schema = (
      target.tool.inputSchema || { type: 'object', properties: {} }
    ) as AnySchema;

    const validate = ajv.compile(schema);

    if (validate(value)) return { valid: true, message: '' };

    const detail = (validate.errors ?? [])
      .map(error =>
        `${error.instancePath || '/'} ${error.message || 'is invalid'}`,
      )
      .join('; ');

    return {
      valid: false,
      message: `Tool arguments do not match the declared input schema: ${detail}`,
    };
  } catch {
    return {
      valid: false,
      message: 'The tool input schema could not be validated.',
    };
  }
}

function recordRejectedCall(
  db: AuditDatabase,
  user: OllamaUser,
  toolName: string,
  reason: string,
): void {
  db.prepare(
    `INSERT INTO audit_log
       (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
     VALUES (?, ?, ?, NULL, NULL, ?, 0, 0, ?)`,
  ).run(
    randomUUID(),
    user.id,
    user.username,
    toolName.slice(0, 200),
    reason.slice(0, 1000),
  );
}

function normalizeToolResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.content)) return result;

  if ('structuredContent' in result) {
    return {
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    };
  }

  const content = result.content.map((item: any) => {
    if (typeof item?.text !== 'string') return item;

    try {
      return JSON.parse(item.text);
    } catch {
      return item.text;
    }
  });

  return content.length === 1
    ? { content: content[0], isError: result.isError === true }
    : { content, isError: result.isError === true };
}

function serializeForModel(value: unknown): string {
  const serialized = JSON.stringify(value);
  const content = typeof serialized === 'string'
    ? serialized
    : String(value);

  return content.length <= 30_000
    ? content
    : `${content.slice(0, 30_000)}...[tool result truncated]`;
}

function cleanFinalAnswer(text: string): string {
  let clean = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  const fence = clean.match(/^```(?:json|markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) clean = fence[1]!.trim();

  try {
    const parsed: unknown = JSON.parse(clean);

    if (typeof parsed === 'string') return parsed;

    if (isObject(parsed)) {
      for (const key of ['answer', 'text', 'content', 'message']) {
        if (typeof parsed[key] === 'string') return parsed[key].trim();
      }

      return JSON.stringify(parsed, null, 2);
    }

    return JSON.stringify(parsed, null, 2);
  } catch {
    return clean;
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractToolCalls(msg: OllamaAssistantMessage): OllamaFunctionCall[] {
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    return msg.tool_calls;
  }
  if (typeof msg.content === 'string') {
    const matches = Array.from(msg.content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi));
    if (matches.length > 0) {
      const calls: OllamaFunctionCall[] = [];
      for (const m of matches) {
        try {
          const parsed = JSON.parse(m[1]!);
          if (parsed && typeof parsed.name === 'string') {
            calls.push({
              function: {
                name: parsed.name,
                arguments: parsed.arguments ?? {},
              },
            });
          }
        } catch {
          // ignore malformed embedded call
        }
      }
      if (calls.length > 0) return calls;
    }
  }
  return [];
}
