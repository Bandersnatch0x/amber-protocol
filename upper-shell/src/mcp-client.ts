/**
 * S2 — Amber MCP client: newline-delimited JSON-RPC 2.0 over stdio.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import type { McpTool, McpToolCallResult } from "./types.ts";

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number | string;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface McpTransport {
	write(line: string): void;
	onLine(handler: (line: string) => void): void;
	close(): void;
}

export type SpawnFn = typeof spawn;

export interface SpawnMcpOptions {
	amberRoot: string;
	target: string;
	execute?: boolean;
	nodeBin?: string;
	env?: NodeJS.ProcessEnv;
	spawnFn?: SpawnFn;
}

/** Spawn `node scripts/amber-mcp.js --target <repo>` as a line transport. */
export function spawnAmberMcpTransport(opts: SpawnMcpOptions): {
	transport: McpTransport;
	child: ChildProcessWithoutNullStreams;
} {
	const script = path.join(opts.amberRoot, "scripts", "amber-mcp.js");
	const args = [script, "--target", opts.target];
	if (opts.execute) args.push("--execute");
	const spawnFn = opts.spawnFn ?? spawn;
	const child = spawnFn(opts.nodeBin ?? process.execPath, args, {
		stdio: ["pipe", "pipe", "pipe"],
		env: opts.env ?? process.env,
	}) as ChildProcessWithoutNullStreams;
	const rl = createInterface({ input: child.stdout });
	const handlers: Array<(line: string) => void> = [];
	rl.on("line", (line) => {
		for (const h of handlers) h(line);
	});
	child.stderr?.on("data", (buf) => {
		process.stderr.write(`[amber-mcp] ${buf}`);
	});
	const transport: McpTransport = {
		write(line: string) {
			child.stdin.write(line.endsWith("\n") ? line : `${line}\n`);
		},
		onLine(handler) {
			handlers.push(handler);
		},
		close() {
			rl.close();
			if (!child.killed) child.kill("SIGTERM");
		},
	};
	return { transport, child };
}

export class AmberMcpClient {
	private nextId = 1;
	private pending = new Map<
		number | string,
		{ resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
	>();
	private closed = false;

	constructor(
		private readonly transport: McpTransport,
		private readonly timeoutMs = 60_000,
	) {
		transport.onLine((line) => this.onLine(line));
	}

	private onLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg: JsonRpcResponse;
		try {
			msg = JSON.parse(trimmed) as JsonRpcResponse;
		} catch {
			return;
		}
		if (msg.id === undefined || msg.id === null) return;
		const waiter = this.pending.get(msg.id);
		if (!waiter) return;
		this.pending.delete(msg.id);
		waiter.resolve(msg);
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (this.closed) throw new Error("MCP client closed");
		const id = this.nextId++;
		const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP timeout waiting for ${method}`));
			}, this.timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			try {
				this.transport.write(JSON.stringify(payload));
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
		if (response.error) {
			throw new Error(`MCP ${method} error ${response.error.code}: ${response.error.message}`);
		}
		return response.result;
	}

	async initialize(): Promise<unknown> {
		const result = await this.request("initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "amber-upper-shell", version: "0.1.0" },
		});
		try {
			this.transport.write(
				JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
			);
		} catch {
			/* notification is best-effort */
		}
		return result;
	}

	async listTools(): Promise<McpTool[]> {
		const result = (await this.request("tools/list", {})) as { tools?: McpTool[] };
		return result.tools ?? [];
	}

	async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
		const result = (await this.request("tools/call", {
			name,
			arguments: args,
		})) as McpToolCallResult;
		return enrichToolResult(result);
	}

	async ping(): Promise<unknown> {
		return this.request("ping", {});
	}

	close(): void {
		this.closed = true;
		for (const [, waiter] of this.pending) {
			waiter.reject(new Error("MCP client closed"));
		}
		this.pending.clear();
		this.transport.close();
	}
}

export function enrichToolResult(result: McpToolCallResult): McpToolCallResult {
	const text = (result.content ?? [])
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("\n");
	let parsed: unknown = result.structuredContent;
	if (parsed === undefined && text) parsed = tryParseJson(text);
	return { ...result, parsed };
}

function tryParseJson(text: string): unknown {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		/* try first JSON object */
	}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			return JSON.parse(trimmed.slice(start, end + 1));
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** In-memory fake transport for unit tests. */
export function createFakeTransport(handler: (req: JsonRpcRequest) => JsonRpcResponse | void): {
	transport: McpTransport;
	lines: string[];
} {
	const lines: string[] = [];
	let lineHandler: ((line: string) => void) | null = null;
	const transport: McpTransport = {
		write(line: string) {
			lines.push(line.trim());
			let req: JsonRpcRequest;
			try {
				req = JSON.parse(line) as JsonRpcRequest;
			} catch {
				return;
			}
			if (req.id === undefined) return;
			const res = handler(req);
			if (res && lineHandler) lineHandler(JSON.stringify(res));
		},
		onLine(h) {
			lineHandler = h;
		},
		close() {
			/* noop */
		},
	};
	return { transport, lines };
}
