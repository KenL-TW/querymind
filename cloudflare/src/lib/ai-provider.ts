import { aiProviderConfigured, gatewayHeaders, resolveAiProvider, type AiProviderId } from "./ai-config";
import { HttpError, readResponseJson } from "./http";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  toolChoice?: "auto" | "none" | "required";
  temperature: number;
  maxOutputTokens: number;
  responseFormat?: "json_object";
  signal: AbortSignal;
}

export interface ProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderTrace {
  providerId: AiProviderId;
  mode: "live" | "mock";
  model: string;
  referenceId: string;
  requestedAt: string;
  completedAt: string;
  status: "success" | "mock";
  latencyMs: number;
  tokenUsage?: ProviderTokenUsage;
}

export interface ProviderCompletion {
  content: string | null;
  toolCalls: ProviderToolCall[];
  finishReason?: string | null;
  trace: ProviderTrace;
}

const PROVIDER_ERROR_STATUS: Record<string, number> = {
  AI_PROVIDER_RATE_LIMIT: 429,
  AI_PROVIDER_QUOTA: 429,
  AI_PROVIDER_AUTH: 502,
  AI_PROVIDER_TIMEOUT: 504,
  AI_PROVIDER_BAD_REQUEST: 502,
  AI_PROVIDER_UPSTREAM: 502,
  AI_PROVIDER_INVALID_RESPONSE: 502,
  AI_PROVIDER_CONFIG: 503,
};

function providerError(code: keyof typeof PROVIDER_ERROR_STATUS, referenceId: string, message?: string): HttpError {
  return new HttpError(PROVIDER_ERROR_STATUS[code], code, message ?? "AI provider request failed.", referenceId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function tokenUsage(value: unknown): ProviderTokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens;
  const totalTokens = usage.total_tokens;
  const valid = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!valid(inputTokens) || !valid(outputTokens)) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: valid(totalTokens) ? totalTokens : inputTokens + outputTokens,
  };
}

function normalizeArguments(value: unknown, referenceId: string): string {
  let parsed: unknown;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) as unknown; } catch { throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId); }
  } else {
    parsed = value;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  return JSON.stringify(parsed);
}

function normalizeOpenAiToolCalls(value: unknown, referenceId: string): ProviderToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  return value.map((item) => {
    const call = asRecord(item);
    const fn = asRecord(call?.function);
    if (!call || typeof call.id !== "string" || !call.id || call.type !== "function" || typeof fn?.name !== "string" || !fn.name) {
      throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
    }
    return { id: call.id, name: fn.name, arguments: normalizeArguments(fn.arguments, referenceId) };
  });
}

function normalizeWorkersAiToolCalls(value: unknown, referenceId: string): ProviderToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  return value.map((item) => {
    const call = asRecord(item);
    const fn = asRecord(call?.function);
    const name = typeof fn?.name === "string" ? fn.name : call?.name;
    const args = fn ? fn.arguments : call?.arguments;
    if (!call || typeof name !== "string" || !name) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
    return {
      id: typeof call.id === "string" && call.id ? call.id : crypto.randomUUID(),
      name,
      arguments: normalizeArguments(args, referenceId),
    };
  });
}

interface NormalizedAiResponse {
  content: string | null;
  toolCalls: ProviderToolCall[];
  finishReason?: string | null;
  usage?: ProviderTokenUsage;
}

const WORKERS_AI_FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter", "function_call"]);

function normalizeWorkersAiFinishReason(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && WORKERS_AI_FINISH_REASONS.has(value) ? value : undefined;
}

function hasUsableCompletion(content: string | null, toolCalls: ProviderToolCall[]): boolean {
  return (content !== null && content.trim().length > 0) || toolCalls.length > 0;
}

