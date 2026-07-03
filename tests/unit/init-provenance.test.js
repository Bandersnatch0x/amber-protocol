"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { loadProvenance } = require("../../scripts/lib/core/scaffold-provenance");

function freshTarget() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-init-"));
	// Use the real shipped templates (default templateRoot).
	return dir;
}

test("fresh init writes provenance with inferred:false and one entry per managed file", () => {
	const dir = freshTarget();
	scaffoldHarness(dir, {});
	const p = loadProvenance(dir);
	assert.ok(p, "provenance written");
	assert.equal(p.provenanceInferred, false);
	assert.ok(p.files["docs/wiki/agent/amber.md"], "controlled file present");
	assert.ok(p.files["AGENTS.md"], "authored file present");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("init --skip-detection still writes provenance", () => {
	const dir = freshTarget();
	scaffoldHarness(dir, { skipDetection: true });
	assert.ok(loadProvenance(dir), "provenance written even without detection");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("re-running init does not overwrite an existing provenance baseline", () => {
	const dir = freshTarget();
	scaffoldHarness(dir, {});
	const before = fs.readFileSync(path.join(dir, ".amber", "provenance.json"), "utf8");
	// Mutate the baseline to a sentinel and confirm a second init leaves it.
	const parsed = JSON.parse(before);
	parsed.files["AGENTS.md"].templateHash = "SENTINEL";
	fs.writeFileSync(path.join(dir, ".amber", "provenance.json"), JSON.stringify(parsed, null, 2));
	scaffoldHarness(dir, {});
	const after = loadProvenance(dir);
	assert.equal(after.files["AGENTS.md"].templateHash, "SENTINEL", "existing baseline preserved on re-init");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("init on a pre-existing install without provenance migrates with inferred:true", () => {
	const dir = freshTarget();
	// Simulate a pre-existing install: copy templates manually, delete any provenance.
	scaffoldHarness(dir, {});
	fs.unlinkSync(path.join(dir, ".amber", "provenance.json"));
	// Re-run init: nothing new is created (all skipped) → migration path.
	scaffoldHarness(dir, {});
	const p = loadProvenance(dir);
	assert.ok(p, "provenance created on migration");
	assert.equal(p.provenanceInferred, true, "pre-existing install stamped inferred");
	fs.rmSync(dir, { recursive: true, force: true });
});
