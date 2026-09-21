"use strict";

// Trusted-control governance contract — Slices G-7 (spec §9): the R0
// nine-file replay bundle and the R1 decision-replay comparison report. The
// fixtures reuse the run-contract's real lifecycle so every recorded chain
// element exists; tampered replay bodies fail closed (NON_REPLAYABLE), and
// the R1 output is a comparison, never pass/fail.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const handoffBundle = require("../../scripts/lib/core/handoff-bundle");
const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, grantSessionExecution } = stageRunner;
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");

const PIN = "runner/ci@1.0.0#diagnose.check@1";
const COMMAND_ID = "diagnose.check";
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-replay-bundle-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	fs.writeFileSync(path.join(root, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(root, "fixture.txt"), "fixture\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	fs.mkdirSync(path.join(root, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			confidence_gating: {
				enabled: true,
				byRule: { [COMMAND_ID]: "high" },
				defaultConfidence: "low",
			},
			rules: [{ id: COMMAND_ID, action: "allow", match: "exact", pattern: "node --version" }],
		}),
	);
	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(root, { id: "agent-a", principalKind: "service" });
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
		name: COMMAND_ID,
		capabilityVersion: "1",
		effects: ["diagnose"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: { identity: "decision/capability", revision: 1 },
	});
	const routesDir = path.join(root, "routes");
	fs.mkdirSync(routesDir, { recursive: true });
	fs.writeFileSync(
		path.join(routesDir, "probe.route.json"),
		JSON.stringify({
			schemaVersion: "1.0.0",
			routeId: "probe",
			version: "1.0.0",
			description: "probe route",
			stages: [{ name: "check", type: "verb", target: PIN }],
		}),
	);
	const sessionDir = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify({
			sessionId: "s1",
			schemaVersion: "1.0.0-rc.1",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			route: { id: "probe", version: "1.0.0" },
			goal: "probe",
			status: "executing",
			completedStages: [],
			lease: {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 120000).toISOString(),
				ttlMs: 120000,
				fence: 1,
			},
		}),
	);
	return root;
}

const CLAIM = { ownerId: "agent-a", tokenHash: TOKEN_HASH, leaseFence: 1 };
const BOUNDED = {
	capabilityPin: PIN,
	providerClass: "bounded-command",
	adapterId: "governed-runner",
	adapterVersion: "1",
};

async function runOnceToSettlement(root) {
	stageRunner._setAdapterTableForTest([BOUNDED]);
	try {
		const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.equal(capture.awaitingAuthorization, true);
		const granted = grantSessionExecution(root, "s1", { attemptId: capture.request.attemptId });
		assert.equal(granted.success, true, (granted.errors || []).join("; "));
		const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
		assert.equal(executed.settlement.status, "succeeded", JSON.stringify(executed.message));
		return capture;
	} finally {
		stageRunner._restoreAdapterTableForTest();
	}
}

