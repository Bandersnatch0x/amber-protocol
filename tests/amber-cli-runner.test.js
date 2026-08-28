"use strict";

// F052 T1 (#255) — `amber runner` CLI seam: governed registration lifecycle,
// fail-closed refusals with stable codes, and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");

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

test("runner help is registered", () => {
	const r = runCli(["runner", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("amber runner register"));
	assert.ok(r.stdout.includes("never command text"));
});
