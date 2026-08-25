"use strict";

// F039 slice 2: pin orgAuditDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { orgAuditDispatch } = require("../../scripts/lib/org-audit-commands");

function tmpRoot(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-org-dispatch-${label}-`));
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot("events");
	const envelope = orgAuditDispatch({ _: ["org", "events"], target: root });
	assert.deepEqual(envelope, {
		result: { target: root, text: "[]", errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot("json");
	const envelope = orgAuditDispatch({ _: ["org", "events"], target: root, json: true });
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
});

test("corrupt ledger fails closed with the typed code and exit 1", () => {
	const root = tmpRoot("corrupt");
	fs.mkdirSync(path.join(root, ".amber", "audit"), { recursive: true });
	fs.writeFileSync(path.join(root, ".amber", "audit", "events.jsonl"), "{ broken\n");
	const envelope = orgAuditDispatch({ _: ["org", "events"], target: root });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, true);
	assert.equal(envelope.result.text, "");
	assert.equal(envelope.result.code, "AMBER_E_ORG_CORRUPT");
	assert.equal(envelope.result.errors.length, 1);
	assert.ok(envelope.result.errors[0].includes("AMBER_E_ORG_CORRUPT"));
});

test("unknown action: exit 1, guidance on the printResult path", () => {
	const envelope = orgAuditDispatch({ _: ["org", "zzz"], target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		"audit org requires events, isolation, cross-repo, or retention.",
	]);
	assert.deepEqual(envelope.result.warnings, []);
});
