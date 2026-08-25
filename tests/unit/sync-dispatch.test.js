"use strict";

// F039 slice 3: pin syncDispatch envelopes so the defineCommand migration stays
// byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { syncDispatch } = require("../../scripts/lib/sync-commands");

function tmpRoot(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-sync-dispatch-${label}-`));
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

test("bare sync envelope: sync payload (no artifact), defaulted errors, exit 0", () => {
	const root = tmpRoot("bare");
	const envelope = syncDispatch({ _: [], target: root });
	assert.equal(envelope.exitCode, 0);
	assert.equal(envelope.bypassPrint, true);
	assert.equal(envelope.result.target, root);
	assert.ok(envelope.result.text.includes("Target:"));
	assert.deepEqual(
		Object.keys(envelope.result.sync),
		["executed", "drift", "refresh", "note"],
		"result.sync carries exactly the documented payload — artifact is excluded",
	);
	assert.equal(envelope.result.sync.executed, false);
	assert.deepEqual(envelope.result.errors, []);
	assert.deepEqual(envelope.result.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown top-level action falls through to the drift report, not guidance", () => {
	const root = tmpRoot("fallthrough");
	const envelope = syncDispatch({ _: ["zzz"], target: root, json: true });
	assert.equal(envelope.exitCode, 0);
	assert.equal(envelope.bypassPrint, false);
	assert.ok(envelope.result.text.includes("Target:"));
	assert.deepEqual(envelope.result.errors, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("envelope pack without --type/--artifact keeps the empty-text/exit-1 envelope", () => {
	const root = tmpRoot("pack");
	const envelope = syncDispatch({ _: ["envelope", "pack"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.result.text, "");
	assert.deepEqual(envelope.result.errors, [
		"sync envelope pack requires --type <artifact-type> --artifact <path>",
	]);
	assert.deepEqual(envelope.result.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("nested unknown session action: exit 1, guidance on the printResult path", () => {
	const root = tmpRoot("unknown-session");
	const envelope = syncDispatch({ _: ["session", "bogus"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, false);
	assert.deepEqual(envelope.result.errors, [
		"sync session requires run, push, pull, list, replay, conflicts, approve, or ledger.",
	]);
	assert.deepEqual(envelope.result.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("session list on a fresh target: empty ledger, exit 0, bypassPrint honored", () => {
	const root = tmpRoot("list");
	const envelope = syncDispatch({ _: ["session", "list"], target: root, json: true });
	assert.equal(envelope.exitCode, 0);
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.result.text, "[]");
	assert.deepEqual(envelope.result.errors, []);
	fs.rmSync(root, { recursive: true, force: true });
});
