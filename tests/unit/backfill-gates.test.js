const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { approvedGatesFromTimeline } = require("../../scripts/backfill-gates");
const { appendSessionEvent } = require("../../scripts/lib/session-timeline");

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
			try { fs.rmSync(sessionDir, { recursive: true }); } catch {}
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
