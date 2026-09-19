"use strict";

// Trusted-control context/runtime contract — Slice A (spec §3.1–§3.2, §8
// cases 2/3 load-build half): classification metadata through governed ingest,
// the effective-classification projection, TTL expiry, the ceiling exclusions,
// and the Loadout snapshot extension. Real store, real load-build — no
// in-memory claims.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createRequest } = require("../../scripts/lib/core/context-request");
const { ingestPayload } = require("../../scripts/lib/core/context-ingest");
const { readPage } = require("../../scripts/lib/core/context-store");
const { previewLoadout } = require("../../scripts/lib/core/context-loadout");
const {
	rankOf,
	effectiveClassificationOf,
	admittedUnderCeiling,
	parseIsoDuration,
	expiresAtFromTtl,
} = require("../../scripts/lib/core/classification");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");

// ── classification module ──

describe("classification vocabulary and projection (§3.1)", () => {
	it("ranks the closed set and leaves unknown rank-less", () => {
		assert.strictEqual(rankOf("public"), 0);
		assert.strictEqual(rankOf("secret"), 4);
		assert.strictEqual(rankOf("unknown"), null);
		assert.strictEqual(rankOf("banana"), null);
	});

	it("projects stored labels, governed defaults, and honest unknowns", () => {
		assert.deepStrictEqual(effectiveClassificationOf({ stored: "restricted", governed: true }), {
			classification: "restricted",
			classificationSource: "stored",
		});
		assert.deepStrictEqual(effectiveClassificationOf({ stored: null, governed: true }), {
			classification: "internal",
			classificationSource: "effective-default",
		});
		assert.deepStrictEqual(effectiveClassificationOf({ stored: null, governed: false }), {
			classification: "unknown",
			classificationSource: "unlabeled",
		});
	});

	it("applies ceilings deterministically; unknown never satisfies any ceiling", () => {
		assert.deepStrictEqual(admittedUnderCeiling("internal", "internal"), { ok: true });
		assert.deepStrictEqual(admittedUnderCeiling("restricted", "internal"), {
			ok: false,
			refusal: "classification-ceiling",
		});
		assert.deepStrictEqual(admittedUnderCeiling("unknown", "secret"), {
			ok: false,
			refusal: "classification-unknown",
		});
		assert.deepStrictEqual(admittedUnderCeiling("secret", null), { ok: true }, "no ceiling configures no constraint");
	});

	it("parses ISO durations deterministically", () => {
		assert.strictEqual(parseIsoDuration("P7D"), 7 * 24 * 3600 * 1000);
		assert.strictEqual(parseIsoDuration("PT30M"), 30 * 60 * 1000);
		assert.strictEqual(parseIsoDuration("P1Y"), 365 * 24 * 3600 * 1000);
		assert.strictEqual(parseIsoDuration("nonsense"), null);
		assert.strictEqual(parseIsoDuration("P"), null);
		assert.strictEqual(expiresAtFromTtl({ ttl: "P1D" }, "2026-09-19T00:00:00.000Z"), "2026-09-20T00:00:00.000Z");
		assert.strictEqual(expiresAtFromTtl({ ttl: null }, "2026-09-19T00:00:00.000Z"), null);
	});
});

// ── ingest: labels + the downgrade gate ──

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-cls-"));
	fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
	fs.mkdirSync(path.join(root, ".amber", "sessions", "s1"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".amber", "sessions", "s1", "ledger.jsonl"),
		'{"action":"governed-command","result":"pass"}\n',
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "docs", "adr", "0003-governance-gated-execution.md"),
		"# ADR-0003\n\nFive preconditions gate execution.\n",
		"utf8",
	);
	return root;
}

function makeRequest(root) {
	const r = createRequest(root, {
		pageId: "classified-note",
		title: "Classified note",
		reason: "explicit",
		sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
	});
	assert.equal(r.errors.length, 0, r.errors.join(", "));
	return r;
}

function payloadFor(req, extra = {}) {
	const s1 = req.request.sources[0];
	return {
		schemaVersion: "1.0.0",
		pageId: req.request.target.pageId,
		title: req.request.target.title,
		knowledgeKind: req.request.target.knowledgeKind || "unspecified",
		scope: [],
		supersedes: [],
		sources: { s1: { kind: s1.kind, ref: s1.ref, rawHash: s1.rawHash, excerpt: s1.excerpt, excerptHash: s1.excerptHash, mutable: false } },
		blocks: [{ type: "prose", sources: ["s1"], text: "Governed execution needs preconditions." }],
		...extra,
	};
}

