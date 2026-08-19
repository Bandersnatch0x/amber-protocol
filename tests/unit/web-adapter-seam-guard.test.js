"use strict";

// Seam guard for docs/architecture/web-viewer.md principle 4 (Issue #130): the
// web server may only reach scripts/lib through scripts/lib/web-adapter.js —
// never deep CLI modules. Recursively scans every .ts/.tsx file under
// apps/web/server for require/import specifiers and fails on any scripts/lib
// reference that is not the web-adapter seam. Comment mentions of scripts/lib
// paths are documentation, not imports, and are ignored.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_DIR = path.join(__dirname, "../../apps/web/server");

/** Recursively collect every .ts/.tsx file under dir (sorted for stable output). */
function collectSourceFiles(dir, out = []) {
	for (const entry of fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(full, out);
		} else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Blank out comments while preserving string literals and line structure, so
 * regex scans neither trip on commented-out imports nor miss real imports
 * that follow a `//` on the same line. Comment characters become spaces;
 * newlines survive, keeping index → line mapping intact.
 *
 * @param {string} source
 * @returns {string}
 */
function blankOutComments(source) {
	const out = source.split("");
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			while (i < n && source[i] !== "\n") {
				out[i] = " ";
				i += 1;
			}
		} else if (ch === "/" && next === "*") {
			out[i] = " ";
			out[i + 1] = " ";
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
				if (source[i] !== "\n") out[i] = " ";
				i += 1;
			}
			if (i < n) {
				out[i] = " ";
				out[i + 1] = " ";
				i += 2;
			}
		} else if (ch === "'" || ch === '"' || ch === "`") {
			const quote = ch;
			i += 1;
			while (i < n) {
				if (source[i] === "\\") {
					i += 2;
					continue;
				}
				if (source[i] === quote) {
					i += 1;
					break;
				}
				i += 1;
			}
		} else {
			i += 1;
		}
	}
	return out.join("");
}

/**
 * Extract module specifiers from comment-blanked source. Covers:
 * - require('...') and wrapped variants such as requireCli('...')
 * - import ... from '...' / import type ... from '...' / export ... from '...'
 * - side-effect imports: import '...'
 * - dynamic imports: import('...')
 *
 * @param {string} source - comment-blanked source text
 * @returns {Array<{ specifier: string, line: number }>}
 */
