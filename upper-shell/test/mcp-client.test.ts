import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AmberMcpClient,
	createFakeTransport,
	enrichToolResult,
	type JsonRpcRequest,
	type JsonRpcResponse,
} from "../src/mcp-client.ts";
import { isApprovalRequired } from "../src/types.ts";

test("initialize + tools/list + tools/call + ping roundtrip", async () => {
	const { transport } = createFakeTransport((req: JsonRpcRequest): JsonRpcResponse => {
		if (req.method === "initialize") {
			return { jsonrpc: "2.0", id: req.id ?? null, result: { protocolVersion: "2025-03-26" } };
		}
		if (req.method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id: req.id ?? null,
				result: {
					tools: [
						{
							name: "amber.session.status",
							description: "status",
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			};
		}
		if (req.method === "tools/call") {
			return {
				jsonrpc: "2.0",
				id: req.id ?? null,
				result: {
					content: [{ type: "text", text: '{"ok":true,"sessionId":"sess_1"}' }],
				},
			};
		}
		if (req.method === "ping") {
			return { jsonrpc: "2.0", id: req.id ?? null, result: {} };
		}
		return { jsonrpc: "2.0", id: req.id ?? null, error: { code: -32601, message: "unknown" } };
	});

	const client = new AmberMcpClient(transport);
	await client.initialize();
	const tools = await client.listTools();
	assert.equal(tools.length, 1);
	assert.equal(tools[0].name, "amber.session.status");
	const result = await client.callTool("amber.session.status", {});
	assert.deepEqual(result.parsed, { ok: true, sessionId: "sess_1" });
	await client.ping();
	client.close();
});

test("MCP errors throw", async () => {
	const { transport } = createFakeTransport((req) => ({
		jsonrpc: "2.0",
		id: req.id ?? null,
		error: { code: -32602, message: "invalid" },
	}));
	const client = new AmberMcpClient(transport);
	await assert.rejects(() => client.listTools(), /invalid/);
});

test("tools/call surfaces approvalRequired without executing", async () => {
	const { transport } = createFakeTransport((req) => ({
		jsonrpc: "2.0",
		id: req.id ?? null,
		result: {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						approvalRequired: true,
						executed: false,
						command: "amber session start --goal x",
						commandArgv: ["amber", "session", "start", "--goal", "x"],
					}),
				},
			],
		},
	}));
	const client = new AmberMcpClient(transport);
	const result = await client.callTool("amber.session.start", { goal: "x" });
	assert.equal(isApprovalRequired(result.parsed), true);
	assert.equal((result.parsed as { executed?: boolean }).executed, false);
});

test("enrichToolResult parses embedded JSON", () => {
	const enriched = enrichToolResult({
		content: [{ type: "text", text: 'note {"approvalRequired":true,"command":"amber x"} done' }],
	});
	assert.equal((enriched.parsed as { approvalRequired: boolean }).approvalRequired, true);
});
