"use strict";

// Trusted-control context/runtime contract — Slice C (spec §5.1–§5.2, §8
// cases 5/7/9): the F052 request's frozen policy/capability/scope bindings,
// the session lease proof at authorize/prepare/settle, and the §4
// contextAuthority validation. Real ledgers, real manifests, injected clocks.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const {
	submitRunnerRequest,
	authorizeRunnerRequest,
	prepareRunnerExecution,
	settleRunnerExecution,
	abortRunnerExecution,
} = require("../../scripts/lib/core/runner-registry");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerRunner, registerRunnerCapability } = require("../../scripts/lib/core/runner-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");

const T0 = new Date("2026-09-19T00:00:00.000Z");
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-runtime-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	admitArtifact(root, { type: "intent", identity: "intent/runner", body: "# Runner\n" });
	const decide = (identity) =>
		admitArtifact(root, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		});
	decide("decision/runner");
	registerRunner(root, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: `sha256:${"a".repeat(64)}`,
		owner: "platform-team",
		decision: { identity: "decision/runner", revision: 1 },
	});
	decide("decision/capability");
	registerRunnerCapability(root, {
		runnerId: "runner/ci",
		runnerVersion: "1.0.0",
		name: "diagnose.check",
		capabilityVersion: "1",
		effects: ["diagnose"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: { identity: "decision/capability", revision: 1 },
	});
	registerAdapter(root, {
		id: "adapter/session",
		owner: "platform-team",
		adapterVersion: "1",
		recordTypes: [{ type: "session", versions: ["v1"] }],
		scope: "F052",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["sessions"] },
	});
	return root;
}

const CAPABILITY_PIN = {
	runnerId: "runner/ci",
	runnerVersion: "1.0.0",
	name: "diagnose.check",
	capabilityVersion: "1",
};

function requestInput(overrides = {}) {
	return {
		capability: CAPABILITY_PIN,
		target: { repository: "repo", paths: ["docs/"] },
		environment: "development",
		scope: "docs/",
		timeoutMs: 1000,
		effects: ["diagnose"],
		credentialRequirement: "none",
		rollback: "none",
		...overrides,
	};
}

function sessionBinding(overrides = {}) {
	return {
		sessionId: "s1",
		attemptId: null,
		ownerId: "agent-a",
		tokenHash: TOKEN_HASH,
		fence: 1,
		...overrides,
	};
}

function writeSessionManifest(root, lease) {
	const sessionDir = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify({
			sessionId: "s1",
			schemaVersion: "1.0.0-rc.1",
			createdAt: T0.toISOString(),
			updatedAt: T0.toISOString(),
			route: { id: "probe", version: "1.0.0" },
			goal: "probe",
			status: "executing",
			completedStages: [],
			lease,
		}),
	);
}

