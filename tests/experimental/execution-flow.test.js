const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { executeSession } = require("../../src/experimental/execution/execution-engine");
const { createManifest } = require("../../scripts/lib/session-manifest");

describe("Execution Flow", () => {
	const testDir = path.join(__dirname, "../fixtures/execution-flow-test");

	beforeEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("executes simple route end-to-end", async () => {
		const route = {
			routeId: "test-route",
			stages: [
				{ name: "s1", type: "command", target: "echo test1" },
				{ name: "s2", type: "command", target: "echo test2" },
			],
			gates: [],
		};

		const manifest = createManifest({
			route: { id: "test-route", version: "1.0.0" },
			goal: "test",
			budget: 10000,
		});

		const sessionDir = path.join(testDir, manifest.sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const result = await executeSession(sessionDir, manifest, route, {});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.stagesCompleted, 2);
	});

	it("stops execution when gate fails", async () => {
		const route = {
			routeId: "test-route",
			stages: [
				{ name: "s1", type: "command", target: "echo test1", gateAfter: "g1" },
			],
			gates: [{ id: "g1", type: "user-approval", description: "Continue?" }],
		};

		const manifest = createManifest({
			route: { id: "test-route", version: "1.0.0" },
			goal: "test",
		});

		const sessionDir = path.join(testDir, manifest.sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		const input = Readable.from(["no\n"]);
		const result = await executeSession(sessionDir, manifest, route, { input });
		assert.strictEqual(result.success, false);
		assert.match(result.reason, /gate/i);
	});

	it("writes timeline events on successful run", async () => {
		const route = {
			routeId: "test-route",
			stages: [{ name: "s1", type: "command", target: "echo hello" }],
			gates: [],
		};

		const manifest = createManifest({
			route: { id: "test-route", version: "1.0.0" },
			goal: "test",
		});

		const sessionDir = path.join(testDir, manifest.sessionId);
		fs.mkdirSync(sessionDir, { recursive: true });

		await executeSession(sessionDir, manifest, route, {});

		const timelinePath = path.join(sessionDir, "timeline.jsonl");
		const timeline = fs.readFileSync(timelinePath, "utf8");
		assert.ok(timeline.includes("stage_started"));
		assert.ok(timeline.includes("stage_completed"));
	});
});