function normalizeOpenAiResponse(value: unknown, referenceId: string): NormalizedAiResponse {
  const root = asRecord(value);
  const choices = root?.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  if (!choice || !message || (message.content !== null && message.content !== undefined && typeof message.content !== "string") || (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== "string")) {
    throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  }
  const usage = tokenUsage(root?.usage);
  const content = typeof message.content === "string" ? message.content : null;
  const toolCalls = normalizeOpenAiToolCalls(message.tool_calls, referenceId);
  if (!hasUsableCompletion(content, toolCalls)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  const finishReason = normalizeWorkersAiFinishReason(choice.finish_reason);
  return {
    content,
    toolCalls,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage ? { usage } : {}),
  };
}

function normalizeWorkersAiResponse(value: unknown, referenceId: string): NormalizedAiResponse {
  const root = asRecord(value);
  if (!root) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  if (Object.hasOwn(root, "choices")) {
    if (!Array.isArray(root.choices)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
    return normalizeOpenAiResponse(value, referenceId);
  }
  const hasResponse = Object.hasOwn(root, "response");
  const hasToolCalls = Object.hasOwn(root, "tool_calls");
  if (!hasResponse && !hasToolCalls) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  if (root.response !== null && root.response !== undefined && typeof root.response !== "string") {
    throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  }
  if (root.finish_reason !== undefined && root.finish_reason !== null && typeof root.finish_reason !== "string") {
    throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  }
  const toolCalls = normalizeWorkersAiToolCalls(root.tool_calls, referenceId);
  const content = typeof root.response === "string" ? root.response : null;
  if (!hasUsableCompletion(content, toolCalls)) throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId);
  const usage = tokenUsage(root.usage);
  const finishReason = normalizeWorkersAiFinishReason(root.finish_reason);
  return {
    content,
    toolCalls,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage ? { usage } : {}),
  };
}

/** Shape-only Preview diagnostics. Never logs model content, tool arguments, or arbitrary provider keys. */
function safeWorkersAiResponseShape(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  if (!root) return {
    root_type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    root_is_array: Array.isArray(value),
    top_level_keys: [],
    choices_type: "absent",
    choices_count: 0,
    content_source: "absent",
    content_type: "absent",
    tool_calls_present: false,
    tool_call_count: 0,
    finish_reason_present: false,
    usage_present: false,
    usage_keys: [],
  };
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const hasMessageContent = Boolean(message && Object.hasOwn(message, "content"));
  const hasResponse = Object.hasOwn(root, "response");
  const content = hasMessageContent ? message?.content : root.response;
  const contentSource = hasMessageContent ? "choices[0].message.content" : hasResponse ? "response" : "absent";
  const toolCalls = message?.tool_calls ?? root.tool_calls;
  const usage = asRecord(root.usage);
  const safeKeyNames = (record: Record<string, unknown> | null): string[] => record
    ? Object.keys(record).filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key)).slice(0, 24)
    : [];
  const rawFinishReason = choice && Object.hasOwn(choice, "finish_reason") ? choice.finish_reason : root.finish_reason;
  const finishReason = normalizeWorkersAiFinishReason(rawFinishReason);
  return {
    root_type: "object",
    root_is_array: false,
    top_level_keys: safeKeyNames(root),
    choices_type: Object.hasOwn(root, "choices") ? (Array.isArray(root.choices) ? "array" : typeof root.choices) : "absent",
    choices_count: choices.length,
    choice_keys: safeKeyNames(choice),
    message_keys: safeKeyNames(message),
    content_source: contentSource,
    response_type: !hasResponse ? "absent" : root.response === null ? "null" : typeof root.response,
    ...(typeof root.response === "string" ? { response_length: root.response.length } : {}),
    content_type: content === null ? "null" : content === undefined ? "absent" : typeof content,
    ...(typeof content === "string" ? { content_length: content.length } : {}),
    tool_calls_present: (message && Object.hasOwn(message, "tool_calls")) || Object.hasOwn(root, "tool_calls"),
    tool_call_count: Array.isArray(toolCalls) ? toolCalls.length : toolCalls === undefined || toolCalls === null ? 0 : null,
    finish_reason_present: (Boolean(choice && Object.hasOwn(choice, "finish_reason")) || Object.hasOwn(root, "finish_reason")),
    ...(finishReason !== undefined ? { finish_reason: finishReason } : rawFinishReason === null ? { finish_reason: null } : typeof rawFinishReason === "string" ? { finish_reason: "other" } : {}),
    usage_present: root.usage !== undefined && root.usage !== null,
    usage_keys: safeKeyNames(usage),
  };
}

