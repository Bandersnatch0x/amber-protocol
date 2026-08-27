"use strict";

// F039 slice 3: pin projectionDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { projectionDispatch } = require("../../scripts/lib/projection-commands");

function tmpRoot(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-projection-dispatch-${label}-`));
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot("list");
	const envelope = projectionDispatch({ _: ["list"], target: root });
	assert.deepEqual(envelope, {
		result: { target: root, text: envelope.result.text, errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
	assert.equal(JSON.parse(envelope.result.text).length, 3);
	fs.rmSync(root, { recursive: true, force: true });
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot("json");
	const envelope = projectionDispatch({ _: ["list"], target: root, json: true });
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
	fs.rmSync(root, { recursive: true, force: true });
});

test("rebuild without --type keeps the empty-text/exit-1 envelope", () => {
	const root = tmpRoot("rebuild");
	const envelope = projectionDispatch({ _: ["rebuild"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.result.text, "");
	assert.equal(envelope.result.errors.length, 1);
	assert.match(envelope.result.errors[0], /projection rebuild requires --type/);
	assert.deepEqual(envelope.result.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("receipt verification failure: exit 1, receipt not found", () => {
	const root = tmpRoot("receipt");
	const envelope = projectionDispatch({ _: ["receipt"], target: root, id: "nope" });
	assert.equal(envelope.exitCode, 1);
	assert.deepEqual(envelope.result.errors, ["receipt not found"]);
	assert.equal(JSON.parse(envelope.result.text).ok, false);
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown action: exit 1, guidance on the printResult path", () => {
	const root = tmpRoot("unknown");
	const envelope = projectionDispatch({ _: ["zzz"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		"projection requires rebuild, status, list, query, strict-query, invalidate, receipt, view, or compare.",
	]);
	assert.deepEqual(envelope.result.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});
