/**
 * VENDOR-AWARE BOUNDARY — this is the ONLY module that may reference
 * provider-specific HTTP endpoints, authentication headers, or API formats.
 */

export type LLMProvider = 'openai' | 'anthropic' | 'stub';
export type LLMFacadePurpose = 'semantic-edges' | 'node-summaries';

export interface LLMStatus {
  available: false;
  reason?: 'not-configured' | 'invalid-config';
}

export interface LLMAvailableStatus {
  available: true;
  provider: LLMProvider;
  model: string;
}

export type LLMStatusResult = LLMStatus | LLMAvailableStatus;

interface LLMConfig {
  apiKey: string;
  provider: LLMProvider;
  model: string;
  baseUrl: string;
}

const PROVIDERS = new Set<LLMProvider>(['openai', 'anthropic', 'stub']);
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_OUTPUT_TOKENS = 2_048;

export class KnowledgeLLMError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'KnowledgeLLMError';
  }
}

function parseProvider(value: string | undefined): LLMProvider {
  const provider = value ?? 'openai';
  if (!PROVIDERS.has(provider as LLMProvider)) {
    throw new KnowledgeLLMError('invalid-provider');
  }
  return provider as LLMProvider;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateBaseUrl(provider: LLMProvider, configured: string): string {
  if (provider === 'stub') return 'stub://local';

  const fallback =
    provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  let url: URL;
  try {
    url = new URL(configured || fallback);
  } catch {
    throw new KnowledgeLLMError('invalid-base-url');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new KnowledgeLLMError('invalid-base-url');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new KnowledgeLLMError('invalid-base-url');
  }

  return url.toString().replace(/\/$/, '');
}

function readTimeoutMs(): number {
  const parsed = Number(process.env.LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > DEFAULT_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function readConfig(): LLMConfig {
  const apiKey = process.env.LLM_API_KEY ?? '';
  const provider = parseProvider(process.env.LLM_PROVIDER);
  return {
    apiKey,
    provider,
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
    baseUrl: validateBaseUrl(provider, process.env.LLM_BASE_URL ?? ''),
  };
}

export function getStatus(): LLMStatusResult {
  if (!process.env.LLM_API_KEY) return { available: false, reason: 'not-configured' };
  try {
    const { provider, model } = readConfig();
    return { available: true, provider, model };
  } catch {
    return { available: false, reason: 'invalid-config' };
  }
}

export function getCacheIdentity(): { provider: LLMProvider; model: string; endpoint: string } {
  const { apiKey, provider, model, baseUrl } = readConfig();
  if (!apiKey) throw new KnowledgeLLMError('not-configured');
  return { provider, model, endpoint: baseUrl };
}

export async function complete(
  purpose: LLMFacadePurpose,
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = readConfig();
  if (!config.apiKey) throw new KnowledgeLLMError('not-configured');

  if (config.provider === 'stub') {
    return buildStubResponse(purpose, userMessage);
  }
  if (config.provider === 'anthropic') {
    return completeAnthropic(config, systemPrompt, userMessage, signal);
  }
  return completeOpenAI(config, systemPrompt, userMessage, signal);
}

function buildStubResponse(purpose: LLMFacadePurpose, userMessage: string): string {
  const request = JSON.parse(userMessage) as {
    nodes?: Array<{ id?: unknown; title?: unknown }>;
    existingEdges?: Array<{ src?: unknown; dst?: unknown; verb?: unknown }>;
  };
  const nodes = (request.nodes ?? []).filter(
    (node): node is { id: string; title?: unknown } => typeof node.id === 'string',
  );

  const preferred = [
    ...nodes.filter((node) => node.id === 'adr:0001'),
    ...nodes.filter((node) => node.id === 'feature:F001'),
    ...nodes.filter((node) => node.id !== 'adr:0001' && node.id !== 'feature:F001'),
  ];

  if (purpose === 'node-summaries') {
    const first = preferred[0];
    return JSON.stringify({
      summaries: first
        ? [
            {
              nodeId: first.id,
              summary: `Semantic summary for ${String(first.title ?? first.id)}.`,
            },
          ]
        : [],
    });
  }

  const existing = new Set(
    (request.existingEdges ?? []).map(
      (edge) => `${String(edge.src)}|${String(edge.dst)}|${String(edge.verb)}`,
    ),
  );
  for (const src of preferred) {
    for (const dst of preferred) {
      const key = `${src.id}|${dst.id}|references`;
      if (src.id !== dst.id && !existing.has(key)) {
        return JSON.stringify({ edges: [{ src: src.id, dst: dst.id, verb: 'references' }] });
      }
    }
  }
  return JSON.stringify({ edges: [] });
}

async function requestTextWithBounds(
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([controller.signal, callerSignal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new KnowledgeLLMError('provider-http-error');
    }
    return await readBoundedResponse(response);
  } catch (error) {
    if (controller.signal.aborted) throw new KnowledgeLLMError('provider-timeout');
    if (callerSignal?.aborted) throw new KnowledgeLLMError('provider-aborted');
    if (error instanceof KnowledgeLLMError) throw error;
    throw new KnowledgeLLMError('provider-unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new KnowledgeLLMError('response-too-large');
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new KnowledgeLLMError('response-too-large');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new KnowledgeLLMError('response-too-large');
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function completeOpenAI(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const raw = await requestTextWithBounds(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
      }),
    },
    signal,
  );
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(raw);
  } catch (error) {
    if (error instanceof KnowledgeLLMError) throw error;
    throw new KnowledgeLLMError('invalid-provider-response');
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new KnowledgeLLMError('empty-provider-response');
  return content;
}

async function completeAnthropic(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const raw = await requestTextWithBounds(
    `${config.baseUrl}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    },
    signal,
  );
  let data: { content?: Array<{ type: string; text: string }> };
  try {
    data = JSON.parse(raw);
  } catch (error) {
    if (error instanceof KnowledgeLLMError) throw error;
    throw new KnowledgeLLMError('invalid-provider-response');
  }
  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (!text) throw new KnowledgeLLMError('empty-provider-response');
  return text;
}
