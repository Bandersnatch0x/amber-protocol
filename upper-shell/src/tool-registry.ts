/**
 * S4 — Map Amber MCP tools/list → OpenAI tools and dispatch tools/call.
 */
import type { AmberMcpClient } from "./mcp-client.ts";
import type { McpTool, McpToolCallResult, OpenAITool } from "./types.ts";

const KNOWN_MUTATING = new Set([
	"amber.session.start",
	"amber.session.verify",
	"amber.session.approve",
	"amber.session.settle",
	"amber.session.lease",
	"amber.memory.approve",
	"amber.memory.abandon",
	"amber.context.ingest",
	"amber.breakglass.grant",
	"amber.external.propose",
	"amber.eval.admit",
]);

export interface ToolRegistryOptions {
	client: Pick<AmberMcpClient, "listTools" | "callTool">;
	target: string;
	agentId?: string;
}

export class ToolRegistry {
	private tools = new Map<string, McpTool>();

	constructor(private readonly opts: ToolRegistryOptions) {}

	async refresh(): Promise<McpTool[]> {
		const list = await this.opts.client.listTools();
		this.tools.clear();
		for (const t of list) this.tools.set(t.name, t);
		return list;
	}

	get(name: string): McpTool | undefined {
		return this.tools.get(name);
	}

	list(): McpTool[] {
		return [...this.tools.values()];
	}

	isKnownMutating(name: string): boolean {
		return KNOWN_MUTATING.has(name);
	}

	toOpenAITools(): OpenAITool[] {
		return this.list().map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: (t.inputSchema as Record<string, unknown>) ?? {
					type: "object",
					properties: {},
				},
			},
		}));
	}

	async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
		const merged: Record<string, unknown> = {
			...args,
			_target: args._target ?? this.opts.target,
			_agent: args._agent ?? this.opts.agentId ?? "upper-shell",
		};
		return this.opts.client.callTool(name, merged);
	}
}
