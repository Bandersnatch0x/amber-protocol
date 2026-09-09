import assert from "node:assert/strict";
import { test } from "node:test";
import {
	completeChat,
	configFromEnv,
	createModelAdapter,
	streamChat,
} from "../src/model-adapter.ts";

test("configFromEnv reads defaults and overrides", () => {
	const cfg = configFromEnv({
		apiKey: "k",
		baseUrl: "https://example.com/v1/",
		model: "m1",
	});
	assert.equal(cfg.apiKey, "k");
	assert.equal(cfg.baseUrl, "https://example.com/v1");
	assert.equal(cfg.model, "m1");
});

test("non-stream chatCompletion parses tool_calls", async () => {
	const fetchImpl: typeof fetch = async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as { stream?: boolean };
		assert.equal(body.stream, false);
		return new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "c1",
									type: "function",
									function: { name: "amber.session.status", arguments: '{"x":1}' },
								},
							],
						},
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	const adapter = createModelAdapter({
		apiKey: "test",
		baseUrl: "https://example.com/v1",
		model: "test-model",
		fetchImpl,
	});
	const msg = await adapter.chatCompletion({
		messages: [{ role: "user", content: "hi" }],
		stream: false,
	});
	assert.equal(msg.role, "assistant");
	assert.equal(msg.tool_calls?.[0]?.function.name, "amber.session.status");
	assert.equal(msg.tool_calls?.[0]?.function.arguments, '{"x":1}');
});

test("streamChat yields text deltas then returns the assistant message", async () => {
	const sse = [
		'data: {"choices":[{"delta":{"content":"Hel"}}]}',
		'data: {"choices":[{"delta":{"content":"lo"}}]}',
		"data: [DONE]",
		"",
	].join("\n");
	const fetchImpl: typeof fetch = async () =>
		new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
	const gen = streamChat(
		{ messages: [{ role: "user", content: "hi" }], stream: true },
		{ apiKey: "k", baseUrl: "https://example.com/v1", model: "m", fetchImpl },
	);
	const texts: string[] = [];
	let step = await gen.next();
	while (!step.done) {
		if (step.value.type === "text") texts.push(step.value.text);
		step = await gen.next();
	}
	assert.deepEqual(texts, ["Hel", "lo"]);
	assert.equal(step.value.content, "Hello");
	assert.equal(step.value.role, "assistant");
});

test("HTTP errors surface status", async () => {
	const fetchImpl: typeof fetch = async () => new Response("nope", { status: 401 });
	await assert.rejects(
		() =>
			completeChat(
				{ messages: [], stream: false },
				{ apiKey: "test", baseUrl: "https://example.com/v1", model: "m", fetchImpl },
			),
		/401/,
	);
});
