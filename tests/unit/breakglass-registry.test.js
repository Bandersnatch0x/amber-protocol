"use strict";

// F057 T1 (#292) — break-glass grant registry with human-only emergency
// authorization.
//
// Tests assert externally visible behavior: a grant binds one verified
// registered capability behind a single-use committed human Decision, is
// bounded to a short half-open validity window with a mandatory
// post-review deadline, derives its status read-time at the injected
// clock (revocation always wins, history is never rewritten), and every
// tamper or forgery fails reads closed with stable AMBER_E_BREAKGLASS_*
// codes.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	useBreakGlass,
	settleBreakGlass,
	reviewBreakGlass,
	breakGlassStatus,
	BREAKGLASS_SCHEMA_VERSION,
	SUPPORTED_BREAKGLASS_SCHEMA_VERSIONS,
	DEFAULT_MAX_BREAKGLASS_BYTES,
	MAX_BREAKGLASS_WINDOW_MS,
	MAX_REVIEW_DELAY_MS,
	BREAKGLASS_CAPABILITY_KINDS,
	BREAKGLASS_CREDENTIALS,
	BREAKGLASS_RISKS,
	BREAKGLASS_DECISION_KINDS,
	GRANT_STATUSES,
	GENESIS_HASH,
	chainHash,
	grantsPath,
	grantBreakGlass,
	revokeBreakGlass,
	showBreakGlassGrant,
	listBreakGlassGrants,
} = require("../../scripts/lib/core/breakglass-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const {
	registerExternalEffect,
	proposeExternalEffect,
	authorizeExternalEffect,
	executeExternalEffect,
	settleExternalExecution,
} = require("../../scripts/lib/core/external-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const {
	registerRunner,
	registerRunnerCapability,
	submitRunnerRequest,
	authorizeRunnerRequest,
	prepareRunnerExecution,
	settleRunnerExecution,
} = require("../../scripts/lib/core/runner-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-breakglass-${label}-`));
}

const NOW = new Date("2026-08-29T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const JWT_LIKE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";

/** Principal + intent + one committed human Decision per identity. */
function decisionsFixture(dir, identities) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/breakglass", body: "# B\n" }).ok,
		true,
	);
	for (const identity of identities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
}

/** Decisions + one registered F056 external effect the grant can pin. */
function grantFixture(dir, identities = ["decision/breakglass-1", "decision/effect-1"]) {
	decisionsFixture(dir, identities);
	assert.equal(
		registerAdapter(dir, {
			id: "adapter/tracker",
			owner: "platform-team",
			adapterVersion: "1",
			recordTypes: [{ type: "ticket", versions: ["v1"] }],
			scope: "F057",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["tracker"] },
		}).ok,
		true,
	);
	assert.equal(
		registerExternalEffect(
			dir,
			{
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
			},
			{ now: NOW },
		).ok,
		true,
	);
}

function grantInput(overrides = {}) {
	return {
		id: "breakglass/incident-42-restore",
		incident: "incident/42",
		purpose: "restore-login-service",
		capability: { kind: "external", id: "effect/ticket-comment", version: "1" },
		target: "tracker/amber-protocol",
		scope: "issues",
		environment: "production",
		risk: "high",
		credentials: "scoped",
		validFrom: NOW.toISOString(),
		validUntil: new Date(NOW.getTime() + HOUR_MS).toISOString(),
		reviewBy: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString(),
		decision: { identity: "decision/breakglass-1", revision: 1 },
		...overrides,
	};
}

