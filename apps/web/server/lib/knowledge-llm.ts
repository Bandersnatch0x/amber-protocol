/**
 * VENDOR-AWARE BOUNDARY — this is the ONLY module that may reference
 * provider-specific HTTP endpoints, authentication headers, or API formats.
 * All other modules in the LLM semantic layer must call complete() without
 * knowing any network or vendor details.
 */

export interface LLMStatus {
  available: false;
}

export interface LLMAvailableStatus {
  available: true;
  provider: string;
  model: string;
}

export type LLMStatusResult = LLMStatus | LLMAvailableStatus;

function readConfig() {
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    provider: (process.env.LLM_PROVIDER ?? 'openai').toLowerCase(),
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    baseUrl: process.env.LLM_BASE_URL ?? '',
  };
}

export function getStatus(): LLMStatusResult {
  const { apiKey, provider, model } = readConfig();
  if (!apiKey) return { available: false };
  return { available: true, provider, model };
}

export async function complete(systemPrompt: string, userMessage: string): Promise<string> {
  const { apiKey, provider, model, baseUrl } = readConfig();
  if (!apiKey) throw new Error('LLM unavailable: no API key configured');

  if (provider === 'stub') {
    return buildStubResponse(userMessage);
  }

  if (provider === 'anthropic') {
    return completeAnthropic({ apiKey, model, baseUrl, systemPrompt, userMessage });
  }

  return completeOpenAI({ apiKey, model, baseUrl, systemPrompt, userMessage });
}

function buildStubResponse(userMessage: string): string {
  const hasEdgesKeyword = userMessage.includes('"edges"') || userMessage.includes('edge');
  if (hasEdgesKeyword) {
    return JSON.stringify({ edges: [] });
  }
  return JSON.stringify({ summaries: [] });
}

interface CallParams {
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  userMessage: string;
}

async function completeOpenAI(p: CallParams): Promise<string> {
  const base = p.baseUrl || 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages: [
        { role: 'system', content: p.systemPrompt },
        { role: 'user', content: p.userMessage },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM API error ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');
  return content;
}

async function completeAnthropic(p: CallParams): Promise<string> {
  const base = p.baseUrl || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': p.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: 2048,
      system: p.systemPrompt,
      messages: [{ role: 'user', content: p.userMessage }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM API error ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text: string }> };
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('LLM returned empty response');
  return text;
}
