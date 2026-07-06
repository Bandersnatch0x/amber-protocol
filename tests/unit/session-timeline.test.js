const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const {
	TIMELINE_EVENT_TYPES,
	appendSessionEvent,
	readSessionEvents,
} = require("../../scripts/lib/session-timeline");

const schemaPath = path.join(__dirname, "../../schemas/timeline-event.schema.json");
const schemaEnum = JSON.parse(fs.readFileSync(schemaPath, "utf8")).properties.type.enum;

describe("appendSessionEvent", () => {
	const sessionDir = path.join(__dirname, "../fixtures/session-timeline-test");

	beforeEach(() => {
		if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true });
		fs.mkdirSync(sessionDir, { recursive: true });
	});
	afterEach(() => {
		if (fs.existsSync(sessionDir)) {
			try { fs.rmSync(sessionDir, { recursive: true }); } catch {}
		}
	});

	it("writes one JSONL line stamped with timestamp + type + data", () => {
		appendSessionEvent(sessionDir, { type: "session_created", data: { sessionId: "123" } });
		const lines = fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8").trim().split("\n");
		assert.strictEqual(lines.length, 1);
		const event = JSON.parse(lines[0]);
		assert.strictEqual(event.type, "session_created");
		assert.deepStrictEqual(event.data, { sessionId: "123" });
		assert.ok(event.timestamp);
		assert.doesNotThrow(() => new Date(event.timestamp).toISOString());
	});

	it("creates the session directory if missing (nested)", () => {
		const nested = path.join(sessionDir, "nested", "deep");
		appendSessionEvent(nested, { type: "session_created", data: {} });
		assert.ok(fs.existsSync(path.join(nested, "timeline.jsonl")));
	});

	it("appends N events as N ordered lines", () => {
		appendSessionEvent(sessionDir, { type: "session_created", data: {} });
		appendSessionEvent(sessionDir, { type: "stage_started", stage: "capture", data: {} });
		const lines = fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8").trim().split("\n");
		assert.strictEqual(lines.length, 2);
		assert.strictEqual(JSON.parse(lines[0]).type, "session_created");
		assert.strictEqual(JSON.parse(lines[1]).stage, "capture");
	});

	it("stamps its own timestamp — caller cannot override it", () => {
		appendSessionEvent(sessionDir, {
			type: "error",
			timestamp: "1999-01-01T00:00:00.000Z",
		});
		const event = JSON.parse(
			fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8").trim(),
		);
		assert.notStrictEqual(event.timestamp, "1999-01-01T00:00:00.000Z");
		assert.doesNotThrow(() => new Date(event.timestamp).toISOString());
	});

	it("surfaces I/O errors instead of swallowing them", () => {
		// A file where a directory is expected makes the write fail.
		const blocker = path.join(sessionDir, "blocker");
		fs.writeFileSync(blocker, "x");
		assert.throws(() => appendSessionEvent(blocker, { type: "error", data: {} }));
	});
});

describe("readSessionEvents", () => {
	const sessionDir = path.join(__dirname, "../fixtures/session-timeline-read-test");
	const timelinePath = path.join(sessionDir, "timeline.jsonl");

	beforeEach(() => {
		if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true });
		fs.mkdirSync(sessionDir, { recursive: true });
	});
	afterEach(() => {
		if (fs.existsSync(sessionDir)) {
			try { fs.rmSync(sessionDir, { recursive: true }); } catch {}
		}
	});

	it("returns [] for a missing file", () => {
		assert.deepStrictEqual(readSessionEvents(path.join(sessionDir, "nope")), []);
	});

	it("returns [] for an empty file", () => {
		fs.writeFileSync(timelinePath, "");
		assert.deepStrictEqual(readSessionEvents(sessionDir), []);
	});

	it("parses each JSONL line in file order", () => {
		fs.writeFileSync(
			timelinePath,
			[
				JSON.stringify({ timestamp: "2026-07-06T00:00:00.000Z", type: "session_created" }),
				JSON.stringify({ timestamp: "2026-07-06T00:00:01.000Z", type: "stage_started", stage: "capture" }),
			].join("\n") + "\n",
		);
		const events = readSessionEvents(sessionDir);
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].type, "session_created");
		assert.strictEqual(events[1].stage, "capture");
	});

	it("skips blank and corrupt lines by default, keeps valid ones", () => {
		fs.writeFileSync(
			timelinePath,
			[
				JSON.stringify({ timestamp: "2026-07-06T00:00:00.000Z", type: "session_created" }),
				"",
				"   ",
				"{not valid json",
				JSON.stringify({ timestamp: "2026-07-06T00:00:02.000Z", type: "session_completed" }),
			].join("\n"),
		);
		const events = readSessionEvents(sessionDir);
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].type, "session_created");
		assert.strictEqual(events[1].type, "session_completed");
	});

	it("throws on a corrupt line when strict", () => {
		fs.writeFileSync(
			timelinePath,
			[
				JSON.stringify({ timestamp: "2026-07-06T00:00:00.000Z", type: "session_created" }),
				"{broken",
			].join("\n"),
		);
		assert.throws(() => readSessionEvents(sessionDir, { strict: true }), /line 2/);
	});
});

describe("TIMELINE_EVENT_TYPES parity with schema enum", () => {
	// Bidirectional deep-equal: catches BOTH a missing constant (the drift that
	// let verification_failed go missing) AND a typo'd extra enum value.
	it("module constants and schema enum are the same set", () => {
		const fromModule = Object.values(TIMELINE_EVENT_TYPES).sort();
		const fromSchema = [...schemaEnum].sort();
		assert.deepStrictEqual(fromModule, fromSchema);
	});

	it("schema accepts every declared type", () => {
		const ajv = new Ajv();
		addFormats(ajv);
		const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
		for (const type of Object.values(TIMELINE_EVENT_TYPES)) {
			assert.strictEqual(
				validate({ timestamp: new Date().toISOString(), type }),
				true,
				`event type '${type}' should be valid`,
			);
		}
	});

	it("schema rejects an unknown type", () => {
		const ajv = new Ajv();
		addFormats(ajv);
		const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
		assert.strictEqual(
			validate({ timestamp: new Date().toISOString(), type: "bogus_event" }),
			false,
		);
	});
});
