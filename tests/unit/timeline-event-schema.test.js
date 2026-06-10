const { describe, it } = require("node:test");
const assert = require("node:assert");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(
	__dirname,
	"../../schemas/timeline-event.schema.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

const ALL_EVENT_TYPES = [
	"session_created",
	"route_selected",
	"stage_started",
	"stage_completed",
	"stage_failed",
	"gate_triggered",
	"gate_passed",
	"gate_failed",
	"checkpoint_created",
	"session_paused",
	"session_resumed",
	"session_completed",
	"session_failed",
	"session_aborted",
	"budget_warning",
	"budget_exceeded",
	"error",
];

describe("timeline-event schema", () => {
	it("accepts all 17 authoritative event types", () => {
		assert.strictEqual(ALL_EVENT_TYPES.length, 17);
		for (const type of ALL_EVENT_TYPES) {
			const event = { timestamp: new Date().toISOString(), type };
			assert.strictEqual(
				validate(event),
				true,
				`event type '${type}' should be valid`,
			);
		}
	});

	it("includes session_failed and session_aborted (manifest status parity)", () => {
		const failed = { timestamp: new Date().toISOString(), type: "session_failed" };
		const aborted = { timestamp: new Date().toISOString(), type: "session_aborted" };
		assert.strictEqual(validate(failed), true);
		assert.strictEqual(validate(aborted), true);
	});

	it("rejects unknown event types", () => {
		const event = { timestamp: new Date().toISOString(), type: "bogus_event" };
		assert.strictEqual(validate(event), false);
	});

	it("requires timestamp and type", () => {
		assert.strictEqual(validate({ type: "error" }), false);
		assert.strictEqual(
			validate({ timestamp: new Date().toISOString() }),
			false,
		);
	});

	it("accepts an error event with a structured error field", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "error",
			error: {
				message: "boom",
				stack: "Error: boom\n  at x",
				recoverable: false,
			},
		};
		assert.strictEqual(validate(event), true);
	});

	it("accepts optional stage and data fields", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "stage_started",
			stage: "capture",
			data: { foo: "bar" },
		};
		assert.strictEqual(validate(event), true);
	});
});
