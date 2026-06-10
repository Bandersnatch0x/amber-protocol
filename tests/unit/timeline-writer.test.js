const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TimelineWriter } = require("../../scripts/lib/timeline-writer");

describe("TimelineWriter", () => {
	const testDir = path.join(__dirname, "../fixtures/timeline-test");
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

	it("should append event to timeline", async () => {
		const writer = new TimelineWriter(timelinePath);
		await writer.append({
			type: "session_created",
			data: { sessionId: "123" },
		});
		await writer.close();

		const content = fs.readFileSync(timelinePath, "utf8");
		const lines = content.trim().split("\n");
		assert.strictEqual(lines.length, 1);

		const event = JSON.parse(lines[0]);
		assert.strictEqual(event.type, "session_created");
		assert.ok(event.timestamp);
	});

	it("should append multiple events", async () => {
		const writer = new TimelineWriter(timelinePath);
		await writer.append({ type: "session_created", data: {} });
		await writer.append({ type: "stage_started", stage: "capture", data: {} });
		await writer.close();

		const content = fs.readFileSync(timelinePath, "utf8");
		const lines = content.trim().split("\n");
		assert.strictEqual(lines.length, 2);

		const first = JSON.parse(lines[0]);
		assert.strictEqual(first.type, "session_created");
		const second = JSON.parse(lines[1]);
		assert.strictEqual(second.type, "stage_started");
		assert.strictEqual(second.stage, "capture");
	});

	it("should create directory automatically", async () => {
		const deepPath = path.join(testDir, "nested", "deep", "timeline.jsonl");
		const writer = new TimelineWriter(deepPath);
		await writer.append({ type: "session_created", data: {} });
		await writer.close();

		assert.ok(fs.existsSync(deepPath));
		const content = fs.readFileSync(deepPath, "utf8");
		const lines = content.trim().split("\n");
		assert.strictEqual(lines.length, 1);
	});

	it("should auto-add timestamp", async () => {
		const writer = new TimelineWriter(timelinePath);
		await writer.append({ type: "session_created", data: {} });
		await writer.close();

		const content = fs.readFileSync(timelinePath, "utf8");
		const event = JSON.parse(content.trim());
		assert.ok(event.timestamp);
		assert.doesNotThrow(() => new Date(event.timestamp).toISOString());
	});

	it("should reject when the target path is unwritable", async () => {
		// Create a file where a directory is expected, so opening the
		// stream fails. The writer must surface the error, not crash the
		// process with an unhandled 'error' event.
		const blocker = path.join(testDir, "blocker");
		fs.writeFileSync(blocker, "x");
		const badPath = path.join(blocker, "timeline.jsonl");

		const writer = new TimelineWriter(badPath);
		await assert.rejects(() =>
			writer.append({ type: "session_created", data: {} }),
		);
		await writer.close().catch(() => {});
	});

	it("close() is a no-op when nothing was written", async () => {
		const writer = new TimelineWriter(timelinePath);
		await assert.doesNotReject(() => writer.close());
	});
});
