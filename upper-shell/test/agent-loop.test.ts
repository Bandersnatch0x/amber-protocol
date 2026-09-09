import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt, runAgentLoop } from "../src/agent-loop.ts";
import type { ChatMessage, McpToolCallResult, OpenAITool } from "../src/types.ts";

test("buildSystemPrompt includes objective", () => {
	assert.match(buildSystemPrompt("do thing"), /do thing/);
});

test("loop: tool call then stop", async () => {
	let calls = 0;
	const chat = async (): Promise<ChatMessage> => {
		calls += 1;
		if (calls === 1) {
			return {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "1",
						type: "function",
						function: { name: "amber.session.status", arguments: "{}" },
					},
				],
			};
		}
		return { role: "assistant", content: "done" };
	};
	const callTool = async (): Promise<McpToolCallResult> => ({
		content: [{ type: "text", text: '{"status":"ok"}' }],
		parsed: { status: "ok" },
	});
	const listOpenAITools = (): OpenAITool[] => [
		{ type: "function", function: { name: "amber.session.status", parameters: {} } },
	];
	const result = await runAgentLoop({
		objective: "check status",
		target: "/repo",
		chat,
		callTool,
		listOpenAITools,
	});
	assert.equal(result.stoppedReason, "stop");
	assert.equal(result.messages.filter((m) => m.role === "tool").length, 1);
	assert.equal(result.messages.at(-1)?.content, "done");
});

test("loop: approvalRequired invokes ask and denies", async () => {
	let asked = false;
	let calls = 0;
	const result = await runAgentLoop({
		objective: "start",
		target: "/repo",
		chat: async () => {
			calls += 1;
			if (calls === 1) {
				return {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "1",
							type: "function",
							function: { name: "amber.session.start", arguments: '{"goal":"x"}' },
						},
					],
				};
			}
			return { role: "assistant", content: "stopped after deny" };
		},
		callTool: async () => ({
			content: [
				{ type: "text", text: '{"approvalRequired":true,"command":"amber session start"}' },
			],
			parsed: { approvalRequired: true, command: "amber session start" },
		}),
		listOpenAITools: () => [],
		ask: async () => {
			asked = true;
			return false;
		},
	});
	assert.equal(asked, true);
	assert.equal(result.stoppedReason, "stop");
	const toolMsg = result.messages.find((m) => m.role === "tool");
	assert.match(toolMsg?.content ?? "", /denied|approved\":false/);
});

test("loop: approvalApproved uses executeApprovedCommand", async () => {
	let executed = false;
	let calls = 0;
	const result = await runAgentLoop({
		objective: "start",
		target: "/repo",
		chat: async () => {
			calls += 1;
			if (calls === 1) {
				return {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "1",
							type: "function",
							function: { name: "amber.session.start", arguments: "{}" },
						},
					],
				};
			}
			return { role: "assistant", content: "ok" };
		},
		callTool: async () => ({
			parsed: {
				approvalRequired: true,
				commandArgv: ["amber", "session", "start", "--goal", "x"],
			},
			content: [{ type: "text", text: "{}" }],
		}),
		listOpenAITools: () => [],
		ask: async () => true,
		executeApprovedCommand: async () => {
			executed = true;
			return { parsed: { sessionId: "sess_x" }, content: [{ type: "text", text: "{}" }] };
		},
	});
	assert.equal(executed, true);
	assert.equal(result.stoppedReason, "stop");
});
