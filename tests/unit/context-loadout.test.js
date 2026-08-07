"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildLoadout, verifyLoadoutFile, loadoutsDir } = require("../../scripts/lib/core/context-loadout");
const { writePage, regenerateIndex, pagesDir, eventsPath } = require("../../scripts/lib/core/context-store");
const { sha256 } = require("../../scripts/lib/core/context-hash");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-loadout-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
	seedRoutes(root, ["bugfix-quick", "feature-standard"]);
	seedRequiredArtifacts(root);
	return root;
}

function seedRequiredArtifacts(root) {
	const agentDir = path.join(root, "docs", "wiki", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(path.join(agentDir, "amber.md"), "# Amber Operating Manual\n\nStay governed.\n", "utf8");
	fs.writeFileSync(
		path.join(agentDir, "context-loadout.md"),
		"# Context Loadout Definition\n\nLoad required artifacts first.\n",
		"utf8",
	);
}

// The allocator validates --route against routes/*.route.json (D1), so the
// fixture must seed the routes the tests reference.
function seedRoutes(root, routeIds) {
	const dir = path.join(root, "routes");
	fs.mkdirSync(dir, { recursive: true });
	for (const routeId of routeIds) {
		fs.writeFileSync(
			path.join(dir, `${routeId}.route.json`),
			JSON.stringify({ routeId, schemaVersion: "1.0.0", stages: [] }, null, 2),
			"utf8",
		);
	}
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

// Page fixture with a mutable code source. `hashes` may be pre-computed by the
// caller via `hashFile` so the page starts "ok"; leaving the dummy hashes
// yields a "stale" page (normHash mismatch), which is useful for stale tests.
function pageFixture({ pageId, title, ref, mutable = true, rawHash, normHash, scope, blocks }) {
	const sources = {
		s1: {
			kind: "code",
			ref,
			rawHash: rawHash || `sha256:${"a".repeat(64)}`,
			normHash: normHash || `sha256:${"b".repeat(64)}`,
			mutable,
		},
	};
	return {
		schemaVersion: "1.0.0",
		pageId,
		title: title || pageId,
		sources,
		blocks: blocks || [{ type: "prose", sources: ["s1"], text: `${title || pageId} body.` }],
		...(scope ? { scope } : {}),
	};
}

function writeMutable(root, ref, content) {
	const full = path.join(root, ref);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, "utf8");
}

// Write events.jsonl directly with explicit `at` fields to control recency
// (appendEvent stamps its own `at`, which we cannot override).
function writeEvents(root, events) {
	const file = eventsPath(root);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
	fs.writeFileSync(file, lines, "utf8");
}

// Fix the page's source hashes to match disk so verify reports "ok".
function freshPage(root, opts) {
	const { hashFile } = require("../../scripts/lib/core/context-hash");
	writeMutable(root, opts.ref, opts.content || "const x = 1;\n");
	const h = hashFile(path.join(root, opts.ref));
	return pageFixture({
		pageId: opts.pageId,
		title: opts.title,
		ref: opts.ref,
		rawHash: h.rawHash,
		normHash: h.normHash,
		scope: opts.scope,
		blocks: opts.blocks,
	});
}

describe("buildLoadout — input validation", () => {
	it("errors when route is missing", () => {
		const root = makeTarget();
		try {
			const result = buildLoadout(root, { route: undefined });
			assert.ok(result.errors.length >= 1);
			assert.equal(result.loadout, null);
			assert.equal(result.loadoutPath, null);
			assert.match(result.errors[0].code, /AMBER_E_CONTEXT_LOADOUT_ROUTE/);
		} finally {
			cleanup(root);
		}
	});

	it("errors when route is not kebab-case", () => {
		const root = makeTarget();
		try {
			const result = buildLoadout(root, { route: "Not_Kabob" });
			assert.ok(result.errors.length >= 1);
			assert.equal(result.loadout, null);
		} finally {
			cleanup(root);
		}
	});

	it("accepts a kebab-case route with digits", () => {
		const root = makeTarget();
		try {
			seedRoutes(root, ["bugfix-quick-2"]);
			const result = buildLoadout(root, { route: "bugfix-quick-2" });
			assert.equal(result.errors.length, 0);
			assert.ok(result.loadoutPath);
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — determinism (D3)", () => {
	it("builds byte-identical loadouts for the same signal + same disk state", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5;\n");
			const p1 = freshPage(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				ref: "scripts/lib/core/governed-runner.js",
			});
			writePage(root, p1);
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "governed-execution", at: "2026-08-01T10:00:00.000Z" },
			]);

			const first = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(first.errors.length, 0, JSON.stringify(first.errors));
			const fileA = fs.readFileSync(first.loadoutPath, "utf8");

			// Second build — events now includes a `loadout-written` line from
			// the first build, but `generatedAt` filters those out, so the
			// loadout file bytes must be identical.
			const second = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(second.errors.length, 0);
			const fileB = fs.readFileSync(second.loadoutPath, "utf8");

			assert.equal(fileA, fileB, "loadout file is not byte-identical across rebuilds");
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — tier ordering (D3)", () => {
	it("orders priority by recency desc, then pageId asc", () => {
		const root = makeTarget();
		try {
			// Three fresh pages, no scope -> all priority candidates.
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writeMutable(root, "scripts/lib/core/c.js", "const c = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			writePage(root, freshPage(root, { pageId: "page-b", title: "B", ref: "scripts/lib/core/b.js" }));
			writePage(root, freshPage(root, { pageId: "page-c", title: "C", ref: "scripts/lib/core/c.js" }));
			regenerateIndex(root);
			// page-b most recent, then page-a, then page-c (older).
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-c", at: "2026-08-01T08:00:00.000Z" },
				{ kind: "page-written", pageId: "page-a", at: "2026-08-03T10:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority, ["page-b", "page-a", "page-c"]);
		} finally {
			cleanup(root);
		}
	});

	it("tie-breaks equal recency by pageId asc", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/x.js", "const x = 1;\n");
			writeMutable(root, "scripts/lib/core/y.js", "const y = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-y", title: "Y", ref: "scripts/lib/core/x.js" }));
			writePage(root, freshPage(root, { pageId: "page-x", title: "X", ref: "scripts/lib/core/y.js" }));
			regenerateIndex(root);
			// Same `at` -> pageId asc tie-break: page-x before page-y.
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-x", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "page-y", at: "2026-08-05T12:00:00.000Z" },
			]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0);
			assert.deepEqual(result.loadout.tiers.priority, ["page-x", "page-y"]);
		} finally {
			cleanup(root);
		}
	});

	it("orders optional by pageId asc when not selected into priority", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/n1.js", "const n1 = 1;\n");
			writeMutable(root, "scripts/lib/core/n2.js", "const n2 = 1;\n");
			writePage(root, freshPage(root, { pageId: "zeta-page", title: "Zeta", ref: "scripts/lib/core/n1.js" }));
			writePage(root, freshPage(root, { pageId: "alpha-page", title: "Alpha", ref: "scripts/lib/core/n2.js" }));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "zeta-page", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "alpha-page", at: "2026-08-05T12:00:00.000Z" },
			]);

			// Both pages fresh + no scope -> both are priority candidates with
			// equal recency; tie-break by pageId asc -> alpha-page, zeta-page
			// both go to priority. Use scope to push one to optional.
			writePage(root, freshPage(root, { pageId: "zeta-page", title: "Zeta", ref: "scripts/lib/core/n1.js", scope: ["other-feature"] }));
			writePage(root, freshPage(root, { pageId: "alpha-page", title: "Alpha", ref: "scripts/lib/core/n2.js", scope: ["bugfix-quick"] }));
			regenerateIndex(root);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority, ["alpha-page"]);
			assert.deepEqual(result.loadout.tiers.optional, ["zeta-page"]);
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — budget exclusion with recorded reasons (D3)", () => {
	it("records over-budget pages with reason and detail", () => {
		const root = makeTarget();
		try {
			// Word estimate reads the page's distilled block text (what the
			// agent actually loads), so "big" pages carry big blocks.
			const smallText = "Small claim.";
			const bigText = "Big claim. " + "substantiation ".repeat(600);
			writeMutable(root, "scripts/lib/core/small.js", "const s = 1;\n");
			writeMutable(root, "scripts/lib/core/big.js", "const b = 1;\n");
			writePage(root, freshPage(root, {
				pageId: "small-page",
				title: "Small",
				ref: "scripts/lib/core/small.js",
				blocks: [{ type: "prose", sources: ["s1"], text: smallText }],
			}));
			writePage(root, freshPage(root, {
				pageId: "big-page",
				title: "Big",
				ref: "scripts/lib/core/big.js",
				blocks: [{ type: "prose", sources: ["s1"], text: bigText }],
			}));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "small-page", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "big-page", at: "2026-08-05T12:00:00.000Z" },
			]);

			// Tight budget after required artifacts: small fits; big overflows.
			const result = buildLoadout(root, { route: "bugfix-quick", budget: 50 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			const overBudget = result.loadout.excluded.filter((e) => e.reason === "over-budget");
			assert.ok(overBudget.length >= 1, "expected at least one over-budget exclusion");
			assert.ok(overBudget.some((e) => e.pageId === "big-page"));
			assert.ok(overBudget[0].detail, "exclusion detail must be non-empty");
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — required-tier overflow fail-fast (D3)", () => {
	it("errors and writes no file when required tier exceeds budget", () => {
		const root = makeTarget();
		try {
			const bigText = "Big claim. " + "substantiation ".repeat(600);
			writeMutable(root, "scripts/lib/core/big.js", "const b = 1;\n");
			writePage(root, freshPage(root, {
				pageId: "big-page",
				title: "Big",
				ref: "scripts/lib/core/big.js",
				blocks: [{ type: "prose", sources: ["s1"], text: bigText }],
			}));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "big-page", at: "2026-08-05T12:00:00.000Z" }]);

			const result = buildLoadout(root, {
				route: "bugfix-quick",
				budget: 10,
				required: ["big-page"],
			});
			assert.ok(result.errors.length >= 1, "expected required-overflow error");
			assert.match(result.errors[0].code, /AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW/);
			assert.equal(result.loadout, null);
			assert.equal(result.loadoutPath, null);
			// No file written.
			assert.ok(!fs.existsSync(loadoutsDir(root)) || fs.readdirSync(loadoutsDir(root)).length === 0);
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — freshness gate per tier (D4)", () => {
	it("excludes tampered pages at every tier (including required)", () => {
		const root = makeTarget();
		try {
			// Immutable ledger source — page starts "ok", then we tamper the live file.
			writeMutable(root, ".amber/sessions/s1/ledger.jsonl", '{"action":"original"}\n');
			const { sha256: sha } = require("../../scripts/lib/core/context-hash");
			const excerpt = '{"action":"original"}';
			const page = {
				schemaVersion: "1.0.0",
				pageId: "ledger-page",
				title: "Ledger",
				sources: {
					s1: {
						kind: "ledger",
						ref: ".amber/sessions/s1/ledger.jsonl#L1-L1",
						rawHash: `sha256:${"c".repeat(64)}`,
						mutable: false,
						excerpt,
						excerptHash: sha(excerpt),
					},
				},
				blocks: [{ type: "prose", sources: ["s1"], text: "Original action." }],
			};
			writePage(root, page);
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "ledger-page", at: "2026-08-05T12:00:00.000Z" }]);
			// Tamper the live ledger — excerptHash no longer matches live content.
			writeMutable(root, ".amber/sessions/s1/ledger.jsonl", '{"action":"tampered"}\n');

			const result = buildLoadout(root, {
				route: "bugfix-quick",
				required: ["ledger-page"],
				budget: 1000,
			});
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			// Tampered page is excluded from every tier — including required.
			assert.deepEqual(result.loadout.tiers.required, []);
			const tamperedExc = result.loadout.excluded.filter((e) => e.reason === "tampered");
			assert.ok(tamperedExc.some((e) => e.pageId === "ledger-page"));
		} finally {
			cleanup(root);
		}
	});

	it("excludes obsolete pages at every tier (including required)", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/gone.js", "const x = 1;\n");
			writePage(root, freshPage(root, { pageId: "gone-page", title: "Gone", ref: "scripts/lib/core/gone.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "gone-page", at: "2026-08-05T12:00:00.000Z" }]);
			// Delete the only mutable source — page becomes obsolete.
			fs.rmSync(path.join(root, "scripts", "lib", "core", "gone.js"), { force: true });

			const result = buildLoadout(root, {
				route: "bugfix-quick",
				required: ["gone-page"],
				budget: 1000,
			});
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.required, []);
			const obsoleteExc = result.loadout.excluded.filter((e) => e.reason === "obsolete");
			assert.ok(obsoleteExc.some((e) => e.pageId === "gone-page"));
		} finally {
			cleanup(root);
		}
	});

	it("includes a stale required page marked stale but excludes stale from priority/optional", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/stale.js", "const x = 1;\n");
			writePage(root, freshPage(root, { pageId: "stale-page", title: "Stale", ref: "scripts/lib/core/stale.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "stale-page", at: "2026-08-05T12:00:00.000Z" }]);
			// Mutate the source — page becomes stale (normHash mismatch).
			writeMutable(root, "scripts/lib/core/stale.js", "const x = 2;\n");

			const result = buildLoadout(root, {
				route: "bugfix-quick",
				required: ["stale-page"],
				budget: 1000,
			});
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			// Required tier includes the stale page, marked stale.
			assert.deepEqual(result.loadout.tiers.required, ["stale-page"]);
			assert.equal(result.loadout.pages["stale-page"].status, "stale");
			// Stale page is NOT in priority or optional.
			assert.ok(!result.loadout.tiers.priority.includes("stale-page"));
			assert.ok(!result.loadout.tiers.optional.includes("stale-page"));
		} finally {
			cleanup(root);
		}
	});

	it("excludes a stale page from priority when not pinned as required", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/stale.js", "const x = 1;\n");
			writePage(root, freshPage(root, { pageId: "stale-page", title: "Stale", ref: "scripts/lib/core/stale.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "stale-page", at: "2026-08-05T12:00:00.000Z" }]);
			writeMutable(root, "scripts/lib/core/stale.js", "const x = 2;\n");

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority, []);
			assert.deepEqual(result.loadout.tiers.optional, []);
			const staleExc = result.loadout.excluded.filter((e) => e.reason === "stale");
			assert.ok(staleExc.some((e) => e.pageId === "stale-page"));
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — no-scope pre-retrofit compatibility (D5)", () => {
	it("loads all fresh pages into priority when no page has scope", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			writePage(root, freshPage(root, { pageId: "page-b", title: "B", ref: "scripts/lib/core/b.js" }));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			// No --feature flag, no page.scope field anywhere — all fresh pages
			// are priority candidates.
			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000, feature: "F999" });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority.sort(), ["page-a", "page-b"]);
		} finally {
			cleanup(root);
		}
	});

	it("narrows to scope-matching pages when at least one page has scope", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writePage(root, freshPage(root, {
				pageId: "page-a",
				title: "A",
				ref: "scripts/lib/core/a.js",
				scope: ["bugfix-quick"],
			}));
			writePage(root, freshPage(root, {
				pageId: "page-b",
				title: "B",
				ref: "scripts/lib/core/b.js",
				scope: ["other-route"],
			}));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority, ["page-a"]);
			// page-b is fresh but off-scope — not selected into priority. With
			// remaining budget it falls into optional (it's still fresh ok).
			assert.deepEqual(result.loadout.tiers.optional, ["page-b"]);
		} finally {
			cleanup(root);
		}
	});

	it("narrows by feature id when --feature is provided", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writePage(root, freshPage(root, {
				pageId: "page-a",
				title: "A",
				ref: "scripts/lib/core/a.js",
				scope: ["F015"],
			}));
			writePage(root, freshPage(root, {
				pageId: "page-b",
				title: "B",
				ref: "scripts/lib/core/b.js",
				scope: ["F020"],
			}));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			const result = buildLoadout(root, { route: "bugfix-quick", feature: "F015", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.deepEqual(result.loadout.tiers.priority, ["page-a"]);
			assert.deepEqual(result.loadout.tiers.optional, ["page-b"]);
			assert.equal(result.loadout.feature, "F015");
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — delta-since semantics (D6)", () => {
	it("emits deltaSince and includes only pages added/re-hashed after the timestamp", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			writePage(root, freshPage(root, { pageId: "page-b", title: "B", ref: "scripts/lib/core/b.js" }));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-a", at: "2026-08-01T10:00:00.000Z" },
				{ kind: "request-created", pageId: "page-a", at: "2026-08-05T11:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			const since = "2026-08-03T00:00:00.000Z";
			const result = buildLoadout(root, { route: "bugfix-quick", since, budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.equal(result.loadout.deltaSince, since);
			// Only page-b was added or re-hashed at >= since; a request alone is not a delta.
			assert.deepEqual(result.loadout.tiers.priority, ["page-b"]);
			assert.deepEqual(result.loadout.tiers.optional, []);
		} finally {
			cleanup(root);
		}
	});

	it("null deltaSince when --since not provided", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-01T10:00:00.000Z" }]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0);
			assert.equal(result.loadout.deltaSince, null);
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — loadout shape and references (D2/D6)", () => {
	it("embeds rawHash per page and references array sorted by pageId", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writeMutable(root, "scripts/lib/core/b.js", "const b = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-b", title: "B", ref: "scripts/lib/core/b.js" }));
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [
				{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" },
				{ kind: "page-written", pageId: "page-b", at: "2026-08-05T12:00:00.000Z" },
			]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));

			// rawHash present and matches sha256(canonicalJson(page)).
			for (const [pageId, info] of Object.entries(result.loadout.pages)) {
				assert.match(info.rawHash, /^sha256:[0-9a-f]{64}$/, `${pageId} rawHash malformed`);
			}

			// references sorted by pageId asc.
			const refIds = result.loadout.references.map((r) => r.pageId);
			assert.deepEqual(refIds, [...refIds].sort());

			// references rawHash matches pages.rawHash.
			for (const ref of result.loadout.references) {
				assert.equal(ref.rawHash, result.loadout.pages[ref.pageId].rawHash);
			}

			assert.equal(result.loadout.schemaVersion, "1.0.0");
			assert.equal(result.loadout.route, "bugfix-quick");
			assert.equal(result.loadout.budgetWords, 1000);
		} finally {
			cleanup(root);
		}
	});

	it("appends a loadout-written event", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const before = require("../../scripts/lib/core/context-store").readEvents(root);
			buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			const after = require("../../scripts/lib/core/context-store").readEvents(root);
			const newEvents = after.slice(before.length);
			const loadoutEvents = newEvents.filter((e) => e.kind === "loadout-written");
			assert.equal(loadoutEvents.length, 1, "expected exactly one loadout-written event");
			assert.equal(loadoutEvents[0].route, "bugfix-quick");
			assert.ok(typeof loadoutEvents[0].pageCount === "number");
			assert.ok(typeof loadoutEvents[0].words === "number");
		} finally {
			cleanup(root);
		}
	});
});

