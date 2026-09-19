"use strict";

// Trusted-control context/runtime contract — Slice E (spec §6, §8 cases 1
// query half / 4 query half / 6 settlement half / 8 claim-stays-claimed):
// the Research adapter, the citation store, and the §6.5 end-to-end flow.
// Real ledger store, real F052 fixture, no network execution anywhere.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const research = require("../../scripts/lib/core/research-adapter");
const { recordCitation, citationExists, foldCitations } = require("../../scripts/lib/core/citation-store");
const {
	registerRunner,
	registerRunnerCapability,
	submitRunnerRequest,
	authorizeRunnerRequest,
	prepareRunnerExecution,
	settleRunnerExecution,
} = require("../../scripts/lib/core/runner-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { createRequest: makeRequest } = require("../../scripts/lib/core/context-request");
const { ingestPayload } = require("../../scripts/lib/core/context-ingest");

const T0 = new Date("2026-09-19T00:00:00.000Z");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-research-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	fs.mkdirSync(path.join(root, "docs"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs", "notes.md"), "Research notes.\n");
	return root;
}

// ── five-method contract shape (0049, second consumer) ──

describe("research adapter — the five-method ExecutionBoundary contract", () => {
	it("declares capabilities, contexts, executions, verifiers, and validates runs", () => {
		const root = makeTarget();
		try {
			const { capabilities: declared, registry } = research.capabilities(root);
			assert.deepEqual(
				declared.map((capability) => capability.name),
				["research.search", "research.extract", "research.cite"],
			);
			assert.ok(Array.isArray(registry));

			const contexts = research.contexts(root);
			assert.strictEqual(contexts.citationStore, ".amber/research/citations.jsonl");

			const executions = research.executions();
			assert.strictEqual(executions.family, "LocalProcess");
			assert.strictEqual(executions.worktree, false);
			assert.deepEqual(executions.writePaths, [".amber/research/citations.jsonl"]);

			const verifiers = research.verifiers();
			const claim = verifiers.find((verifier) => verifier.verifier === "claim_supported");
			assert.strictEqual(claim.actorClass, "independent-verifier-principal");

			assert.equal(research.validate({ writePaths: [".amber/research/citations.jsonl"] }).ok, true);
			const refused = research.validate({ writePaths: ["src/"] });
			assert.equal(refused.ok, false);
			assert.match(refused.reason, /outside the research boundary/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── citation store: the one write path ──

describe("research citation store (§6.1–6.2)", () => {
	it("records citations with both timestamps and flags a stale retrieval", () => {
		const root = makeTarget();
		try {
			const recorded = recordCitation(
				root,
				{
					citationId: "cite-1",
					sourceRef: "https://example.com/source",
					rawHash: `sha256:${"a".repeat(64)}`,
					retrievedAt: new Date(T0.getTime() - 1000).toISOString(),
					locator: "https://example.com/source#L1",
					claimRef: "claim/1",
					requestHash: `sha256:${"b".repeat(64)}`,
				},
				{ now: T0 },
			);
			assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
			assert.strictEqual(recorded.record.retrievedAt !== recorded.record.at, true, "the two timestamps stay distinct");

			// §6.1 freshness flag: the gap exceeding the declared bound flags.
			const fresh = research.freshnessFlag(recorded.record, 3600_000);
			assert.strictEqual(fresh.flagged, false);
			const stale = research.freshnessFlag(recorded.record, 100);
			assert.strictEqual(stale.flagged, true);

			// A duplicate citationId refuses (recorded once, never updated).
			const again = recordCitation(
				root,
				{
					citationId: "cite-1",
					sourceRef: "x",
					rawHash: `sha256:${"a".repeat(64)}`,
					retrievedAt: T0.toISOString(),
					locator: "x",
					requestHash: `sha256:${"b".repeat(64)}`,
				},
				{ now: T0 },
			);
			assert.equal(again.ok, false);

			// citation_exists is deterministic over the store.
			assert.equal(citationExists(root, "cite-1").exists, true);
			assert.equal(citationExists(root, "ghost").exists, false);
			assert.strictEqual(foldCitations(root).length, 1);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("source_accessible records unavailable for network refs — never fake success", () => {
		const root = makeTarget();
		try {
			const local = research.sourceAccessible(root, "docs/notes.md");
			assert.strictEqual(local.status, "accessible");
			const network = research.sourceAccessible(root, "https://example.com/source");
			assert.strictEqual(network.status, "unavailable");
			const missing = research.sourceAccessible(root, "docs/ghost.md");
			assert.strictEqual(missing.status, "unavailable");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("claim_supported refuses self-verification and records through the Evidence seam", () => {
		const root = makeTarget();
		try {
			registerPrincipal(root, { id: "producer@example.com", principalKind: "service" });
			registerPrincipal(root, { id: "verifier@example.com", principalKind: "human" });
			const selfRefused = research.recordClaimVerification(root, {
				claimRef: "claim/1",
				producer: "producer@example.com",
				verifier: "producer@example.com",
				verdict: true,
			});
			assert.equal(selfRefused.ok, false);
			assert.match(selfRefused.errors[0], /never verifies its own claim/);

			const recorded = research.recordClaimVerification(root, {
				claimRef: "claim/1",
				producer: "producer@example.com",
				verifier: "verifier@example.com",
				verdict: true,
			});
			assert.equal(recorded.ok, true, JSON.stringify(recorded.errors));
			assert.match(recorded.note, /observed/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── R-EG-2: the search query egress seam ──

function seedClassifiedPage(root, pageId, classification) {
	const req = makeRequest(root, {
		pageId,
		title: pageId,
		reason: "explicit",
		sources: [{ ref: "docs/notes.md" }],
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
			sources: {
				s1: s1.mutable
					? { kind: s1.kind, ref: s1.ref, rawHash: s1.rawHash, normHash: s1.normHash, mutable: true }
					: { kind: s1.kind, ref: s1.ref, rawHash: s1.rawHash, excerpt: s1.excerpt, excerptHash: s1.excerptHash, mutable: false },
			},
			blocks: [{ type: "prose", sources: ["s1"], text: `Content of ${pageId}.` }],
			...(classification ? { classification } : {}),
		},
	});
	assert.equal(result.accepted, true, (result.errors || []).join("; "));
	const { readPage } = require("../../scripts/lib/core/context-store");
	const { sha256, canonicalJson } = require("../../scripts/lib/core/context-hash");
	return sha256(canonicalJson(JSON.stringify(readPage(root, pageId))));
}

describe("research query egress (R-EG-2, §8 cases 1 and 4, query half)", () => {
	it("refuses a wrong-scope declaration, an over-ceiling source, and a missing provenance", () => {
		const root = makeTarget();
		try {
			const restrictedHash = seedClassifiedPage(root, "restricted-notes", "restricted");
			// Wrong scope: the reference does not resolve.
			const wrongScope = research.validateQueryDeclaration(root, {
				querySources: [{ kind: "page", ref: "no-such-page", rawHash: `sha256:${"a".repeat(64)}` }],
				capability: { maxQueryClassification: "internal" },
			});
			assert.equal(wrongScope.ok, false);
			assert.match(wrongScope.errors[0], /does not resolve/);

			// Ceiling: restricted content above the internal ceiling.
			const overCeiling = research.validateQueryDeclaration(root, {
				querySources: [{ kind: "page", ref: "restricted-notes", rawHash: restrictedHash }],
				capability: { maxQueryClassification: "internal" },
			});
			assert.equal(overCeiling.ok, false);
			assert.match(overCeiling.errors[0], /classification-ceiling/);

			// Provenance required and absent.
			const noProvenance = research.validateQueryDeclaration(root, {
				querySources: [],
				capability: { requiresQueryProvenance: true },
			});
			assert.equal(noProvenance.ok, false);
			assert.match(noProvenance.errors[0], /requires query provenance/);

			// The same declaration passes under the raised ceiling.
			const allowed = research.validateQueryDeclaration(root, {
				querySources: [{ kind: "page", ref: "restricted-notes", rawHash: restrictedHash }],
				capability: { maxQueryClassification: "restricted" },
			});
			assert.equal(allowed.ok, true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── the §6.5 end-to-end flow through the REAL F052 lifecycle ──

function registerResearchCapabilities(root) {
	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(root, { id: "agent-a", principalKind: "service" });
	admitArtifact(root, { type: "intent", identity: "intent/research", body: "# R\n" });
	const decide = (identity) =>
		admitArtifact(root, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/research" } }],
		});
	decide("decision/runner");
	registerRunner(root, {
		id: "runner/research",
		version: "1.0.0",
		integrityDigest: `sha256:${"a".repeat(64)}`,
		owner: "research-team",
		decision: { identity: "decision/runner", revision: 1 },
	});
	decide("decision/capability");
	registerRunnerCapability(root, {
		runnerId: "runner/research",
		runnerVersion: "1.0.0",
		name: "research.search",
		capabilityVersion: "1",
		effects: ["read"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: { identity: "decision/capability", revision: 1 },
	});
}

describe("the §6.5 end-to-end research flow (fixture)", () => {
	it("request → grant → authorize → prepare → settle → cite → verify, attributable end to end", () => {
		const root = makeTarget();
		try {
			registerResearchCapabilities(root);
			seedClassifiedPage(root, "research-notes", "internal");

			// 1-2. request (the search capability) with querySources → R-EG-2.
			const submitted = submitRunnerRequest(
				root,
				{
					capability: { runnerId: "runner/research", runnerVersion: "1.0.0", name: "research.search", capabilityVersion: "1" },
					target: { repository: "repo", paths: ["docs/"] },
					environment: "development",
					scope: "docs/",
					timeoutMs: 1000,
					effects: ["read"],
					credentialRequirement: "none",
					rollback: "none",
					contextAuthority: {
						loadoutHash: null,
						constraints: {
							maxClassification: "internal",
							purpose: null,
							expiresAt: null,
							accessBoundaries: ["docs/"],
						},
					},
				},
				{ now: T0 },
			);
			assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));

			// 3. human grants the binding; authorize consumes it.
			const granted = grantApproval(
				root,
				{
					id: "approval/research",
					approver: "alice@example.com",
					scope: null,
					subject: `runner-request:development:${submitted.record.requestHash}`,
					validUntil: "2036-01-01T00:00:00.000Z",
				},
				{ now: T0 },
			);
			assert.equal(granted.ok, true, (granted.errors || []).join("; "));
			const authorized = authorizeRunnerRequest(
				root,
				{
					requestHash: submitted.record.requestHash,
					approval: "approval/research",
					decisionIdentity: "decision/authorize",
					body: "# Authorize research run\n",
					traces: [{ type: "decides", to: { type: "intent", identity: "intent/research" } }],
					scope: null,
				},
				{ now: T0 },
			);
			assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));

			// 4. prepare; the retrieval itself executes OUTSIDE Amber (there is
			// no Amber execution step to run — the Runtime calls Amber).
			const prepared = prepareRunnerExecution(
				root,
				{
					requestHash: submitted.record.requestHash,
					runner: { id: "runner/research", version: "1.0.0", integrityDigest: `sha256:${"a".repeat(64)}` },
				},
				{ now: T0 },
			);
			assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
			const settled = settleRunnerExecution(
				root,
				{
					requestHash: submitted.record.requestHash,
					receipt: {
						runner: { id: "runner/research", version: "1.0.0", integrityDigest: `sha256:${"a".repeat(64)}` },
						exitCode: 0,
						signal: null,
						timedOut: false,
						startedAt: T0.toISOString(),
						finishedAt: T0.toISOString(),
						durationMs: 0,
						outputsDigest: `sha256:${"c".repeat(64)}`,
						scope: { repository: "repo", paths: ["docs/"] },
						sandboxAssurance: "unavailable",
						credentialAssurance: "unavailable",
					},
				},
				{ now: T0 },
			);
			assert.equal(settled.ok, true, (settled.errors || []).join("; "));

			// 5. cite writes the citation store; receipt outputs carry the mapping.
			const cited = recordCitation(
				root,
				{
					citationId: "cite-e2e-1",
					sourceRef: "https://example.com/notes",
					rawHash: `sha256:${"d".repeat(64)}`,
					retrievedAt: new Date(T0.getTime() - 5000).toISOString(),
					locator: "https://example.com/notes#L1-L2",
					claimRef: "claim/research-e2e",
					requestHash: submitted.record.requestHash,
				},
				{ now: T0 },
			);
			assert.equal(cited.ok, true, (cited.errors || []).join("; "));

			// 6. verification: deterministic checks + the independent claim verdict.
			assert.equal(citationExists(root, "cite-e2e-1").exists, true);
			const accessible = research.sourceAccessible(root, "docs/notes.md");
			assert.strictEqual(accessible.status, "accessible");
			const claim = research.recordClaimVerification(root, {
				claimRef: "claim/research-e2e",
				producer: "agent-a",
				verifier: "alice@example.com",
				verdict: true,
			});
			assert.equal(claim.ok, true, JSON.stringify(claim.errors));

			// 7. the chain is attributable by joins.
			const [citation] = foldCitations(root);
			assert.strictEqual(citation.requestHash, submitted.record.requestHash);
			assert.strictEqual(settled.record.requestHash, submitted.record.requestHash);
			assert.strictEqual(authorized.record.requestHash, submitted.record.requestHash);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
