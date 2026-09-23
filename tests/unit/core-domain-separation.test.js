"use strict";

// Trusted-control governance contract — Slice G-1 (spec §5.5/§5.6): the
// Core/Adapter dependency guards. Core-marked files under `scripts/lib/core/`
// must not require the git-semantics modules (git-exec / git-state /
// git-workflow-detector) or the worktree-manager; the Coding Adapter files
// themselves sit outside the guard (Guard 3). The not-yet-split files carry a
// recorded known-deviation allowlist (§5.5's disposition rows 4-11); the guard
// tightens monotonically as the G-9 splits land — a new violation fails, an
// allowlisted one does not. Mechanics: AST require-path scan through
// code-graph.js's TypeScript parser (no runtime execution), per spec §5.6.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { extractCodeCorpus } = require("../../scripts/lib/core/code-graph");

const LIB_ROOT = path.join(__dirname, "..", "..", "scripts", "lib");
const CORE_ROOT = path.join(LIB_ROOT, "core");

// Guard 3 whitelist: these are themselves Coding Adapter implementations
// (spec §5.5 rows 1-3 + worktree-manager at lib level) and are outside
// Guard 1's Core set.
const CODING_ADAPTER_FILES = new Set([
	"git-exec.js",
	"git-state.js",
	"git-workflow-detector.js",
	// §5.3: the ExecutionDomainAdapter seam is an Adapter implementation (it
	// injects the domain semantics Core may not import); never a Core file.
	"execution-domain-adapter.js",
]);

// The forbidden git-semantics modules (Core purity, Guard 1).
const FORBIDDEN_CORE_TARGETS = new Set([
	"git-exec.js",
	"git-state.js",
	"git-workflow-detector.js",
	"worktree-manager.js",
]);

// F071 H3b note: core/context-loadout requires harness/context-core (the ONE
// firewall verdict, composed verbatim — never re-implemented). This is a
// deliberate core→harness edge with no module cycle (context-core requires
// only schema/ledger/state/event cores, nothing from core/context-loadout).
// The guard does not forbid it; a FUTURE harness require of context-loadout
// would close a real cycle and must be flagged deliberately.

// Known-deviation allowlist (spec §5.5 disposition rows 4-11): the Core-marked
// files that still contain adapter-module requires today. The guard is red
// only on NEW violations — this list shrinks monotonically and each entry
// names its state.
//
// G-9 progress: ALL rows landed the injected-adapter split (rows 4-10 lazy
// git-semantics injection; row 11 governed-runner delegating worktree/spawn
// through the execution-domain-adapter seam). Their remaining requires sit
// INSIDE the lazy adapter-injection function (Adapter-to-Adapter composition
// at first use, never at module load). The AST scan is scope-blind, so the
// split files stay listed with the split state recorded; a scope-aware scan
// tightens them out.
const KNOWN_DEVIATIONS = new Set([
	"artifact-drift.js", // §5.5 row 4 — split landed; lazy injection residual
	"identity.js", // §5.5 row 5 — split landed; lazy injection residual
	"ledger-seal.js", // §5.5 row 6 — split landed; lazy injection residual
	"scaffold.js", // §5.5 row 7 — split landed; lazy injection residual
	"sync-session.js", // §5.5 row 8 — split landed; lazy injection residual
	"sync-transport.js", // §5.5 row 9 — split landed; lazy injection residual
	"team-governance-advisor.js", // §5.5 row 10 — split landed; lazy injection residual
	"governed-runner.js", // §5.5 row 11 — split landed; lazy adapter-injection residual
]);

// Guard 2 (Adapter isolation): a Coding Adapter implementation must not be
// required by a Core-marked file except through the recorded deviations —
// injection through the Adapter interface only.
const ADAPTER_FILES = new Set([...CODING_ADAPTER_FILES, "worktree-manager.js"]);

function scan() {
	return extractCodeCorpus(CORE_ROOT);
}

function coreViolations(corpus) {
	const violations = [];
	for (const edge of corpus.imports.values()) {
		if (!edge.src || !edge.dst) continue;
		if (CODING_ADAPTER_FILES.has(edge.src)) continue; // Guard 3
		if (!FORBIDDEN_CORE_TARGETS.has(edge.dst) && edge.dst !== "worktree-manager.js") continue;
		if (KNOWN_DEVIATIONS.has(edge.src)) continue; // recorded pending split
		violations.push(`${edge.src} -> ${edge.dst} (line ${edge.evidence?.[0]?.line ?? "?"})`);
	}
	return violations;
}

