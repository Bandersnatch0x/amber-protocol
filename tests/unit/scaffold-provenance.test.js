"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	normalizedContentForHash,
	computeTemplateHash,
	templateManagedFiles,
	fileTier,
	buildProvenance,
	loadProvenance,
	writeProvenance,
} = require("../../scripts/lib/core/scaffold-provenance");
const { writeJson } = require("../../scripts/lib/core/fs-utils");

// A tiny fake template root with one controlled, one authored, one state file.
function fakeTemplateRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tpl-"));
	fs.mkdirSync(path.join(root, "docs/wiki/agent"), { recursive: true });
	fs.mkdirSync(path.join(root, ".workflow/continuous-improvement"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs/wiki/agent/amber.md"), "---\nupdated: 2026-01-01\n---\n# Amber\n");
	fs.writeFileSync(path.join(root, "AGENTS.md"), "agent rules\n");
	fs.writeFileSync(path.join(root, ".workflow/continuous-improvement/state.json"), "{}\n");
	return root;
}

test("normalizedContentForHash strips the YAML updated: line but keeps other content", () => {
	const a = "---\nupdated: 2026-01-01\n---\nbody\n";
	const b = "---\nupdated: 2026-02-02\n---\nbody\n";
	assert.equal(normalizedContentForHash(a), normalizedContentForHash(b), "date-only diff normalizes equal");
	assert.ok(normalizedContentForHash(a).includes("body"));
	assert.ok(!/updated:/.test(normalizedContentForHash(a)));
});

test("computeTemplateHash is deterministic and content-sensitive", () => {
	const root = fakeTemplateRoot();
	const f = path.join(root, "AGENTS.md");
	const h1 = computeTemplateHash(f);
	const h2 = computeTemplateHash(f);
	assert.equal(h1, h2);
	fs.writeFileSync(f, "changed content\n");
	assert.notEqual(h1, computeTemplateHash(f));
	assert.equal(computeTemplateHash(path.join(root, "nope")), null);
	fs.rmSync(root, { recursive: true, force: true });
});

test("templateManagedFiles lists repo-relative POSIX paths", () => {
	const root = fakeTemplateRoot();
	const files = templateManagedFiles(root).sort();
	assert.deepEqual(files, [
		".workflow/continuous-improvement/state.json",
		"AGENTS.md",
		"docs/wiki/agent/amber.md",
	]);
	fs.rmSync(root, { recursive: true, force: true });
});

test("fileTier classifies controlled / authored / state", () => {
	assert.equal(fileTier("docs/wiki/glossary.md"), "controlled");
	assert.equal(fileTier("docs/wiki/index.md"), "controlled");
	assert.equal(fileTier("AGENTS.md"), "authored");
	assert.equal(fileTier(".workflow/continuous-improvement/state.json"), "state");
});

test("buildProvenance stamps the on-disk hash per managed file with tier", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	// "Install": copy templates into target.
	for (const rel of templateManagedFiles(tpl)) {
		const dest = path.join(target, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(tpl, rel), dest);
	}
	const provenance = buildProvenance(target, { templateRoot: tpl, inferred: false });
	assert.equal(provenance.provenanceInferred, false);
	assert.ok(provenance.amberVersion);
	assert.ok(provenance.files["docs/wiki/agent/amber.md"]);
	assert.equal(provenance.files["docs/wiki/agent/amber.md"].tier, "controlled");
	assert.equal(provenance.files["AGENTS.md"].tier, "authored");
	assert.equal(provenance.files[".workflow/continuous-improvement/state.json"].tier, "state");
	// Missing files are omitted.
	fs.rmSync(path.join(target, "AGENTS.md"));
	const p2 = buildProvenance(target, { templateRoot: tpl, inferred: false });
	assert.ok(!p2.files["AGENTS.md"]);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("loadProvenance / writeProvenance round-trip; absent/corrupt → null", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	assert.equal(loadProvenance(target), null);
	const p = { schemaVersion: 1, amberVersion: "9.9.9", provenanceInferred: false, files: { "x.md": { templateHash: "h", tier: "controlled" } } };
	writeProvenance(target, p);
	assert.deepEqual(loadProvenance(target).files["x.md"], { templateHash: "h", tier: "controlled" });
	fs.writeFileSync(path.join(target, ".amber", "provenance.json"), "{ broken");
	assert.equal(loadProvenance(target), null);
	fs.rmSync(target, { recursive: true, force: true });
});