describe("R0 replay bundle (governance contract §9.1)", () => {
	it("emits the replay/ directory with hash-pinned files; the chain rebuilds offline", async () => {
		const root = makeTarget();
		try {
			const capture = await runOnceToSettlement(root);
			const bundle = handoffBundle.buildReplayBundle(root, "s1");
			assert.equal(bundle.ok, true);
			// The manifest hashes every emitted file.
			assert.ok(bundle.manifest.files["governed-ledger.jsonl"]);
			assert.match(bundle.manifest.files["governed-ledger.jsonl"], /^sha256:[0-9a-f]{64}$/);
			assert.ok(bundle.manifest.files["policy.json"]);
			// The policy version pinned at capture is the bundle's copy (one per
			// version seen, R-RP-4). Structured files serialize into the bundle,
			// so the row parses from the emitted content.
			const policyRows = JSON.parse(bundle.files["policy.json"]);
			assert.equal(policyRows.length, 1);
			assert.equal(
				policyRows[0].rules.rules[0].id,
				COMMAND_ID,
				"the hash-pinned policy copy rides the bundle",
			);
			// The authorization chain elements are all present in the bundle:
			// approval (grants), governed ledger (policy verdict + execution),
			// session manifest (frozen inputs).
			assert.match(bundle.files["approvals.jsonl"], /"kind":"approved"/);
			assert.match(bundle.files["governed-ledger.jsonl"], /policy\.evaluated/);
			assert.match(bundle.files["governed-ledger.jsonl"], /"kind":"executed"/);
			assert.ok(bundle.files["session-manifest.json"]);
			void capture;
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("writeHandoffBundle --replay-scope writes the replay/ directory into the bundle", async () => {
		const root = makeTarget();
		try {
			await runOnceToSettlement(root);
			const outDir = path.join(root, ".amber", "handoff", "replay-test");
			// The bundle's structural validation reads the live handoff at the
			// repository root (audit.js) — regenerate it exactly as the real
			// flow does.
			const { renderHandoff } = require("../../scripts/lib/handoff-command");
			fs.writeFileSync(path.join(root, "session-handoff.md"), renderHandoff(root));
			const result = handoffBundle.writeHandoffBundle(root, {
				outputDir: outDir,
				replayScope: "s1",
			});
			assert.deepEqual(result.errors, [], result.errors.join("; "));
			assert.ok(fs.existsSync(path.join(outDir, "replay", "manifest.json")));
			assert.ok(fs.existsSync(path.join(outDir, "replay", "governed-ledger.jsonl")));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("R1 decision replay (governance contract §9.2)", () => {
	it("produces a comparison report, not pass/fail; a rules change reads DRIFTED", async () => {
		const root = makeTarget();
		try {
			await runOnceToSettlement(root);
			// Replay against the SAME rules: the recorded allow reproduces.
			const same = handoffBundle.replayPolicyDecisions(root, "s1");
			assert.equal(same.ok, true);
			assert.equal(same.report.evaluated, 1);
			// The original decision row reads from the recorded admission
			// verdict (allow via the exact rule) — same rules give EXACT.
			assert.ok(
				["EXACT", "COMPATIBLE"].includes(same.rows[0].state),
				`same-rules replay reads EXACT or COMPATIBLE, got ${same.rows[0].state}`,
			);

			// A rules change since capture reads DRIFTED — how would the same
			// inputs be judged today (a comparison, never a pass/fail).
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify({
					schemaVersion: 1,
					defaultAction: "deny",
					rules: [{ id: "deny-all", action: "deny", match: "prefix", pattern: "node" }],
				}),
			);
			const after = handoffBundle.replayPolicyDecisions(root, "s1");
			assert.equal(after.ok, true);
			assert.equal(after.rows[0].state, "DRIFTED");
			assert.deepEqual(after.report, {
				evaluated: 1,
				exact: 0,
				compatible: 0,
				drifted: 1,
				nonReplayable: 0,
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("a hash-only legacy attempt reads NON_REPLAYABLE — never default-filled", async () => {
		const root = makeTarget();
		try {
			await runOnceToSettlement(root);
			// Hand-craft a second, legacy-shaped request (no frozen record) and
			// chain it onto the session ledger.
			const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
			appendLedgerRecord(path.join(root, ".amber", "sessions", "s1", "ledger.jsonl"), {
				schemaVersion: 2,
				kind: "stage_attempt_requested",
				requestId: "req-legacy",
				attemptId: "att-legacy",
				sessionId: "s1",
				stageName: "check",
				status: "pending",
				idempotencyKey: "legacy-key",
				requestedAt: new Date().toISOString(),
				deadlineAt: new Date(Date.now() + 300000).toISOString(),
				recordedAt: new Date().toISOString(),
			});
			const report = handoffBundle.replayPolicyDecisions(root, "s1");
			assert.equal(report.ok, true);
			assert.equal(report.report.nonReplayable, 1, "the legacy attempt is non-replayable");
			assert.equal(report.report.evaluated, 2);
			const legacyRow = report.rows.find((row) => row.state === "NON_REPLAYABLE");
			assert.match(legacyRow.reason, /no frozen admission inputs/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

// ── G-10: the web-adapter drift fold (governance contract §9.4) ──

describe("session drift fold (web-adapter seam, G-10)", () => {
	const { sessionDriftFold } = require("../../scripts/lib/web-adapter");

	it("folds a settled capture to EXACT; a rules change to DRIFTED; no attempts to null", async () => {
		const root = makeTarget();
		try {
			assert.equal(sessionDriftFold(root, "s1"), null, "no captured attempts → null");

			await runOnceToSettlement(root);
			const settled = sessionDriftFold(root, "s1");
			assert.equal(settled.state, "EXACT", JSON.stringify(settled.report));
			assert.equal(settled.report.evaluated, 1);

			// A rules change after capture: the fold reads DRIFTED.
			fs.writeFileSync(
				path.join(root, ".amber", "governance", "rules.json"),
				JSON.stringify({
					schemaVersion: 1,
					defaultAction: "deny",
					rules: [{ id: "deny-all", action: "deny", match: "prefix", pattern: "node" }],
				}),
			);
			const drifted = sessionDriftFold(root, "s1");
			assert.equal(drifted.state, "DRIFTED");
			assert.equal(drifted.report.drifted, 1);

			// An unknown session folds to null (badge renders nothing).
			assert.equal(sessionDriftFold(root, "ghost"), null);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
