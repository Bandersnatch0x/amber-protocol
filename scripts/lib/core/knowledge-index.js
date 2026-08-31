"use strict";

// 0009 (#0009): the read-time document index — `amber knowledge search`.
//
// An index-priority access layer over the full search surface, the cure for
// the recall experiment's two structural blind spots (0008 §6.3):
//   - file-name-invisibility (R07/R08): a content substring search cannot
//     reach a file whose body never mentions its own name — 76.8% of files
//     do not (0008 §6.2 / 0009-D4). The path plane makes every file path and
//     file name a first-class key.
//   - cross-language zero-recall (S01-S14): a Chinese phrasing of an English
//     concept misses a corpus that is mostly English. The lexicon plane
//     mechanically derives CONTEXT.md terms (canonical name + the backtick
//     anchors in its definition + its `_Avoid_` lines) so a query for a term
//     name reaches the SSOT entry. Cross-language one-hop stays at query
//     time (an honest bound: the index builds deterministic English literals
//     only, 0009 Dissent).
//
// Three planes, one read-time pass:
//   content  — substring over the full search surface (docs + scripts +
//              schemas + tests + templates + routes + skills + standards +
//              registry + profiles + issues + .github + apps/web/src) and
//              root-level documents; binary files are skipped by NUL-byte
//              detection (grep -I parity, 0009 self-decision list #5).
//   path     — every walked file path and file name is a key; a name query
//              matches any path whose basename or full path contains it.
//   lexicon  — CONTEXT.md terms, mechanically derived (format unchanged):
//                * the canonical name (`**Term**:` heading);
//                * backtick anchors in the definition body (code/path refs);
//                * the `_Avoid_:` line tokens (R11: avoid tokens are
//                  findable — a banned-word query points back to the SSOT
//                  term — but never a term-suggestion output; a banned word
//                  cannot propagate as a recommended surface).
//
// Determinism (0008 §4 hard rule): results sort by byte order
// (path → plane → position), no locale, no timestamps, no randomness.
// Recompute over an unchanged tree is byte-identical (the graph contract's
// twin). No weights, no model confidence, no thresholds: matching is boolean
// hit + deterministic order (0009 second-stage hard constraint). Read-time
// compute: nothing persisted, nothing cached (0009-D1 → O3, and the index
// must not fail closed when the parallel projection gate fails — no coupling
// to the corpus manifest).
//
// Read-only: no target writes of any kind. Fail-closed on an absent or
// unreadable target and on an invalid query, with the typed local error
// vocabulary below (readFailure parity, knowledge-commands.js:36).

const fs = require("node:fs");
const path = require("node:path");

const { typedError } = require("./error-catalog");
const {
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
} = require("../state-dir-resolver");

const ERROR_CODES = Object.freeze({
	source: "AMBER_E_KNOWLEDGE_INDEX_SOURCE",
	invalid: "AMBER_E_KNOWLEDGE_INDEX_INVALID",
});

// 0008 §6.2 search surface: the walk descends the whole tree minus build
// artifacts and the runtime/state roots. The web app source is included
// (apps/web/src) but its build output (apps/web/dist, node_modules under it)
// is not. The state dir (canonical .amber and legacy .harness) and .git are
// runtime/history, never the search surface — pulled from the state-dir
// resolver seam rather than a literal so the rename stays consistent.
const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
	"coverage",
	"test-results",
	"test-reports",
	"output",
	"assets",
	"dist",
	"build",
]);

// grep -I parity: a file whose first chunk contains a NUL byte is binary and
// is skipped by content search (it may still appear in the path plane — its
// path is a legitimate key, 0009 self-decision list #5).
const BINARY_PROBE_BYTES = 8192;

function toPosix(p) {
	return String(p).replace(/\\/g, "/");
}

function isBinary(absPath) {
	let fd;
	try {
		fd = fs.openSync(absPath, "r");
		const buf = Buffer.alloc(BINARY_PROBE_BYTES);
		const n = fs.readSync(fd, buf, 0, BINARY_PROBE_BYTES, 0);
		// ponytail: NUL-byte heuristic, the same signal `grep -I` uses. A real
		// text file may contain any byte except NUL; a binary almost always has
		// one in its first chunk. Ceiling: pathological binaries with no NUL in
		// the first 8 KB pass as text — grep -I has the identical blind spot.
		return buf.slice(0, n).includes(0);
	} catch (err) {
		if (err.code === "ENOENT") return true; // vanished between walk and read
		throw typedError(ERROR_CODES.source, `could not probe ${absPath}: ${err.message}`);
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				/* ponytail: close failure is not a search concern */
			}
		}
	}
}

