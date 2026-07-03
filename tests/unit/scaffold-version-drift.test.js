"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { detectScaffoldDrift } = require("../../scripts/lib/core/scaffold-version-drift");
const { buildProvenance, writeProvenance, templateManagedFiles } = require("../../scripts/lib/core/scaffold-provenance");

// Controlled + authored + state fake templates. amber.md is controlled; AGENTS.md authored.
function fakeTemplateRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tpl-"));
	fs.mkdirSync(path.join(root, "docs/wiki/agent"), { recursive: true });
	fs.mkdirSync(path.join(root, ".workflow/continuous-improvement"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs/wiki/agent/amber.md"), "amber v1\n");
	fs.writeFileSync(path.join(root, "AGENTS.md"), "agents v1\n");
	fs.writeFileSync(path.join(root, ".workflow/continuous-improvement/state.json"), "{}\n");
	return root;
}

function install(tpl, target) {
	for (const rel of templateManagedFiles(tpl)) {
		const dest = path.join(target, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(tpl, rel), dest);
	}
}

function withProvenance(target, tpl, inferred = false) {
	writeProvenance(target, buildProvenance(target, { templateRoot: tpl, inferred }));
}

test("everything fresh right after install", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, false);
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	assert.equal(drift.installed, true);
	assert.equal(drift.counts.fresh, 3);
	assert.equal(drift.counts.stale, 0);
	assert.equal(drift.counts.customized, 0);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("template moved on, file untouched since install → stale", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, false); // baseline = installed (= shipped v1)
	// Ship a new version of the controlled file.
	fs.writeFileSync(path.join(tpl, "docs/wiki/agent/amber.md"), "amber v2\n");
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	const amber = drift.files.find((f) => f.path === "docs/wiki/agent/amber.md");
	assert.equal(amber.classification, "stale");
	assert.equal(amber.tier, "controlled");
	assert.equal(drift.counts.stale, 1);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("user edited the file after install → customized (never stale)", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, false);
	fs.writeFileSync(path.join(target, "docs/wiki/agent/amber.md"), "my custom amber\n");
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	const amber = drift.files.find((f) => f.path === "docs/wiki/agent/amber.md");
	assert.equal(amber.classification, "customized");
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("inferred provenance + differing file → ambiguous (not stale)", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, true); // inferred migration baseline
	fs.writeFileSync(path.join(tpl, "docs/wiki/agent/amber.md"), "amber v2\n");
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	const amber = drift.files.find((f) => f.path === "docs/wiki/agent/amber.md");
	assert.equal(amber.classification, "ambiguous");
	assert.ok(drift.provenanceInferred);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("deleted managed file → missing", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, false);
	fs.unlinkSync(path.join(target, "AGENTS.md"));
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	assert.equal(drift.counts.missing, 1);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("no provenance → installed:false with a guidance note, no crash", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target); // no writeProvenance
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	assert.equal(drift.installed, false);
	assert.match(drift.note, /No install provenance/);
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});

test("a template file added AFTER provenance was stamped → ambiguous (no baseline entry, never stale)", () => {
	const tpl = fakeTemplateRoot();
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tgt-"));
	install(tpl, target);
	withProvenance(target, tpl, false); // baseline covers only the v1 set (no working-rules.md)
	// A later release ships a NEW managed file the install never saw. The user has a
	// (non-shipped) version of it on disk. There is no provenance entry for it, so the
	// detector cannot prove "stale" — it must classify ambiguous (safe: never overwritten).
	fs.mkdirSync(path.join(tpl, "docs/wiki/agent"), { recursive: true });
	fs.writeFileSync(path.join(tpl, "docs/wiki/agent/working-rules.md"), "shipped v1\n");
	fs.mkdirSync(path.join(target, "docs/wiki/agent"), { recursive: true });
	fs.writeFileSync(path.join(target, "docs/wiki/agent/working-rules.md"), "my version\n");
	const drift = detectScaffoldDrift(target, { templateRoot: tpl });
	const wr = drift.files.find((f) => f.path === "docs/wiki/agent/working-rules.md");
	assert.ok(wr, "new template file is iterated");
	assert.equal(wr.classification, "ambiguous", "no entry → ambiguous, never stale");
	fs.rmSync(tpl, { recursive: true, force: true });
	fs.rmSync(target, { recursive: true, force: true });
});