function extractModuleSpecifiers(source) {
	const lineAt = (index) => source.slice(0, index).split("\n").length;
	const found = [];
	const patterns = [
		// require / requireCli / any require* wrapper with a string-literal argument
		/\brequire[A-Za-z$_][\w$]*\s*\(\s*(['"`])([^'"`]+)\1/g,
		// plain require( literal )
		/\brequire\s*\(\s*(['"`])([^'"`]+)\1/g,
		// import/export ... from '...' (including import type)
		/\bfrom\s+(['"`])([^'"`]+)\1/g,
		// side-effect import: import '...'
		/(?:^|[\s;])import\s+(['"`])([^'"`]+)\1/g,
		// dynamic import('...')
		/\bimport\s*\(\s*(['"`])([^'"`]+)\1/g,
	];
	const seen = new Set();
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const key = `${match.index}:${match[2]}`;
			if (seen.has(key)) continue;
			seen.add(key);
			found.push({ specifier: match[2], line: lineAt(match.index) });
		}
	}
	return found.sort((a, b) => a.line - b.line);
}

/** Normalize a specifier for matching (Windows checkout may hold backslashes). */
function normalizeSpecifier(specifier) {
	return specifier.replace(/\\/g, "/");
}

/** Whether a specifier reaches into scripts/lib (relative climb or absolute fragment). */
function targetsScriptsLib(specifier) {
	return /(^|\/)scripts\/lib\//.test(normalizeSpecifier(specifier));
}

/** The only legal scripts/lib target: the web-adapter seam (.js runtime / .d.ts types). */
function isWebAdapterSeam(specifier) {
	return /(^|\/)scripts\/lib\/web-adapter(\.(js|d\.ts))?$/.test(normalizeSpecifier(specifier));
}

/** Scan the whole web server tree once; shared by every assertion below. */
function scanServerSeam() {
	const files = collectSourceFiles(SERVER_DIR);
	const adapterRefs = [];
	const violations = [];
	for (const file of files) {
		const source = blankOutComments(fs.readFileSync(file, "utf8"));
		const rel = path.relative(path.join(__dirname, "../.."), file).replace(/\\/g, "/");
		for (const { specifier, line } of extractModuleSpecifiers(source)) {
			if (!targetsScriptsLib(specifier)) continue;
			if (isWebAdapterSeam(specifier)) {
				adapterRefs.push({ file: rel, line, specifier });
			} else {
				violations.push({ file: rel, line, specifier });
			}
		}
	}
	return { files, adapterRefs, violations };
}

describe("seam guard detector (self-check against silent no-op scans)", () => {
	it("extracts specifiers from require, requireCli, import forms, and dynamic import", () => {
		const sample = blankOutComments(
			[
				"const a = require('mod-a');",
				"const b = requireCli('../../scripts/lib/session-state-machine.js');",
				"import { x } from 'mod-b';",
				"import type { Y } from '../../scripts/lib/web-adapter';",
				"import 'side-effect-mod';",
				"export { z } from 'mod-c';",
				"const d = await import('dynamic-mod');",
			].join("\n"),
		);
		const specifiers = extractModuleSpecifiers(sample).map((s) => s.specifier);
		for (const expected of [
			"mod-a",
			"../../scripts/lib/session-state-machine.js",
			"mod-b",
			"../../scripts/lib/web-adapter",
			"side-effect-mod",
			"mod-c",
			"dynamic-mod",
		]) {
			assert.ok(specifiers.includes(expected), `must detect ${expected}`);
		}
	});

	it("ignores scripts/lib paths mentioned only in comments", () => {
		const sample = blankOutComments(
			[
				"// mirrors scripts/lib/session-state-machine.js",
				"/* deep require('../../scripts/lib/core/loop-policy.js') lives here */",
				"const a = require('real-mod'); // trailing scripts/lib/core/audit.js note",
			].join("\n"),
		);
		const specifiers = extractModuleSpecifiers(sample).map((s) => s.specifier);
		assert.deepEqual(specifiers, ["real-mod"]);
	});

	it("classifies web-adapter variants as legal and deep modules as violations", () => {
		for (const legal of [
			"../../../../scripts/lib/web-adapter",
			"../../../../scripts/lib/web-adapter.js",
			"scripts/lib/web-adapter.d.ts",
		]) {
			assert.ok(targetsScriptsLib(legal), `${legal} must be seen as scripts/lib`);
			assert.ok(isWebAdapterSeam(legal), `${legal} must be the legal seam`);
		}
		for (const illegal of [
			"../../../../scripts/lib/session-state-machine.js",
			"../../../scripts/lib/core/loop-policy.js",
			"scripts/lib/web-adapter-utils.js",
		]) {
			assert.ok(targetsScriptsLib(illegal), `${illegal} must be seen as scripts/lib`);
			assert.ok(!isWebAdapterSeam(illegal), `${illegal} must NOT pass as the seam`);
		}
	});
});

describe("web-adapter seam guard (apps/web/server)", () => {
	it("has TypeScript sources to scan (scan path is alive)", () => {
		assert.ok(fs.existsSync(SERVER_DIR), `missing scan root: ${SERVER_DIR}`);
		const { files } = scanServerSeam();
		assert.ok(files.length > 0, "expected at least one .ts/.tsx file under apps/web/server");
	});

	it("keeps at least one live web-adapter reference (guards against empty-scan false green)", () => {
		const { adapterRefs } = scanServerSeam();
		assert.ok(
			adapterRefs.length > 0,
			"no web-adapter import found under apps/web/server — the scan is likely dead",
		);
	});

	it("imports scripts/lib only through the web-adapter seam", () => {
		const { violations } = scanServerSeam();
		const report = violations.map((v) => `  ${v.file}:${v.line} → ${v.specifier}`).join("\n");
		assert.equal(
			violations.length,
			0,
			`deep scripts/lib imports bypass the web-adapter seam ` +
				`(docs/architecture/web-viewer.md principle 4):\n${report}`,
		);
	});
});
