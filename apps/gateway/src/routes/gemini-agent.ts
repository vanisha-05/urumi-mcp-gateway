import { Ajv, type AnySchema } from 'ajv';
import { randomUUID } from 'node:crypto';
import type { DbUpstream } from '../db.js';
import type { NamespacedTool } from '../mcp-client.js';

export interface GeminiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GeminiToolTarget {
  upstream: DbUpstream;
  originalName: string;
  tool: NamespacedTool;
}

export interface GeminiToolCallResult {
  name: string;
  upstream: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface GeminiUser {
  id: string;
  username: string;
}

interface AuditDatabase {
  prepare(sql: string): { run(...params: unknown[]): unknown };
}

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_MODEL_TURNS = 6;
const ajv = new Ajv({ allErrors: true, strict: false });

export class GeminiAgentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly upstreamStatus?: number,
    readonly upstreamCode?: string,
    readonly upstreamMessage?: string,
    readonly upstreamErrorCode?: number,
    readonly upstreamReasons: string[] = [],
  ) {
    super(message);
    this.name = 'GeminiAgentError';
  }
}

export interface GeminiAgentLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export async function executeGeminiAgent(options: {
  apiKey: string;
  messages: GeminiChatMessage[];
  tools: GeminiToolTarget[];
  user: GeminiUser;
  db: AuditDatabase;
  executeTool: (target: GeminiToolTarget, args: Record<string, unknown>) => Promise<unknown>;
  fetcher?: typeof fetch;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  logger?: GeminiAgentLogger;
}): Promise<{ content: string; toolCalls: GeminiToolCallResult[]; turns: number }> {
  const { apiKey, messages, tools, user, db, executeTool, logger } = options;
  const fetcher = options.fetcher ?? fetch;
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const endpoint =
    options.endpoint ??
    process.env.GEMINI_ENDPOINT ??
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const timeoutMs =
    options.timeoutMs ??
    (process.env.GEMINI_TIMEOUT_MS ? Number(process.env.GEMINI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);

  const toolsByFunctionName = new Map<string, GeminiToolTarget>();
  for (const target of tools) {
    const name = functionName(target);
    if (toolsByFunctionName.has(name)) {
      throw new GeminiAgentError(`Two Gateway tools resolve to the same function name: ${name}`);
    }
    toolsByFunctionName.set(name, target);
  }

  const declarations = tools.map(target => ({
    name: functionName(target),
    description: target.tool.description || `Tool ${target.tool.name}`,
    parameters: toGeminiSchema(target.tool.inputSchema || { type: 'object', properties: {} }),
  }));

  const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const toolCalls: GeminiToolCallResult[] = [];
  let turns = 0;

  for (; turns < MAX_MODEL_TURNS; turns += 1) {
    const apiStart = performance.now();
    let response: any;
    try {
      response = await callGemini(
        fetcher,
        apiKey,
        {
          contents,
          systemInstruction: {
            parts: [
              {
                text:

`Current date and time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' })}. Use this date and time as the reference for questions about today, yesterday, recent records, and date ranges. Use the declared Gateway tools for live data. Follow each tool input schema exactly, use only fields needed by the request, and never copy the full natural-language request into a filter value. Base answers on returned tool results and do not invent data. When asked for the latest N records, set the schema field that limits the result count to N.`
,
              },
            ],
          },
          // REST uses protobuf JSON names (camelCase)
          tools: declarations.length ? [{ functionDeclarations: declarations }] : undefined,
        },
        endpoint,
        timeoutMs,
      );
      const apiDurationMs = Math.round((performance.now() - apiStart) * 100) / 100;
      logger?.info(
        { stage: 'gemini_api_request', turn: turns + 1, durationMs: apiDurationMs, model },
        'Gemini API request completed',
      );
    } catch (err) {
      const apiDurationMs = Math.round((performance.now() - apiStart) * 100) / 100;
      logger?.warn(
        { stage: 'gemini_api_request', turn: turns + 1, durationMs: apiDurationMs, model, err: err instanceof Error ? err.message : String(err) },
        'Gemini API request failed',
      );
      throw err;
    }

    const candidate = response.candidates?.[0];
    const candidateContent = candidate?.content;
    if (!candidateContent || !Array.isArray(candidateContent.parts)) {
      throw new GeminiAgentError('Gemini returned no usable response candidate.');
    }

    const functionCallParts = candidateContent.parts
      .filter((part: any) => part && typeof part === 'object' && part.functionCall);

    if (!functionCallParts.length) {
      const text = candidateContent.parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!text) throw new GeminiAgentError('Gemini returned neither text nor a tool call.');
      return { content: cleanFinalAnswer(text), toolCalls, turns: turns + 1 };
    }

    // Gemini requires its complete function-call turn followed by tool responses.
    // Preserve candidateContent.parts intact (including thoughtSignature).
    contents.push({ role: 'model', parts: candidateContent.parts });
    const responseParts: Array<Record<string, unknown>> = [];

    for (const part of functionCallParts) {
      const call = (part as any).functionCall;
      const callId = typeof call?.id === 'string' ? call.id : undefined;
      const name = typeof call?.name === 'string' ? call.name : '';
      const target = toolsByFunctionName.get(name);
      const args = call?.args;
      const validation = target
        ? validateArguments(target, args)
        : { valid: false, message: 'Unknown tool name.' };

      if (!target || !validation.valid) {
        const reason = target ? validation.message : 'Unknown tool name.';
        recordRejectedCall(db, user, name || '(missing function name)', reason);
        responseParts.push({
          functionResponse: {
            name: name || 'unknown_tool',
            ...(callId ? { id: callId } : {}),
            response: { error: reason },
          },
        });
        toolCalls.push({
          name: name || 'unknown_tool',
          upstream: target?.upstream.name ?? 'unknown',
          args: isObject(args) ? args : {},
          result: { error: reason },
        });
        continue;
      }

      try {
        const rawResult = await executeTool(
          target,
          (isObject(args) ? args : {}) as Record<string, unknown>,
        );
        const normalized = normalizeToolResult(rawResult);
        toolCalls.push({
          name: target.tool.name,
          upstream: target.upstream.name,
          args: (isObject(args) ? args : {}) as Record<string, unknown>,
          result: rawResult,
        });
        responseParts.push({
          functionResponse: {
            name,
            ...(callId ? { id: callId } : {}),
            response: { result: normalized },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed.';
        toolCalls.push({
          name: target.tool.name,
          upstream: target.upstream.name,
          args: (isObject(args) ? args : {}) as Record<string, unknown>,
          result: { error: message },
        });
        responseParts.push({
          functionResponse: {
            name,
            ...(callId ? { id: callId } : {}),
            response: { error: message },
          },
        });
      }
    }

    if (turns === MAX_MODEL_TURNS - 1) {
      return {
        content:
          'I reached the tool-calling limit before Gemini returned a final answer. The completed tool results are shown below.',
        toolCalls,
        turns: turns + 1,
      };
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  throw new GeminiAgentError('Gemini did not complete a response within the tool-calling limit.');
}

async function callGemini(
  fetcher: typeof fetch,
  apiKey: string,
  payload: unknown,
  endpoint: string,
  timeoutMs: number,
): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new GeminiAgentError(
        `Gemini API request timed out after ${Math.round(timeoutMs / 1000)} s.`,
        504,
      );
    }
    const networkCode = safeNetworkCode(error);
    throw new GeminiAgentError(
      `Gemini API could not be reached${networkCode ? ` (${networkCode})` : ''}. Check Gateway network access.`,
    );
  }

  if (!response.ok) {
    let errorBody: any;
    try {
      errorBody = await response.json();
    } catch {
      /* keep the status if no JSON error is provided */
    }
    const upstreamCode = safeUpstreamCode(errorBody?.error?.status);
    const upstreamErrorCode = safeHttpCode(errorBody?.error?.code);
    const upstreamReasons = safeReasons(errorBody?.error?.details);
    const upstreamMessage = safeUpstreamMessage(errorBody?.error?.message, errorBody?.error?.details);

    if (
      response.status === 429 ||
      upstreamCode === 'RESOURCE_EXHAUSTED' ||
      upstreamReasons.includes('RATE_LIMIT_EXCEEDED')
    ) {
      throw new GeminiAgentError(
        'Gemini API returned HTTP 429: Free-tier quota exhausted or rate limit exceeded. Please try again later.',
        502,
        response.status,
        upstreamCode || 'RESOURCE_EXHAUSTED',
        upstreamMessage || 'Free-tier quota exhausted or rate limit exceeded.',
        upstreamErrorCode || 429,
        upstreamReasons.length ? upstreamReasons : ['RESOURCE_EXHAUSTED'],
      );
    }

    const detail = [upstreamCode, upstreamReasons.join(', '), upstreamMessage]
      .filter(Boolean)
      .join(': ');
    throw new GeminiAgentError(
      `Gemini API returned HTTP ${response.status}${detail ? ` (${detail})` : ''}.`,
      502,
      response.status,
      upstreamCode,
      upstreamMessage,
      upstreamErrorCode,
      upstreamReasons,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new GeminiAgentError('Gemini API returned malformed JSON.');
  }
}

/** Node fetch errors can expose a stable system code in `cause`; never copy
 * the free-form error message because it may contain request or credential data. */
function safeNetworkCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const cause =
    'cause' in error && error.cause && typeof error.cause === 'object' ? error.cause : error;
  if (!('code' in cause) || typeof cause.code !== 'string') return undefined;
  const code = cause.code.toUpperCase();
  return /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(
    code,
  )
    ? code
    : undefined;
}

function safeUpstreamCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
}

function safeHttpCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function safeReasons(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return [
    ...new Set(
      details
        .map((detail: any) => detail?.reason)
        .filter((reason: unknown): reason is string => typeof reason === 'string')
        .map((reason: string) => reason.toUpperCase())
        .filter((reason: string) => /^[A-Z][A-Z0-9_]{0,63}$/.test(reason)),
    ),
  ].slice(0, 8);
}

/** Keep only Google validation wording and structural request paths. Error text
 * can contain echoed request values, so arbitrary upstream prose is not logged. */
function safeUpstreamMessage(value: unknown, details: unknown): string | undefined {
  const messages = [
    value,
    ...(Array.isArray(details) ? details.map((detail: any) => detail?.fieldViolations).flat() : []),
  ]
    .map((item: any) =>
      typeof item === 'string' ? item : `${item?.field ?? ''} ${item?.description ?? ''}`,
    )
    .filter(Boolean)
    .slice(0, 12);
  const sanitized: string[] = [];
  for (const message of messages) {
    const unknownName = message.match(
      /Unknown name ["']([a-zA-Z0-9_.-]{1,100})["'] at ["']([a-zA-Z0-9_.[\]-]{1,160})["']/i,
    );
    if (unknownName) sanitized.push(`Unknown request field '${unknownName[1]}' at '${unknownName[2]}'.`);
    const invalidValue = message.match(/Invalid value at ["']([a-zA-Z0-9_.[\]-]{1,160})["']/i);
    if (invalidValue) sanitized.push(`Invalid value at '${invalidValue[1]}'.`);
    const violation = message.match(/^\s*([a-zA-Z0-9_.[\]-]{1,160})\s+/);
    if (violation && !/^invalid$/i.test(violation[1]!) && !unknownName && !invalidValue) {
      sanitized.push(`Validation failed at '${violation[1]}'.`);
    }
  }
  if (sanitized.length) return [...new Set(sanitized)].slice(0, 4).join(' ');
  if (messages.some(message => /invalid json payload/i.test(message))) return 'Invalid JSON request payload.';
  if (messages.some(message => /not supported/i.test(message))) return 'A request field or value is not supported.';
  return 'Upstream rejected the request.';
}

export function functionName(target: GeminiToolTarget): string {
  // Gemini requires: max 128 chars, [a-zA-Z0-9_.:-], must start with letter or underscore.
  const sanitized = target.tool.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 128);
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`.slice(0, 128);
}

export function toGeminiSchema(schema: unknown): unknown {
  if (!isObject(schema) || Object.keys(schema).length === 0) {
    return { type: 'OBJECT', properties: {} };
  }
  const supported = new Set([
    'type',
    'format',
    'description',
    'nullable',
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
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!supported.has(key)) continue;
    if (key === 'properties' && isObject(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, toGeminiSchema(child)]),
      );
    } else if (key === 'items') {
      result.items = toGeminiSchema(value);
    } else if (key === 'type' && typeof value === 'string') {
      const types: Record<string, string> = {
        object: 'OBJECT',
        array: 'ARRAY',
        string: 'STRING',
        number: 'NUMBER',
        integer: 'INTEGER',
        boolean: 'BOOLEAN',
      };
      result.type = types[value.toLowerCase()] || value.toUpperCase();
    } else if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((item): item is string => typeof item === 'string');
      const nonNull = types.find(type => type.toLowerCase() !== 'null') ?? 'object';
      const typesMap: Record<string, string> = {
        object: 'OBJECT',
        array: 'ARRAY',
        string: 'STRING',
        number: 'NUMBER',
        integer: 'INTEGER',
        boolean: 'BOOLEAN',
      };
      result.type = typesMap[nonNull.toLowerCase()] || nonNull.toUpperCase();
      if (types.some(t => t.toLowerCase() === 'null')) {
        result.nullable = true;
      }
    } else if (key === 'enum' && Array.isArray(value)) {
      result.enum = value.map(v => String(v));
    } else if (key === 'required' && Array.isArray(value)) {
      const req = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
      if (req.length > 0) {
        result.required = req;
      }
    } else {
      result[key] = value;
    }
  }

  if (!result.type) {
    result.type = result.properties ? 'OBJECT' : (result.items ? 'ARRAY' : 'STRING');
  }
  if (result.type === 'OBJECT' && !result.properties) {
    result.properties = {};
  }
  if (result.type === 'ARRAY' && !result.items) {
    result.items = { type: 'STRING' };
  }

  return result;
}

function validateArguments(
  target: GeminiToolTarget,
  value: unknown,
): { valid: boolean; message: string } {
  if (!isObject(value)) return { valid: false, message: 'Tool arguments must be a JSON object.' };
  try {
    const validate = ajv.compile(
      (target.tool.inputSchema || { type: 'object', properties: {} }) as AnySchema,
    );
    if (validate(value)) return { valid: true, message: '' };
    const detail = (validate.errors || [])
      .map(
        (error: { instancePath?: string; message?: string }) =>
          `${error.instancePath || '/'} ${error.message || 'is invalid'}`,
      )
      .join('; ');
    return {
      valid: false,
      message: `Tool arguments do not match the declared input schema: ${detail}`,
    };
  } catch {
    return { valid: false, message: 'The tool input schema could not be validated.' };
  }
}

function recordRejectedCall(
  db: AuditDatabase,
  user: GeminiUser,
  toolName: string,
  reason: string,
): void {
  db.prepare(
    `INSERT INTO audit_log (id, user_id, username, upstream_id, upstream_name, tool_name, duration_ms, success, error_message)
     VALUES (?, ?, ?, NULL, NULL, ?, 0, 0, ?)`,
  ).run(randomUUID(), user.id, user.username, toolName.slice(0, 200), reason.slice(0, 1000));
}

function normalizeToolResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.content)) return result;
  if ('structuredContent' in result) {
    return { structuredContent: result.structuredContent, isError: result.isError === true };
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

function cleanFinalAnswer(text: string): string {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = clean.match(/^```(?:json|markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) clean = fence[1]!.trim();
  try {
    const parsed = JSON.parse(clean);
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
