"use strict";

// F061 (#0009): deterministic document index — `amber knowledge search`.
//
// The index is a pure function of the committed tree, three planes:
//   content  — substring over the full search surface (docs + scripts +
//              schemas + tests + templates + routes + ... + root docs),
//              binary files skipped by NUL-byte detection (grep -I parity);
//   path     — every file path / file name is a first-class key (the
//              file-name-invisible finding R07/R08: 76.8% of files do not
//              mention their own name stem in their body);
//   lexicon  — CONTEXT.md is the sole expansion word source; terms are
//              mechanically derived (canonical name + backtick anchors in the
//              definition + `_Avoid_` lines). `_Avoid_` discipline: an avoid
//              token is findable but never an expansion/suggestion output.
//
// Determinism: results sort by byte order (path, then plane, then position),
// no locale, no timestamps, no randomness — recompute over an unchanged tree
// is byte-identical. No weights, no model confidence, no thresholds: matching
// is boolean hit + deterministic order (0008 §4 hard rule). Read-time compute;
// nothing persisted, nothing cached.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	buildKnowledgeIndex,
	searchKnowledge,
	ERROR_CODES,
} = require("../../scripts/lib/core/knowledge-index");
const { knowledgeDispatch } = require("../../scripts/lib/knowledge-commands");

const REPO_ROOT = path.join(__dirname, "..", "..");

// ── byte-stability (the graph contract's twin; 0008 §3.1 / 0009 D1) ─────

test("recompute over an unchanged tree is byte-identical", () => {
	const first = JSON.stringify(buildKnowledgeIndex(REPO_ROOT));
	const second = JSON.stringify(buildKnowledgeIndex(REPO_ROOT));
	assert.equal(first, second);
});

// ── three planes ───────────────────────────────────────────────────────

test("content plane: substring hit in a file body returns that file", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	const results = searchKnowledge(index, "supersedes");
	// ADR-#### supersedes headers are a real corpus pattern; at least one
	// docs/adr file mentions "Supersedes".
	const paths = results.map((r) => r.path);
	assert.ok(
		paths.some((p) => p.startsWith("docs/adr/")),
		"content plane reaches ADR bodies",
	);
});

test("path plane: a file whose body never mentions its own name is still reachable by name (R07 parity)", () => {
	// R07 target: scripts/lib/command-registry.js — its body does not contain
	// the substring "command-registry" (0008 §6.3). The path plane must still
	// return it for a name query so the file-name-invisible finding is cured.
	const index = buildKnowledgeIndex(REPO_ROOT);
	const results = searchKnowledge(index, "command-registry");
	const paths = results.map((r) => r.path);
	assert.ok(
		paths.includes("scripts/lib/command-registry.js"),
		"path plane reaches a file-name-invisible file",
	);
});

test("lexicon plane: CONTEXT.md term name is a searchable key", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	// "Route" is a CONTEXT.md canonical term; its name is in the lexicon.
	const results = searchKnowledge(index, "Route");
	// The lexicon plane returns the CONTEXT.md term entry, not a file.
	const lex = results.filter((r) => r.plane === "lexicon");
	assert.ok(lex.length > 0, "lexicon plane returns CONTEXT.md term hits");
	assert.ok(lex.some((r) => r.term && r.term.toLowerCase().includes("route")));
});

test("lexicon plane: _Avoid_ token is findable but never an expansion output", () => {
	// R11: the banned token ALLOWED_TRANSITIONS lives in a `_Avoid_` line of
	// the Session transition term (CONTEXT.md). It must be findable (so a
	// banned-word query points back to the SSOT term), but it must never be
	// returned as a *term suggestion* (a banned word cannot propagate as a
	// recommended lexicon surface).
	const index = buildKnowledgeIndex(REPO_ROOT);
	const results = searchKnowledge(index, "ALLOWED_TRANSITIONS");
	// Findable as evidence attached to the term that bans it...
	const hits = results.filter((r) => r.plane === "lexicon");
	assert.ok(hits.length > 0, "avoid token is findable (R11 rescue: query points back to SSOT)");
	// ...but the returned terms are never the avoid token itself as a term name.
	for (const r of hits) {
		assert.notEqual(r.matchKind, "term-suggestion", "avoid token never suggested as a term");
	}
});