function readEvents(ledgerPath) {
	return fs
		.readFileSync(ledgerPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

function writeEvents(ledgerPath, events) {
	fs.writeFileSync(ledgerPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

test("break-glass constants pin the vocabulary and bound contracts", () => {
	assert.equal(BREAKGLASS_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_BREAKGLASS_SCHEMA_VERSIONS], [1]);
	assert.equal(DEFAULT_MAX_BREAKGLASS_BYTES, 1024 * 1024);
	assert.equal(MAX_BREAKGLASS_WINDOW_MS, 24 * 3_600_000);
	assert.equal(MAX_REVIEW_DELAY_MS, 30 * 24 * 3_600_000);
	assert.deepEqual([...BREAKGLASS_CAPABILITY_KINDS], ["runner", "external"]);
	assert.deepEqual([...BREAKGLASS_CREDENTIALS], ["none", "scoped"]);
	assert.deepEqual([...BREAKGLASS_RISKS], ["low", "medium", "high", "critical"]);
	assert.deepEqual([...BREAKGLASS_DECISION_KINDS], ["acceptance", "approval"]);
	assert.deepEqual([...GRANT_STATUSES], ["granted", "used", "revoked", "expired"]);
});

test("grant binds a verified capability behind a single-use human Decision", () => {
	const dir = mkTarget("grant");
	grantFixture(dir);
	const granted = grantBreakGlass(dir, grantInput(), { now: NOW });
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	assert.equal(granted.record.id, "breakglass/incident-42-restore");
	assert.equal(granted.record.incident, "incident/42");
	assert.equal(granted.record.purpose, "restore-login-service");
	assert.deepEqual(granted.record.capability, {
		kind: "external",
		id: "effect/ticket-comment",
		version: "1",
	});
	assert.equal(granted.record.target, "tracker/amber-protocol");
	assert.equal(granted.record.environment, "production");
	assert.equal(granted.record.risk, "high");
	assert.equal(granted.record.credentials, "scoped");
	assert.equal(granted.record.status, "granted");
	assert.equal(granted.record.revocation, null);
	assert.deepEqual(granted.record.decision, {
		identity: "decision/breakglass-1",
		revision: 1,
		decisionKind: "approval",
		principal: "legal@example.com",
	});
	const events = readEvents(grantsPath(dir));
	assert.equal(events.length, 1);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(chainHash(events[0], GENESIS_HASH), events[0].hash);
	assert.equal(
		showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: NOW }).status,
		"granted",
	);
	assert.equal(listBreakGlassGrants(dir, { status: "granted", now: NOW }).length, 1);
	const duplicate = grantBreakGlass(
		dir,
		grantInput({ decision: { identity: "decision/effect-1", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(duplicate.ok, false);
	assert.match(duplicate.errors[0], /already exists; an emergency authorization is never reused/);
});

test("a runner capability pin verifies against the runner registry", () => {
	const dir = mkTarget("runner-pin");
	grantFixture(dir, [
		"decision/breakglass-1",
		"decision/effect-1",
		"decision/runner-1",
		"decision/cap-1",
	]);
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: `sha256:${"a".repeat(64)}`,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
	const ghost = grantBreakGlass(
		dir,
		grantInput({
			capability: {
				kind: "runner",
				runnerId: "runner/ghost",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
		}),
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_BREAKGLASS_INVALID");
	assert.match(ghost.errors[0], /runner "runner\/ghost" is not registered/);
	const granted = grantBreakGlass(
		dir,
		grantInput({
			capability: {
				kind: "runner",
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
		}),
		{ now: NOW },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));
	assert.equal(granted.record.capability.kind, "runner");
});

test("the closed grant shape refuses smuggling, leaks, and unbounded windows", () => {
	const dir = mkTarget("shape");
	grantFixture(dir);
	const cases = [
		[grantInput({ force: true }), /unknown field "force"/],
		[grantInput({ risk: "extreme" }), /risk must be one of/],
		[grantInput({ credentials: "standing" }), /credentials must be one of/],
		[grantInput({ target: "https://evil.example/hook" }), /must not carry a URL scheme/],
		[grantInput({ purpose: "run this; rm -rf /" }), /cannot ride an emergency grant/],
		[grantInput({ scope: "issues/../../secrets" }), /must not carry a ".." path segment/],
		[grantInput({ validUntil: NOW.toISOString() }), /validUntil must be strictly after validFrom/],
		[
			grantInput({ validUntil: new Date(NOW.getTime() + 25 * HOUR_MS).toISOString() }),
			/validity window must not exceed/,
		],
		[
			grantInput({ reviewBy: new Date(NOW.getTime() + HOUR_MS).toISOString() }),
			/reviewBy must be strictly after validUntil/,
		],
		[
			grantInput({ reviewBy: new Date(NOW.getTime() + 32 * 24 * HOUR_MS).toISOString() }),
			/reviewBy must be within/,
		],
		[
			grantInput({ capability: { kind: "shell", command: "bash" } }),
			/kind must be one of runner, external — break-glass reaches only registered capabilities/,
		],
		[
			grantInput({ capability: { kind: "external", id: "effect/ghost", version: "1" } }),
			/is not registered; break-glass reaches only registered capabilities/,
		],
	];
	for (const [input, pattern] of cases) {
		const refused = grantBreakGlass(dir, input, { now: NOW });
		assert.equal(refused.ok, false, JSON.stringify(input));
		assert.equal(refused.code, "AMBER_E_BREAKGLASS_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	// Credential-looking material carries its own stable code: the audit
	// trail refuses secrets loudly, not as a generic shape error.
	const leaked = grantBreakGlass(dir, grantInput({ incident: JWT_LIKE }), { now: NOW });
	assert.equal(leaked.ok, false);
	assert.equal(leaked.code, "AMBER_E_BREAKGLASS_CREDENTIAL_LEAK");
	// The window anchors to the grant instant: no backdating, no deferred
	// standing authorization.
	const backdated = grantBreakGlass(
		dir,
		grantInput({ validFrom: new Date(NOW.getTime() - 1).toISOString() }),
		{ now: NOW },
	);
	assert.equal(backdated.ok, false);
	assert.match(backdated.errors[0], /cannot backdate its window/);
	const deferred = grantBreakGlass(
		dir,
		grantInput({
			validFrom: new Date(NOW.getTime() + 25 * HOUR_MS).toISOString(),
			validUntil: new Date(NOW.getTime() + 26 * HOUR_MS).toISOString(),
			reviewBy: new Date(NOW.getTime() + 96 * HOUR_MS).toISOString(),
		}),
		{ now: NOW },
	);
	assert.equal(deferred.ok, false);
	assert.match(deferred.errors[0], /a deferred window is a standing authorization/);
	// A corrupt capability source registry passes its corrupt code through.
	const { effectsPath } = require("../../scripts/lib/core/external-registry");
	fs.appendFileSync(effectsPath(dir), '{"kind":"effect"}\n');
	const corruptSource = grantBreakGlass(dir, grantInput(), { now: NOW });
	assert.equal(corruptSource.ok, false);
	assert.equal(corruptSource.code, "AMBER_E_EXTERNAL_CORRUPT");
	assert.equal(fs.existsSync(grantsPath(dir)), false);
});

test("grant authority requires an unscoped committed human Decision and is single-use", () => {
	const dir = mkTarget("authority");
	grantFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "bot@example.com", principalKind: "service" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/review-1",
			body: "# Review\n",
			decisionKind: "review",
			principal: "bot@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		}).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scoped",
			body: "# S\n",
			scope: "session/1",
		}).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/scoped-1",
			body: "# Scoped\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			scope: "session/1",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/scoped" } }],
		}).ok,
		true,
	);
	const cases = [
		[{ identity: "decision/ghost", revision: 1 }, /is not a committed Decision artifact/],
		[{ identity: "decision/review-1", revision: 1 }, /carries decisionKind "review"/],
		[{ identity: "decision/scoped-1", revision: 1 }, /is scoped to "session\/1"/],
	];
	for (const [decision, pattern] of cases) {
		const refused = grantBreakGlass(dir, grantInput({ decision }), { now: NOW });
		assert.equal(refused.ok, false, JSON.stringify(decision));
		assert.equal(refused.code, "AMBER_E_BREAKGLASS_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	// An Agent or executor cannot self-grant: acceptance/approval Decision
	// slots are human-only at admission, so a service principal never
	// reaches the grant authority at all.
	const selfGrant = admitArtifact(dir, {
		type: "decision",
		identity: "decision/self-grant",
		body: "# Self grant\n",
		decisionKind: "approval",
		principal: "bot@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
	});
	assert.equal(selfGrant.ok, false);
	assert.match((selfGrant.errors || []).join("; "), /human/i);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	// The same Decision cannot authorize a second act — not even a
	// revocation.
	const reused = revokeBreakGlass(
		dir,
		{
			id: "breakglass/incident-42-restore",
			reason: "no longer needed",
			decision: { identity: "decision/breakglass-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(reused.ok, false);
	assert.match(reused.errors[0], /already authorized grant .*single-use/);
});

test("revocation immediately blocks and preserves the original grant", () => {
	const dir = mkTarget("revoke");
	grantFixture(dir, ["decision/breakglass-1", "decision/effect-1", "decision/breakglass-revoke-1"]);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const ghost = revokeBreakGlass(
		dir,
		{
			id: "breakglass/ghost",
			reason: "compromise",
			decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_BREAKGLASS_NOT_FOUND");
	const leakyReason = revokeBreakGlass(
		dir,
		{
			id: "breakglass/incident-42-restore",
			reason: `token=${JWT_LIKE}`,
			decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(leakyReason.ok, false);
	assert.equal(leakyReason.code, "AMBER_E_BREAKGLASS_CREDENTIAL_LEAK");
	assert.match(leakyReason.errors[0], /credential material/);
	const revoked = revokeBreakGlass(
		dir,
		{
			id: "breakglass/incident-42-restore",
			reason: "credential compromise suspected",
			decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(revoked.ok, true, (revoked.errors || []).join("; "));
	assert.equal(revoked.record.status, "revoked");
	assert.equal(revoked.record.revocation.reason, "credential compromise suspected");
	// The original grant content is preserved untouched.
	assert.equal(revoked.record.capability.id, "effect/ticket-comment");
	assert.equal(revoked.record.validUntil, grantInput().validUntil);
	assert.equal(listBreakGlassGrants(dir, { status: "revoked", now: NOW }).length, 1);
	const again = revokeBreakGlass(
		dir,
		{
			id: "breakglass/incident-42-restore",
			reason: "again",
			decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
		},
		{ now: NOW },
	);
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already revoked; history is never rewritten/);
});

test("expiry derives read-time from the half-open window and preserves the grant", () => {
	const dir = mkTarget("expiry");
	grantFixture(dir);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const boundary = new Date(NOW.getTime() + HOUR_MS);
	const beforeBoundary = new Date(boundary.getTime() - 1);
	// Documented latitude: before the window opens the grant still reads
	// "granted" — the fixed status vocabulary holds, and consumption (T2)
	// separately refuses outside [validFrom, validUntil).
	assert.equal(
		showBreakGlassGrant(dir, "breakglass/incident-42-restore", {
			now: new Date(NOW.getTime() - 1),
		}).status,
		"granted",
	);
	assert.equal(
		showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: beforeBoundary }).status,
		"granted",
	);
	// Half-open [validFrom, validUntil): expiry lands at exactly validUntil.
	const expired = showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: boundary });
	assert.equal(expired.status, "expired");
	assert.equal(expired.capability.id, "effect/ticket-comment");
	assert.equal(listBreakGlassGrants(dir, { status: "expired", now: boundary }).length, 1);
	assert.equal(listBreakGlassGrants(dir, { status: "granted", now: boundary }).length, 0);
});

test("a tampered grant ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	grantFixture(dir);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const pristine = readEvents(grantsPath(dir));
	const tampered = JSON.parse(JSON.stringify(pristine));
	tampered[0].risk = "low";
	writeEvents(grantsPath(dir), tampered);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: NOW }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	// A validly re-chained forgery with a smuggled field fails the closed
	// shape: a wider grant cannot ride a consistently re-hashed ledger.
	const { hash: _hash, ...rest } = pristine[0];
	const forged = { ...rest, sudo: true };
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(grantsPath(dir), [forged]);
	assert.throws(
		() => showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: NOW }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" && /unknown field "sudo"/.test(err.message),
	);
	// A validly re-chained revocation of a grant that never existed fails
	// the fold closed too.
	const forgedRevoke = {
		kind: "revoke",
		schemaVersion: 1,
		at: NOW.toISOString(),
		id: "breakglass/ghost",
		reason: "forged",
		decision: {
			identity: "decision/forged",
			revision: 1,
			decisionKind: "approval",
			principal: "legal@example.com",
		},
		prevHash: pristine[0].hash,
	};
	forgedRevoke.hash = chainHash(forgedRevoke, forgedRevoke.prevHash);
	writeEvents(grantsPath(dir), [...pristine, forgedRevoke]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: NOW }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" && /revokes unknown grant/.test(err.message),
	);
});

test("a fresh grant lock held by another writer refuses granting", () => {
	const dir = mkTarget("lock");
	grantFixture(dir);
	const lockPath = path.join(dir, ".amber", "breakglass", "grants.lock");
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	fs.writeFileSync(lockPath, "holder-token-1");
	const contended = grantBreakGlass(dir, grantInput(), { now: NOW });
	assert.equal(contended.ok, false);
	assert.equal(contended.code, "AMBER_E_BREAKGLASS_LOCK");
	fs.rmSync(lockPath);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
});

test("the grant ledger byte ceiling refuses growth without writing", () => {
	const dir = mkTarget("ceiling");
	grantFixture(dir);
	process.env.AMBER_BREAKGLASS_MAX_GRANTS_BYTES = "64";
	try {
		const capped = grantBreakGlass(dir, grantInput(), { now: NOW });
		assert.equal(capped.ok, false);
		assert.equal(capped.code, "AMBER_E_BREAKGLASS_SIZE_CEILING");
		assert.equal(fs.existsSync(grantsPath(dir)), false);
	} finally {
		delete process.env.AMBER_BREAKGLASS_MAX_GRANTS_BYTES;
	}
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
});

// ---------------------------------------------------------------------------
// F057 T2 (#293) — atomic one-use consumption bound to the underlying
// admission.
// ---------------------------------------------------------------------------

const USE_AT = new Date(NOW.getTime() + 30 * 60_000);

/** Grant + an AUTHORIZED underlying F056 proposal matching it exactly. */
function usableGrantFixture(dir) {
	grantFixture(dir, ["decision/breakglass-1", "decision/effect-1"]);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: `sha256:${"a".repeat(64)}`,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true, (proposed.errors || []).join("; "));
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/external-1",
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${proposed.record.requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize external effect\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	return proposed.record.requestHash;
}

test("use spends the grant atomically with the authorized underlying admission", () => {
	const dir = mkTarget("use");
	const requestHash = usableGrantFixture(dir);
	const ghost = useBreakGlass(
		dir,
		{ id: "breakglass/ghost", reference: "request/1" },
		{ now: USE_AT },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_BREAKGLASS_NOT_FOUND");
	const used = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: USE_AT },
	);
	assert.equal(used.ok, true, (used.errors || []).join("; "));
	assert.equal(used.record.status, "used");
	assert.deepEqual(used.record.use.reference, { kind: "external", id: "request/1" });
	assert.equal(used.record.use.requestHash, requestHash);
	// One-use: a spent grant refuses every later use — replay is
	// impossible even with a different reference.
	const again = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: USE_AT },
	);
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /is already used; a break-glass authorization is one-use/);
	// A used grant is terminal: it cannot be revoked either.
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/breakglass-revoke-1",
			body: "# revoke\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		}).ok,
		true,
	);
	const revokeUsed = revokeBreakGlass(
		dir,
		{
			id: "breakglass/incident-42-restore",
			reason: "too late",
			decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
		},
		{ now: USE_AT },
	);
	assert.equal(revokeUsed.ok, false);
	assert.match(revokeUsed.errors[0], /is already used; a spent authorization ended through use/);
	assert.equal(
		showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: USE_AT }).status,
		"used",
	);
	assert.equal(listBreakGlassGrants(dir, { status: "used", now: USE_AT }).length, 1);
});

