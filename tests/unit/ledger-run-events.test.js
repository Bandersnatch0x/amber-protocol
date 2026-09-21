"use strict";

// Trusted-control governance contract — Slice G-2 (spec §10.3): the
// run-events chained family. Legacy plaintext prefix tolerated on read and
// never re-chained; chained events verify by fold; a tampered chained line
// fails closed.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	appendChainedTimelineEvent,
	readTimelineVerified,
	RUN_EVENTS_CORRUPT_CODE,
} = require("../../scripts/lib/core/ledger-run-events");
const { appendSessionEvent } = require("../../scripts/lib/session-timeline");

function makeSessionDir() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-run-events-"));
	const sessionDir = path.join(root, "s1");
	fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}

describe("run-events chained family (governance contract §10.3)", () => {
	it("chains governed events over a legacy plaintext prefix; legacy lines stay untouched", () => {
		const sessionDir = makeSessionDir();
		try {
			// Legacy plaintext prefix (the pre-G2 writer — no hash fields).
			appendSessionEvent(sessionDir, { type: "session_created", data: { goal: "legacy" } });
			appendSessionEvent(sessionDir, { type: "route_selected", data: { route: "probe" } });
			const legacy = fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8");

			const first = appendChainedTimelineEvent(sessionDir, {
				type: "run_started",
				data: { stage: "check" },
			});
			assert.match(first.hash, /^[0-9a-f]{64}$/);
			assert.strictEqual(first.prevHash, "0".repeat(64), "genesis at the first chained line");
			assert.strictEqual(first.sequence, 1);
			const second = appendChainedTimelineEvent(sessionDir, {
				type: "run_completed",
				data: { stage: "check" },
			});
			assert.strictEqual(second.prevHash, first.hash);
			assert.strictEqual(second.sequence, 2);

			// The legacy prefix bytes are unchanged (never re-chained, never
			// backfilled).
			assert.ok(
				fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8").startsWith(legacy),
			);

			const records = readTimelineVerified(sessionDir);
			assert.strictEqual(records.length, 4);
			assert.strictEqual(records[0].type, "session_created");
			assert.strictEqual(records[0].hash, undefined);
			assert.strictEqual(records[2].type, "run_started");
		} finally {
			fs.rmSync(path.dirname(sessionDir), { recursive: true, force: true });
		}
	});

	it("a tampered chained line fails the fold closed", () => {
		const sessionDir = makeSessionDir();
		try {
			appendChainedTimelineEvent(sessionDir, { type: "run_started", data: { stage: "check" } });
			appendChainedTimelineEvent(sessionDir, { type: "run_completed", data: { stage: "check" } });
			const filePath = path.join(sessionDir, "timeline.jsonl");
			const records = fs.readFileSync(filePath, "utf8").trimEnd().split("\n");
			// Records 0 and 1 are the chained pair; tamper the second one.
			const tampered = records.map((line, index) =>
				index === 1 ? JSON.stringify({ ...JSON.parse(line), data: { stage: "rewritten" } }) : line,
			);
			fs.writeFileSync(filePath, tampered.join("\n") + "\n");
			assert.throws(
				() => readTimelineVerified(sessionDir),
				(error) =>
					error.amberCode === RUN_EVENTS_CORRUPT_CODE && /body hash|prevHash/.test(error.message),
			);
		} finally {
			fs.rmSync(path.dirname(sessionDir), { recursive: true, force: true });
		}
	});

	it("an explicit caller sequence may not collide with the chained run", () => {
		const sessionDir = makeSessionDir();
		try {
			appendChainedTimelineEvent(sessionDir, { type: "run_started", data: {} });
			const second = appendChainedTimelineEvent(sessionDir, {
				type: "run_completed",
				data: {},
				sequence: 99,
			});
			assert.strictEqual(second.sequence, 99);
			const third = appendChainedTimelineEvent(sessionDir, { type: "policy_denied", data: {} });
			assert.strictEqual(
				third.sequence,
				100,
				"the next sequence continues past the explicit high-water mark",
			);
		} finally {
			fs.rmSync(path.dirname(sessionDir), { recursive: true, force: true });
		}
	});
});
