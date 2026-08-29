"use strict";

// F057 T1 (#292) — `amber breakglass` CLI seam: governed grant and
// revocation, read-only listing with the injected clock, fail-closed
// refusals with stable codes, and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../scripts/lib/core/adapter-registry");
const { grantsPath } = require("../scripts/lib/core/breakglass-registry");
const {
	registerExternalEffect,
	proposeExternalEffect,
	authorizeExternalEffect,
	executeExternalEffect,
	settleExternalExecution,
} = require("../scripts/lib/core/external-registry");
const { grantApproval } = require("../scripts/lib/core/approval-registry");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-breakglass-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function fixtureRepo(dir, identities = ["decision/breakglass-1", "decision/effect-1"]) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/breakglass", body: "# B\n" }).ok,
		true,
	);
	for (const identity of identities) {
		assert.equal(
			admitArtifact(dir, {
				type: "decision",
				identity,
				body: `# ${identity}\n`,
				decisionKind: "approval",
				principal: "legal@example.com",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
			}).ok,
			true,
		);
	}
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
			{ now: new Date("2026-08-29T00:00:00.000Z") },
		).ok,
		true,
	);
}

function grantArgs(overrides = {}) {
	const flags = {
		"--id": "breakglass/incident-42-restore",
		"--incident": "incident/42",
		"--purpose": "restore-login-service",
		"--capability": "external:effect/ticket-comment@1",
		"--exact-target": "tracker/amber-protocol",
		"--scope": "issues",
		"--environment": "production",
		"--risk": "high",
		"--credential": "scoped",
		"--valid-from": "2026-08-29T00:00:00.000Z",
		"--valid-until": "2026-08-29T01:00:00.000Z",
		"--review-by": "2026-09-01T00:00:00.000Z",
		"--decision-identity": "decision/breakglass-1",
		"--revision": "1",
		"--now": "2026-08-29T00:00:00.000Z",
		...overrides,
	};
	const args = ["breakglass", "grant", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args;
}

test("breakglass grant, grants, and revoke form the governed lifecycle", () => {
	const dir = mkTarget("lifecycle");
	fixtureRepo(dir, ["decision/breakglass-1", "decision/effect-1", "decision/breakglass-revoke-1"]);
	const granted = runCli(grantArgs(), dir);
	assert.equal(granted.status, 0, granted.stderr || granted.stdout);
	assert.equal(payload(granted).status, "granted");
	assert.equal(payload(granted).decision.principal, "legal@example.com");

	const listed = runCli(
		[
			"breakglass",
			"grants",
			"--target",
			".",
			"--status",
			"granted",
			"--now",
			"2026-08-29T00:30:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(listed.status, 0, listed.stderr || listed.stdout);
	assert.equal(payload(listed).length, 1);
	const expired = runCli(
		[
			"breakglass",
			"grants",
			"--target",
			".",
			"--status",
			"expired",
			"--now",
			"2026-08-29T01:00:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(payload(expired).length, 1);

	const revoked = runCli(
		[
			"breakglass",
			"revoke",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--reason",
			"credential compromise suspected",
			"--decision-identity",
			"decision/breakglass-revoke-1",
			"--revision",
			"1",
			"--now",
			"2026-08-29T00:30:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(revoked.status, 0, revoked.stderr || revoked.stdout);
	assert.equal(payload(revoked).status, "revoked");
	assert.equal(payload(revoked).revocation.reason, "credential compromise suspected");
});

test("breakglass refusals carry stable codes and never write", () => {
	const dir = mkTarget("refusals");
	fixtureRepo(dir);

	const missingIncident = runCli(grantArgs({ "--incident": null }), dir);
	assert.equal(missingIncident.status, 1);
	assert.equal(envelope(missingIncident).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(missingIncident).errors[0], /--incident is required/);

	const badPin = runCli(grantArgs({ "--capability": "shell:bash" }), dir);
	assert.equal(badPin.status, 1);
	assert.equal(envelope(badPin).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badPin).errors[0], /--capability must be runner:/);

	const truncated = runCli(grantArgs().slice(0, -1), dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(truncated).errors[0], /--now requires a value/);

	const wideWindow = runCli(grantArgs({ "--valid-until": "2026-08-31T00:00:00.000Z" }), dir);
	assert.equal(wideWindow.status, 1);
	assert.equal(envelope(wideWindow).code, "AMBER_E_BREAKGLASS_INVALID");
	assert.match(envelope(wideWindow).errors[0], /validity window must not exceed/);

	assert.equal(fs.existsSync(grantsPath(dir)), false);

	const badStatus = runCli(
		["breakglass", "grants", "--target", ".", "--status", "consumed", "--json"],
		dir,
	);
	assert.equal(badStatus.status, 1);
	assert.equal(envelope(badStatus).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badStatus).errors[0], /--status must be one of/);
});

test("breakglass grants fails closed on a corrupt ledger", () => {
	const dir = mkTarget("corrupt");
	fixtureRepo(dir);
	assert.equal(runCli(grantArgs(), dir).status, 0);
	fs.appendFileSync(grantsPath(dir), '{"kind":"grant"}\n');
	const corrupt = runCli(["breakglass", "grants", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_BREAKGLASS_CORRUPT");
	const corruptStatus = runCli(
		["breakglass", "status", "--target", ".", "--id", "breakglass/incident-42-restore", "--json"],
		dir,
	);
	assert.equal(corruptStatus.status, 1);
	assert.equal(envelope(corruptStatus).code, "AMBER_E_BREAKGLASS_CORRUPT");
	const blocked = runCli(
		grantArgs({ "--id": "breakglass/second", "--decision-identity": "decision/effect-1" }),
		dir,
	);
	assert.equal(blocked.status, 1);
	assert.equal(envelope(blocked).code, "AMBER_E_BREAKGLASS_CORRUPT");
});

test("breakglass use spends the grant once against the authorized underlying request", () => {
	const dir = mkTarget("use");
	fixtureRepo(dir);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(runCli(grantArgs(), dir).status, 0);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: `sha256:${"a".repeat(64)}`,
		},
		{ now: new Date("2026-08-29T00:00:00.000Z") },
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
			{ now: new Date("2026-08-29T00:00:00.000Z") },
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
			{ now: new Date("2026-08-29T00:00:00.000Z") },
		).ok,
		true,
	);
	const useArgs = (overrides = {}) => {
		const flags = {
			"--id": "breakglass/incident-42-restore",
			"--request": "request/1",
			"--now": "2026-08-29T00:30:00.000Z",
			...overrides,
		};
		const args = ["breakglass", "use", "--target", ".", "--json"];
		for (const [flag, value] of Object.entries(flags)) {
			if (value !== null) args.push(flag, value);
		}
		return args;
	};
	// Expiry boundary: exactly validUntil refuses, half-open.
	const expired = runCli(useArgs({ "--now": "2026-08-29T01:00:00.000Z" }), dir);
	assert.equal(expired.status, 1);
	assert.equal(envelope(expired).code, "AMBER_E_BREAKGLASS_INVALID");
	assert.match(envelope(expired).errors[0], /never outlives its window/);
	const used = runCli(useArgs(), dir);
	assert.equal(used.status, 0, used.stderr || used.stdout);
	assert.equal(payload(used).status, "used");
	assert.equal(payload(used).use.requestHash, proposed.record.requestHash);
	const again = runCli(useArgs(), dir);
	assert.equal(again.status, 1);
	assert.equal(envelope(again).code, "AMBER_E_BREAKGLASS_INVALID");
	assert.match(envelope(again).errors[0], /one-use/);
	// F057 T4 (#295): --force cannot override one-use — the spent grant
	// returns the identical refusal.
	const forcedReplay = runCli([...useArgs(), "--force", "--yes"], dir);
	assert.equal(forcedReplay.status, 1);
	assert.deepEqual(envelope(forcedReplay).errors, envelope(again).errors);
	const shown = runCli(
		[
			"breakglass",
			"show",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--now",
			"2026-08-29T00:45:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr || shown.stdout);
	assert.equal(payload(shown).status, "used");
	const ghost = runCli(
		["breakglass", "show", "--target", ".", "--id", "breakglass/ghost", "--json"],
		dir,
	);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_BREAKGLASS_NOT_FOUND");

	// Settlement binds the real underlying receipt through the CLI.
	assert.equal(
		executeExternalEffect(
			dir,
			{
				id: "execution/1",
				request: "request/1",
				credential: {
					purpose: "comment.create",
					scope: "tracker/amber-protocol",
					expiresAt: "2026-08-29T00:30:30.000Z",
				},
			},
			{ now: new Date("2026-08-29T00:30:00.000Z") },
		).ok,
		true,
	);
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
			{ now: new Date("2026-08-29T00:31:00.000Z") },
		).ok,
		true,
	);
	const settled = runCli(
		[
			"breakglass",
			"settle",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--receipt",
			"execution/1",
			"--now",
			"2026-08-29T00:32:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(settled.status, 0, settled.stderr || settled.stdout);
	assert.equal(payload(settled).settlement.outcome, "committed");

	// The overdue post-review is a visible projection, and the review
	// lands behind a fresh human Decision.
	const overdue = runCli(
		[
			"breakglass",
			"status",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--now",
			"2026-09-02T00:00:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(overdue.status, 0, overdue.stderr || overdue.stdout);
	assert.equal(payload(overdue).reviewOverdue, true);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/breakglass-review-1",
			body: "# review\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/breakglass" } }],
		}).ok,
		true,
	);
	const reviewed = runCli(
		[
			"breakglass",
			"review",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--outcome",
			"service restored",
			"--necessity",
			"release path was 40 minutes out",
			"--impact",
			"one ticket comment created",
			"--follow-up",
			"add a standing runbook",
			"--decision-identity",
			"decision/breakglass-review-1",
			"--revision",
			"1",
			"--now",
			"2026-09-02T00:00:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(reviewed.status, 0, reviewed.stderr || reviewed.stdout);
	const finalStatus = runCli(
		[
			"breakglass",
			"status",
			"--target",
			".",
			"--id",
			"breakglass/incident-42-restore",
			"--now",
			"2026-09-02T01:00:00.000Z",
			"--json",
		],
		dir,
	);
	assert.equal(payload(finalStatus).reviewOverdue, false);
	assert.equal(payload(finalStatus).reviewLate, true);
	assert.equal(payload(finalStatus).review.followUp, "add a standing runbook");
});

test("breakglass help and unknown actions route through the shared dispatcher", () => {
	const dir = mkTarget("help");
	const help = runCli(["breakglass", "--help"], dir);
	assert.equal(help.status, 0, help.stderr || help.stdout);
	assert.match(
		help.stdout,
		/amber breakglass <grant\|revoke\|grants\|use\|show\|settle\|review\|status>/,
	);
	assert.match(help.stdout, /--review-by/);
	assert.match(help.stdout, /never a flag, a reusable token, or an/);
	assert.match(help.stdout, /No MCP capability resolves to this command/);

	// F057 T4 (#295): --force/--yes are inert here — the same refusal
	// comes back with or without them; ordinary confirmation is never
	// break-glass.
	const bare = runCli(
		[
			"breakglass",
			"use",
			"--target",
			".",
			"--id",
			"breakglass/ghost",
			"--request",
			"request/1",
			"--json",
		],
		dir,
	);
	const forced = runCli(
		[
			"breakglass",
			"use",
			"--target",
			".",
			"--id",
			"breakglass/ghost",
			"--request",
			"request/1",
			"--force",
			"--yes",
			"--json",
		],
		dir,
	);
	assert.equal(bare.status, 1);
	assert.equal(forced.status, 1);
	assert.equal(envelope(bare).code, "AMBER_E_BREAKGLASS_NOT_FOUND");
	assert.equal(envelope(forced).code, envelope(bare).code);
	assert.deepEqual(envelope(forced).errors, envelope(bare).errors);

	const unknown = runCli(["breakglass", "bogus", "--target", ".", "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.match(
		envelope(unknown).errors[0],
		/breakglass requires grant, revoke, grants, use, show, settle, review, or status/,
	);
});