// Sorted, symlink-free walk. POSIX-relative file paths only. Symlinks are
// skipped (no follow) so an escaping link can never widen the surface.
function walkSurface(targetRoot) {
	const files = [];
	const walk = (absDir, relDir) => {
		let entries;
		try {
			entries = fs.readdirSync(absDir, { withFileTypes: true });
		} catch (err) {
			if (err.code === "ENOENT") return;
			throw typedError(
				ERROR_CODES.source,
				`could not read directory ${relDir || "."}: ${err.message}`,
			);
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of entries) {
			if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
				// hidden files/dirs (.github is a search-surface directory per 0008
				// §6.2, but it does not start with a dot-prefixed hidden marker in
				// a way that matters — .github is handled by the explicit name
				// check below; other dotfiles like .gitignore are not surface).
				if (entry.name === ".github") {
					// fall through to directory handling
				} else {
					continue;
				}
			}
			if (entry.isSymbolicLink()) continue;
			const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
			if (entry.isDirectory()) {
				if (EXCLUDED_DIRS.has(entry.name)) continue;
				walk(path.join(absDir, entry.name), rel);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push(rel);
		}
	};
	const root = path.resolve(targetRoot);
	// A missing target is not an empty index (0009 fail-closed contract).
	try {
		fs.accessSync(root, fs.constants.R_OK);
	} catch (err) {
		throw typedError(
			ERROR_CODES.source,
			`target is not a readable directory: ${root} (${err.message})`,
		);
	}
	walk(root, "");
	files.sort();
	return files;
}

// ── lexicon plane: CONTEXT.md mechanical derivation ────────────────────
//
// CONTEXT.md is the sole expansion word source (0009-D3 → O1). Its format is
// untouched; this parser only reads. A term is a `**Name**:` heading followed
// by a definition paragraph and an optional `_Avoid_:` line. We derive:
//   - the canonical term name (the `**...**` text);
//   - backtick anchors in the definition body (code/path references);
//   - `_Avoid_:` tokens (comma/slash separated).
// `_Avoid_` discipline (R11, derived, no threshold): an avoid token is
// findable (a banned-word query hits the term that bans it) but is never
// returned as a term-suggestion output (matchKind "avoid-evidence", not
// "term-suggestion"). A banned word cannot propagate as a recommended
// surface.
const CONTEXT_PATH = "CONTEXT.md";

