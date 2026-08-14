const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("node:os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const { approvedGatesFromTimeline } = require("../../scripts/backfill-gates");
const { appendSessionEvent } = require("../../scripts/lib/session-timeline");

const ROOT = path.resolve(__dirname, "../..");

// F2 insurance: approvedGatesFromTimeline carries logic beyond reading
// (gateId extraction, first-occurrence-wins dedup, timestamp capture) that no
// test covered before the timeline deepening migrated its read. These cases
// pin that logic so the migration can't silently break the web-viewer backfill.
describe("approvedGatesFromTimeline", () => {
	const sessionDir = path.join(__dirname, "../fixtures/backfill-gates-test");

	beforeEach(() => {
		if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true });
		fs.mkdirSync(sessionDir, { recursive: true });
	});
	afterEach(() => {
		if (fs.existsSync(sessionDir)) {
			try {
				fs.rmSync(sessionDir, { recursive: true });
			} catch {
				/* ignore cleanup failure */
			}
		}
	});

	it("collects an approved gate with its timestamp", () => {
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });
		const approvals = approvedGatesFromTimeline(sessionDir);
		assert.strictEqual(approvals.size, 1);
		assert.ok(approvals.has("g1"));
		assert.ok(approvals.get("g1")); // timestamp captured
	});

	it("keeps only the first occurrence when a gate is approved more than once", () => {
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });
		appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId: "g1" } });
		const approvals = approvedGatesFromTimeline(sessionDir);
		assert.strictEqual(approvals.size, 1);
	});

	it("skips gate_passed events without a string gateId", () => {
		appendSessionEvent(sessionDir, { type: "gate_passed", data: {} });
		appendSessionEvent(sessionDir, { type: "gate_passed" });
		appendSessionEvent(sessionDir, { type: "stage_completed", data: {} });
		const approvals = approvedGatesFromTimeline(sessionDir);
		assert.strictEqual(approvals.size, 0);
	});
});

describe("backfill-gates target Route resolution", () => {
	it("dry-run reads Route definitions from the selected target repository", (t) => {
		const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-backfill-target-"));
		t.after(() => fs.rmSync(target, { recursive: true, force: true }));

		const routesDir = path.join(target, "routes");
		fs.mkdirSync(routesDir, { recursive: true });
		fs.writeFileSync(
			path.join(routesDir, "target-only.route.json"),
			JSON.stringify({
				routeId: "target-only",
				schemaVersion: "1.0.0",
				stages: [
					{
						name: "verify",
						type: "command",
						target: "node --test",
						gateAfter: "target-approval",
					},
				],
				gates: [{ id: "target-approval", type: "user-approval" }],
			}),
		);

		const sessionDir = path.join(target, ".amber", "sessions", "session-1");
		fs.mkdirSync(sessionDir, { recursive: true });
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify({
				sessionId: "session-1",
				createdAt: "2026-08-14T00:00:00.000Z",
				route: { id: "target-only", version: "1.0.0" },
			}),
		);

		const run = spawnSync(
			process.execPath,
			[path.join(ROOT, "scripts", "backfill-gates.js"), "--target", target, "--dry-run", "--json"],
			{ cwd: ROOT, encoding: "utf8" },
		);

		assert.strictEqual(run.status, 0, run.stderr);
		const output = JSON.parse(run.stdout);
		assert.strictEqual(output.sessions, 1);
		assert.strictEqual(output.gatesWritten, 1);
		assert.strictEqual(output.skipped, 0);
		assert.strictEqual(fs.existsSync(path.join(sessionDir, "gates")), false);
	});
});