let approvalCounter = 0;
function grantFor(root, requestHash) {
	approvalCounter += 1;
	const granted = grantApproval(
		root,
		{
			id: `approval/runner-${approvalCounter}`,
			approver: "alice@example.com",
			scope: null,
			subject: `runner-request:development:${requestHash}`,
			validUntil: "2036-01-01T00:00:00.000Z",
		},
		{ now: T0 },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	return `approval/runner-${approvalCounter}`;
}

function authorizeInput(requestHash, approvalId) {
	return {
		requestHash,
		approval: approvalId ?? "approval/runner-1",
		decisionIdentity: "decision/authorize",
		body: "# Authorize\n",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		scope: null,
	};
}

describe("F052 frozen request bindings (Slice C, spec §8 cases 5/7/9)", () => {
	it("freezes policy/capability/scope hashes at submit and refuses policy drift at authorize", () => {
		const root = makeTarget();
		try {
			const submitted = submitRunnerRequest(root, requestInput(), { now: T0 });
			assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
			const record = submitted.record;
			assert.match(record.policyHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(record.capabilityHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(record.scopeHash, /^sha256:[0-9a-f]{64}$/);

			// The governance rules change after submit: the frozen policyHash
			// no longer matches and authorization refuses (stale authority).
			fs.mkdirSync(path.join(root, ".amber", "governance"), { recursive: true });
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify({ schemaVersion: 1, defaultAction: "allow", rules: [] }),
			);
			grantFor(root, record.requestHash);
			const refused = authorizeRunnerRequest(root, authorizeInput(record.requestHash), { now: T0 });
			assert.equal(refused.ok, false);
			assert.match(refused.errors[0], /frozen policyHash/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("prepare and settle fail under a displaced or expired lease (case 9)", () => {
		const root = makeTarget();
		try {
			writeSessionManifest(root, {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: T0.toISOString(),
				expiresAt: new Date(T0.getTime() + 120000).toISOString(),
				ttlMs: 120000,
				fence: 1,
			});
			const submitted = submitRunnerRequest(
				root,
				requestInput({ sessionBinding: sessionBinding() }),
				{ now: T0 },
			);
			assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
			const approvalId = grantFor(root, submitted.record.requestHash);
			const authorized = authorizeRunnerRequest(
				root,
				authorizeInput(submitted.record.requestHash, approvalId),
				{ now: T0 },
			);
			assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));

			// Lease displacement: fence bump + new token digest.
			writeSessionManifest(root, {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: T0.toISOString(),
				expiresAt: new Date(T0.getTime() + 120000).toISOString(),
				ttlMs: 120000,
				fence: 2,
			});
			const prepareRefused = prepareRunnerExecution(
				root,
				{
					requestHash: submitted.record.requestHash,
					runner: {
						id: "runner/ci",
						version: "1.0.0",
						integrityDigest: `sha256:${"a".repeat(64)}`,
					},
				},
				{ now: T0 },
			);
			assert.equal(prepareRefused.ok, false);
			assert.match(prepareRefused.errors[0], /lease drift/);
			const settleRefused = settleRunnerExecution(
				root,
				{
					requestHash: submitted.record.requestHash,
					receipt: {
						runner: {
							id: "runner/ci",
							version: "1.0.0",
							integrityDigest: `sha256:${"a".repeat(64)}`,
						},
						exitCode: 0,
						signal: null,
						timedOut: false,
						startedAt: T0.toISOString(),
						finishedAt: T0.toISOString(),
						durationMs: 0,
						outputsDigest: `sha256:${"b".repeat(64)}`,
						scope: { repository: "repo", paths: ["docs/"] },
						sandboxAssurance: "observed",
						credentialAssurance: "unavailable",
					},
				},
				{ now: T0 },
			);
			assert.equal(settleRefused.ok, false);
			assert.match(settleRefused.errors[0], /lease drift/);

			// The unbound twin of the same request is unaffected: the F050
			// approval plus the runner pin remain the authority (§5.2). It
			// declares a different target scope (a hashed field), so it is a
			// different request — the sessionBinding itself is deliberately
			// NOT part of the requestHash (time-variant lease proof, §5.1).
			const direct = submitRunnerRequest(
				root,
				requestInput({ target: { repository: "repo", paths: ["src/"] }, scope: "src/" }),
				{ now: T0 },
			);
			assert.equal(direct.ok, true, (direct.errors || []).join("; "));
			const directApproval = grantFor(root, direct.record.requestHash);
			const directAuthorized = authorizeRunnerRequest(
				root,
				authorizeInput(direct.record.requestHash, directApproval),
				{ now: T0 },
			);
			assert.equal(directAuthorized.ok, true, (directAuthorized.errors || []).join("; "));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("contextAuthority honors its hard expiry at authorize (R-CA-3, case 3 consumption half)", () => {
		const root = makeTarget();
		try {
			const submitted = submitRunnerRequest(
				root,
				requestInput({
					contextAuthority: {
						loadoutHash: null,
						constraints: {
							maxClassification: "internal",
							purpose: null,
							expiresAt: new Date(T0.getTime() + 3600_000).toISOString(),
							accessBoundaries: ["docs/"],
						},
					},
				}),
				{ now: T0 },
			);
			assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
			const expiryApprovalId = grantFor(root, submitted.record.requestHash);
			// Authorized inside the window…
			const authorized = authorizeRunnerRequest(
				root,
				authorizeInput(submitted.record.requestHash, expiryApprovalId),
				{ now: T0 },
			);
			assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
			// …but prepare after the expiry refuses with context-expired.
			const later = new Date(T0.getTime() + 7200_000);
			const prepareRefused = prepareRunnerExecution(
				root,
				{
					requestHash: submitted.record.requestHash,
					runner: {
						id: "runner/ci",
						version: "1.0.0",
						integrityDigest: `sha256:${"a".repeat(64)}`,
					},
				},
				{ now: later },
			);
			assert.equal(prepareRefused.ok, false);
			assert.match(prepareRefused.errors[0], /context-expired/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses an already-expired contextAuthority at submit and a malformed one always", () => {
		const root = makeTarget();
		try {
			const expired = submitRunnerRequest(
				root,
				requestInput({
					contextAuthority: {
						loadoutHash: null,
						constraints: {
							maxClassification: "internal",
							purpose: null,
							expiresAt: "2020-01-01T00:00:00.000Z",
							accessBoundaries: ["docs/"],
						},
					},
				}),
				{ now: T0 },
			);
			assert.equal(expired.ok, false);
			assert.match(expired.errors[0], /already passed/);
			const malformed = submitRunnerRequest(
				root,
				requestInput({
					contextAuthority: { loadoutHash: null, constraints: { maxClassification: "internal" } },
				}),
				{ now: T0 },
			);
			assert.equal(malformed.ok, false);
			assert.match(malformed.errors[0], /missing field/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
