"use strict";

// Trusted-control context/runtime contract — Slice B (spec §3.5 R-EG-1, §8
// cases 1 and 4, F056 half): declaration-based egress constraints at the
// propose and execute seams. The payloadHash binding stays a declared-hash
// binding: no test here asserts actual payload-byte integrity, payload
// identity, or leak prevention — the bytes actually sent are an executor
// claim (E2, §3.5).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	registerExternalEffect,
	proposeExternalEffect,
	authorizeExternalEffect,
	executeExternalEffect,
} = require("../../scripts/lib/core/external-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { createRequest } = require("../../scripts/lib/core/context-request");
const { ingestPayload } = require("../../scripts/lib/core/context-ingest");

const NOW = new Date("2026-09-19T00:00:00.000Z");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-egress-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	registerPrincipal(root, { id: "bob@example.com", principalKind: "human" });
	admitArtifact(root, { type: "intent", identity: "intent/external", body: "# X\n" });
	for (const identity of ["decision/effect-1", "decision/effect-2"]) {
		admitArtifact(root, {
			type: "decision",
			identity,
			body: "# D\n",
			decisionKind: "approval",
			principal: "bob@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		});
	}
	registerAdapter(root, {
		id: "adapter/tracker",
		owner: "platform-team",
		adapterVersion: "1",
		recordTypes: [{ type: "ticket", versions: ["v1"] }],
		scope: "F056",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["tracker"] },
	});
	return root;
}

const { execFileSync } = require("node:child_process");

function effectInput(overrides = {}) {
	return {
		id: "effect/ticket-comment",
		version: "1",
		owner: "platform-team",
		system: "ticketing",
		operation: "comment.create",
		target: "tracker/amber-protocol",
		scope: "issues",
		inputSchema: { type: "object", required: ["body"] },
		idempotency: "idempotent",
		credentials: "scoped",
		receiptFields: ["commentId"],
		compensation: { kind: "irreversible" },
		timeoutMs: 30_000,
		adapter: { id: "adapter/tracker", version: "1" },
		decision: { identity: "decision/effect-1", revision: 1 },
		...overrides,
	};
}

// A real governed-ingest Context Page: the declared source the egress checks
// resolve against.
function seedPage(root, pageId, classification) {
	fs.mkdirSync(path.join(root, "docs"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs", "notes.md"), `Notes for ${pageId}.\n`);
	const req = createRequest(root, {
		pageId,
		title: pageId,
		reason: "explicit",
		sources: [{ ref: "docs/notes.md" }],
	});
	assert.equal(req.errors.length, 0, req.errors.join("; "));
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
					: {
							kind: s1.kind,
							ref: s1.ref,
							rawHash: s1.rawHash,
							excerpt: s1.excerpt,
							excerptHash: s1.excerptHash,
							mutable: false,
						},
			},
			blocks: [{ type: "prose", sources: ["s1"], text: `Content of ${pageId}.` }],
			...(classification ? { classification } : {}),
		},
	});
	assert.equal(result.accepted, true, (result.errors || []).join("; "));
	return result;
}

// The page's canonical hash — the same derivation the loadout and the
// declared-source resolution use.
function pageRawHash(root, pageId) {
	const { readPage } = require("../../scripts/lib/core/context-store");
	const { sha256, canonicalJson } = require("../../scripts/lib/core/context-hash");
	return sha256(canonicalJson(JSON.stringify(readPage(root, pageId))));
}

