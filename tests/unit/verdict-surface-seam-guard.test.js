"use strict";

/**
 * Guard for the verdict-surface seam (ADR-0106).
 *
 * Four incidents (`688e9df0`, `cb7bb8a1`, `88632c52`, `issues/357`) shared one
 * shape: a surface answered "did this pass?" and never said where "did not run"
 * goes, so an absent result read as a pass. The factory makes the choice a
 * declaration; this guard makes the declaration mandatory.
 *
 * Two rules, because the two failure modes are different:
 *
 *   1. A module that writes a not-run word as a string literal is a verdict
 *      surface, whether or not it thinks so. It must go through
 *      `defineVerdictSurface`. This is the rule that catches the incident shape
 *      — `held-out-core.js` wrote `"not-run"` inline with no declaration.
 *   2. Some surfaces rule 1 cannot see: those placing not-run at `refusal` or
 *      `assurance` record no not-run word at all, and `retention` spells its
 *      not-run value `unavailable`, which is outside the narrowed list because
 *      lifecycle vocabularies use that word too. A census pins their
 *      declarations so removing one is a test failure rather than a silent
 *      regression to "undeclared".
 *
 * Out of scope, matching ADR-0106 decision 5: lifecycle status vocabularies
 * (`adapter READ_STATUSES`, `retention HOLD_STATUSES`, `canonical
 * ARTIFACT_STATUSES`, `breakglass GRANT_STATUSES`, `runner REQUEST_STATUSES`)
 * and the two deferred mixed axes (`external DECLARED_STATUSES`, `retention
 * SETTLEMENT_STATUSES`). They describe where a record sits, not whether a check
 * passed, and the narrowed word list below does not match them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { NOT_RUN_WORDS } = require("../../scripts/lib/core/verdict-surface");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Both production trees: the security audit surface spans them — the CLI half
// lives in scripts/lib and the report fold in src/security.
const SCAN_TARGETS = [path.join(REPO_ROOT, "scripts", "lib"), path.join(REPO_ROOT, "src")];
const FACTORY_FILE = "scripts/lib/core/verdict-surface.js";

// Rule 2: the surfaces whose placement is invisible to rule 1.
const DECLARED_SURFACES = Object.freeze([
	"scripts/lib/core/evidence-receipts.js",
	"scripts/lib/core/gate-evaluation.js",
	"scripts/lib/core/policy-evaluation.js",
	"scripts/lib/core/retention-registry.js",
]);

const NOT_RUN_LITERAL = new RegExp(`["'](${NOT_RUN_WORDS.join("|")})["']`);
const FACTORY_IMPORT = /require\(\s*["'][^"']*verdict-surface["']\s*\)/;

function toPosix(value) {
	return value.replace(/\\/g, "/");
}

function collectJsFiles(entry) {
	const stat = fs.statSync(entry);
	if (stat.isFile()) return entry.endsWith(".js") ? [entry] : [];
	const out = [];
	for (const name of fs.readdirSync(entry).sort()) {
		out.push(...collectJsFiles(path.join(entry, name)));
	}
	return out;
}

/** Not-run literals in one source text, e.g. `["not-run"]`. */
function notRunLiteralsIn(source) {
	const found = new Set();
	for (const match of source.matchAll(new RegExp(NOT_RUN_LITERAL.source, "g"))) {
		found.add(match[1]);
	}
	return [...found].sort();
}

function productionFiles() {
	const files = SCAN_TARGETS.flatMap((target) => collectJsFiles(target)).sort();
	// The guard is only meaningful if it walks the production trees: fail loudly
	// if the layout moved out from under it.
	assert.ok(files.length > 40, `expected to scan 40+ production files, found ${files.length}`);
	return files.map((file) => ({
		relativePath: toPosix(path.relative(REPO_ROOT, file)),
		source: fs.readFileSync(file, "utf8"),
	}));
}

test("a module that names a not-run word goes through defineVerdictSurface", () => {
	const offenders = [];
	for (const { relativePath, source } of productionFiles()) {
		if (relativePath === FACTORY_FILE) continue;
		const literals = notRunLiteralsIn(source);
		if (literals.length > 0 && !FACTORY_IMPORT.test(source)) {
			offenders.push(`${relativePath}: ${literals.join(", ")}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		[
			"These modules declare a verdict vocabulary without saying where did-not-run goes:",
			...offenders,
			"Call defineVerdictSurface (ADR-0106) or use a surface that already declared one.",
		].join("\n"),
	);
});

test("the surfaces rule 1 cannot see keep their declarations", () => {
	const sources = new Map(productionFiles().map((f) => [f.relativePath, f.source]));
	for (const relativePath of DECLARED_SURFACES) {
		assert.ok(
			sources.has(relativePath),
			`declared verdict surface ${relativePath} no longer exists — update the census`,
		);
		assert.ok(
			FACTORY_IMPORT.test(sources.get(relativePath)),
			`${relativePath} no longer calls defineVerdictSurface; its not-run placement is undeclared again`,
		);
	}
});

test("the seam rule discriminates: an inline not-run literal is reported", () => {
	assert.deepEqual(
		notRunLiteralsIn(
			'const status = findings.length > 0 ? "fail" : pages === 0 ? "not-run" : "pass";',
		),
		["not-run"],
	);
	assert.deepEqual(
		notRunLiteralsIn("const CHECK_STATUSES = Object.freeze(['pass', 'fail', 'unscanned']);"),
		["unscanned"],
	);
	// A comment naming the word is not a declaration.
	assert.deepEqual(notRunLiteralsIn("// not-run means the check never ran"), []);
	// Lifecycle words outside the narrowed list stay out of scope.
	assert.deepEqual(
		notRunLiteralsIn('const READ_STATUSES = Object.freeze(["fresh", "stale", "unavailable"]);'),
		[],
	);
});
