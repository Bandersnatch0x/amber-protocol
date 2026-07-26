"use strict";

const fs = require("fs");
const path = require("path");

// scripts/lib/session-timeline.js
// The single deep module owning the Session timeline artifact: the event
// vocabulary, the JSONL framing, and the read/append surface. Replaces
// timeline-writer.js (streaming ceremony for what are always single-event
// writes) and timeline-reader.js. Parallel to the governed-runner deepening
// (ADR-0003). Schema parity is enforced at test time, not runtime — every
// writer is a trusted internal caller, so runtime Ajv would be gold-plating.

const FILENAME = "timeline.jsonl";

// Single source of truth for timeline event types. Kept equal to the enum in
// schemas/timeline-event.schema.json by tests/unit/session-timeline.test.js
// (bidirectional deep-equal, so drift fails the suite in either direction).
const TIMELINE_EVENT_TYPES = Object.freeze({
	SESSION_CREATED: "session_created",
	ROUTE_SELECTED: "route_selected",
	STAGE_STARTED: "stage_started",
	STAGE_COMPLETED: "stage_completed",
	STAGE_FAILED: "stage_failed",
	VERIFICATION_FAILED: "verification_failed",
	GATE_TRIGGERED: "gate_triggered",
	GATE_PASSED: "gate_passed",
	GATE_FAILED: "gate_failed",
	CHECKPOINT_CREATED: "checkpoint_created",
	SESSION_PAUSED: "session_paused",
	SESSION_RESUMED: "session_resumed",
	SESSION_COMPLETED: "session_completed",
	SESSION_FAILED: "session_failed",
	SESSION_ABORTED: "session_aborted",
	BUDGET_WARNING: "budget_warning",
	BUDGET_EXCEEDED: "budget_exceeded",
	ERROR: "error",
});

// Append one timeline event for a session. Stamps the timestamp (caller cannot
// override it) and creates the session directory if needed. Sync by design —
// every caller writes one event then moves on, so a streaming handle buys
// nothing and appendFileSync is atomic per line. Callers may `await` it
// harmlessly.
function appendSessionEvent(sessionDir, event) {
	if (!fs.existsSync(sessionDir)) {
		fs.mkdirSync(sessionDir, { recursive: true });
	}
	const line = JSON.stringify({
		...event,
		timestamp: new Date().toISOString(),
	}) + "\n";
	fs.appendFileSync(path.join(sessionDir, FILENAME), line);
}

// Read all timeline events for a session. Missing or empty file -> []. Corrupt
// lines are skipped unless { strict: true }, in which case the first corrupt
// line throws (so a half-written timeline is still inspectable after a crash).
function readSessionEvents(sessionDir, { strict = false } = {}) {
	const filePath = path.join(sessionDir, FILENAME);
	if (!fs.existsSync(filePath)) {
		return [];
	}

	const events = [];
	const lines = fs.readFileSync(filePath, "utf8").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "") continue;

		try {
			events.push(JSON.parse(line));
		} catch (err) {
			if (strict) {
				throw new Error(`Corrupt timeline at line ${i + 1}: ${err.message}`, { cause: err });
			}
		}
	}

	return events;
}

module.exports = {
	TIMELINE_EVENT_TYPES,
	appendSessionEvent,
	readSessionEvents,
};
