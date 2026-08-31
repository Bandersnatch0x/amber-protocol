"use strict";

// F061 follow-up (#310) — runner family migration: ledger BYTE equivalence.
//
// The family migration's contract (ADR-0028 decision 2; F061 Testing
// Decisions) is byte compatibility: the ledger ritual assembled by
// `defineLedgerFamily` must write the exact bytes the hand-written ritual
// wrote — for every ledger the family owns. This test replays one
// deterministic full lifecycle across all three runner ledgers —
// register runner → register capability → submit request → authorize →
// prepare → settle (committed) — with injected clocks against a seeded
// fixture, and asserts each produced ledger under `.amber/runner/` is
// byte-identical to its recorded golden:
//
//   registry.jsonl    — runner, capability
//   requests.jsonl    — requested, authorized
//   executions.jsonl  — prepared, settled
//
// Recording method (do not re-record against a factory-assembled
// implementation — the golden bytes are the migration's before/after
// evidence and are only ever valid when recorded from a PRE-migration,
// hand-written ritual): the golden fixtures
// `tests/fixtures/runner/{registry,requests,executions}-lifecycle.golden.jsonl`
// were recorded in this worktree BEFORE the migration, against the
// hand-written implementation at commit 659cd10 ("refactor(core): assemble
// the adapter ledgers through defineLedgerFamily (#309)"), by running
//
//   AMBER_RECORD_RUNNER_GOLDEN=1 node --test tests/unit/runner-ledger-bytes.test.js
//
// twice and verifying both recordings were byte-identical before
// committing. Every input is pinned (injected clocks, fixed ids, fixed
// digests), so the ledger bytes — including every chain hash and request
// hash — are fully deterministic; `.gitattributes` normalizes the
// fixtures to LF, matching the `\n` the ledger writer appends.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
	registerRunner,
	registerRunnerCapability,
	submitRunnerRequest,
	authorizeRunnerRequest,
	prepareRunnerExecution,
	settleRunnerExecution,
	registryPath,
	requestsPath,
	executionsPath,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");
