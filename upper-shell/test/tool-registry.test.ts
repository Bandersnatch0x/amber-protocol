import assert from "node:assert/strict";
import { test } from "node:test";
import { AmberMcpClient, createFakeTransport } from "../src/mcp-client.ts";
import { ToolRegistry } from "../src/tool-registry.ts";

test("maps list to OpenAI tools and delegates callTool", async () => {
	let calledArgs: Record<string, unknown> | undefined;
	const { transport } = createFakeTransport((req) => {
		if (req.method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id: req.id ?? null,
				result: {
					tools: [
						{
							name: "amber.route.test",
							description: "route",
							inputSchema: { type: "object", properties: { q: { type: "string" } } },
						},
					],
				},
			};
		}
		if (req.method === "tools/call") {
			const params = req.params as { name: string; arguments: Record<string, unknown> };
			calledArgs = params.arguments;
			return {
				jsonrpc: "2.0",
				id: req.id ?? null,
				result: { content: [{ type: "text", text: '{"ok":1}' }] },
			};
		}
		return { jsonrpc: "2.0", id: req.id ?? null, result: {} };
	});
	const client = new AmberMcpClient(transport);
	const registry = new ToolRegistry({ client, target: "/repo", agentId: "t" });
	await registry.refresh();
	const openai = registry.toOpenAITools();
	assert.equal(openai[0].function.name, "amber.route.test");
	assert.equal(openai[0].type, "function");
	assert.equal(registry.isKnownMutating("amber.session.start"), true);
	assert.equal(registry.isKnownMutating("amber.route.test"), false);
	await registry.callTool("amber.route.test", { q: "x" });
	assert.equal(calledArgs?._target, "/repo");
	assert.equal(calledArgs?._agent, "t");
	assert.equal(calledArgs?.q, "x");
});
