const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TimelineWriter } = require("../../scripts/lib/timeline-writer");

describe("timeline throughput load test", () => {
	const testRoot = path.join(__dirname, "../fixtures/timeline-load");
	const timelinePath = path.join(testRoot, "timeline.jsonl");

	beforeEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
		fs.mkdirSync(testRoot, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
	});

	it("should write 1000 events in <500ms", async () => {
		const writer = new TimelineWriter(timelinePath);
		const startTime = Date.now();

		for (let i = 0; i < 1000; i++) {
			await writer.append({
				type: "stage_started",
				stage: `stage-${i}`,
				data: { index: i },
			});
		}

		await writer.close();
		const duration = Date.now() - startTime;

		assert.ok(
			duration < 500,
			`Write duration ${duration}ms exceeds 500ms target`,
		);

		const lines = fs.readFileSync(timelinePath, "utf8").trim().split("\n");
		assert.strictEqual(lines.length, 1000);
	});
});
