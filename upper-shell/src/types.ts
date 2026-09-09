/** Shared types for Upper Shell MVP (S1–S7). */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallFunction {
	name: string;
	arguments: string;
}

export interface ToolCall {
	id: string;
	type: "function";
	function: ToolCallFunction;
}

export interface ChatMessage {
	role: Role;
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export type ChatStreamEvent =
	{ type: "text"; text: string } | { type: "tool_calls"; tool_calls: ToolCall[] };

export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface McpContentItem {
	type: string;
	text?: string;
}

export interface McpToolCallResult {
	content?: McpContentItem[];
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	parsed?: unknown;
}

export interface ApprovalRequiredPayload {
	approvalRequired: true;
	command?: string;
	commandArgv?: string[];
	commandShell?: string;
	hint?: string;
	dryRun?: boolean;
	executed?: boolean;
	[key: string]: unknown;
}

export function isApprovalRequired(value: unknown): value is ApprovalRequiredPayload {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { approvalRequired?: unknown }).approvalRequired === true
	);
}

export interface ModelAdapterConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	fetchImpl?: typeof fetch;
}

export interface StreamChatParams {
	messages: ChatMessage[];
	tools?: OpenAITool[];
	signal?: AbortSignal;
	stream?: boolean;
}

export type AskFn = (prompt: string) => Promise<boolean>;

export type CaptureRun = (
	bin: string,
	args: string[],
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export interface AgentLoopOptions {
	objective: string;
	target: string;
	maxTurns?: number;
	agentId?: string;
	sessionId?: string | null;
	systemPromptExtra?: string;
	signal?: AbortSignal;
	chat: (params: StreamChatParams) => Promise<ChatMessage>;
	callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
	listOpenAITools: () => OpenAITool[];
	ask?: AskFn;
	onEvent?: (event: { type: string; [key: string]: unknown }) => void;
	executeApprovedCommand?: (payload: ApprovalRequiredPayload) => Promise<McpToolCallResult>;
}
