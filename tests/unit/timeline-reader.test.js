const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { readTimeline } = require("../../scripts/lib/timeline-reader");

describe("readTimeline", () => {
	const testDir = path.join(__dirname, "../fixtures/timeline-reader-test");
	const timelinePath = path.join(testDir, "timeline.jsonl");

	beforeEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			try {
				fs.rmSync(testDir, { recursive: true });
			} catch {}
		}
	});

	it("returns an empty array for a missing file", () => {
		const events = readTimeline(path.join(testDir, "nope.jsonl"));
		assert.deepStrictEqual(events, []);
	});

	it("returns an empty array for an empty file", () => {
		fs.writeFileSync(timelinePath, "");
		const events = readTimeline(timelinePath);
		assert.deepStrictEqual(events, []);
	});

	it("parses each JSONL line into an event object", () => {
		const lines = [
			JSON.stringify({
				timestamp: "2026-06-10T00:00:00.000Z",
				type: "session_created",
			}),
			JSON.stringify({
				timestamp: "2026-06-10T00:00:01.000Z",
				type: "stage_started",
				stage: "capture",
			}),
		];
		fs.writeFileSync(timelinePath, lines.join("\n") + "\n");

		const events = readTimeline(timelinePath);
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].type, "session_created");
		assert.strictEqual(events[1].stage, "capture");
	});

	it("ignores blank lines and trailing whitespace", () => {
		const content =
			JSON.stringify({ timestamp: "2026-06-10T00:00:00.000Z", type: "error" }) +
			"\n\n   \n";
		fs.writeFileSync(timelinePath, content);

		const events = readTimeline(timelinePath);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].type, "error");
	});

	it("skips corrupt lines by default and keeps valid ones", () => {
		const content = [
			JSON.stringify({
				timestamp: "2026-06-10T00:00:00.000Z",
				type: "session_created",
			}),
			"{not valid json",
			JSON.stringify({
				timestamp: "2026-06-10T00:00:02.000Z",
				type: "session_completed",
			}),
		].join("\n");
		fs.writeFileSync(timelinePath, content);

		const events = readTimeline(timelinePath);
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].type, "session_created");
		assert.strictEqual(events[1].type, "session_completed");
	});

	it("throws on a corrupt line when strict is enabled", () => {
		const content = [
			JSON.stringify({
				timestamp: "2026-06-10T00:00:00.000Z",
				type: "session_created",
			}),
			"{broken",
		].join("\n");
		fs.writeFileSync(timelinePath, content);

		assert.throws(() => readTimeline(timelinePath, { strict: true }), /line 2/);
	});
});
