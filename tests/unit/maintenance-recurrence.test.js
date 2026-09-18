"use strict";

// Recurrence reporting on the maintenance inspection surface (trusted-control
// evolution contract §9, E8; plan Slice 4). The facade seam is used
// (F014-M4): tests never import Maintenance internals directly.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const maintenance = require("../../scripts/lib/maintenance");

function makeTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "b4-recurrence-"));
}

function writeEvolutionLog(targetRoot, body) {
	fs.mkdirSync(path.join(targetRoot, "docs", "wiki", "engineering"), { recursive: true });
	fs.writeFileSync(
		path.join(targetRoot, "docs", "wiki", "engineering", "harness-evolution.md"),
		body,
	);
}

test("absent log: recurrence reports unknown, never a fabricated rate", () => {
	const target = makeTarget();
	try {
		const outcome = maintenance.evidence(target);
		assert.equal(outcome.evolution.recurrence.denominator, "unknown");
		assert.equal(outcome.evolution.recurrence.recurrenceRate, null);
		assert.equal(outcome.evolution.recurrence.transcriptsScanned, null);
		assert.equal(outcome.evolution.recurrence.window, "docs/wiki/engineering/harness-evolution.md (absent)");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("log with findings: occurrences over the same window's denominator, measured rate", () => {
	const target = makeTarget();
	try {
		writeEvolutionLog(
			target,
			[
				"# Amber Evolution Log",
				"",
				"Finding: first failure mode text",
				"Finding: first failure mode text",
				"Finding: second failure mode text",
				"",
				"```amber-finding",
				JSON.stringify({
					findingAttribution: {
						entrySurface: "tool-output",
						impactSurface: "context",
						failureMode: "first failure mode text",
						responsibleArtifact: "wiki",
					},
				}),
				"```",
				"",
			].join("\n"),
		);
		const outcome = maintenance.evidence(target);
		const recurrence = outcome.evolution.recurrence;
		// Denominator: 3 legacy Finding lines + 1 structured block = 4.
		assert.equal(recurrence.transcriptsScanned, 4);
		// Occurrences count the SAME window's observations by failure-mode
		// text: the block is a denominator observation, so its occurrence
		// counts too (2 legacy + 1 block for the first mode, 1 for the
		// second) — no structured-only undercount.
		assert.equal(recurrence.occurrences, 4);
		assert.equal(recurrence.recurrenceRate, 1);
		assert.equal(recurrence.denominator, "measured");
		assert.equal(recurrence.window, "docs/wiki/engineering/harness-evolution.md");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("structured-only log: blocks count as occurrences, not denominator-only weight", () => {
	const target = makeTarget();
	try {
		const block = (mode) =>
			[
				"```amber-finding",
				JSON.stringify({
					findingAttribution: {
						entrySurface: "tool-output",
						impactSurface: "context",
						failureMode: mode,
						responsibleArtifact: "wiki",
					},
				}),
				"```",
			].join("\n");
		writeEvolutionLog(
			target,
			["# Amber Evolution Log", "", block("only failure mode"), block("only failure mode"), block("only failure mode")].join("\n"),
		);
		const recurrence = maintenance.evidence(target).evolution.recurrence;
		assert.equal(recurrence.transcriptsScanned, 3);
		assert.equal(recurrence.occurrences, 3);
		assert.equal(recurrence.recurrenceRate, 1);
		assert.equal(recurrence.denominator, "measured");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a block that names no failure mode stays in the denominator without inventing an occurrence", () => {
	const target = makeTarget();
	try {
		writeEvolutionLog(
			target,
			[
				"Finding: real failure mode",
				"",
				"```amber-finding",
				"{ not valid json",
				"```",
				"",
			].join("\n"),
		);
		const recurrence = maintenance.evidence(target).evolution.recurrence;
		// The unparseable block is a window observation (denominator 2) but
		// names no failure-mode text, so only the legacy line is an
		// occurrence — the rate honestly reads 1/2, never a fabricated count.
		assert.equal(recurrence.transcriptsScanned, 2);
		assert.equal(recurrence.occurrences, 1);
		assert.equal(recurrence.recurrenceRate, 0.5);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("empty log (denominator 0): unknown, not a zero rate", () => {
	const target = makeTarget();
	try {
		writeEvolutionLog(target, "# Amber Evolution Log\n\nno findings here\n");
		const outcome = maintenance.evidence(target);
		assert.equal(outcome.evolution.recurrence.transcriptsScanned, null);
		assert.equal(outcome.evolution.recurrence.recurrenceRate, null);
		assert.equal(outcome.evolution.recurrence.denominator, "unknown");
		// A scanned-but-empty window still carries the (zero) occurrence count.
		assert.equal(outcome.evolution.recurrence.occurrences, 0);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("inspection carries the same recurrence evidence (report-only envelope)", () => {
	const target = makeTarget();
	try {
		writeEvolutionLog(
			target,
			"Finding: repeat\nFinding: repeat\n",
		);
		const inspection = maintenance.inspect(target);
		const recurrence = inspection.recurrence;
		assert.deepEqual(
			Object.keys(recurrence).sort(),
			["denominator", "occurrences", "recurrenceRate", "transcriptsScanned", "window"],
		);
		assert.equal(recurrence.occurrences, 2);
		assert.equal(recurrence.recurrenceRate, 1);
		// No improvement-claim fields exist on the envelope.
		assert.equal(
			JSON.stringify(recurrence).match(/delta|improve|reduction|before|after/i),
			null,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("deterministic: same log, same recurrence evidence", () => {
	const target = makeTarget();
	try {
		writeEvolutionLog(target, "Finding: repeat\nFinding: repeat\n");
		const first = maintenance.evidence(target).evolution.recurrence;
		const second = maintenance.evidence(target).evolution.recurrence;
		assert.deepEqual(first, second);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});