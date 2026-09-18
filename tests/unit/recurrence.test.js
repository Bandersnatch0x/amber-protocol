"use strict";

// Recurrence measurement units (trusted-control evolution contract §9, E8;
// plan Slice 4). The derivation is report-only: it carries counts and a rate
// over a declared exposure denominator and never computes an improvement
// claim.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
	RECURRENCE_DENOMINATOR_STATES,
	deriveRecurrence,
	transcriptWindowLabel,
} = require("../../scripts/lib/core/recurrence");

test("derives recurrenceRate as occurrences over the same window's denominator", () => {
	const derived = deriveRecurrence({
		occurrences: 3,
		transcriptsScanned: 12,
		window: transcriptWindowLabel(50),
	});
	assert.equal(derived.occurrences, 3);
	assert.equal(derived.transcriptsScanned, 12);
	assert.equal(derived.recurrenceRate, 0.25);
	assert.equal(derived.denominator, "measured");
	assert.equal(derived.window, "newest 50 transcript files per host home");
});

test("reports unknown — never a fabricated number — for a zero denominator", () => {
	const derived = deriveRecurrence({ occurrences: 4, transcriptsScanned: 0, window: "w" });
	assert.equal(derived.recurrenceRate, null);
	assert.equal(derived.transcriptsScanned, null);
	assert.equal(derived.denominator, "unknown");
	// The occurrence count is still carried: unknown applies to the rate, not
	// to the observation.
	assert.equal(derived.occurrences, 4);
});

test("reports unknown for an unavailable denominator", () => {
	for (const transcriptsScanned of [undefined, null, NaN, Infinity, -1, "12", {}]) {
		const derived = deriveRecurrence({ occurrences: 2, transcriptsScanned, window: "w" });
		assert.equal(derived.recurrenceRate, null, `denominator ${String(transcriptsScanned)}`);
		assert.equal(derived.denominator, "unknown");
	}
});

test("unknown is distinct from a measured zero rate", () => {
	const zeroRate = deriveRecurrence({ occurrences: 0, transcriptsScanned: 5, window: "w" });
	assert.equal(zeroRate.recurrenceRate, 0);
	assert.equal(zeroRate.denominator, "measured");
	const unknown = deriveRecurrence({ occurrences: 0, transcriptsScanned: 0, window: "w" });
	assert.equal(unknown.recurrenceRate, null);
	assert.equal(unknown.denominator, "unknown");
	assert.notEqual(zeroRate.denominator, unknown.denominator);
});

test("is deterministic for the same window input", () => {
	const input = { occurrences: 7, transcriptsScanned: 21, window: "w" };
	assert.deepEqual(deriveRecurrence(input), deriveRecurrence(input));
});

test("carries no before/after improvement claim", () => {
	const derived = deriveRecurrence({ occurrences: 3, transcriptsScanned: 12, window: "w" });
	const keys = Object.keys(derived).sort();
	assert.deepEqual(keys, [
		"denominator",
		"occurrences",
		"recurrenceRate",
		"transcriptsScanned",
		"window",
	]);
	// No field names a delta, a comparison, or an improvement.
	assert.equal(JSON.stringify(derived).match(/delta|before|after|improve|reduction/i), null);
});

test("the denominator state set is closed and frozen", () => {
	assert.deepEqual([...RECURRENCE_DENOMINATOR_STATES], ["measured", "unknown"]);
	assert.throws(() => {
		RECURRENCE_DENOMINATOR_STATES.push("guessed");
	});
});

test("tolerates absent or malformed input without fabricating a rate", () => {
	for (const input of [undefined, null, "x", 42, []]) {
		const derived = deriveRecurrence(input);
		assert.equal(derived.recurrenceRate, null);
		assert.equal(derived.denominator, "unknown");
		assert.equal(derived.occurrences, 0);
		assert.equal(derived.window, "unknown");
	}
});