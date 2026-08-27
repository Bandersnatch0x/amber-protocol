"use strict";

// F039 slice 2: pin knowledgeDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { knowledgeDispatch } = require("../../scripts/lib/knowledge-commands");

function tmpRoot(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-knowledge-dispatch-${label}-`));
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot("list");
	const envelope = knowledgeDispatch({ _: ["list"], target: root });
	assert.deepEqual(envelope, {
		result: { target: root, text: "[]", errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot("json");
	const envelope = knowledgeDispatch({ _: ["list"], target: root, json: true });
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
});

test("admit failure keeps the empty-text/exit-1 envelope", () => {
	const root = tmpRoot("admit");
	const envelope = knowledgeDispatch({ _: ["admit"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.result.text, "");
	assert.equal(envelope.result.errors.length, 1);
	assert.deepEqual(envelope.result.warnings, []);
});

test("unknown action: exit 1, guidance on the printResult path", () => {
	const envelope = knowledgeDispatch({ _: ["zzz"], target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		"knowledge requires admit, list, status, retire, query, or graph.",
	]);
	assert.deepEqual(envelope.result.warnings, []);
});