describe("ingest classification metadata (§3.1)", () => {
	it("stores the page-level label; request sources without labels carry unknown", () => {
		const root = makeTarget();
		try {
			const req = makeRequest(root);
			assert.strictEqual(req.request.sources[0].classification, "unknown");
			const result = ingestPayload(root, {
				requestId: req.requestId,
				payload: payloadFor(req, { classification: "restricted", purpose: "probe" }),
			});
			assert.equal(result.accepted, true, (result.errors || []).join("; "));
			const page = readPage(root, "classified-note");
			assert.strictEqual(page.classification, "restricted");
			assert.strictEqual(page.purpose, "probe");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a restricted → internal downgrade without a committed Decision", () => {
		const root = makeTarget();
		try {
			const req = makeRequest(root);
			assert.equal(
				ingestPayload(root, {
					requestId: req.requestId,
					payload: payloadFor(req, { classification: "restricted" }),
				}).accepted,
				true,
			);
			const downgraded = ingestPayload(root, {
				requestId: req.requestId,
				payload: payloadFor(req, { classification: "internal" }),
			});
			assert.equal(downgraded.accepted, false);
			assert.equal(downgraded.code, "AMBER_E_CONTEXT_DOWNGRADE_REFUSED");
			// The stored label is unchanged (refusal, never write-back).
			assert.strictEqual(readPage(root, "classified-note").classification, "restricted");

			// An omitted label is also a downgrade (to the effective internal).
			const omitted = ingestPayload(root, {
				requestId: req.requestId,
				payload: payloadFor(req),
			});
			assert.equal(omitted.accepted, false);
			assert.equal(omitted.code, "AMBER_E_CONTEXT_DOWNGRADE_REFUSED");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("accepts a downgrade that shows a committed human Decision", () => {
		const root = makeTarget();
		try {
			registerDecisionFixture(root);
			const req = makeRequest(root);
			assert.equal(
				ingestPayload(root, {
					requestId: req.requestId,
					payload: payloadFor(req, { classification: "restricted" }),
				}).accepted,
				true,
			);
			const result = ingestPayload(root, {
				requestId: req.requestId,
				payload: payloadFor(req, {
					classification: "internal",
					relabelDecision: { identity: "decision/relabel", revision: 1 },
				}),
			});
			assert.equal(result.accepted, true, (result.errors || []).join("; "));
			assert.strictEqual(readPage(root, "classified-note").classification, "internal");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a downgrade citing a decision that does not resolve", () => {
		const root = makeTarget();
		try {
			const req = makeRequest(root);
			assert.equal(
				ingestPayload(root, {
					requestId: req.requestId,
					payload: payloadFor(req, { classification: "restricted" }),
				}).accepted,
				true,
			);
			const result = ingestPayload(root, {
				requestId: req.requestId,
				payload: payloadFor(req, {
					classification: "internal",
					relabelDecision: { identity: "decision/ghost", revision: 1 },
				}),
			});
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_DOWNGRADE_REFUSED");
			assert.match(result.errors.join(" "), /does not resolve|could not be verified/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// The downgrade gate verifies the relabel Decision against the canonical
// artifact store — a real committed human decision artifact, not a stub.
function registerDecisionFixture(root) {
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	registerDecisionFixture.principalDone = registerDecisionFixture.principalDone || (() => {
		const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
		registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	})();
	admitArtifact(root, { type: "intent", identity: "intent/relabel", body: "# Relabel\n" });
	admitArtifact(root, {
		type: "decision",
		identity: "decision/relabel",
		body: "# Relabel decision\n",
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/relabel" } }],
	});
}

// ── load-build: projection, ceiling, expiry (§8 cases 2/3, load-build half) ──

describe("load-build metadata projection and authority exclusions (§3.1-3.3)", () => {
	function seedPage(root, pageId, extra = {}) {
		const req = createRequest(root, {
			pageId,
			title: pageId,
			reason: "explicit",
			sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
		});
		assert.equal(req.errors.length, 0);
		const s1 = req.request.sources[0];
		const result = ingestPayload(root, {
			requestId: req.requestId,
			payload: {
				schemaVersion: "1.0.0",
				pageId,
				title: pageId,
				knowledgeKind: req.request.target.knowledgeKind || "unspecified",
				scope: [],
				supersedes: [],
				sources: { s1: { kind: s1.kind, ref: s1.ref, rawHash: s1.rawHash, excerpt: s1.excerpt, excerptHash: s1.excerptHash, mutable: false } },
				blocks: [{ type: "prose", sources: ["s1"], text: `Content of ${pageId}.` }],
				...extra,
			},
		});
		assert.equal(result.accepted, true, (result.errors || []).join("; "));
		return result;
	}

	function makeLoadTarget() {
		const root = makeTarget();
		execFileSync("git", ["init", "-q"], { cwd: root });
		execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
		execFileSync("git", ["config", "user.name", "T"], { cwd: root });
		fs.writeFileSync(path.join(root, "docs", "adr", "0001-x.md"), "# ADR-0001\n");
		fs.mkdirSync(path.join(root, "routes"), { recursive: true });
		fs.writeFileSync(
			path.join(root, "routes", "probe.route.json"),
			JSON.stringify({
				schemaVersion: "1.0.0",
				routeId: "probe",
				version: "1.0.0",
				description: "probe",
				stages: [{ name: "check", type: "command", target: "node --version" }],
			}),
		);
		// The three required artifacts (operating manual, route manifest,
		// loadout definition) must exist for the build.
		const manual = path.join(root, "docs", "wiki", "agent");
		fs.mkdirSync(manual, { recursive: true });
		fs.writeFileSync(path.join(manual, "amber.md"), "# Manual\n");
		fs.writeFileSync(path.join(manual, "context-loadout.md"), "# Loadout def\n");
		return root;
	}

	it("projects the effective classification and the ttl expiry; no ceiling denies nothing", async () => {
		const root = makeLoadTarget();
		try {
			seedPage(root, "labeled-page", { classification: "confidential", purpose: "probe", ttl: "P1D" });
			seedPage(root, "unlabeled-page");
			const preview = previewLoadout(root, { route: "probe", budget: 4000 });
			assert.deepEqual(preview.errors, [], JSON.stringify(preview.errors));
			const loadout = preview.loadout;
			assert.ok(loadout.pages["labeled-page"]);
			assert.strictEqual(loadout.pages["labeled-page"].classification, "confidential");
			assert.strictEqual(loadout.pages["labeled-page"].classificationSource, "stored");
			assert.strictEqual(loadout.pages["labeled-page"].purpose, "probe");
			assert.match(loadout.pages["labeled-page"].expiresAt, /^20\d\d-/);
			// Pre-field governed page: effective internal with recorded source —
			// never a stored write-back.
			assert.strictEqual(loadout.pages["unlabeled-page"].classification, "internal");
			assert.strictEqual(loadout.pages["unlabeled-page"].classificationSource, "effective-default");
			assert.strictEqual(readPage(root, "unlabeled-page").classification, undefined);
			assert.deepStrictEqual(loadout.redactions, []);
			for (const artifact of loadout.artifacts.required) {
				assert.strictEqual(artifact.classification, "internal");
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("excludes over-ceiling and expired pages from every tier with explicit reasons", async () => {
		const root = makeLoadTarget();
		try {
			seedPage(root, "quiet-page", { classification: "internal" });
			seedPage(root, "hot-page", { classification: "restricted" });
			seedPage(root, "old-page", { classification: "internal", ttl: "PT1H" });
			// Backdate the old-page ingest stamp so its ttl expiry has passed,
			// then rebuild the projection whose sourceHash covers the pages.
			const pagePath = path.join(root, ".amber", "context", "pages", "old-page.json");
			const page = JSON.parse(fs.readFileSync(pagePath, "utf8"));
			page.created_at = "2026-01-01T00:00:00.000Z";
			fs.writeFileSync(pagePath, JSON.stringify(page, null, 2) + "\n");
			require("../../scripts/lib/core/context-projection").rebuildProjection(root);

			const preview = previewLoadout(root, { route: "probe", budget: 4000, maxClassification: "internal" });
			assert.deepEqual(preview.errors, [], JSON.stringify(preview.errors));
			const loadout = preview.loadout;
			assert.ok(loadout.pages["quiet-page"], "within-ceiling page included");
			assert.ok(!loadout.pages["hot-page"]);
			assert.ok(!loadout.pages["old-page"]);
			const reasons = Object.fromEntries(loadout.excluded.map((e) => [e.pageId, e.reason]));
			assert.strictEqual(reasons["hot-page"], "classification");
			assert.strictEqual(reasons["old-page"], "expired");
			// Even a required pin cannot pull a page past the ceiling.
			const pinned = previewLoadout(root, {
				route: "probe",
				budget: 4000,
				maxClassification: "internal",
				required: ["hot-page"],
			});
			assert.deepEqual(pinned.errors, []);
			assert.ok(!pinned.loadout.pages["hot-page"]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