test("a failed admission never consumes and a grant cannot widen itself", () => {
	const dir = mkTarget("no-widen");
	usableGrantFixture(dir);
	const cases = [
		[{ id: "breakglass/incident-42-restore", reference: "request/ghost" }, /does not exist/],
	];
	for (const [input, pattern] of cases) {
		const refused = useBreakGlass(dir, input, { now: USE_AT });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "AMBER_E_BREAKGLASS_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	// An unauthorized proposal refuses: break-glass never substitutes for
	// the underlying authorization.
	assert.equal(
		proposeExternalEffect(
			dir,
			{
				id: "request/2",
				effect: { id: "effect/ticket-comment", version: "1" },
				payloadHash: `sha256:${"b".repeat(64)}`,
			},
			{ now: NOW },
		).ok,
		true,
	);
	const unauthorized = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/2" },
		{ now: USE_AT },
	);
	assert.equal(unauthorized.ok, false);
	assert.match(unauthorized.errors[0], /never substitutes for the underlying authorization/);
	// A reference riding a DIFFERENT effect refuses: the grant pinned one
	// capability and can never widen to another.
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/effect-2",
			body: "# decision/effect-2\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		}).ok,
		true,
	);
	assert.equal(
		registerExternalEffect(
			dir,
			{
				id: "effect/announce",
				version: "1",
				owner: "platform-team",
				system: "notification",
				operation: "message.post",
				target: "tracker/amber-protocol",
				scope: "issues",
				inputSchema: { type: "object", required: ["body"] },
				idempotency: "idempotent",
				credentials: "scoped",
				receiptFields: ["messageId"],
				compensation: { kind: "irreversible" },
				timeoutMs: 30_000,
				adapter: { id: "adapter/tracker", version: "1" },
				decision: { identity: "decision/effect-2", revision: 1 },
			},
			{ now: NOW },
		).ok,
		true,
	);
	const proposedOther = proposeExternalEffect(
		dir,
		{
			id: "request/3",
			effect: { id: "effect/announce", version: "1" },
			payloadHash: `sha256:${"c".repeat(64)}`,
		},
		{ now: NOW },
	);
	assert.equal(proposedOther.ok, true, (proposedOther.errors || []).join("; "));
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/external-2",
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${proposedOther.record.requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/3",
				approval: "approval/external-2",
				decisionIdentity: "decision/external-consume-2",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	const widened = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/3" },
		{ now: USE_AT },
	);
	assert.equal(widened.ok, false);
	assert.equal(widened.code, "AMBER_E_BREAKGLASS_INVALID");
	assert.match(widened.errors[0], /rides effect "effect\/announce"@1, not the granted capability/);
	// Every refusal left the grant unconsumed.
	assert.equal(
		showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: USE_AT }).status,
		"granted",
	);
	// Consuming succeeds afterwards: nothing was spent by the failures.
	assert.equal(
		useBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", reference: "request/1" },
			{ now: USE_AT },
		).ok,
		true,
	);
});

