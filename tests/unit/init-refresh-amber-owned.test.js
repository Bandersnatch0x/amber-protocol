"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const {
	detectScaffoldDrift,
	refreshAmberOwnedFiles,
} = require("../../scripts/lib/core/scaffold-version-drift");
const { TEMPLATE_ROOT } = require("../../scripts/lib/core/constants");

const REL = "docs/wiki/glossary.md"; // controlled file that ships with the repo

// Copy the shipped templates to a temp dir so refresh tests can mutate templates
// WITHOUT touching the real repo templates. node --test runs files in parallel;
// mutating templates/ would leak into other suites (scaffold-amber, init-with-
// detection) and survive a mid-run SIGKILL. The copy carries the same files, so
// AMBER_CONTROLLED_CONTENT_FILES membership is preserved.
function copyTemplates() {
	const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "amber-tpl-fix-"));
	fs.cpSync(TEMPLATE_ROOT, tpl, { recursive: true });
	return tpl;
}

function installDir(tpl) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-refresh-"));
	scaffoldHarness(dir, { templateRoot: tpl }); // install + provenance (baseline = installed = shipped copy)
	return dir;
}

test("--refresh-amber-owned overwrites a stale controlled file, backs up, and re-stamps provenance", () => {
	const tpl = copyTemplates();
	const dir = installDir(tpl);
	try {
		const shippedPath = path.join(tpl, REL);
		const installedPath = path.join(dir, REL);

		// Ship a new version of the (copied) template.
		const original = fs.readFileSync(shippedPath, "utf8");
		fs.writeFileSync(shippedPath, original + "\n# refreshed addition\n");

		// Sanity: detector sees stale before refresh.
		let drift = detectScaffoldDrift(dir, { templateRoot: tpl });
		assert.equal(drift.files.find((f) => f.path === REL).classification, "stale");

		const before = fs.readFileSync(installedPath, "utf8");
		scaffoldHarness(dir, { refreshAmberOwned: true, templateRoot: tpl });

		// Controlled stale file overwritten to the new shipped content.
		const after = fs.readFileSync(installedPath, "utf8");
		assert.notEqual(after, before);
		assert.ok(after.includes("# refreshed addition"));
		// Backed up.
		assert.ok(fs.existsSync(installedPath + ".bak"));
		// Re-stamped: detector now sees fresh.
		drift = detectScaffoldDrift(dir, { templateRoot: tpl });
		assert.equal(drift.files.find((f) => f.path === REL).classification, "fresh");
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("--refresh-amber-owned does NOT overwrite a customized controlled file, but caches the new template for manual merge", () => {
	const tpl = copyTemplates();
	const dir = installDir(tpl);
	try {
		const shippedPath = path.join(tpl, REL);
		const installedPath = path.join(dir, REL);
		const original = fs.readFileSync(shippedPath, "utf8");
		fs.writeFileSync(shippedPath, original + "\n# refreshed addition\n");

		// User customized the installed file AFTER install. Provenance still holds
		// the install-time baseline, so this classifies "customized".
		fs.writeFileSync(installedPath, "my custom glossary\n");
		const before = fs.readFileSync(installedPath, "utf8");
		scaffoldHarness(dir, { refreshAmberOwned: true, templateRoot: tpl });
		assert.equal(fs.readFileSync(installedPath, "utf8"), before, "customized file untouched");
		// New template cached for manual merge.
		const proposal = path.join(
			dir,
			".amber",
			"maintenance",
			"proposals",
			REL.replace(/\//g, "__") + ".new",
		);
		assert.ok(fs.existsSync(proposal), "proposal cached");
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("--refresh-amber-owned never touches authored or state files", () => {
	const tpl = copyTemplates();
	const dir = installDir(tpl);
	try {
		const rel = "AGENTS.md"; // authored
		const shippedPath = path.join(tpl, rel);
		const installedPath = path.join(dir, rel);
		const original = fs.readFileSync(shippedPath, "utf8");
		fs.writeFileSync(shippedPath, original + "\n# new agents content\n");

		const before = fs.readFileSync(installedPath, "utf8");
		scaffoldHarness(dir, { refreshAmberOwned: true, templateRoot: tpl });
		assert.equal(fs.readFileSync(installedPath, "utf8"), before, "authored file untouched");
		assert.ok(!fs.existsSync(installedPath + ".bak"), "no backup created for authored file");
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("--refresh-amber-owned re-stamps so a refreshed file stays refreshable on the NEXT release (not stuck customized)", () => {
	const tpl = copyTemplates();
	const dir = installDir(tpl);
	try {
		const shippedPath = path.join(tpl, REL);
		const installedPath = path.join(dir, REL);
		const original = fs.readFileSync(shippedPath, "utf8");

		// Release v2: refresh overwrites the file AND re-stamps its provenance baseline to v2.
		fs.writeFileSync(shippedPath, original + "\n# v2\n");
		scaffoldHarness(dir, { refreshAmberOwned: true, templateRoot: tpl });
		assert.ok(fs.readFileSync(installedPath, "utf8").includes("# v2"));

		// Release v3: file is still v2 (unchanged since the v2 refresh).
		// WITHOUT re-stamp, provenance baseline would still be v1 → installed(v2) !=
		// baseline(v1) → "customized" (stuck, never auto-refreshable again).
		// WITH re-stamp, baseline is v2, file is v2, shipped is v3 → "stale".
		fs.writeFileSync(shippedPath, original + "\n# v2\n\n# v3\n");
		const drift = detectScaffoldDrift(dir, { templateRoot: tpl });
		const file = drift.files.find((f) => f.path === REL);
		assert.equal(
			file.classification,
			"stale",
			"re-stamp keeps the file refreshable, not stuck customized",
		);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("--refresh-amber-owned on a target with no provenance is a safe no-op", () => {
	const tpl = copyTemplates();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-refresh-"));
	try {
		// Install templates, then remove provenance entirely.
		scaffoldHarness(dir, { templateRoot: tpl });
		fs.unlinkSync(path.join(dir, ".amber", "provenance.json"));
		// Refresh must NOT crash or overwrite anything; it returns empty lists + a note.
		const result = refreshAmberOwnedFiles(dir, { templateRoot: tpl });
		assert.deepEqual(result.refreshed, []);
		assert.deepEqual(result.proposals, []);
		assert.ok(result.note, "guidance note present on no-provenance refresh");
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