function isControlledResponseShapeSmoke(request: ProviderRequest): boolean {
  return request.messages.length === 1
    && request.messages[0].role === "user"
    && request.messages[0].content === "Return exactly: READY"
    && (!request.tools || request.tools.length === 0)
    && request.responseFormat === undefined;
}

function toProviderMessages(messages: ProviderMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "tool") {
      if (!message.toolCallId) throw new HttpError(503, "AI_PROVIDER_CONFIG", "Tool result is missing its call reference.");
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content ?? "" };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toProviderTools(tools: ProviderTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.strict === undefined ? {} : { strict: tool.strict }),
    },
  }));
}

function classifyProviderStatus(status: number, errorBody: unknown, referenceId: string): HttpError {
  const body = JSON.stringify(errorBody ?? "").toLowerCase();
  if (status === 401 || status === 403) return providerError("AI_PROVIDER_AUTH", referenceId);
  if (status === 402 || /insufficient[_ -]quota|credit[_ -]balance[_ -]exhausted|quota[_ -]exceeded/u.test(body)) {
    return providerError("AI_PROVIDER_QUOTA", referenceId);
  }
  if (status === 429) return providerError("AI_PROVIDER_RATE_LIMIT", referenceId);
  if (status === 408 || status === 504) return providerError("AI_PROVIDER_TIMEOUT", referenceId);
  if (status === 400 || status === 422) return providerError("AI_PROVIDER_BAD_REQUEST", referenceId);
  return providerError("AI_PROVIDER_UPSTREAM", referenceId);
}

async function safeErrorBody(response: Response): Promise<unknown> {
  try { return await readResponseJson(response); } catch { return undefined; }
}

async function openAiGatewayCompletion(env: Env, request: ProviderRequest, referenceId: string): Promise<{ content: string | null; toolCalls: ProviderToolCall[]; usage?: ProviderTokenUsage }> {
  if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_TOKEN) throw providerError("AI_PROVIDER_CONFIG", referenceId);
  let response: Response;
  try {
    response = await fetch(env.AI_GATEWAY_URL, {
      method: "POST",
      headers: gatewayHeaders(env, referenceId),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        max_completion_tokens: request.maxOutputTokens,
        messages: toProviderMessages(request.messages),
        ...(request.tools ? {
          tools: toProviderTools(request.tools),
          tool_choice: request.toolChoice ?? "auto",
          parallel_tool_calls: false,
        } : {}),
        ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
      }),
    });
  } catch (error) {
    if (request.signal.aborted) throw new HttpError(499, "CLIENT_CLOSED_REQUEST", "The client disconnected before the AI request completed.", referenceId);
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw providerError("AI_PROVIDER_TIMEOUT", referenceId);
    throw providerError("AI_PROVIDER_UPSTREAM", referenceId);
  }
  if (!response.ok) throw classifyProviderStatus(response.status, await safeErrorBody(response), referenceId);
  let value: unknown;
  try { value = await readResponseJson(response); } catch { throw providerError("AI_PROVIDER_INVALID_RESPONSE", referenceId); }
  return normalizeOpenAiResponse(value, referenceId);
}

function raceWorkersAi<T>(promise: Promise<T>, signal: AbortSignal, referenceId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new HttpError(499, "CLIENT_CLOSED_REQUEST", "The client disconnected before the AI request completed.", referenceId)));
    const timer = setTimeout(() => finish(() => reject(providerError("AI_PROVIDER_TIMEOUT", referenceId))), 30_000);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
  });
}

function safeThrownCode(error: unknown): string | null {
  const value = asRecord(error);
  const code = value?.code ?? value?.status;
  return typeof code === "string" || typeof code === "number" ? String(code).toLowerCase() : null;
}

