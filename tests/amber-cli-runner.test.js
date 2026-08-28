"use strict";

// F052 T1/T2 (#255, #256) — `amber runner` CLI seam: governed registration
// and execution-request lifecycles, fail-closed refusals with stable codes,
// and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");
const { grantApproval } = require("../scripts/lib/core/approval-registry");
const { recordEvidence } = require("../scripts/lib/core/evidence-receipts");
const { registerRunner, registerRunnerCapability } = require("../scripts/lib/core/runner-registry");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const DIGEST = `sha256:${"a".repeat(64)}`;

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-runner-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function decisionFixture(dir, identity) {
	const decision = admitArtifact(dir, {
		type: "decision",
		identity,
		body: `# ${identity}\n`,
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner-cli" } }],
	});
	assert.equal(decision.ok, true, (decision.errors || []).join("; "));
}

test("runner register, capability, show, and list form the governed lifecycle", () => {
	const dir = mkTarget("lifecycle");
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/runner-cli", body: "# R\n" }).ok,
		true,
	);
	decisionFixture(dir, "decision/runner-cli");
	decisionFixture(dir, "decision/cap-cli");

	const registered = runCli(
		[
			"runner",
			"register",
			"--id",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--integrity",
			DIGEST,
			"--runner-owner",
			"platform-team",
			"--decision-identity",
			"decision/runner-cli",
			"--revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(registered.status, 0, registered.stderr || registered.stdout);
	assert.equal(payload(registered).kind, "runner");

	const capability = runCli(
		[
			"runner",
			"capability",
			"--id",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--capability",
			"deploy.staging-web",
			"--capability-version",
			"1",
			"--effect",
			"deploy",
			"--path-prefix",
			"deploy/staging",
			"--timeout-ms",
			"600000",
			"--credential",
			"scoped",
			"--rollback",
			"runbook/staging-rollback",
			"--decision-identity",
			"decision/cap-cli",
			"--revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(capability.status, 0, capability.stderr || capability.stdout);
	assert.equal(payload(capability).name, "deploy.staging-web");

	const shown = payload(
		runCli(["runner", "show", "--id", "runner/ci", "--target", dir, "--json"], dir),
	);
	assert.deepEqual(shown.versions, ["1.0.0"]);
	assert.equal(shown.capabilities.length, 1);

	const listed = payload(runCli(["runner", "list", "--target", dir, "--json"], dir));
	assert.equal(listed.length, 1);

	const reused = runCli(
		[
			"runner",
			"register",
			"--id",
			"runner/ci",
			"--runner-version",
			"2.0.0",
			"--integrity",
			DIGEST,
			"--runner-owner",
			"platform-team",
			"--decision-identity",
			"decision/runner-cli",
			"--revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(reused.status, 1);
	assert.equal(envelope(reused).code, "AMBER_E_RUNNER_INVALID");
});

test("runner refusals carry stable codes", () => {
	const dir = mkTarget("refusals");

	const ghost = runCli(["runner", "show", "--id", "runner/ghost", "--target", dir, "--json"], dir);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_RUNNER_NOT_FOUND");

	const missingEffect = runCli(
		[
			"runner",
			"capability",
			"--id",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--capability",
			"deploy.web",
			"--capability-version",
			"1",
			"--timeout-ms",
			"1000",
			"--credential",
			"none",
			"--rollback",
			"none",
			"--decision-identity",
			"decision/x",
			"--revision",
			"1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(missingEffect.status, 1);
	assert.equal(envelope(missingEffect).code, "AMBER_E_INVALID_ARG");

	const truncated = runCli(["runner", "register", "--id", "--target", dir, "--json"], dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");

	const trailingPrefix = runCli(
		[
			"runner",
			"capability",
			"--id",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--capability",
			"deploy.web",
			"--capability-version",
			"1",
			"--effect",
			"deploy",
			"--timeout-ms",
			"1000",
			"--credential",
			"none",
			"--rollback",
			"none",
			"--decision-identity",
			"decision/x",
			"--revision",
			"1",
			"--target",
			dir,
			"--json",
			"--path-prefix",
		],
		dir,
	);
	assert.equal(trailingPrefix.status, 1);
	assert.equal(envelope(trailingPrefix).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(trailingPrefix).errors[0], /--path-prefix requires a value/);
});

test("runner request, authorize, prepare, and settle form the governed execution lifecycle", () => {
	const dir = mkTarget("request");
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/runner-cli", body: "# R\n" }).ok,
		true,
	);
	decisionFixture(dir, "decision/runner-cli");
	decisionFixture(dir, "decision/cap-cli");
	const rehearsed = recordEvidence(dir, {
		id: "evidence/rehearsal-cli",
		producer: "carol@example.com",
		assurance: "observed",
		scope: "F052",
		subject: "staging rollback rehearsal",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(rehearsed.ok, true, (rehearsed.errors || []).join("; "));
	const registered = registerRunner(dir, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: DIGEST,
		owner: "platform-team",
		decision: { identity: "decision/runner-cli", revision: 1 },
	});
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
	const capability = registerRunnerCapability(dir, {
		runnerId: "runner/ci",
		runnerVersion: "1.0.0",
		name: "deploy.staging-web",
		capabilityVersion: "1",
		effects: ["deploy"],
		pathPrefixes: ["deploy/staging"],
		timeoutMsMax: 600_000,
		credentialRequirement: "scoped",
		rollback: "runbook/staging-rollback",
		decision: { identity: "decision/cap-cli", revision: 1 },
	});
	assert.equal(capability.ok, true, (capability.errors || []).join("; "));

	const requestArgs = [
		"runner",
		"request",
		"--id",
		"runner/ci",
		"--runner-version",
		"1.0.0",
		"--capability",
		"deploy.staging-web",
		"--capability-version",
		"1",
		"--repository",
		"repo/main",
		"--path",
		"deploy/staging/web",
		"--environment",
		"staging",
		"--input-hash",
		DIGEST,
		"--timeout-ms",
		"300000",
		"--effect",
		"deploy",
		"--credential",
		"scoped",
		"--credential-handle",
		"cred-7f3a",
		"--credential-purpose",
		"staging-deploy",
		"--credential-scope",
		"deploy/staging",
		"--credential-expires",
		new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		"--rehearsal",
		"evidence/rehearsal-cli",
		"--rollback",
		"runbook/staging-rollback",
		"--target",
		dir,
		"--json",
	];
	const submitted = runCli(requestArgs, dir);
	assert.equal(submitted.status, 0, submitted.stderr || submitted.stdout);
	const request = payload(submitted);
	assert.equal(request.status, "requested");
	assert.equal(request.risk, "high");
	assert.equal(request.approvalBinding, `runner-request:staging:${request.requestHash}`);

	const denied = runCli(
		requestArgs.map((token) => (token === "300000" ? "600001" : token)),
		dir,
	);
	assert.equal(denied.status, 1);
	assert.equal(envelope(denied).code, "AMBER_E_RUNNER_REQUEST_DENIED");

	const granted = grantApproval(
		dir,
		{
			id: "approval/req-cli",
			approver: "bob@example.com",
			scope: null,
			subject: request.approvalBinding,
			validUntil: "2027-01-01T00:00:00.000Z",
		},
		{ now: new Date("2026-08-28T00:00:00.000Z") },
	);
	assert.equal(granted.ok, true, (granted.errors || []).join("; "));

	const authorized = runCli(
		[
			"runner",
			"authorize",
			"--request-hash",
			request.requestHash,
			"--approval",
			"approval/req-cli",
			"--decision-identity",
			"decision/req-cli",
			"--body",
			"# Authorize deploy",
			"--trace",
			"decides:intent:intent/runner-cli",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(authorized.status, 0, authorized.stderr || authorized.stdout);
	assert.equal(payload(authorized).status, "authorized");

	const listed = payload(
		runCli(["runner", "requests", "--environment", "staging", "--target", dir, "--json"], dir),
	);
	assert.deepEqual(
		listed.map((entry) => entry.status),
		["authorized", "denied"],
	);

	const prepared = runCli(
		[
			"runner",
			"prepare",
			"--request-hash",
			request.requestHash,
			"--id",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--integrity",
			DIGEST,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
	assert.equal(payload(prepared).status, "attempted");

	const receiptPath = path.join(dir, "receipt.json");
	fs.writeFileSync(
		receiptPath,
		JSON.stringify({
			runner: { id: "runner/ci", version: "1.0.0", integrityDigest: DIGEST },
			exitCode: 0,
			signal: null,
			timedOut: false,
			startedAt: "2026-08-28T01:00:00.000Z",
			finishedAt: "2026-08-28T01:02:00.000Z",
			durationMs: 120000,
			outputsDigest: DIGEST,
			scope: { repository: "repo/main", paths: ["deploy/staging/web"] },
			sandboxAssurance: "observed",
			credentialAssurance: "observed",
		}),
	);
	const settled = runCli(
		[
			"runner",
			"settle",
			"--request-hash",
			request.requestHash,
			"--receipt",
			"receipt.json",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(settled.status, 0, settled.stderr || settled.stdout);
	assert.equal(payload(settled).status, "committed");

	const executions = payload(
		runCli(["runner", "executions", "--status", "committed", "--target", dir, "--json"], dir),
	);
	assert.equal(executions.length, 1);
	assert.equal(executions[0].settlement.resultIntegrity, "receipt-bound");
});

test("runner help is registered", () => {
	const r = runCli(["runner", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("amber runner register"));
	assert.ok(r.stdout.includes("amber runner request"));
	assert.ok(r.stdout.includes("command text"));
});
