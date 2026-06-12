"use strict";
// Permanent guard: legacy "harness" naming may appear only in the allowlist
// or on lines that explicitly label themselves as legacy/historical.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");

const PATTERNS = [
	/coding-harness/i,
	/Coding Harness/,
	/harness-core/,
	/harness-delivery/,
	/safe-harness-bootstrap/,
	/scripts\/harness\.js/,
	/"\.harness"/,
];

// Lines carrying these markers are deliberate legacy mentions (rename docs,
// deprecation notes, era labels) and are exempt wherever they appear.
const LINE_EXEMPT = /legacy|deprecated|formerly|historical|预迁移|旧名|曾用名|（原 |\(原 /i;

const ALLOWLIST = [
	"scripts/harness.js",
	"scripts/compat/coding-harness.js",
	"scripts/lib/harness-core.js",
	"scripts/lib/state-dir-resolver.js",
	"scripts/lib/state-migration.js",
	"docs/legacy/",
	"docs/reviews/", // historical review records
	"docs/release/CHANGELOG.md",
	"docs/release/RELEASE_NOTES.md",
	"docs/superpowers/plans/",
	"docs/superpowers/specs/",
	"docs/examples/", // historical review artifacts generated from real read-only trials
	"docs/wiki/PHASE_B_ALPHA_TASKS.md", // era-noted historical task list
	".workflow/",
	".mimocode/",
	"tests/fixtures/",
	"tests/legacy-references.test.js",
	"tests/amber-core-structure.test.js", // guard asserts core never requires the legacy facade name
	"tests/unit/amber-core-exports.test.js",
	"tests/unit/state-dir-resolver.test.js",
	"tests/unit/state-migration.test.js",
	"tests/amber-cli.test.js", // shim-forwarding subtest spawns legacy entrypoints
	"package.json", // legacy bin alias
	"package-lock.json",
	"correctness-review.md",
	"correctness-review-round2.md",
	"maintainability-review.md",
	"maintainability-review-round2.md",
	"tests-review-round2.md",
	"fix-round1.md",
];

// Files inside allowlisted directories that must STILL be clean — active docs.
const MUST_BE_CLEAN = ["docs/examples/README.md"];

// Code shims allowed to carry old names must self-identify as legacy so the
// allowlist cannot silently become a hiding place for active code.
const SELF_IDENTIFYING_SHIMS = [
	"scripts/harness.js",
	"scripts/compat/coding-harness.js",
	"scripts/lib/harness-core.js",
];

const SCAN_DIRS = ["scripts", "tests", "docs", "templates", "skills", "registry",
	"rule-packs", "standards", "workflow-packs", "team-presets", "profiles",
	"routes", "schemas", "src", "apps", ".claude-plugin", ".codex-plugin"];
const ROOT_FILES = ["README.md", "README.zh-CN.md", "SPEC.md", "ROADMAP.md",
	"BACKLOG.md", "UBIQUITOUS_LANGUAGE.md", "package.json"];

function isAllowed(rel) {
	const slash = rel.split(path.sep).join("/");
	if (MUST_BE_CLEAN.includes(slash)) return false;
	return ALLOWLIST.some((a) => slash === a || slash.startsWith(a));
}

function* walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			// Skip generated/build output: .next embeds absolute paths that
			// legitimately contain the on-disk repo folder name.
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === ".tmp" ||
				entry.name === ".next" ||
				entry.name === "dist" ||
				entry.name === "coverage"
			) continue;
			yield* walk(full);
		} else yield full;
	}
}

test("legacy harness references appear only in the allowlist or on labeled lines", () => {
	const offenders = [];
	const files = [
		...ROOT_FILES.map((f) => path.join(REPO, f)).filter(fs.existsSync),
	];
	for (const dir of SCAN_DIRS) {
		const abs = path.join(REPO, dir);
		if (fs.existsSync(abs)) files.push(...walk(abs));
	}
	for (const file of files) {
		const rel = path.relative(REPO, file);
		if (isAllowed(rel)) continue;
		if (!/\.(js|json|md)$/.test(file)) continue;
		const lines = fs.readFileSync(file, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (LINE_EXEMPT.test(lines[i])) continue;
			for (const pattern of PATTERNS) {
				if (pattern.test(lines[i])) {
					offenders.push(`${rel}:${i + 1}: ${pattern}`);
					break;
				}
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`legacy references outside allowlist:\n${offenders.join("\n")}`,
	);
});

test("code shims in the allowlist self-identify as legacy", () => {
	for (const shim of SELF_IDENTIFYING_SHIMS) {
		const content = fs.readFileSync(path.join(REPO, shim), "utf8");
		assert.match(
			content,
			/legacy|deprecated/i,
			`${shim} must carry a legacy/deprecated note`,
		);
	}
});