const { mkLedgerTarget, readEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-runner-bytes");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "runner");
const GOLDEN = Object.freeze({
	registry: path.join(FIXTURES_DIR, "registry-lifecycle.golden.jsonl"),
	requests: path.join(FIXTURES_DIR, "requests-lifecycle.golden.jsonl"),
	executions: path.join(FIXTURES_DIR, "executions-lifecycle.golden.jsonl"),
});
const GOLDEN_SHA256 = Object.freeze({
	registry: "a2493061687c1b8aa20897723eaf75bc10a47ed0cdce9aeaf0928ac68e6f545b",
	requests: "ef667b68808a2104235947203c9c2b4a33915d979469130c54ddab6307a9caf1",
	executions: "c597bf21bab2e30afcd6a1758c9406f41e052939ac660f61e58b785cf20e6cfb",
});
const GOLDEN_BYTES = Object.freeze({ registry: 1069, requests: 1469, executions: 1427 });

const DIGEST = `sha256:${"a".repeat(64)}`;
const NOW = new Date("2026-08-28T00:00:00.000Z");
const PREPARE_AT = new Date("2026-08-28T01:00:00.000Z");
const SETTLE_AT = new Date("2026-08-28T01:02:00.000Z");
const RUNNER_PIN = Object.freeze({
	id: "runner/ci",
	version: "1.0.0",
	integrityDigest: DIGEST,
});

function ok(result, label) {
	assert.equal(result.ok, true, `${label}: ${(result.errors || []).join("; ")}`);
	return result;
}

function runLifecycle(dir) {
	mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
	try {
		ok(
			registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }),
			"register alice",
		);
		ok(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }), "register bob");
		ok(
			registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }),
			"register carol",
		);
		ok(
			admitArtifact(dir, { type: "intent", identity: "intent/runner", body: "# Runner\n" }),
			"admit intent/runner",
		);
		ok(
			admitArtifact(dir, {
				type: "decision",
				identity: "decision/runner-1",
				body: "# Decision decision/runner-1\n",
				decisionKind: "approval",
				principal: "alice@example.com",
				scope: null,
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
			}),
			"admit decision/runner-1",
		);
		ok(
			admitArtifact(dir, {
				type: "decision",
				identity: "decision/cap-1",
				body: "# Decision decision/cap-1\n",
				decisionKind: "approval",
				principal: "alice@example.com",
				scope: null,
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
			}),
			"admit decision/cap-1",
		);
		ok(
			registerRunner(
				dir,
				{
					id: "runner/ci",
					version: "1.0.0",
					integrityDigest: DIGEST,
					owner: "platform-team",
					decision: { identity: "decision/runner-1", revision: 1 },
				},
				{ now: NOW },
			),
			"register runner/ci",
		);
		ok(
			registerRunnerCapability(
				dir,
				{
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
				},
				{ now: NOW },
			),
			"register capability",
		);
		ok(
			recordEvidence(dir, {
				id: "evidence/rehearsal-1",
				producer: "carol@example.com",
				assurance: "observed",
				scope: "F052",
				subject: "staging rollback rehearsal",
				status: "pass",
			}),
			"record rehearsal evidence",
		);
		const submitted = ok(
			submitRunnerRequest(
				dir,
				{
					capability: {
						runnerId: "runner/ci",
						runnerVersion: "1.0.0",
						name: "deploy.staging-web",
						capabilityVersion: "1",
					},
					target: { repository: "repo/main", paths: ["deploy/staging/web"] },
					scope: null,
					environment: "staging",
					inputHashes: [DIGEST],
					timeoutMs: 300_000,
					effects: ["deploy"],
					credentialRequirement: "scoped",
					credential: {
						handle: "cred-7f3a",
						purpose: "staging-deploy",
						scope: "deploy/staging",
						expiresAt: "2026-08-28T12:00:00.000Z",
					},
					rehearsal: "evidence/rehearsal-1",
					rollback: "runbook/staging-rollback",
				},
				{ now: NOW },
			),
			"submit request",
		);
		ok(
			grantApproval(
				dir,
				{
					id: "approval/req-1",
					approver: "bob@example.com",
					scope: null,
					subject: submitted.record.approvalBinding,
					validUntil: "2027-01-01T00:00:00.000Z",
				},
				{ now: NOW },
			),
			"grant approval",
		);
		ok(
			authorizeRunnerRequest(
				dir,
				{
					requestHash: submitted.record.requestHash,
					approval: "approval/req-1",
					decisionIdentity: "decision/req-1",
					body: "# Authorize request\n",
					traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
					scope: null,
				},
				{ now: NOW },
			),
			"authorize request",
		);
		ok(
			prepareRunnerExecution(
				dir,
				{ requestHash: submitted.record.requestHash, runner: { ...RUNNER_PIN } },
				{ now: PREPARE_AT },
			),
			"prepare execution",
		);
		ok(
			settleRunnerExecution(
				dir,
				{
					requestHash: submitted.record.requestHash,
					receipt: {
						runner: { ...RUNNER_PIN },
						exitCode: 0,
						signal: null,
						timedOut: false,
						startedAt: "2026-08-28T01:00:00.000Z",
						finishedAt: "2026-08-28T01:02:00.000Z",
						durationMs: 120_000,
						outputsDigest: DIGEST,
						scope: { repository: "repo/main", paths: ["deploy/staging/web"] },
						sandboxAssurance: "observed",
						credentialAssurance: "observed",
					},
				},
				{ now: SETTLE_AT },
			),
			"settle execution",
		);
	} finally {
		mock.timers.reset();
	}
	return {
		registry: registryPath(dir),
		requests: requestsPath(dir),
		executions: executionsPath(dir),
	};
}

test("the factory-assembled runner ledgers are byte-identical to the pre-migration recording", () => {
	const ledgers = runLifecycle(mkTarget("lifecycle"));
	assert.deepEqual(
		readEvents(ledgers.registry).map((event) => event.kind),
		["runner", "capability"],
	);
	assert.deepEqual(
		readEvents(ledgers.requests).map((event) => event.kind),
		["requested", "authorized"],
	);
	assert.deepEqual(
		readEvents(ledgers.executions).map((event) => event.kind),
		["prepared", "settled"],
	);
	for (const name of Object.keys(GOLDEN)) {
		const actual = fs.readFileSync(ledgers[name]);
		const golden = fs.readFileSync(GOLDEN[name]);
		assert.equal(
			golden.byteLength,
			GOLDEN_BYTES[name],
			`the recorded pre-migration ${name} golden size changed unexpectedly`,
		);
		assert.equal(
			crypto.createHash("sha256").update(golden).digest("hex"),
			GOLDEN_SHA256[name],
			`the recorded pre-migration ${name} golden changed unexpectedly`,
		);
		assert.equal(
			actual.equals(golden),
			true,
			`the migrated ${name} ledger ritual wrote different bytes than the pre-migration implementation recorded in tests/fixtures/runner/${path.basename(GOLDEN[name])}`,
		);
	}
});