function adapterIsolationViolations(libCorpus) {
	const violations = [];
	for (const edge of libCorpus.imports.values()) {
		if (!edge.src || !edge.dst) continue;
		if (!ADAPTER_FILES.has(edge.dst)) continue;
		const srcFile = edge.src.replace(/^core\//, "");
		// The ExecutionDomainAdapter seam is itself an Adapter implementation:
		// its delegating requires (worktree-manager, git-state) are
		// Adapter-to-Adapter composition, never a Core import (§5.3).
		if (CODING_ADAPTER_FILES.has(srcFile)) continue;
		// A Core-marked file requiring a Coding Adapter module is only legal
		// when it is itself in the known-deviation list (the G-9 split target).
		if (edge.src.startsWith("core/") && KNOWN_DEVIATIONS.has(srcFile)) {
			continue;
		}
		if (edge.src.startsWith("core/")) {
			violations.push(`${edge.src} -> ${edge.dst} (line ${edge.evidence?.[0]?.line ?? "?"})`);
		}
	}
	return violations;
}

describe("core/adapter dependency guards (governance contract §5.6)", () => {
	test("Guard 1: Core purity — no NEW git-semantics requires beyond the recorded allowlist", () => {
		const corpus = scan();
		const violations = coreViolations(corpus);
		assert.deepEqual(
			violations,
			[],
			`new git-semantics requires in Core (tighten nothing; shrink the allowlist instead):\n${violations.join("\n")}`,
		);
	});

	test("Guard 2: Adapter isolation — a non-deviation Core file never requires a Coding Adapter module", () => {
		const libCorpus = extractCodeCorpus(LIB_ROOT);
		const violations = adapterIsolationViolations(libCorpus);
		assert.deepEqual(
			violations,
			[],
			`Core files directly requiring Coding Adapter modules:\n${violations.join("\n")}`,
		);
	});

	test("Guard 3: the git-semantics modules are themselves outside the Core set", () => {
		for (const file of CODING_ADAPTER_FILES) {
			assert.ok(
				!KNOWN_DEVIATIONS.has(file),
				`${file} is a Coding Adapter implementation, not a Core deviation`,
			);
		}
	});

	test("the allowlist is monotone: every entry still requires an adapter module at HEAD", () => {
		// A stale allowlist entry (the split landed and no adapter require
		// remains) hides nothing but lies about the tree — the G-9 acceptance
		// requires the allowlist to shrink. Fail on any entry that no longer
		// requires SOME adapter module (git-semantics family or the
		// ExecutionBoundary seam). The probe covers BOTH corpora:
		// `governed-runner.js` requires `../worktree-manager`/the seam (a
		// lib-level sibling or core sibling), which the core-only corpus does
		// not resolve.
		const corpus = scan();
		const libCorpus = extractCodeCorpus(LIB_ROOT);
		const requiresAdapter = new Map();
		const consider = (edge) => {
			if (!edge.src || !edge.dst) return;
			const src = edge.src.replace(/^core\//, "");
			if (ADAPTER_FILES.has(edge.dst)) {
				requiresAdapter.set(src, edge.dst);
			}
		};
		for (const edge of corpus.imports.values()) consider(edge);
		for (const edge of libCorpus.imports.values()) {
			if (edge.src && edge.src.startsWith("core/")) consider(edge);
		}
		const stale = [...KNOWN_DEVIATIONS].filter((entry) => !requiresAdapter.has(entry));
		assert.deepEqual(
			stale,
			[],
			`stale allowlist entries (the split landed and no adapter require remains; remove them so the list keeps shrinking):\n${stale.join("\n")}`,
		);
	});

	test("a deliberately injected forbidden require turns the guard red (fixture)", () => {
		// The AST scan runs over a synthetic corpus shape rather than writing a
		// temp file into scripts/lib/core: the guard's mechanics are the same
		// map folds; this proves a new violation is not swallowed.
		const synthetic = {
			imports: new Map([
				[
					0,
					{
						src: "hypothetical-new-core-file.js",
						dst: "git-exec.js",
						evidence: [{ path: "hypothetical-new-core-file.js", line: 3 }],
					},
				],
			]),
		};
		const violations = [];
		for (const edge of synthetic.imports.values()) {
			if (CODING_ADAPTER_FILES.has(edge.src)) continue;
			if (KNOWN_DEVIATIONS.has(edge.src)) continue;
			if (FORBIDDEN_CORE_TARGETS.has(edge.dst) || edge.dst === "worktree-manager.js") {
				violations.push(`${edge.src} -> ${edge.dst}`);
			}
		}
		assert.deepEqual(violations, ["hypothetical-new-core-file.js -> git-exec.js"]);
	});
});
