"use strict";

// F039 slice 2: pin phaseDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { phaseDispatch } = require("../../scripts/lib/phase-commands");

function tmpRoot(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-phase-dispatch-${label}-`));
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot("transitions");
	const envelope = phaseDispatch({ _: ["transitions"], target: root });
	assert.deepEqual(envelope, {
		result: { target: root, text: "[]", errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot("json");
	const envelope = phaseDispatch({ _: ["transitions"], target: root, json: true });
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
});

test("invariant regression: exit 1 with the fixed diagnostic", () => {
	const root = tmpRoot("invariants");
	const envelope = phaseDispatch({ _: ["invariants"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.deepEqual(envelope.result.errors, ["invariant regression detected"]);
	assert.deepEqual(envelope.result.warnings, []);
	assert.ok(envelope.result.text.includes("inv-1"));
});

test("unknown action: exit 1, guidance on the printResult path", () => {
	const envelope = phaseDispatch({ _: ["zzz"], target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		"phase requires evidence, validate, promote, rollback, transitions, or invariants.",
	]);
	assert.deepEqual(envelope.result.warnings, []);
});