describe("verifyLoadoutFile — required-tier re-check (D7)", () => {
	it("passes when no required-tier page changed", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const built = buildLoadout(root, {
				route: "bugfix-quick",
				budget: 1000,
				required: ["page-a"],
			});
			assert.equal(built.errors.length, 0, JSON.stringify(built.errors));

			const verify = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(verify.ok, true, JSON.stringify(verify.findings));
			assert.equal(verify.findings.length, 0);
		} finally {
			cleanup(root);
		}
	});

	it("detects a changed required-tier page", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const built = buildLoadout(root, {
				route: "bugfix-quick",
				budget: 1000,
				required: ["page-a"],
			});
			assert.equal(built.errors.length, 0, JSON.stringify(built.errors));

			// Mutate the page file directly so its identity hash changes.
			const pageFile = path.join(pagesDir(root), "page-a.json");
			const updated = JSON.parse(fs.readFileSync(pageFile, "utf8"));
			updated.title = "A (edited)";
			fs.writeFileSync(pageFile, JSON.stringify(updated, null, 2) + "\n", "utf8");

			const verify = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(verify.ok, false);
			assert.ok(
				verify.findings.some((f) => f.code === "AMBER_E_CONTEXT_SOURCE_STALE" && f.pageId === "page-a"),
				JSON.stringify(verify.findings),
			);
		} finally {
			cleanup(root);
		}
	});

	it("reports a finding when a required-tier page no longer exists on disk", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const built = buildLoadout(root, {
				route: "bugfix-quick",
				budget: 1000,
				required: ["page-a"],
			});
			assert.equal(built.errors.length, 0);

			// Delete the page file.
			fs.rmSync(path.join(pagesDir(root), "page-a.json"), { force: true });

			const verify = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(verify.ok, false);
			assert.ok(verify.findings.some((f) => f.pageId === "page-a"));
		} finally {
			cleanup(root);
		}
	});

	it("returns ok=true for a loadout with empty required tier", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const built = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(built.errors.length, 0);
			assert.deepEqual(built.loadout.tiers.required, []);

			const verify = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(verify.ok, true);
		} finally {
			cleanup(root);
		}
	});

	it("errors when the loadout file does not exist", () => {
		const root = makeTarget();
		try {
			const verify = verifyLoadoutFile(root, path.join(loadoutsDir(root), "missing.json"));
			assert.equal(verify.ok, false);
			assert.ok(verify.findings.length >= 1);
		} finally {
			cleanup(root);
		}
	});
});

