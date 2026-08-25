"use strict";

// F039 pilot: pin hooksDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced.

const test = require("node:test");
const assert = require("node:assert");
const { hooksDispatch } = require("../../scripts/lib/hooks-commands");
const { installTargetRoutes } = require("../helpers/target-routes");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-hooks-dispatch-"));
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot();
	installTargetRoutes(root);
	const envelope = hooksDispatch({ _: ["status"], target: root });
	assert.deepEqual(envelope, {
		result: { target: root, text: envelope.result.text, errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
	fs.rmSync(root, { recursive: true, force: true });
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot();
	installTargetRoutes(root);
	const envelope = hooksDispatch({ _: ["status"], target: root, json: true });
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown top-level action: exit 1, guidance on the printResult path", () => {
	const envelope = hooksDispatch({ _: ["zzz"], target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		"hooks requires check, install, uninstall, status, or breadcrumb.",
	]);
});

test("unknown breadcrumb sub-action: exit 1, guidance on the printResult path", () => {
	const envelope = hooksDispatch({ _: ["breadcrumb", "zzz"], target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, false);
	assert.deepEqual(envelope.result.errors, [
		"hooks breadcrumb requires print, install, uninstall, or status.",
	]);
});

test("breadcrumb print in text mode: bypassPrint true with onBypass renderer", () => {
	const root = tmpRoot();
	installTargetRoutes(root);
	const envelope = hooksDispatch({ _: ["breadcrumb", "print"], target: root, format: "text" });
	assert.equal(envelope.bypassPrint, true);
	assert.equal(envelope.exitCode, 0);
	assert.equal(typeof envelope.onBypass, "function");
	assert.deepEqual(envelope.result.errors, []);
	fs.rmSync(root, { recursive: true, force: true });
});