test("use refuses outside the half-open window and after revocation", () => {
	const dir = mkTarget("window");
	usableGrantFixture(dir);
	const notYet = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: new Date(NOW.getTime() - 1) },
	);
	assert.equal(notYet.ok, false);
	assert.match(notYet.errors[0], /is not valid yet; the window opens at/);
	// Half-open boundary: exactly validUntil refuses.
	const boundary = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: new Date(NOW.getTime() + HOUR_MS) },
	);
	assert.equal(boundary.ok, false);
	assert.match(boundary.errors[0], /expired at .*; emergency authority never outlives its window/);
	const lastInstant = new Date(NOW.getTime() + HOUR_MS - 1);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/breakglass-revoke-1",
			body: "# revoke\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		}).ok,
		true,
	);
	assert.equal(
		revokeBreakGlass(
			dir,
			{
				id: "breakglass/incident-42-restore",
				reason: "compromise",
				decision: { identity: "decision/breakglass-revoke-1", revision: 1 },
			},
			{ now: USE_AT },
		).ok,
		true,
	);
	const revoked = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: lastInstant },
	);
	assert.equal(revoked.ok, false);
	assert.match(revoked.errors[0], /revocation blocks future use immediately/);
});

test("re-chained double-use and out-of-window use forgeries fail every read closed", () => {
	const dir = mkTarget("use-tamper");
	usableGrantFixture(dir);
	assert.equal(
		useBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", reference: "request/1" },
			{ now: USE_AT },
		).ok,
		true,
	);
	const pristine = readEvents(grantsPath(dir));
	// A validly re-chained second use of the spent grant fails the fold.
	const duplicate = { ...pristine[1] };
	delete duplicate.hash;
	duplicate.prevHash = pristine[1].hash;
	duplicate.hash = chainHash(duplicate, duplicate.prevHash);
	writeEvents(grantsPath(dir), [...pristine, duplicate]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: USE_AT }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/uses a spent grant; a break-glass authorization is one-use/.test(err.message),
	);
	// A changed request hash is an in-place rewrite: the hash chain
	// fails the read closed.
	const changedHash = JSON.parse(JSON.stringify(pristine));
	changedHash[1].requestHash = `sha256:${"f".repeat(64)}`;
	writeEvents(grantsPath(dir), changedHash);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: USE_AT }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	// A validly re-chained use forged with the wrong reference kind fails
	// the re-derivation against the granted capability kind.
	const { hash: _kindHash, ...kindBody } = pristine[1];
	const wrongKind = {
		...kindBody,
		reference: { kind: "runner", id: kindBody.reference.id },
	};
	wrongKind.hash = chainHash(wrongKind, wrongKind.prevHash);
	writeEvents(grantsPath(dir), [pristine[0], wrongKind]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: USE_AT }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/not the granted "external" capability/.test(err.message),
	);
	// A validly re-chained use rewritten outside the window fails closed:
	// the use instant is re-derivable against the grant window.
	const { hash: _hash, ...useBody } = pristine[1];
	const outside = { ...useBody, at: new Date(NOW.getTime() + 2 * HOUR_MS).toISOString() };
	outside.hash = chainHash(outside, outside.prevHash);
	writeEvents(grantsPath(dir), [pristine[0], outside]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: USE_AT }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/outside its validity window/.test(err.message),
	);
});

