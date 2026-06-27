"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { explain, renderMarkdown } = require("../../scripts/lib/explain-command");

test("explain <code> prints structured detail", () => {
	const r = explain({ _: ["AMBER_E_FEATURE_NO_EVIDENCE"] });
	assert.equal(r.errors.length, 0);
	assert.ok(r.text.includes("AMBER_E_FEATURE_NO_EVIDENCE"));
	assert.ok(r.text.includes("Cause:"));
	assert.ok(r.text.includes("Fix:"));
	assert.ok(r.text.includes("Layer:"));
});

test("explain with no code lists all codes", () => {
	const r = explain({ _: [] });
	assert.equal(r.errors.length, 0);
	assert.ok(r.text.includes("AMBER_E_HOOK_PRECOMMIT_BLOCKED"));
	assert.ok(r.text.includes("AMBER_E_FEATURE_NOT_FOUND"));
});

test("explain unknown code exits with suggestions", () => {
	const r = explain({ _: ["evidence"] });
	assert.equal(r.errors.length, 1);
	assert.ok(r.text.includes("AMBER_E_FEATURE_NO_EVIDENCE"), "suggests by substring");
});

test("renderMarkdown emits a table row for every code", () => {
	const md = renderMarkdown();
	const { CATALOG } = require("../../scripts/lib/core/error-catalog");
	for (const code of Object.keys(CATALOG)) {
		assert.ok(md.includes(code), `markdown missing ${code}`);
	}
	assert.ok(md.includes("| Code |"));
});

test("explain --markdown writes the doc to disk", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-explain-"));
	const out = path.join(dir, "troubleshooting.md");
	const r = explain({ markdown: out });
	assert.equal(r.errors.length, 0);
	const written = fs.readFileSync(out, "utf8");
	assert.ok(written.includes("AMBER_E_HOOK_PRECOMMIT_BLOCKED"));
	fs.rmSync(dir, { recursive: true, force: true });
});
