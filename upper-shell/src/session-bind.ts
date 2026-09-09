/**
 * S5 — Bind an Amber governance session via amber.session.start (MCP).
 * Failures continue degraded so tests without live Amber still pass.
 */
import { executeApprovedCommand, requestApproval } from "./approval-bridge.ts";
import type { AskFn, CaptureRun, McpToolCallResult } from "./types.ts";
import { isApprovalRequired } from "./types.ts";

export interface SessionBindRegistry {
	callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult>;
}

export interface SessionBindResult {
	sessionId: string | null;
	degraded: boolean;
	warning?: string;
	raw?: McpToolCallResult;
}

export async function bindSession(opts: {
	registry: SessionBindRegistry;
	objective: string;
	ask?: AskFn;
	amberRoot?: string;
	route?: string;
	runFn?: CaptureRun;
}): Promise<SessionBindResult> {
	try {
		let result = await opts.registry.callTool("amber.session.start", {
			goal: opts.objective,
			...(opts.route ? { route: opts.route } : {}),
		});

		let parsed = result.parsed;
		if (isApprovalRequired(parsed)) {
			const { approved } = await requestApproval(parsed, opts.ask, "amber.session.start");
			if (!approved) {
				return {
					sessionId: null,
					degraded: true,
					warning: "session start denied by operator; continuing degraded",
					raw: result,
				};
			}
			if (!opts.amberRoot) {
				return {
					sessionId: null,
					degraded: true,
					warning: "session start approved but amberRoot missing for command spawn",
					raw: result,
				};
			}
			result = await executeApprovedCommand(parsed, {
				amberRoot: opts.amberRoot,
				runFn: opts.runFn,
			});
			parsed = result.parsed;
		}

		const sessionId = extractSessionId(parsed, result);
		return {
			sessionId,
			degraded: !sessionId,
			warning: sessionId ? undefined : "session id not found in result",
			raw: result,
		};
	} catch (err) {
		return {
			sessionId: null,
			degraded: true,
			warning: `session start failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

export function extractSessionId(parsed: unknown, result?: McpToolCallResult): string | null {
	const candidates: unknown[] = [parsed];
	if (result?.structuredContent) candidates.push(result.structuredContent);
	for (const c of candidates) {
		const id = digSessionId(c);
		if (id) return id;
	}
	const text = (result?.content ?? []).map((x) => x.text ?? "").join("\n");
	return matchSessionId(text);
}

function matchSessionId(text: string): string | null {
	if (!text) return null;
	const created = text.match(/Session created:\s*([a-f0-9-]+)/i);
	if (created?.[1]) return created[1];
	const keyed = text.match(/session[_\s-]?id["'\s:=]+([a-zA-Z0-9._-]+)/i);
	return keyed?.[1] ?? null;
}

function digSessionId(value: unknown, depth = 0): string | null {
	if (depth > 5 || value == null) return null;
	if (typeof value === "string") {
		return matchSessionId(value) ?? value.match(/sess_[a-zA-Z0-9._-]+/)?.[0] ?? null;
	}
	if (typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	for (const key of ["sessionId", "session_id", "id"]) {
		if (typeof obj[key] === "string" && (obj[key] as string).length > 0) {
			return obj[key] as string;
		}
	}
	if (typeof obj.stdout === "string") {
		const fromOut = matchSessionId(obj.stdout);
		if (fromOut) return fromOut;
	}
	for (const v of Object.values(obj)) {
		const found = digSessionId(v, depth + 1);
		if (found) return found;
	}
	return null;
}