test("concurrent lock contention refuses use without consuming", () => {
	const dir = mkTarget("use-lock");
	usableGrantFixture(dir);
	const lockPath = path.join(dir, ".amber", "breakglass", "grants.lock");
	fs.writeFileSync(lockPath, "holder-token-1");
	const contended = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: "request/1" },
		{ now: USE_AT },
	);
	assert.equal(contended.ok, false);
	assert.equal(contended.code, "AMBER_E_BREAKGLASS_LOCK");
	fs.rmSync(lockPath);
	assert.equal(
		useBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", reference: "request/1" },
			{ now: USE_AT },
		).ok,
		true,
	);
});

test("a runner-capability grant admits only the matching authorized runner request", () => {
	const dir = mkTarget("runner-use");
	decisionsFixture(dir, [
		"decision/breakglass-1",
		"decision/breakglass-2",
		"decision/runner-1",
		"decision/cap-1",
	]);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: `sha256:${"a".repeat(64)}`,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		recordEvidence(dir, {
			id: "evidence/rehearsal-1",
			producer: "carol@example.com",
			assurance: "observed",
			scope: "F052",
			subject: "staging rollback rehearsal",
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		}).ok,
		true,
	);
	const runnerPin = {
		kind: "runner",
		runnerId: "runner/ci",
		runnerVersion: "1.0.0",
		name: "deploy.staging-web",
		capabilityVersion: "1",
	};
	assert.equal(
		grantBreakGlass(
			dir,
			grantInput({
				capability: runnerPin,
				target: "repo/main",
				scope: "deploy",
				environment: "staging",
			}),
			{ now: NOW },
		).ok,
		true,
	);
	// A second grant in a different environment cannot admit the same
	// request: environment is an equality axis for runner references.
	assert.equal(
		grantBreakGlass(
			dir,
			grantInput({
				id: "breakglass/incident-42-prod",
				capability: runnerPin,
				target: "repo/main",
				scope: "deploy",
				environment: "production",
				decision: { identity: "decision/breakglass-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const submitted = submitRunnerRequest(
		dir,
		{
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
			target: { repository: "repo/main", paths: ["deploy/staging/web"] },
			scope: "deploy",
			environment: "staging",
			inputHashes: [`sha256:${"b".repeat(64)}`],
			timeoutMs: 300_000,
			effects: ["deploy"],
			credentialRequirement: "scoped",
			credential: {
				handle: "cred-7f3a",
				purpose: "staging-deploy",
				scope: "deploy/staging",
				expiresAt: new Date(NOW.getTime() + 12 * HOUR_MS).toISOString(),
			},
			rehearsal: "evidence/rehearsal-1",
			rollback: "runbook/staging-rollback",
		},
		{ now: NOW },
	);
	assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
	const hash = submitted.record.requestHash;
	// An unauthorized runner request refuses without consuming.
	const unauthorized = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: hash },
		{ now: USE_AT },
	);
	assert.equal(unauthorized.ok, false);
	assert.match(unauthorized.errors[0], /never substitutes for the underlying authorization/);
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/req-1",
				approver: "bob@example.com",
				scope: null,
				subject: submitted.record.approvalBinding,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		authorizeRunnerRequest(
			dir,
			{
				requestHash: hash,
				approval: "approval/req-1",
				decisionIdentity: "decision/req-1",
				body: "# Authorize request\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
				scope: null,
			},
			{ now: NOW },
		).ok,
		true,
	);
	// The wrong-environment grant refuses: a grant cannot widen itself.
	const wrongEnvironment = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-prod", reference: hash },
		{ now: USE_AT },
	);
	assert.equal(wrongEnvironment.ok, false);
	assert.match(
		wrongEnvironment.errors[0],
		/runs in environment "staging", not the granted "production"/,
	);
	const used = useBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", reference: hash },
		{ now: USE_AT },
	);
	assert.equal(used.ok, true, (used.errors || []).join("; "));
	assert.deepEqual(used.record.use.reference, { kind: "runner", id: hash });
	assert.equal(used.record.use.requestHash, hash);
});

