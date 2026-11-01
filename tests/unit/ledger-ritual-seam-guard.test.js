"use strict";

/**
 * Guard for the governed-ledger ritual seam (F061 / ADR-0028).
 *
 * ADR-0028 makes `defineLedgerFamily` the single admission path for a governed
 * chained ledger: it owns path resolution, the append lock, the fail-closed
 * fold, the chain walk, the size ceiling, and the governed append. A module
 * that requires `acquireLedgerLock` or `appendLedgerEvent` directly rebuilds
 * that ritual by hand, which is the exact drift the factory's header says it
 * prevents ("a family assembled here cannot drift back into a private append or
 * an unchained fold"). Nothing stopped that before: `staleness-registry.js`
 * hand-wrote ~137 lines of it until it was folded back in.
 *
 * Exempt files:
 *   - scripts/lib/core/ledger-family.js — composes the primitives into the
 *     family surface; it is the only intended caller of `appendLedgerEvent`.
 *   - scripts/lib/core/ledger-suggestion-review.js — deliberately probes the
 *     lock and ceiling BEFORE mutating (acquire-and-release), so its governed
 *     append still goes through the factory.
 *
 * Out of scope on purpose: `readLedgerFailClosed` and `appendJSONL`. The
 * artifact journal, the organization audit, and the knowledge base are
 * unchained append-only logs (zero `prevHash`/`chainHash` references), so the
 * chained factory does not apply to them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_TARGET = path.join(REPO_ROOT, "scripts", "lib");
const EXEMPT_FILES = new Set([
	"scripts/lib/core/ledger-family.js",
	"scripts/lib/core/ledger-suggestion-review.js",
]);
const FORBIDDEN = ["acquireLedgerLock", "appendLedgerEvent"];

// Destructured import: `const { ..., acquireLedgerLock, ... } = require(".../registry-ledger")`
const DESTRUCTURED_IMPORT =
	/const\s*\{([\s\S]*?)\}\s*=\s*require\(\s*["'][^"']*registry-ledger["']\s*\)/g;
// Direct property access: `require(".../registry-ledger").appendLedgerEvent(`
const PROPERTY_ACCESS =
	/require\(\s*["'][^"']*registry-ledger["']\s*\)\s*\.\s*(acquireLedgerLock|appendLedgerEvent)/g;

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

/** Offending import names in one source text, e.g. `["acquireLedgerLock"]`. */
function offensesIn(source) {
	const found = new Set();
	for (const match of source.matchAll(DESTRUCTURED_IMPORT)) {
		for (const raw of match[1].split(",")) {
			const name = raw.split(":")[0].trim();
			if (FORBIDDEN.includes(name)) found.add(name);
		}
	}
	for (const match of source.matchAll(PROPERTY_ACCESS)) {
		if (FORBIDDEN.includes(match[1])) found.add(match[1]);
	}
	return [...found].sort();
}

function findOffenders() {
	const files = collectJsFiles(SCAN_TARGET).sort();
	const relativeFiles = files.map((file) => toPosix(path.relative(REPO_ROOT, file)));

	// The guard is only meaningful if it actually walks the production tree:
	// fail loudly if the layout moved out from under it.
	assert.ok(
		relativeFiles.length > 40,
		`expected to scan 40+ production files, found ${relativeFiles.length}`,
	);
	for (const exempt of EXEMPT_FILES) {
		assert.ok(
			relativeFiles.includes(exempt),
			`exempt file ${exempt} no longer exists — update the exemption list`,
		);
	}

	const offenders = [];
	files.forEach((file, index) => {
		const relativePath = relativeFiles[index];
		if (EXEMPT_FILES.has(relativePath)) return;
		const names = offensesIn(fs.readFileSync(file, "utf8"));
		if (names.length > 0) offenders.push(`${relativePath}: ${names.join(", ")}`);
	});
	return offenders;
}

test("production code reaches the ledger ritual only through defineLedgerFamily", () => {
	const offenders = findOffenders();
	assert.deepEqual(
		offenders,
		[],
		[
			"These modules require the raw ledger primitives instead of defineLedgerFamily:",
			...offenders,
			"Declare the family in ledger-family.js, or add a reasoned exemption above.",
		].join("\n"),
	);
});

test("the seam rule discriminates: a hand-rolled import is reported", () => {
	assert.deepEqual(
		offensesIn('const {\n\tGENESIS_HASH,\n\tacquireLedgerLock,\n} = require("./registry-ledger");'),
		["acquireLedgerLock"],
	);
	assert.deepEqual(
		offensesIn('const { appendLedgerEvent } = require("../core/registry-ledger");'),
		["appendLedgerEvent"],
	);
	assert.deepEqual(
		offensesIn('require("./registry-ledger").appendLedgerEvent(cwd, options, body);'),
		["appendLedgerEvent"],
	);
	// The primitives that unchained logs legitimately use stay out of scope.
	assert.deepEqual(
		offensesIn(
			'const { appendJSONL, readLedgerFailClosed } = require("./jsonl");\nconst { chainHash } = require("./registry-ledger");',
		),
		[],
	);
});
