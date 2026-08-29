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
const { registerExternalEffect } = require("../../scripts/lib/core/external-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");

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
	assert.deepEqual([...GRANT_STATUSES], ["granted", "revoked", "expired"]);
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