// ---------------------------------------------------------------------------
// F057 T3 (#294) — outcome settlement linkage & mandatory post-review.
// ---------------------------------------------------------------------------

test("settlement binds the used grant to the real underlying receipt", () => {
	const dir = mkTarget("settle");
	usableGrantFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "auditor@example.com", principalKind: "service" }).ok,
		true,
	);
	// Settlement follows use.
	const premature = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/1" },
		{ now: USE_AT },
	);
	assert.equal(premature.ok, false);
	assert.match(premature.errors[0], /was never used; settlement follows use/);
	assert.equal(
		useBreakGlass(
			dir,
			{ id: "breakglass/incident-42-restore", reference: "request/1" },
			{ now: USE_AT },
		).ok,
		true,
	);
	// A claim without a real reference refuses.
	const ghost = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/ghost" },
		{ now: USE_AT },
	);
	assert.equal(ghost.ok, false);
	assert.match(ghost.errors[0], /never substitutes a claim for execution Evidence/);
	// The underlying execution must be SETTLED first: missing output
	// never means success.
	assert.equal(
		executeExternalEffect(
			dir,
			{
				id: "execution/1",
				request: "request/1",
				credential: {
					purpose: "comment.create",
					scope: "tracker/amber-protocol",
					expiresAt: new Date(USE_AT.getTime() + 30_000).toISOString(),
				},
			},
			{ now: USE_AT },
		).ok,
		true,
	);
	const unsettled = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/1" },
		{ now: USE_AT },
	);
	assert.equal(unsettled.ok, false);
	assert.match(unsettled.errors[0], /is not settled; missing output never means success/);
	assert.equal(
		settleExternalExecution(
			dir,
			{
				id: "execution/1",
				externalRecordId: "TRACK-1234",
				requestDigest: `sha256:${"d".repeat(64)}`,
				responseDigest: `sha256:${"e".repeat(64)}`,
				declared: "committed",
			},
			{ now: USE_AT },
		).ok,
		true,
	);
	// An execution settling a DIFFERENT request refuses: the receipt must
	// settle exactly the admitted request.
	assert.equal(
		proposeExternalEffect(
			dir,
			{
				id: "request/other",
				effect: { id: "effect/ticket-comment", version: "1" },
				payloadHash: `sha256:${"9".repeat(64)}`,
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/external-other",
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${showBreakGlassGrant(dir, "breakglass/incident-42-restore", { now: USE_AT }) && require("../../scripts/lib/core/external-registry").showExternalProposal(dir, "request/other").requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/other",
				approval: "approval/external-other",
				decisionIdentity: "decision/external-consume-other",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		executeExternalEffect(
			dir,
			{
				id: "execution/other",
				request: "request/other",
				credential: {
					purpose: "comment.create",
					scope: "tracker/amber-protocol",
					expiresAt: new Date(USE_AT.getTime() + 30_000).toISOString(),
				},
			},
			{ now: USE_AT },
		).ok,
		true,
	);
	assert.equal(
		settleExternalExecution(
			dir,
			{
				id: "execution/other",
				externalRecordId: "TRACK-OTHER",
				requestDigest: `sha256:${"d".repeat(64)}`,
				responseDigest: `sha256:${"e".repeat(64)}`,
				declared: "committed",
			},
			{ now: USE_AT },
		).ok,
		true,
	);
	const wrongRequest = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/other" },
		{ now: USE_AT },
	);
	assert.equal(wrongRequest.ok, false);
	assert.match(wrongRequest.errors[0], /settles request "request\/other", not the admitted/);
	const settled = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/1" },
		{ now: USE_AT },
	);
	assert.equal(settled.ok, true, (settled.errors || []).join("; "));
	assert.deepEqual(settled.record.settlement.receipt, { kind: "external", id: "execution/1" });
	assert.equal(settled.record.settlement.outcome, "committed");
	assert.deepEqual(settled.record.settlement.remedy, { kind: "irreversible", reference: null });
	const again = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: "execution/1" },
		{ now: USE_AT },
	);
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already settled; emergency history is never rewritten/);
});