interface SafeWorkersAiErrorMetadata {
  name?: string;
  code?: string;
  status?: number;
  traceId?: string;
}

const workersAiErrorMetadata = new WeakMap<HttpError, SafeWorkersAiErrorMetadata>();

function safeProviderCode(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 999_999) return String(value);
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  return /^\d{1,6}$/u.test(code) || /^[A-Z][A-Z0-9_.-]{0,63}$/u.test(code) ? code : undefined;
}

function safeProviderName(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value) ? value : undefined;
}

function safeProviderTraceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/u.test(value) ? value : undefined;
}

/** Extract only allow-listed structured metadata. Never inspect provider messages or bodies. */
function readSafeWorkersAiErrorMetadata(error: unknown): SafeWorkersAiErrorMetadata {
  const root = asRecord(error);
  if (!root) return {};
  const records = [root, asRecord(root.error), asRecord(root.cause), asRecord(root.response)].filter((item): item is Record<string, unknown> => item !== null);
  const metadata: SafeWorkersAiErrorMetadata = {};
  for (const record of records) {
    metadata.name ??= safeProviderName(record.name ?? record.type);
    metadata.code ??= safeProviderCode(record.code ?? record.errorCode ?? record.error_code ?? record.cfErrorCode);
    const status = record.status ?? record.statusCode ?? record.status_code;
    if (metadata.status === undefined && typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) metadata.status = status;
    metadata.traceId ??= safeProviderTraceId(record.requestId ?? record.request_id ?? record.rayId ?? record.ray_id ?? record.cfRay ?? record.cf_ray ?? record.traceId ?? record.trace_id);
  }
  const response = asRecord(root.response);
  const headers = response?.headers;
  if (!metadata.status && response && typeof response.status === "number" && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) metadata.status = response.status;
  if (!metadata.traceId && headers instanceof Headers) metadata.traceId = safeProviderTraceId(headers.get("cf-ray") ?? headers.get("cf-request-id"));
  return metadata;
}

function normalizeWorkersAiProviderError(error: unknown, referenceId: string): HttpError {
  if (error instanceof HttpError) return error;
  const metadata = readSafeWorkersAiErrorMetadata(error);
  let normalized: HttpError;
  switch (metadata.code) {
    case "3036": normalized = providerError("AI_PROVIDER_QUOTA", referenceId); break;
    case "5035":
    case "5018":
    case "5016":
    case "3041":
    case "3023": normalized = providerError("AI_PROVIDER_AUTH", referenceId); break;
    case "5007":
    case "3042":
    case "5004":
    case "3003":
    case "3006": normalized = providerError("AI_PROVIDER_BAD_REQUEST", referenceId); break;
    case "3007":
    case "3008": normalized = providerError("AI_PROVIDER_TIMEOUT", referenceId); break;
    default: normalized = normalizeProviderError(error, referenceId);
  }
  if (Object.keys(metadata).length) workersAiErrorMetadata.set(normalized, metadata);
  return normalized;
}

function normalizeProviderError(error: unknown, referenceId: string): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return providerError("AI_PROVIDER_TIMEOUT", referenceId);
  const code = safeThrownCode(error) ?? "";
  const status = Number(asRecord(error)?.status);
  if (status) return classifyProviderStatus(status, { code }, referenceId);
  if (/insufficient[_ -]quota|credit[_ -]balance[_ -]exhausted|quota[_ -]exceeded/u.test(code)) return providerError("AI_PROVIDER_QUOTA", referenceId);
  if (/rate[_ -]?limit|too[_ -]many[_ -]requests|^429$/u.test(code)) return providerError("AI_PROVIDER_RATE_LIMIT", referenceId);
  if (/unauthorized|forbidden|^401$|^403$/u.test(code)) return providerError("AI_PROVIDER_AUTH", referenceId);
  if (/invalid[_ -]request|bad[_ -]request|^400$|^422$/u.test(code)) return providerError("AI_PROVIDER_BAD_REQUEST", referenceId);
  return providerError("AI_PROVIDER_UPSTREAM", referenceId);
}

