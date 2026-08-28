"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

function git(args) {
	return execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function trackedFiles() {
	return git(["ls-files"]).split(/\r?\n/).filter(Boolean);
}

const IMPLEMENTATION_PREFIXES = [
	"scripts/",
	"apps/",
	"schemas/",
	"tests/",
	"action-types/",
	"routes/",
	"workflow-packs/",
	"standards/",
];

const EXTERNAL_IDENTIFIERS = new RegExp(
	[
		["better", "harness"].join("[- ]?"),
		["tre", "llis"].join(""),
		["qoder", "ai"].join(""),
		["cobus", "greyling"].join(""),
	].join("|"),
	"i",
);

const TRACKED_REFERENCE_ALLOWLIST = new Set([
	"AGENTS.md",
	"CLAUDE.md",
	"LOOP.md",
	"README.md",
	"ROADMAP.md",
	"SPEC.md",
	"feature_list.json",
	"docs/adr/0008-workflow-effectiveness-vs-governance-readiness.md",
	"docs/dogfood-weekly.md",
	"docs/plans/F025-Break-loop-post-mortem-scaffold.md",
	"docs/quality/better-harness-reference-improvement-plan.md",
	"docs/quality/external-reference-ip-audit.md",
	// The committed F059 knowledge corpus mirrors already-allowlisted reviewed docs verbatim
	// (e.g. the loop-engineering wiki page); its mentions are the same reviewed references.
	"docs/knowledge-corpus/knowledge-base.output.json",
	// Sharing materials cite external projects (e.g. Trellis) as reviewed competitive research.
	"docs/sharing/2026-08-amber-architecture-sharing.md",
	"docs/sharing/2026-08-amber-sharing-outline.md",
	"docs/superpowers/specs/2026-06-09-declarative-loop-contract-design.md",
	"docs/wiki/knowledge-plan.json",
	"docs/wiki/knowledge/index.md",
	"docs/wiki/knowledge/knowledge-cards.md",
	"docs/wiki/knowledge/loop-engineering-governed-execution/loop-engineering-governed-execution.md",
	"skills/amber-continuous-improvement/SKILL.md",
	"templates/docs/wiki/knowledge-plan.json",
	"templates/docs/wiki/knowledge-plan.yaml",
	".agents/skills/amber-continuous-improvement/SKILL.md",
	".claude/commands/amber-continuous-improvement.md",
	".gemini/commands/amber/continuous-improvement.toml",
]);

function versionableFiles() {
	return git(["ls-files", "--cached", "--others", "--exclude-standard"])
		.split(/\r?\n/)
		.filter(Boolean);
}

function fileContainsExternalIdentifier(file) {
	const absolute = path.join(ROOT, file);
	if (!fs.existsSync(absolute)) return false;
	const bytes = fs.readFileSync(absolute);
	if (bytes.length > 1024 * 1024 || bytes.includes(0)) return false;
	return EXTERNAL_IDENTIFIERS.test(bytes.toString("utf8"));
}

function versionableReferenceFiles() {
	const self = path.relative(ROOT, __filename).split(path.sep).join("/");
	return versionableFiles()
		.filter((file) => file !== self)
		.filter(fileContainsExternalIdentifier);
}

test("external reference project identifiers never enter implementation surfaces", () => {
	const offenders = versionableReferenceFiles().filter((file) =>
		IMPLEMENTATION_PREFIXES.some((prefix) => file.startsWith(prefix)),
	);
	assert.deepEqual(offenders, []);
});

test("external reference mentions stay inside the reviewed versionable allowlist", () => {
	const offenders = versionableReferenceFiles().filter(
		(file) => !TRACKED_REFERENCE_ALLOWLIST.has(file),
	);
	assert.deepEqual(offenders, []);
});

test("ignored external report run products cannot enter the tracked tree", () => {
	const tracked = trackedFiles();
	assert.deepEqual(
		tracked.filter((file) => file.startsWith(".qoder/")),
		[],
	);
});

test("external reference tools are not runtime or development dependencies", () => {
	const manifest = JSON.parse(git(["show", "HEAD:package.json"]));
	const dependencyNames = Object.keys({
		...(manifest.dependencies || {}),
		...(manifest.devDependencies || {}),
		...(manifest.optionalDependencies || {}),
	});
	assert.deepEqual(
		dependencyNames.filter((name) => EXTERNAL_IDENTIFIERS.test(name)),
		[],
	);
});