test("a runner settlement links the derived terminal status and rollback declaration", () => {
	const dir = mkTarget("runner-settle");
	decisionsFixture(dir, ["decision/breakglass-1", "decision/runner-1", "decision/cap-1"]);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }).ok,
		true,
	);
	const DIGEST = `sha256:${"a".repeat(64)}`;
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 600_000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		recordEvidence(dir, {
			id: "evidence/rehearsal-1",
			producer: "carol@example.com",
			assurance: "observed",
			scope: "F052",
			subject: "staging rollback rehearsal",
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		}).ok,
		true,
	);
	assert.equal(
		grantBreakGlass(
			dir,
			grantInput({
				capability: {
					kind: "runner",
					runnerId: "runner/ci",
					runnerVersion: "1.0.0",
					name: "deploy.staging-web",
					capabilityVersion: "1",
				},
				target: "repo/main",
				scope: "deploy",
				environment: "staging",
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const submitted = submitRunnerRequest(
		dir,
		{
			capability: {
				runnerId: "runner/ci",
				runnerVersion: "1.0.0",
				name: "deploy.staging-web",
				capabilityVersion: "1",
			},
			target: { repository: "repo/main", paths: ["deploy/staging/web"] },
			scope: "deploy",
			environment: "staging",
			inputHashes: [`sha256:${"b".repeat(64)}`],
			timeoutMs: 300_000,
			effects: ["deploy"],
			credentialRequirement: "scoped",
			credential: {
				handle: "cred-7f3a",
				purpose: "staging-deploy",
				scope: "deploy/staging",
				expiresAt: new Date(NOW.getTime() + 12 * HOUR_MS).toISOString(),
			},
			rehearsal: "evidence/rehearsal-1",
			rollback: "runbook/staging-rollback",
		},
		{ now: NOW },
	);
	assert.equal(submitted.ok, true, (submitted.errors || []).join("; "));
	const hash = submitted.record.requestHash;
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/req-1",
				approver: "bob@example.com",
				scope: null,
				subject: submitted.record.approvalBinding,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		authorizeRunnerRequest(
			dir,
			{
				requestHash: hash,
				approval: "approval/req-1",
				decisionIdentity: "decision/req-1",
				body: "# Authorize request\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
				scope: null,
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		useBreakGlass(dir, { id: "breakglass/incident-42-restore", reference: hash }, { now: USE_AT })
			.ok,
		true,
	);
	// A receipt other than the admitted request hash refuses.
	const wrongReceipt = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: `sha256:${"1".repeat(64)}` },
		{ now: USE_AT },
	);
	assert.equal(wrongReceipt.ok, false);
	assert.match(wrongReceipt.errors[0], /is not the admitted request/);
	// A non-terminal execution has no outcome to link yet.
	const RUNNER_PIN = { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST };
	assert.equal(
		prepareRunnerExecution(dir, { requestHash: hash, runner: { ...RUNNER_PIN } }).ok,
		true,
	);
	const unterminated = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: hash },
		{ now: USE_AT },
	);
	assert.equal(unterminated.ok, false);
	assert.match(unterminated.errors[0], /has no terminal outcome yet/);
	const runnerSettled = settleRunnerExecution(dir, {
		requestHash: hash,
		receipt: {
			runner: { ...RUNNER_PIN },
			exitCode: 1,
			signal: null,
			timedOut: false,
			startedAt: new Date(USE_AT.getTime() + 1_000).toISOString(),
			finishedAt: new Date(USE_AT.getTime() + 2_000).toISOString(),
			durationMs: 1_000,
			outputsDigest: DIGEST,
			scope: { repository: "repo/main", paths: ["deploy/staging/web"] },
			sandboxAssurance: "observed",
			credentialAssurance: "observed",
		},
	});
	// A failed outcome is RECORDED and returned as its stable code —
	// execution never reports fake success, and no attempt disappears.
	assert.equal(runnerSettled.ok, false);
	assert.equal(runnerSettled.code, "AMBER_E_RUNNER_EXECUTION_FAILED");
	assert.equal(runnerSettled.record.status, "failed");
	// A FAILED underlying outcome records — an emergency attempt cannot
	// disappear — and the declared rollback runbook rides the remedy.
	const settled = settleBreakGlass(
		dir,
		{ id: "breakglass/incident-42-restore", receipt: hash },
		{ now: USE_AT },
	);
	assert.equal(settled.ok, true, (settled.errors || []).join("; "));
	assert.equal(settled.record.settlement.outcome, "failed");
	assert.deepEqual(settled.record.settlement.remedy, {
		kind: "rollback",
		reference: "runbook/staging-rollback",
	});
});

test("the mandatory post-review lands against the declared deadline", () => {
	const dir = mkTarget("review");
	grantFixture(dir, ["decision/breakglass-1", "decision/effect-1", "decision/breakglass-review-1"]);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const reviewInput = (overrides = {}) => ({
		id: "breakglass/incident-42-restore",
		outcome: "service restored",
		necessity: "release path was 40 minutes out",
		impact: "one ticket comment created",
		followUp: "add a standing runbook",
		decision: { identity: "decision/breakglass-review-1", revision: 1 },
		...overrides,
	});
	// A review before the grant ended refuses.
	const early = reviewBreakGlass(dir, reviewInput(), { now: USE_AT });
	assert.equal(early.ok, false);
	assert.match(early.errors[0], /has not ended; a post-review follows use, revocation, or expiry/);
	// A grant Decision cannot double as the review Decision.
	const afterExpiry = new Date(NOW.getTime() + 2 * HOUR_MS);
	const reused = reviewBreakGlass(
		dir,
		reviewInput({ decision: { identity: "decision/breakglass-1", revision: 1 } }),
		{ now: afterExpiry },
	);
	assert.equal(reused.ok, false);
	assert.match(reused.errors[0], /already authorized grant .*single-use/);
	// An empty field refuses: a post-review is accountable.
	const empty = reviewBreakGlass(dir, reviewInput({ necessity: " " }), { now: afterExpiry });
	assert.equal(empty.ok, false);
	assert.match(empty.errors[0], /must preserve a non-empty necessity/);
	// Overdue is a visible read-time projection before the review lands.
	const pastDeadline = new Date(NOW.getTime() + 73 * HOUR_MS);
	assert.equal(
		breakGlassStatus(dir, "breakglass/incident-42-restore", { now: pastDeadline }).reviewOverdue,
		true,
	);
	assert.equal(
		breakGlassStatus(dir, "breakglass/incident-42-restore", { now: USE_AT }).reviewOverdue,
		false,
	);
	// A late review is still recordable — and reads flagged; the boundary
	// is half-open (exactly reviewBy is late).
	const exactlyDeadline = new Date(NOW.getTime() + 72 * HOUR_MS);
	assert.equal(exactlyDeadline.toISOString(), grantInput().reviewBy);
	const late = reviewBreakGlass(dir, reviewInput(), { now: pastDeadline });
	assert.equal(late.ok, true, (late.errors || []).join("; "));
	const status = breakGlassStatus(dir, "breakglass/incident-42-restore", { now: pastDeadline });
	assert.equal(status.review.necessity, "release path was 40 minutes out");
	assert.equal(status.reviewOverdue, false);
	assert.equal(status.reviewLate, true);
	assert.equal(Date.parse(status.review.at) >= Date.parse(status.reviewBy), true);
	const again = reviewBreakGlass(dir, reviewInput(), { now: pastDeadline });
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already reviewed; one post-review per grant/);
	assert.equal(breakGlassStatus(dir, "breakglass/ghost", { now: NOW }), null);
});