function authorize(dir, proposalId, requestHash) {
	const granted = grantApproval(
		dir,
		{
			id: "approval/external",
			approver: "bob@example.com",
			scope: null,
			subject: `external-effect:${requestHash}`,
			validUntil: "2036-01-01T00:00:00.000Z",
		},
		{ now: NOW },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	return authorizeExternalEffect(
		dir,
		{
			id: proposalId,
			approval: "approval/external",
			decisionIdentity: "decision/external-consume",
			body: "# Authorize external effect\n",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			scope: null,
		},
		{ now: NOW },
	);
}

describe("F056 egress declarations (R-EG-1, spec §8 cases 1 and 4)", () => {
	it("registers the egress ceilings with their defaults and honored overrides", () => {
		const root = makeTarget();
		try {
			const defaults = registerExternalEffect(root, effectInput(), { now: NOW });
			assert.equal(defaults.ok, true, (defaults.errors || []).join("; "));
			assert.equal(defaults.record.maxPayloadClassification, "internal");
			assert.equal(defaults.record.requiresPayloadProvenance, false);
			const raised = registerExternalEffect(
				root,
				effectInput({
					id: "effect/wide",
					decision: { identity: "decision/effect-2", revision: 1 },
					maxPayloadClassification: "secret",
					requiresPayloadProvenance: true,
				}),
				{ now: NOW },
			);
			assert.equal(raised.ok, true, (raised.errors || []).join("; "));
			assert.equal(raised.record.maxPayloadClassification, "secret");
			assert.equal(raised.record.requiresPayloadProvenance, true);
			const invalid = registerExternalEffect(
				root,
				effectInput({ decision: { identity: "decision/effect-2", revision: 1 }, maxPayloadClassification: "banana" }),
				{ now: NOW },
			);
			assert.equal(invalid.ok, false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a declared source that does not resolve in the current snapshot (case 4)", () => {
		const root = makeTarget();
		try {
			registerExternalEffect(root, effectInput(), { now: NOW });
			const refused = proposeExternalEffect(
				root,
				{
					id: "request/1",
					effect: { id: "effect/ticket-comment", version: "1" },
					payloadHash: `sha256:${"a".repeat(64)}`,
					payloadSources: [
						{ kind: "page", ref: "no-such-page", rawHash: `sha256:${"b".repeat(64)}` },
					],
				},
				{ now: NOW },
			);
			assert.equal(refused.ok, false);
			assert.match(refused.errors[0], /does not resolve in the current context snapshot/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses declared restricted content above the effect ceiling; the same declaration passes under a raised ceiling (case 1)", () => {
		const root = makeTarget();
		try {
			seedPage(root, "restricted-notes", "restricted");
			const restrictedHash = pageRawHash(root, "restricted-notes");
			registerExternalEffect(root, effectInput(), { now: NOW });
			const refused = proposeExternalEffect(
				root,
				{
					id: "request/1",
					effect: { id: "effect/ticket-comment", version: "1" },
					payloadHash: `sha256:${"a".repeat(64)}`,
					payloadSources: [
						{ kind: "page", ref: "restricted-notes", rawHash: restrictedHash },
					],
				},
				{ now: NOW },
			);
			assert.equal(refused.ok, false);
			assert.match(refused.errors[0], /classification-ceiling/);
			assert.match(refused.errors[0], /restricted/);

			// The one legitimate widening: a new effect VERSION with a higher
			// declared ceiling — itself a human-approved registration. The
			// caller of propose can never widen the ceiling by declaration.
			registerExternalEffect(
				root,
				effectInput({
					version: "2",
					maxPayloadClassification: "restricted",
					decision: { identity: "decision/effect-2", revision: 1 },
				}),
				{ now: NOW },
			);
			const allowed = proposeExternalEffect(
				root,
				{
					id: "request/2",
					effect: { id: "effect/ticket-comment", version: "2" },
					payloadHash: `sha256:${"a".repeat(64)}`,
					payloadSources: [
						{ kind: "page", ref: "restricted-notes", rawHash: restrictedHash },
					],
				},
				{ now: NOW },
			);
			assert.equal(allowed.ok, true, (allowed.errors || []).join("; "));
			// The declaration rides the proposal record verbatim.
			assert.deepEqual(allowed.record.payloadSources, [
				{ kind: "page", ref: "restricted-notes", rawHash: restrictedHash },
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses an unverifiable proposal when the effect requires provenance and none is declared", () => {
		const root = makeTarget();
		try {
			registerExternalEffect(
				root,
				effectInput({ requiresPayloadProvenance: true }),
				{ now: NOW },
			);
			const refused = proposeExternalEffect(
				root,
				{
					id: "request/1",
					effect: { id: "effect/ticket-comment", version: "1" },
					payloadHash: `sha256:${"a".repeat(64)}`,
				},
				{ now: NOW },
			);
			assert.equal(refused.ok, false);
			assert.match(refused.errors[0], /requires payload provenance/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a declared source whose revision drifted since the declaration (rawHash)", () => {
		const root = makeTarget();
		try {
			seedPage(root, "drifting-notes");
			const staleHash = `sha256:${"c".repeat(64)}`;
			registerExternalEffect(root, effectInput(), { now: NOW });
			const refused = proposeExternalEffect(
				root,
				{
					id: "request/1",
					effect: { id: "effect/ticket-comment", version: "1" },
					payloadHash: `sha256:${"a".repeat(64)}`,
					payloadSources: [{ kind: "page", ref: "drifting-notes", rawHash: staleHash }],
				},
				{ now: NOW },
			);
			assert.equal(refused.ok, false);
			assert.match(refused.errors[0], /rawHash drift/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("a declared source that disappears after authorization refuses execute as drift", () => {
		const root = makeTarget();
		try {
			seedPage(root, "vanishing-notes", "internal");
			const hash = pageRawHash(root, "vanishing-notes");
			registerExternalEffect(root, effectInput(), { now: NOW });
			const proposed = proposeExternalEffect(
				root,
				{
					id: "request/1",
					effect: { id: "effect/ticket-comment", version: "1" },
					payloadHash: `sha256:${"a".repeat(64)}`,
					payloadSources: [{ kind: "page", ref: "vanishing-notes", rawHash: hash }],
				},
				{ now: NOW },
			);
			assert.equal(proposed.ok, true);
			const authorized = authorize(root, "request/1", proposed.record.requestHash);
			assert.equal(authorized.ok, true);

			// The declared source leaves the snapshot after authorization.
			fs.rmSync(path.join(root, ".amber", "context", "pages", "vanishing-notes.json"), {
				force: true,
			});
			const drifted = executeExternalEffect(
				root,
				{ id: "execution/1", request: "request/1", credential: null },
				{ now: NOW },
			);
			assert.equal(drifted.ok, false);
			assert.match(drifted.errors[0], /AMBER_E_EXTERNAL_DRIFT|does not resolve/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
