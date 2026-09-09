import assert from "node:assert/strict";
import { test } from "node:test";
import { bindSession, extractSessionId } from "../src/session-bind.ts";

test("bindSession does not throw when callTool fails", async () => {
	const result = await bindSession({
		registry: {
			callTool: async () => {
				throw new Error("no amber");
			},
		},
		objective: "demo",
	});
	assert.equal(result.degraded, true);
	assert.equal(result.sessionId, null);
	assert.match(result.warning ?? "", /no amber/);
});

test("bindSession continues degraded when operator denies", async () => {
	const result = await bindSession({
		registry: {
			callTool: async () => ({
				parsed: {
					approvalRequired: true,
					commandArgv: ["amber", "session", "start", "--goal", "demo"],
				},
			}),
		},
		objective: "demo",
		ask: async () => false,
		amberRoot: "/amber",
	});
	assert.equal(result.degraded, true);
	assert.match(result.warning ?? "", /denied/);
});

test("bindSession parses session id after approved spawn", async () => {
	const result = await bindSession({
		registry: {
			callTool: async () => ({
				parsed: {
					approvalRequired: true,
					commandArgv: ["amber", "session", "start", "--goal", "demo"],
				},
			}),
		},
		objective: "demo",
		ask: async () => true,
		amberRoot: "/amber",
		runFn: async () => ({
			stdout: "Session created: 11111111-2222-3333-4444-555555555555",
			stderr: "",
			code: 0,
		}),
	});
	assert.equal(result.degraded, false);
	assert.equal(result.sessionId, "11111111-2222-3333-4444-555555555555");
});

test("extractSessionId reads Session created lines", () => {
	assert.equal(
		extractSessionId(undefined, {
			content: [{ type: "text", text: "Session created: abcd-ef" }],
		}),
		"abcd-ef",
	);
	assert.equal(extractSessionId({ sessionId: "sess_9" }), "sess_9");
});