test("re-chained settlement and review forgeries fail every read closed", () => {
	const dir = mkTarget("t3-tamper");
	grantFixture(dir);
	assert.equal(grantBreakGlass(dir, grantInput(), { now: NOW }).ok, true);
	const pristine = readEvents(grantsPath(dir));
	// A validly re-chained settlement of an unused grant fails the fold.
	const forgedSettlement = {
		kind: "settlement",
		schemaVersion: 1,
		at: NOW.toISOString(),
		id: "breakglass/incident-42-restore",
		receipt: { kind: "external", id: "execution/forged" },
		outcome: "committed",
		remedy: { kind: "irreversible", reference: null },
		prevHash: pristine[0].hash,
	};
	forgedSettlement.hash = chainHash(forgedSettlement, forgedSettlement.prevHash);
	writeEvents(grantsPath(dir), [...pristine, forgedSettlement]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: NOW }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/settles an unused grant; settlement follows use/.test(err.message),
	);
	// A validly re-chained settlement through the WRONG capability kind
	// fails the re-derivation even when the grant was used: the receipt
	// kind is in-ledger derivable. (Covered indirectly by the unused
	// refusal above for this fixture; the kind check is exercised by the
	// runner-vs-external settlement suites.)
	// A validly re-chained review before the grant ended fails the fold:
	// the review instant is re-derivable against the window.
	const forgedReview = {
		kind: "review",
		schemaVersion: 1,
		at: NOW.toISOString(),
		id: "breakglass/incident-42-restore",
		outcome: "fine",
		necessity: "none",
		impact: "none",
		followUp: "none",
		decision: {
			identity: "decision/forged",
			revision: 1,
			decisionKind: "approval",
			principal: "legal@example.com",
		},
		prevHash: pristine[0].hash,
	};
	forgedReview.hash = chainHash(forgedReview, forgedReview.prevHash);
	writeEvents(grantsPath(dir), [...pristine, forgedReview]);
	assert.throws(
		() => listBreakGlassGrants(dir, { now: NOW }),
		(err) =>
			err.amberCode === "AMBER_E_BREAKGLASS_CORRUPT" &&
			/reviews grant .* before it ended/.test(err.message),
	);
});

// ---------------------------------------------------------------------------
// F057 T4 (#295) — no-force semantics, MCP non-execution & boundary
// integrity.
// ---------------------------------------------------------------------------

test("the MCP seam exposes no break-glass surface", () => {
	const { COMMAND_CAPABILITIES } = require("../../scripts/lib/mcp-action-contracts");
	// Break-glass is returned approval-required and never executed
	// (ADR-0022/F018): the MCP capability registry carries no break-glass
	// verb at all, so no registry-proven read-only variant can ever wield
	// emergency authority.
	const breakglassCapabilities = Object.keys(COMMAND_CAPABILITIES).filter((key) =>
		key.split(/[\s.:/-]/).includes("breakglass"),
	);
	assert.deepEqual(breakglassCapabilities, []);
});

test("ordinary confirmation flags never route into break-glass", () => {
	// Neither --force nor --yes is interpreted as break-glass anywhere on
	// this surface: the handlers never consult those keys, so ordinary
	// confirmation cannot bypass the distinct Decision family.
	const sources = [
		"scripts/lib/breakglass-commands.js",
		"scripts/lib/core/breakglass-registry.js",
	].map((file) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8"));
	for (const source of sources) {
		assert.equal(/args\.(force|yes)\b/.test(source), false);
		assert.equal(/\byes\s*===|\bforce\s*===/.test(source), false);
		// The flag tables use quoted keys, so a smuggled ["force","--force"]
		// row would trip the literal ban too.
		assert.equal(/["'](force|yes)["']/.test(source), false);
	}
});

test("the break-glass registry never touches the sync transport surface", () => {
	// ADR-0020's self-owned git transport exception stays isolated: the
	// break-glass surface shares no transport-specific module, code, or
	// state path with it, never spawns a process, and confines every
	// ledger under .amber/breakglass/. Break-glass waives nothing.
	const sources = [
		"scripts/lib/core/breakglass-registry.js",
		"scripts/lib/breakglass-commands.js",
	].map((file) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8"));
	for (const source of sources) {
		assert.equal(/sync-transport|transport-ledger|AMBER_E_SYNC/.test(source), false);
		assert.equal(/child_process|execSync|spawn/.test(source), false);
	}
	const dir = mkTarget("isolation");
	assert.match(grantsPath(dir).replaceAll("\\", "/"), /\.amber\/breakglass\//);
});
