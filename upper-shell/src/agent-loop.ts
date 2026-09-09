/**
 * S3 — Sequential agent turn loop (no parallel tools, no compaction).
 */
import { requestApproval } from "./approval-bridge.ts";
import type { AgentLoopOptions, ChatMessage, McpToolCallResult } from "./types.ts";
import { isApprovalRequired } from "./types.ts";

export interface AgentLoopResult {
	messages: ChatMessage[];
	sessionId?: string | null;
	stoppedReason: "stop" | "max_turns" | "aborted" | "error";
	error?: string;
}

export function buildSystemPrompt(objective: string, extra?: string): string {
	return [
		"You are Amber Upper Shell, an agent that completes repository work",
		"ONLY by calling Amber MCP tools. Never write .amber/ files yourself.",
		"Prefer read-only tools first. Mutating tools need human y/n approval.",
		"When the objective is done, reply with a concise summary and stop calling tools.",
		"",
		`Objective: ${objective}`,
		extra ? `\n${extra}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
	const maxTurns = opts.maxTurns ?? 12;
	const sessionId = opts.sessionId ?? null;
	const messages: ChatMessage[] = [
		{ role: "system", content: buildSystemPrompt(opts.objective, opts.systemPromptExtra) },
		{ role: "user", content: opts.objective },
	];

	const aborted = (): AgentLoopResult => ({
		messages,
		sessionId,
		stoppedReason: "aborted",
	});

	try {
		for (let turn = 0; turn < maxTurns; turn++) {
			if (opts.signal?.aborted) return aborted();
			opts.onEvent?.({ type: "turn.start", turn });
			const assistant = await opts.chat({
				messages,
				tools: opts.listOpenAITools(),
				signal: opts.signal,
				stream: false,
			});
			messages.push(assistant);
			opts.onEvent?.({ type: "turn.assistant", turn, message: assistant });

			const toolCalls = assistant.tool_calls ?? [];
			if (toolCalls.length === 0) {
				return { messages, sessionId, stoppedReason: "stop" };
			}

			for (const tc of toolCalls) {
				if (opts.signal?.aborted) return aborted();
				const name = tc.function.name;
				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
				} catch {
					args = {};
				}
				opts.onEvent?.({ type: "tool.call", name, args });
				let result: McpToolCallResult;
				try {
					result = await opts.callTool(name, args);
				} catch (err) {
					result = {
						isError: true,
						content: [
							{
								type: "text",
								text: JSON.stringify({
									error: err instanceof Error ? err.message : String(err),
								}),
							},
						],
						parsed: { error: err instanceof Error ? err.message : String(err) },
					};
				}

				if (isApprovalRequired(result.parsed)) {
					opts.onEvent?.({ type: "approval.required", name, payload: result.parsed });
					if (!opts.ask) {
						result = denialResult("no askFn configured; mutating tool blocked");
					} else {
						const { approved } = await requestApproval(result.parsed, opts.ask, name);
						if (!approved) {
							result = denialResult("operator denied approval");
						} else if (opts.executeApprovedCommand) {
							result = await opts.executeApprovedCommand(result.parsed);
						} else {
							result = denialResult("fail-closed: no executeApprovedCommand hook");
						}
					}
				}

				messages.push({
					role: "tool",
					tool_call_id: tc.id,
					name,
					content: serializeToolResult(result),
				});
				opts.onEvent?.({ type: "tool.result", name, result });
			}
		}
		return { messages, sessionId, stoppedReason: "max_turns" };
	} catch (err) {
		if (opts.signal?.aborted) return aborted();
		return {
			messages,
			sessionId,
			stoppedReason: "error",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

function denialResult(reason: string): McpToolCallResult {
	return {
		isError: true,
		content: [{ type: "text", text: JSON.stringify({ approved: false, reason }) }],
		parsed: { approved: false, reason },
	};
}

function serializeToolResult(result: McpToolCallResult): string {
	if (result.parsed !== undefined) {
		try {
			return JSON.stringify(result.parsed);
		} catch {
			/* fall through */
		}
	}
	const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
	return text || JSON.stringify({ isError: result.isError === true });
}