// ── determinism / order ───────────────────────────────────────────────

test("results are in deterministic order: plane rank, then path, then position", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	const results = searchKnowledge(index, "knowledge");
	// The key mirrors the implementation's declared order (plane rank, path,
	// position) with the position zero-padded, so the string sort is exactly
	// the order the index produces (no locale, no model). Plane rank is by
	// scarcity: lexicon < path < content.
	const PLANE_RANK = { lexicon: 0, path: 1, content: 2 };
	const key = (r) => `${PLANE_RANK[r.plane]} ${r.path} ${String(r.position ?? 0).padStart(8, "0")}`;
	const keys = results.map(key);
	const sorted = [...keys].sort();
	assert.deepEqual(keys, sorted, "byte-stable order, no locale");
});

// ── fail-closed (0009 D2: typed error code, readFailure parity) ────────

test("a missing target fails closed with a typed error code", () => {
	const missing = path.join(os.tmpdir(), "amber-index-missing-" + process.pid);
	fs.rmSync(missing, { recursive: true, force: true });
	assert.throws(
		() => buildKnowledgeIndex(missing),
		(err) => err.amberCode === ERROR_CODES.source,
		"missing target is a typed source error, not a silent empty index",
	);
});

test("an empty query is rejected, not a silent match-all", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	assert.throws(
		() => searchKnowledge(index, ""),
		(err) => err.amberCode === ERROR_CODES.invalid,
		"empty query is a typed invalid error, never match-all",
	);
});

// ── zero weights / zero model (0009 hard constraint) ───────────────────

test("no result carries a score, weight, or confidence field", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	const results = searchKnowledge(index, "schema");
	for (const r of results) {
		assert.equal(r.score, undefined, "no score field");
		assert.equal(r.weight, undefined, "no weight field");
		assert.equal(r.confidence, undefined, "no confidence field");
	}
});

test("--limit bounds the result set deterministically (top-N of the byte order)", () => {
	const index = buildKnowledgeIndex(REPO_ROOT);
	const full = searchKnowledge(index, "test");
	const limited = searchKnowledge(index, "test", { limit: 5 });
	assert.ok(limited.length <= 5, "limit is respected");
	assert.equal(limited.length, Math.min(full.length, 5), "limit takes the ordered prefix");
});

test("a small --limit surfaces the scarce planes, not just content", () => {
	// The plane rank exists so the two planes this surface was built for stay
	// visible under a small limit. "command-registry" is the R07 probe: the
	// path plane is the only plane that can reach the file whose body never
	// names itself, and content hits for the same query run into the dozens.
	// Ordering content first would push the one hit that matters past any
	// small --limit — that is the regression this pins.
	const index = buildKnowledgeIndex(REPO_ROOT);
	const limited = searchKnowledge(index, "command-registry", { limit: 3 });
	assert.ok(
		limited.some((r) => r.plane === "path"),
		"the path plane is reachable within the first 3 results",
	);
	assert.ok(
		limited.every((r) => r.plane !== "content") ||
			limited.findIndex((r) => r.plane === "content") >
				limited.findIndex((r) => r.plane === "path"),
		"no content hit outranks a path hit",
	);
});

// ── CLI seam (knowledge-commands.js search action) ────────────────────

test("CLI: amber knowledge search --query <text> --json returns ordered hits", () => {
	const { result, exitCode } = knowledgeDispatch({
		_: ["search"],
		target: REPO_ROOT,
		query: "schema-validation",
		json: true,
	});
	assert.equal(exitCode, 0);
	const payload = JSON.parse(result.text || "{}");
	assert.ok(Array.isArray(payload.results));
	assert.ok(payload.results.length > 0, "CLI search returns hits");
});

test("CLI: missing --query fails closed (exit 1, typed code)", () => {
	const { result, exitCode } = knowledgeDispatch({
		_: ["search"],
		target: REPO_ROOT,
		json: true,
	});
	assert.equal(exitCode, 1);
	assert.equal(result.code, "AMBER_E_KNOWLEDGE_INDEX_INVALID", "typed error code on missing query");
	assert.ok(result.errors.length > 0, "non-empty diagnostics, never a silent success");
});
