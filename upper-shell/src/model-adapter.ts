/**
 * S1 — OpenAI-compatible chat completions (stream + non-stream fallback).
 * Env: OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
 */
import type {
	ChatMessage,
	ChatStreamEvent,
	ModelAdapterConfig,
	StreamChatParams,
	ToolCall,
} from "./types.ts";

export function configFromEnv(overrides: Partial<ModelAdapterConfig> = {}): ModelAdapterConfig {
	const apiKey = overrides.apiKey ?? process.env.OPENAI_API_KEY ?? "";
	const baseUrl = (
		overrides.baseUrl ??
		process.env.OPENAI_BASE_URL ??
		"https://api.openai.com/v1"
	).replace(/\/$/, "");
	const model = overrides.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
	return { apiKey, baseUrl, model, fetchImpl: overrides.fetchImpl };
}

export async function* streamChat(
	params: StreamChatParams,
	config: ModelAdapterConfig = configFromEnv(),
): AsyncGenerator<ChatStreamEvent, ChatMessage> {
	const fetchImpl = config.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) throw new Error("fetch is not available; provide fetchImpl");
	if (!config.apiKey) throw new Error("OPENAI_API_KEY is required");

	const useStream = params.stream !== false;
	const body: Record<string, unknown> = {
		model: config.model,
		messages: params.messages,
		stream: useStream,
	};
	if (params.tools && params.tools.length > 0) {
		body.tools = params.tools;
		body.tool_choice = "auto";
	}

	const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: params.signal,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 500)}`);
	}

	if (!useStream) {
		const json = (await res.json()) as { choices?: Array<{ message?: ChatMessage }> };
		const message = json.choices?.[0]?.message;
		if (!message) throw new Error("OpenAI response missing choices[0].message");
		const final = normalizeAssistant(message);
		if (final.content) yield { type: "text", text: final.content };
		if (final.tool_calls?.length) yield { type: "tool_calls", tool_calls: final.tool_calls };
		return final;
	}

	return yield* consumeSSE(res);
}

export async function completeChat(
	params: StreamChatParams,
	config?: ModelAdapterConfig,
	onEvent?: (event: ChatStreamEvent) => void,
): Promise<ChatMessage> {
	const gen = streamChat(params, config);
	let step = await gen.next();
	while (!step.done) {
		onEvent?.(step.value);
		step = await gen.next();
	}
	return step.value;
}

export function createModelAdapter(config: ModelAdapterConfig) {
	return {
		config,
		streamChat: (params: StreamChatParams) => streamChat(params, config),
		chatCompletion: (params: StreamChatParams, onEvent?: (event: ChatStreamEvent) => void) =>
			completeChat(params, config, onEvent),
	};
}

export type ModelAdapter = ReturnType<typeof createModelAdapter>;

function normalizeAssistant(message: ChatMessage): ChatMessage {
	return {
		role: "assistant",
		content: message.content ?? null,
		tool_calls: message.tool_calls,
	};
}

async function* consumeSSE(res: Response): AsyncGenerator<ChatStreamEvent, ChatMessage> {
	if (!res.body) throw new Error("stream response missing body");
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let content = "";
	const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

	const snapshot = (): ToolCall[] =>
		[...toolCalls.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, v], i) => ({
				id: v.id || `call_${i}`,
				type: "function" as const,
				function: { name: v.name, arguments: v.arguments || "{}" },
			}));

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const raw of lines) {
			const line = raw.trim();
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (data === "[DONE]") continue;
			let parsed: {
				choices?: Array<{
					delta?: {
						content?: string;
						tool_calls?: Array<{
							index?: number;
							id?: string;
							function?: { name?: string; arguments?: string };
						}>;
					};
				}>;
			};
			try {
				parsed = JSON.parse(data);
			} catch {
				continue;
			}
			const delta = parsed.choices?.[0]?.delta;
			if (!delta) continue;
			if (typeof delta.content === "string" && delta.content) {
				content += delta.content;
				yield { type: "text", text: delta.content };
			}
			if (delta.tool_calls?.length) {
				for (const tc of delta.tool_calls) {
					const idx = tc.index ?? 0;
					const cur = toolCalls.get(idx) ?? { id: "", name: "", arguments: "" };
					if (tc.id) cur.id = tc.id;
					if (tc.function?.name) cur.name += tc.function.name;
					if (tc.function?.arguments) cur.arguments += tc.function.arguments;
					toolCalls.set(idx, cur);
				}
				yield { type: "tool_calls", tool_calls: snapshot() };
			}
		}
	}

	const tool_calls = toolCalls.size > 0 ? snapshot() : undefined;
	return { role: "assistant", content: content || null, tool_calls };
}