describe("loadoutsDir", () => {
	it("returns the .amber/context/loadouts path", () => {
		const root = makeTarget();
		try {
			assert.equal(loadoutsDir(root), path.join(root, ".amber", "context", "loadouts"));
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout — rawHash determinism (D2/D7 contract)", () => {
	it("the rawHash embedded in the loadout matches sha256(canonicalJson(page)) recomputed from disk", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/a.js", "const a = 1;\n");
			writePage(root, freshPage(root, { pageId: "page-a", title: "A", ref: "scripts/lib/core/a.js" }));
			regenerateIndex(root);
			writeEvents(root, [{ kind: "page-written", pageId: "page-a", at: "2026-08-05T12:00:00.000Z" }]);

			const result = buildLoadout(root, { route: "bugfix-quick", budget: 1000 });
			assert.equal(result.errors.length, 0);

			// Recompute the page's identity hash directly from disk using the
			// same canonical-Json-over-page approach documented in the module.
			const page = JSON.parse(
				fs.readFileSync(path.join(pagesDir(root), "page-a.json"), "utf8"),
			);
			// Local canonical JSON mirror (must match the module's helper).
			const recurse = (v) => {
				if (Array.isArray(v)) return `[${v.map(recurse).join(",")}]`;
				if (v !== null && typeof v === "object") {
					const keys = Object.keys(v).sort();
					return `{${keys.map((k) => `${JSON.stringify(k)}:${recurse(v[k])}`).join(",")}}`;
				}
				return JSON.stringify(v);
			};
			const recomputed = sha256(recurse(page));
			assert.equal(result.loadout.pages["page-a"].rawHash, recomputed);
		} finally {
			cleanup(root);
		}
	});
});

describe("buildLoadout required artifacts", () => {
	it("returns a structured error when a required artifact is not a file", () => {
		const root = makeTarget();
		try {
			const manualPath = path.join(root, "docs", "wiki", "agent", "amber.md");
			fs.rmSync(manualPath);
			fs.mkdirSync(manualPath);

			const result = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(result.loadout, null);
			assert.equal(result.errors[0].code, "AMBER_E_CONTEXT_LOADOUT_REQUIRED");
			assert.match(result.errors[0].detail, /not a readable file/);
		} finally {
			cleanup(root);
		}
	});

	it("keeps required governance artifacts separate from Context Page references", () => {
		const root = makeTarget();
		try {
			const result = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
			assert.equal(result.loadout.schemaVersion, "1.0.0");
			assert.deepEqual(
				result.loadout.artifacts.required.map((artifact) => artifact.kind),
				["operating-manual", "route-manifest", "loadout-definition"],
			);
			assert.deepEqual(result.loadout.references, []);
			for (const artifact of result.loadout.artifacts.required) {
				assert.match(artifact.path, /^(docs|routes)\//);
				assert.match(artifact.rawHash, /^sha256:[0-9a-f]{64}$/);
			}
		} finally {
			cleanup(root);
		}
	});

	it("counts required artifact words in required-tier overflow", () => {
		const root = makeTarget();
		try {
			const result = buildLoadout(root, {
				route: "bugfix-quick",
				budget: 1,
			});
			assert.equal(result.loadout, null);
			assert.equal(result.loadoutPath, null);
			assert.equal(
				result.errors[0].code,
				"AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW",
			);
		} finally {
			cleanup(root);
		}
	});

	it("fails verification when a required artifact changes", () => {
		const root = makeTarget();
		try {
			const built = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(built.errors.length, 0, JSON.stringify(built.errors));
			fs.appendFileSync(
				path.join(root, "docs", "wiki", "agent", "amber.md"),
				"\nChanged after generation.\n",
				"utf8",
			);
			const result = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(result.ok, false);
			assert.ok(
				result.findings.some(
					(finding) =>
						finding.code === "AMBER_E_CONTEXT_LOADOUT_REQUIRED" &&
						finding.kind === "operating-manual",
				),
				JSON.stringify(result.findings),
			);
		} finally {
			cleanup(root);
		}
	});

	it("rejects a loadout that does not match the final 1.0.0 schema", () => {
		const root = makeTarget();
		try {
			const built = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(built.errors.length, 0, JSON.stringify(built.errors));
			const loadout = JSON.parse(fs.readFileSync(built.loadoutPath, "utf8"));
			loadout.schemaVersion = "1.1.0";
			fs.writeFileSync(
				built.loadoutPath,
				JSON.stringify(loadout, null, 2) + "\n",
				"utf8",
			);
			const result = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(result.ok, false);
			assert.ok(
				result.findings.some(
					(finding) => finding.code === "AMBER_E_CONTEXT_LOADOUT_CORRUPT",
				),
				JSON.stringify(result.findings),
			);
		} finally {
			cleanup(root);
		}
	});

	it("rejects an unsafe feature identifier before constructing the output path", () => {
		const root = makeTarget();
		try {
			const result = buildLoadout(root, {
				route: "bugfix-quick",
				feature: "x/../../../../package",
			});
			assert.equal(result.loadout, null);
			assert.equal(result.loadoutPath, null);
			assert.equal(result.errors[0].code, "AMBER_E_CONTEXT_SCHEMA_INVALID");
		} finally {
			cleanup(root);
		}
	});

	it("returns an error when the Loadouts directory junction escapes the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-loadout-link-"));
		try {
			const linkedDir = loadoutsDir(root);
			fs.mkdirSync(path.dirname(linkedDir), { recursive: true });
			fs.symlinkSync(
				outsideRoot,
				linkedDir,
				process.platform === "win32" ? "junction" : "dir",
			);
			const result = buildLoadout(root, { route: "bugfix-quick" });
			assert.equal(result.loadout, null);
			assert.equal(result.loadoutPath, null);
			assert.match(result.errors[0].detail, /outside the target/i);
			assert.deepEqual(fs.readdirSync(outsideRoot), []);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});

	it("fails verification when a required artifact is missing", () => {
		const root = makeTarget();
		try {
			const built = buildLoadout(root, { route: "bugfix-quick" });
			fs.rmSync(
				path.join(root, "docs", "wiki", "agent", "context-loadout.md"),
				{ force: true },
			);
			const result = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(result.ok, false);
			assert.ok(
				result.findings.some(
					(finding) =>
						finding.code === "AMBER_E_CONTEXT_LOADOUT_REQUIRED" &&
						finding.kind === "loadout-definition",
				),
			);
		} finally {
			cleanup(root);
		}
	});

	it("fails verification when a required artifact path escapes the target", () => {
		const root = makeTarget();
		try {
			const built = buildLoadout(root, { route: "bugfix-quick" });
			const loadout = JSON.parse(fs.readFileSync(built.loadoutPath, "utf8"));
			loadout.artifacts.required[0].path = "../outside.md";
			fs.writeFileSync(
				built.loadoutPath,
				JSON.stringify(loadout, null, 2) + "\n",
				"utf8",
			);
			const result = verifyLoadoutFile(root, built.loadoutPath);
			assert.equal(result.ok, false);
			assert.match(result.findings[0].detail, /outside the target/i);
		} finally {
			cleanup(root);
		}
	});
});
