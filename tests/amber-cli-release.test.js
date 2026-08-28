"use strict";

// F053 T1 (#274) — `amber release` CLI seam: governed candidate
// preparation, fail-closed refusals with stable codes, and help
// registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../scripts/lib/core/evidence-receipts");
const { registerRunner, registerRunnerCapability } = require("../scripts/lib/core/runner-registry");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-release-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

test("release prepare, show, and list form the governed candidate lifecycle", () => {
	const dir = mkTarget("lifecycle");
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		registerPrincipal(dir, { id: "carol@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/release-cli", body: "# R\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "policy", identity: "policy/release", body: "# P\n" }).ok,
		true,
	);
	for (const identity of ["decision/runner-cli", "decision/cap-cli"]) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/release-cli" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	for (const id of [
		"evidence/test-run",
		"evidence/review-logic",
		"evidence/review-security",
		"evidence/review-spec",
		"evidence/rollback-plan",
	]) {
		const recorded = recordEvidence(dir, {
			id,
			producer: "carol@example.com",
			assurance: "observed",
			scope: "F053",
			subject: `release fixture ${id}`,
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		});
		assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	}
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-cli", revision: 1 },
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
			decision: { identity: "decision/cap-cli", revision: 1 },
		}).ok,
		true,
	);

	const prepared = runCli(
		[
			"release",
			"prepare",
			"--id",
			"release/web-42",
			"--commit",
			COMMIT,
			"--change-artifact",
			"intent:intent/release-cli@1",
			"--evidence-item",
			"evidence/test-run",
			"--review-logic",
			"evidence/review-logic",
			"--review-security",
			"evidence/review-security",
			"--review-spec",
			"evidence/review-spec",
			"--environment",
			"staging",
			"--release-policy",
			"policy/release@1",
			"--runner",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--capability",
			"deploy.staging-web",
			"--capability-version",
			"1",
			"--credential",
			"scoped",
			"--rollback",
			"evidence/rollback-plan",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
	const candidate = payload(prepared);
	assert.match(candidate.releaseHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(candidate.review.specCompliance, "evidence/review-spec");

	const shown = payload(
		runCli(["release", "show", "--id", "release/web-42", "--target", dir, "--json"], dir),
	);
	assert.equal(shown.releaseHash, candidate.releaseHash);

	const listed = payload(
		runCli(["release", "list", "--environment", "staging", "--target", dir, "--json"], dir),
	);
	assert.equal(listed.length, 1);

	const badPin = runCli(
		[
			"release",
			"prepare",
			"--id",
			"release/x",
			"--commit",
			COMMIT,
			"--review-logic",
			"evidence/review-logic",
			"--review-security",
			"evidence/review-security",
			"--review-spec",
			"evidence/review-spec",
			"--environment",
			"staging",
			"--release-policy",
			"policy/release@1",
			"--runner",
			"runner/ci",
			"--runner-version",
			"1.0.0",
			"--capability",
			"deploy.staging-web",
			"--capability-version",
			"1",
			"--credential",
			"scoped",
			"--rollback",
			"evidence/rollback-plan",
			"--change-artifact",
			"nonsense",
			"--evidence-item",
			"evidence/test-run",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(badPin.status, 1);
	assert.equal(envelope(badPin).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badPin).errors[0], /--change-artifact must be/);

	const tampered = fs
		.readFileSync(path.join(dir, ".amber", "release", "candidates.jsonl"), "utf8")
		.replace("staging", "production");
	fs.writeFileSync(path.join(dir, ".amber", "release", "candidates.jsonl"), tampered);
	const corrupt = runCli(["release", "list", "--target", dir, "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_RELEASE_CORRUPT");
});

test("release refusals carry stable codes", () => {
	const dir = mkTarget("refusals");

	const ghost = runCli(
		["release", "show", "--id", "release/ghost", "--target", dir, "--json"],
		dir,
	);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_RELEASE_NOT_FOUND");

	const truncated = runCli(["release", "prepare", "--id", "--target", dir, "--json"], dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
});

test("release help is registered", () => {
	const r = runCli(["release", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("amber release prepare"));
	assert.ok(r.stdout.includes("never approvals"));
});
