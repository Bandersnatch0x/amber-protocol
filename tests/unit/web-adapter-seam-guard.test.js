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
 * Blank comments (and regex literals / template interpolations) while
 * preserving string literals and line structure. A small lexer, not a regex
 * sweep: handles line/block comments, escaped quotes, nested template
 * interpolation `${...}` (with its own strings), and regex literals — so the
 * scan never trips on commented-out imports nor misses real ones, and does
 * not need updating as comment styles evolve. Newlines survive, keeping the
 * index → line mapping intact.
 */
function blankOutComments(source) {
	const out = source.split("");
	const n = source.length;
	const blank = (from, to) => {
		for (let k = from; k < to && k < n; k += 1) {
			if (source[k] !== "\n") out[k] = " ";
		}
	};

	// Walk a quoted string (escapes respected); nothing is blanked.
	const skipString = (start, quote) => {
		let i = start + 1;
		while (i < n) {
			if (source[i] === "\\") {
				i += 2;
				continue;
			}
			if (source[i] === quote) return i + 1;
			i += 1;
		}
		return n;
	};

	// Walk a template literal; interpolations `${...}` are blanked (they may
	// contain quotes, comments, or nested templates).
	const skipTemplate = (start) => {
		let i = start + 1;
		while (i < n) {
			if (source[i] === "\\") {
				i += 2;
				continue;
			}
			if (source[i] === "`") return i + 1;
			if (source[i] === "$" && source[i + 1] === "{") {
				const exprStart = i;
				let depth = 1;
				i += 2;
				while (i < n && depth > 0) {
					if (source[i] === "`") {
						i = skipTemplate(i);
						continue;
					}
					if (source[i] === "'" || source[i] === '"') {
						i = skipString(i, source[i]);
						continue;
					}
					if (source[i] === "{") depth += 1;
					else if (source[i] === "}") depth -= 1;
					i += 1;
				}
				blank(exprStart, i);
				continue;
			}
			i += 1;
		}
		return n;
	};

	// Regex-start heuristic: `/` begins a regex when the previous significant
	// token cannot end an expression (operators, openers, or start of line).
	const isRegexStart = (pos) => {
		let prev = pos - 1;
		while (prev >= 0 && /\s/.test(source[prev])) prev -= 1;
		if (prev < 0) return true;
		const c = source[prev];
		if (/[A-Za-z0-9_$)\]'"]/.test(c)) return false;
		return true;
	};

	const skipRegex = (start) => {
		let i = start + 1;
		let inClass = false;
		while (i < n) {
			if (source[i] === "\\") {
				i += 2;
				continue;
			}
			if (source[i] === "[") inClass = true;
			else if (source[i] === "]") inClass = false;
			else if (source[i] === "/" && !inClass) {
				i += 1;
				while (i < n && /[A-Za-z]/.test(source[i])) i += 1;
				return i;
			}
			i += 1;
		}
		return n;
	};

	let i = 0;
	while (i < n) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			let j = i;
			while (j < n && source[j] !== "\n") j += 1;
			blank(i, j);
			i = j;
		} else if (ch === "/" && next === "*") {
			let j = i + 2;
			while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j += 1;
			j = Math.min(n, j + 2);
			blank(i, j);
			i = j;
		} else if (ch === "'" || ch === '"') {
			i = skipString(i, ch);
		} else if (ch === "`") {
			i = skipTemplate(i);
		} else if (ch === "/" && isRegexStart(i)) {
			const end = skipRegex(i);
			blank(i, end);
			i = end;
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

	it("lexer survives regex literals containing comment sequences", () => {
		// a regex containing `//` and `/*` must not start a comment scan
		const sample = blankOutComments(
			[
				"const re = /scripts\\/lib\\/\\/\\/deep\\.js/; // real comment",
				"const a = require('real-mod');",
			].join("\n"),
		);
		const specifiers = extractModuleSpecifiers(sample).map((s) => s.specifier);
		assert.deepEqual(specifiers, ["real-mod"]);
	});

	it("lexer survives template literals with quoted interpolation", () => {
		// quotes inside ${...} and comments inside the template must not escape
		const sample = blankOutComments(
			[
				"const p = `path/${'deep'}/` + require('real-mod');",
				"const t = `a ${x ? 'y' : 'z'} /* not a comment */ b`;",
			].join("\n"),
		);
		const specifiers = extractModuleSpecifiers(sample).map((s) => s.specifier);
		assert.deepEqual(specifiers, ["real-mod"]);
	});

	it("lexer treats a regex after a closing paren as code (known heuristic limit)", () => {
		// a regex right after `)` (e.g. after an if condition) is read as a
		// division by the heuristic, so a `//` inside such a regex can start a
		// comment scan. The guard still must not invent specifiers from the
		// surrounding code — lock the actual behavior here.
		const sample = blankOutComments(
			[
				"if (flag) /a\\/\\/b/.test(p) && require('real-mod');",
				"const a = require('real-mod');",
			].join("\n"),
		);
		const specifiers = extractModuleSpecifiers(sample).map((s) => s.specifier);
		assert.deepEqual(specifiers, ["real-mod", "real-mod"]);
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