function parseContextLexicon(targetRoot) {
	const abs = path.join(targetRoot, CONTEXT_PATH);
	let raw;
	try {
		raw = fs.readFileSync(abs, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return []; // no CONTEXT.md = empty lexicon
		throw typedError(ERROR_CODES.source, `could not read ${CONTEXT_PATH}: ${err.message}`);
	}
	const normalized = raw.replace(/\r\n/g, "\n");
	const terms = [];
	// A term heading: a line starting with `**Name**:` (possibly with a
	// parenthetical, e.g. `**Session transition (edge graph)**:`).
	const termRe = /^\*\*(.+?)\*\*\s*:/;
	const avoidRe = /^_Avoid_\s*:\s*(.+)$/;
	const lines = normalized.split("\n");
	let current = null;
	const finish = () => {
		if (current) {
			current.anchors.sort();
			current.avoid.sort();
			terms.push(current);
		}
	};
	for (const line of lines) {
		const tm = termRe.exec(line);
		if (tm) {
			finish();
			current = {
				name: tm[1].trim(),
				path: CONTEXT_PATH,
				anchors: [],
				avoid: [],
			};
			continue;
		}
		if (!current) continue;
		const am = avoidRe.exec(line);
		if (am) {
			// `_Avoid_` tokens are comma-separated per CONTEXT.md convention.
			for (const tok of am[1].split(",")) {
				const t = tok.trim();
				if (t) current.avoid.push(t);
			}
			continue;
		}
		// Backtick anchors in the definition body: `code/path` references.
		// ponytail: a single regex pass, no AST. Ceiling: backticks spanning
		// lines or nested code fences are not parsed as inline anchors — the
		// CONTEXT.md term definitions never use them (verified 2026-08-31).
		const anchorRe = /`([^`]+)`/g;
		let am2;
		while ((am2 = anchorRe.exec(line)) !== null) {
			const anchor = am2[1].trim();
			if (anchor) current.anchors.push(anchor);
		}
	}
	finish();
	// Stable order: by term name (byte order, no locale).
	terms.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return terms;
}

// ── the index ──────────────────────────────────────────────────────────

/**
 * Build the read-time document index of a target repository. Pure function of
 * the committed tree; nothing is persisted.
 * @param {string} target - Target repository root.
 * @returns {object} The index (an opaque structure consumed by searchKnowledge).
 */
function buildKnowledgeIndex(target) {
	const targetRoot = path.resolve(target || process.cwd());
	const files = walkSurface(targetRoot);
	const lexicon = parseContextLexicon(targetRoot);
	// Content is read lazily at search time (not all files are probed for
	// NUL up front — only the files a query's substring could live in). The
	// index records the walked file set and the lexicon; search reads bytes
	// on demand. This keeps a no-query run cheap and the build byte-stable.
	return {
		schemaVersion: 1,
		targetRoot,
		files,
		lexicon,
	};
}

// ── search ─────────────────────────────────────────────────────────────

const PLANE_ORDER = Object.freeze({
	content: 0,
	path: 1,
	lexicon: 2,
});

/**
 * Search the index for a query string. Boolean-hit matching + deterministic
 * byte order; no weights, no model confidence, no thresholds.
 *
 * Result shape (stable across recompute over an unchanged tree):
 *   { path, plane, position, matchKind, term?, snippet? }
 * sorted by (path, plane, position) in byte order.
 *
 * @param {object} index - The index from buildKnowledgeIndex.
 * @param {string} query - Non-empty query string.
 * @param {{limit?: number}} [opts]
 * @returns {Array<object>} Ordered hits (bounded by opts.limit).
 */
function searchKnowledge(index, query, opts = {}) {
	if (typeof query !== "string" || query.length === 0) {
		throw typedError(ERROR_CODES.invalid, "search query is empty or not a string");
	}
	const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : Infinity;
	const needle = query;
	const lowerNeedle = needle.toLowerCase();

	const hits = [];

	// ── path plane ──
	// Every file path is a key. A path match: the full POSIX path or its
	// basename contains the query (case-insensitive, grep -i parity). This is
	// the R07/R08 cure: a file whose body never mentions its name is still
	// reachable by its name.
	for (const rel of index.files) {
		const posix = rel; // already POSIX from walkSurface
		if (posix.toLowerCase().includes(lowerNeedle)) {
			const base = posix.slice(posix.lastIndexOf("/") + 1);
			hits.push({
				path: posix,
				plane: "path",
				position: 0,
				matchKind: base.toLowerCase().includes(lowerNeedle) ? "basename" : "path",
			});
		}
	}

	// ── content plane ──
	// Substring over the full surface, binary files skipped by NUL detection.
	for (const rel of index.files) {
		const abs = path.join(index.targetRoot, rel);
		if (isBinary(abs)) continue;
		let content;
		try {
			content = fs.readFileSync(abs, "utf8");
		} catch (err) {
			if (err.code === "ENOENT") continue; // removed between walk and read
			throw typedError(ERROR_CODES.source, `could not read ${rel}: ${err.message}`);
		}
		const normalized = content.replace(/\r\n/g, "\n");
		const lower = normalized.toLowerCase();
		let from = 0;
		let at;
		// ponytail: linear indexOf scan. Ceiling: O(n × m) per file worst case
		// for pathological repeated near-misses; the whole-surface rebuild is
		// ~1.5 s over 1,265 files (0009-D1), so this is not a throughput concern.
		// Upgrade to a per-file precomputed suffix array only if a measured
		// hot path shows it — YAGNI until then.
		while ((at = lower.indexOf(lowerNeedle, from)) !== -1) {
			hits.push({
				path: rel,
				plane: "content",
				position: at,
				matchKind: "substring",
			});
			from = at + 1;
		}
	}

	// ── lexicon plane ──
	// CONTEXT.md terms. The canonical name is a key (term-suggestion output).
	// Backtick anchors and `_Avoid_` tokens are findable evidence attached to
	// the term, but avoid tokens are never term-suggestion outputs (R11).
	for (const term of index.lexicon) {
		const nameLower = term.name.toLowerCase();
		if (nameLower.includes(lowerNeedle)) {
			hits.push({
				path: term.path,
				plane: "lexicon",
				position: 0,
				matchKind: "term-suggestion",
				term: term.name,
			});
		}
		// Anchors: findable evidence, not a term suggestion.
		for (const anchor of term.anchors) {
			if (anchor.toLowerCase().includes(lowerNeedle)) {
				hits.push({
					path: term.path,
					plane: "lexicon",
					position: 0,
					matchKind: "anchor-evidence",
					term: term.name,
				});
			}
		}
		// Avoid tokens: findable (R11 rescue) but never a term suggestion.
		for (const avoid of term.avoid) {
			if (avoid.toLowerCase().includes(lowerNeedle)) {
				hits.push({
					path: term.path,
					plane: "lexicon",
					position: 0,
					matchKind: "avoid-evidence",
					term: term.name,
				});
			}
		}
	}

	// Deterministic byte order: path, then plane (content < path < lexicon),
	// then position. No locale. (Parity with knowledge-graph.js:480-485.)
	hits.sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		const pa = PLANE_ORDER[a.plane];
		const pb = PLANE_ORDER[b.plane];
		if (pa !== pb) return pa - pb;
		return (a.position ?? 0) - (b.position ?? 0);
	});

	return hits.slice(0, limit === Infinity ? hits.length : limit);
}

module.exports = {
	ERROR_CODES,
	buildKnowledgeIndex,
	searchKnowledge,
};
