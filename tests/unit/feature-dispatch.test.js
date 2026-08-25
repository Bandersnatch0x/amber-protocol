"use strict";

// F039 slice 4: pin runFeatureAction's body-only { text, errors, warnings }
// contract across the defineCommand routing — no target key ever leaks into
// the presentation body; the command-dispatcher adds it at its own boundary.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runFeatureAction } = require("../../scripts/lib/feature-commands");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-feature-dispatch-"));
}

test("known action body: text + defaulted errors/warnings, no target key", () => {
	const root = tmpRoot();
	const body = runFeatureAction("list", root, {});
	assert.deepEqual(body, { text: "No features registered.", errors: [], warnings: [] });
	fs.rmSync(root, { recursive: true, force: true });
});

test("error body through the dispatcher: id guard, still body-only", () => {
	const root = tmpRoot();
	const body = runFeatureAction("add", root, { title: "T" });
	assert.deepEqual(body, {
		text: "",
		errors: ["feature add requires --id <feature-id>."],
		warnings: [],
	});
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown action: empty text, guidance lists every action", () => {
	const root = tmpRoot();
	assert.deepEqual(runFeatureAction("bogus", root, {}), {
		text: "",
		errors: ["feature requires add, list, remove, verify, evidence, or paths."],
		warnings: [],
	});
	assert.deepEqual(runFeatureAction(undefined, root, {}), {
		text: "",
		errors: ["feature requires add, list, remove, verify, evidence, or paths."],
		warnings: [],
	});
	fs.rmSync(root, { recursive: true, force: true });
});

test("add success renders the structured result with its doctor hint warning", () => {
	const root = tmpRoot();
	const body = runFeatureAction("add", root, { id: "F1", title: "T" });
	assert.equal(body.text, "Feature added: F1 — T");
	assert.deepEqual(body.errors, []);
	assert.equal(body.warnings.length, 1);
	assert.match(body.warnings[0], /not doctor-valid yet/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("positional routing: add id/title fall back to _[1]/_[2]", () => {
	const root = tmpRoot();
	const body = runFeatureAction("add", root, { _: ["add", "F9", "Positional"] });
	assert.equal(body.text, "Feature added: F9 — Positional");
	assert.deepEqual(body.errors, []);
	fs.rmSync(root, { recursive: true, force: true });
});