async function workersAiCompletion(env: Env, request: ProviderRequest, referenceId: string): Promise<{ content: string | null; toolCalls: ProviderToolCall[]; usage?: ProviderTokenUsage }> {
  if (!env.AI || typeof env.AI.run !== "function") throw providerError("AI_PROVIDER_CONFIG", referenceId);
  const input: Record<string, unknown> = {
    messages: toProviderMessages(request.messages),
    temperature: request.temperature,
    max_completion_tokens: request.maxOutputTokens,
    ...(request.tools ? {
      tools: toProviderTools(request.tools),
      tool_choice: request.toolChoice ?? "auto",
      parallel_tool_calls: false,
    } : {}),
    ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
  };
  let pending: Promise<unknown>;
  try {
    pending = env.AI.run(request.model, input, { tags: ["querymind", referenceId] });
  } catch (error) {
    throw normalizeWorkersAiProviderError(error, referenceId);
  }
  let raw: unknown;
  try { raw = await raceWorkersAi(pending, request.signal, referenceId); } catch (error) { throw normalizeWorkersAiProviderError(error, referenceId); }
  if (env.ENVIRONMENT === "preview" && isControlledResponseShapeSmoke(request)) {
    console.info(JSON.stringify({
      event: "ai_provider.response_shape",
      provider_id: "workers_ai",
      model: request.model,
      reference_id: referenceId,
      ...safeWorkersAiResponseShape(raw),
    }));
  }
  return normalizeWorkersAiResponse(raw, referenceId);
}

export async function completeWithAiProvider(env: Env, request: ProviderRequest): Promise<ProviderCompletion> {
  const selection = resolveAiProvider(env);
  const referenceId = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  const startedAt = Date.now();
  if (request.model !== selection.model) throw providerError("AI_PROVIDER_CONFIG", referenceId);
  if (!aiProviderConfigured(env)) throw providerError("AI_PROVIDER_CONFIG", referenceId);
  try {
    const completion = selection.providerId === "openai_gateway"
      ? await openAiGatewayCompletion(env, request, referenceId)
      : await workersAiCompletion(env, request, referenceId);
    const completedAt = new Date().toISOString();
    const trace: ProviderTrace = {
      providerId: selection.providerId,
      mode: "live",
      model: selection.model,
      referenceId,
      requestedAt,
      completedAt,
      status: "success",
      latencyMs: Math.max(0, Date.now() - startedAt),
      ...(completion.usage ? { tokenUsage: completion.usage } : {}),
    };
    console.info(JSON.stringify({
      event: "ai_provider.completed",
      provider_id: trace.providerId,
      model: trace.model,
      reference_id: trace.referenceId,
      status: trace.status,
      latency_ms: trace.latencyMs,
      ...(trace.tokenUsage ? { token_usage: trace.tokenUsage } : {}),
    }));
    return { ...completion, trace };
  } catch (error) {
    const normalized = normalizeProviderError(error, referenceId);
    const code = normalized.code in PROVIDER_ERROR_STATUS ? normalized.code : "AI_PROVIDER_UPSTREAM";
    const workersAiMetadata = selection.providerId === "workers_ai" ? workersAiErrorMetadata.get(normalized) : undefined;
    console.error(JSON.stringify({
      event: "ai_provider.failed",
      provider_id: selection.providerId,
      model: selection.model,
      reference_id: normalized.referenceId ?? referenceId,
      error_code: code,
      status: normalized.status,
      latency_ms: Math.max(0, Date.now() - startedAt),
      ...(workersAiMetadata?.name ? { cf_error_name: workersAiMetadata.name } : {}),
      ...(workersAiMetadata?.code ? { cf_error_code: workersAiMetadata.code } : {}),
      ...(workersAiMetadata?.status ? { cf_http_status: workersAiMetadata.status } : {}),
      ...(workersAiMetadata?.traceId ? { cf_trace_id: workersAiMetadata.traceId } : {}),
    }));
    throw normalized;
  }
}
