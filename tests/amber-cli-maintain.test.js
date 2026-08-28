"use strict";

// F054 T1 (#279), T2 (#280), T3 (#281) — `amber maintain` CLI seam:
// governed detector registration, deterministic detection, trigger
// proposals, owner triage with exact + integrity fixtures, fail-closed
// refusals with stable codes, and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");
const { findingsPath } = require("../scripts/lib/core/maintain-registry");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-maintain-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

/** Principal + intent + one committed human Decision per identity. */
function fixtureRepo(dir, decisionIdentities) {
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/maintain", body: "# M\n" }).ok,
		true,
	);
	for (const identity of decisionIdentities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/maintain" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
}

function registerArgs(overrides = {}) {
	const flags = {
		"--id": "detector/error-rate",
		"--detector-version": "1",
		"--metric": "http-5xx-rate",
		"--source": "observability/api",
		"--baseline": "10",
		"--window-ms": "3600000",
		"--scope": "service/api",
		"--cooldown-ms": "3600000",
		"--max-observations": "100",
		"--decision-identity": "decision/detector-1",
		"--revision": "1",
		...overrides,
	};
	const args = ["maintain", "register-detector", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args.concat(["--rule", "warn:ge:100", "--rule", "page:ge:500"]);
}

function detectArgs(overrides = {}) {
	const flags = {
		"--id": "detector/error-rate",
		"--detector-version": "1",
		"--subject": "service/api",
		"--window-from": "2026-08-29T00:00:00.000Z",
		"--window-to": "2026-08-29T00:30:00.000Z",
		"--value": "120",
		"--observation-hash": HASH_A,
		...overrides,
	};
	const args = ["maintain", "detect", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args;
}

test("maintain register-detector, detect, detectors, and findings form the governed lifecycle", () => {
	const dir = mkTarget("lifecycle");
	fixtureRepo(dir, ["decision/detector-1"]);
	const registered = runCli(registerArgs(), dir);
	assert.equal(registered.status, 0, registered.stderr || registered.stdout);
	const detector = payload(registered);
	assert.equal(detector.id, "detector/error-rate");
	assert.equal(detector.version, "1");
	assert.equal(detector.outputType, "finding");
	assert.equal(detector.decision.principal, "alice@example.com");
	assert.deepEqual(detector.rules, [
		{ tier: "warn", comparator: "ge", threshold: 100 },
		{ tier: "page", comparator: "ge", threshold: 500 },
	]);

	const detectors = runCli(["maintain", "detectors", "--target", ".", "--json"], dir);
	assert.equal(detectors.status, 0, detectors.stderr || detectors.stdout);
	assert.equal(payload(detectors).length, 1);

	const inBand = runCli(detectArgs({ "--value": "50" }), dir);
	assert.equal(inBand.status, 0, inBand.stderr || inBand.stdout);
	assert.deepEqual(payload(inBand), { tier: "in-band" });
	assert.equal(fs.existsSync(findingsPath(dir)), false);

	const outOfBand = runCli(detectArgs(), dir);
	assert.equal(outOfBand.status, 0, outOfBand.stderr || outOfBand.stdout);
	const finding = payload(outOfBand);
	assert.equal(finding.tier, "warn");
	assert.equal(finding.inputHash, HASH_A);
	assert.match(finding.fingerprint, /^sha256:[0-9a-f]{64}$/);

	const repeat = runCli(detectArgs({ "--observation-hash": HASH_B }), dir);
	assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
	assert.equal(payload(repeat).fingerprint, finding.fingerprint);

	const findings = runCli(["maintain", "findings", "--target", ".", "--json"], dir);
	assert.equal(findings.status, 0, findings.stderr || findings.stdout);
	assert.equal(payload(findings).length, 2);
	const filtered = runCli(
		["maintain", "findings", "--target", ".", "--fingerprint", finding.fingerprint, "--json"],
		dir,
	);
	assert.equal(payload(filtered).length, 2);
	const none = runCli(
		["maintain", "findings", "--target", ".", "--id", "detector/ghost", "--json"],
		dir,
	);
	assert.equal(payload(none).length, 0);
});

test("maintain refusals carry stable codes and never write", () => {
	const dir = mkTarget("refusals");
	fixtureRepo(dir, ["decision/detector-1"]);

	const badRule = runCli(registerArgs().slice(0, -4).concat(["--rule", "warn:eq:100"]), dir);
	assert.equal(badRule.status, 1);
	assert.equal(envelope(badRule).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badRule).errors[0], /--rule must be <tier>:<ge\|gt\|le\|lt>:<threshold>/);

	const badBaseline = runCli(registerArgs({ "--baseline": "ten" }), dir);
	assert.equal(badBaseline.status, 1);
	assert.equal(envelope(badBaseline).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badBaseline).errors[0], /--baseline must be a finite number/);

	const missingMetric = runCli(registerArgs({ "--metric": null }), dir);
	assert.equal(missingMetric.status, 1);
	assert.equal(envelope(missingMetric).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(missingMetric).errors[0], /--metric is required/);

	const truncated = runCli(["maintain", "detect", "--target", ".", "--json", "--subject"], dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(truncated).errors[0], /--subject requires a value/);

	assert.equal(runCli(registerArgs(), dir).status, 0);
	const duplicate = runCli(registerArgs(), dir);
	assert.equal(duplicate.status, 1);
	assert.equal(envelope(duplicate).code, "AMBER_E_MAINTAIN_EXISTS");

	const ghost = runCli(detectArgs({ "--id": "detector/ghost" }), dir);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_MAINTAIN_NOT_FOUND");

	const wideWindow = runCli(detectArgs({ "--window-to": "2026-08-29T02:00:00.000Z" }), dir);
	assert.equal(wideWindow.status, 1);
	assert.equal(envelope(wideWindow).code, "AMBER_E_MAINTAIN_INVALID");

	const badHash = runCli(detectArgs({ "--observation-hash": "sha256:xyz" }), dir);
	assert.equal(badHash.status, 1);
	assert.equal(envelope(badHash).code, "AMBER_E_MAINTAIN_INVALID");
	assert.equal(fs.existsSync(findingsPath(dir)), false);
});

test("maintain corrupt ledgers fail reads closed at the CLI seam", () => {
	const dir = mkTarget("corrupt");
	fixtureRepo(dir, ["decision/detector-1"]);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);
	fs.appendFileSync(findingsPath(dir), '{"kind":"finding"}\n');
	const findings = runCli(["maintain", "findings", "--target", ".", "--json"], dir);
	assert.equal(findings.status, 1);
	assert.equal(envelope(findings).code, "AMBER_E_MAINTAIN_FINDING_CORRUPT");
	const detectorLedger = path.join(path.dirname(findingsPath(dir)), "detectors.jsonl");
	fs.appendFileSync(detectorLedger, '{"kind":"detector"}\n');
	const detectors = runCli(["maintain", "detectors", "--target", ".", "--json"], dir);
	assert.equal(detectors.status, 1);
	assert.equal(envelope(detectors).code, "AMBER_E_MAINTAIN_CORRUPT");
});

test("maintain help and unknown actions route through the shared dispatcher", () => {
	const dir = mkTarget("help");
	const help = runCli(["maintain", "--help"], dir);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /register-detector/);
	assert.match(help.stdout, /deterministic Findings/);
	assert.match(help.stdout, /propose --finding-index <n>/);
	assert.match(
		help.stdout,
		/triage --fingerprint <sha256:\.\.\.> --outcome <fix\|schedule\|dismiss>/,
	);
	assert.match(help.stdout, /proposals \[--fingerprint <sha256:\.\.\.>\]/);
	const unknown = runCli(["maintain", "promote", "--target", ".", "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.match(
		envelope(unknown).errors[0],
		/maintain requires register-detector, detect, propose, triage, detectors, findings, or proposals/,
	);
});

test("maintain propose opens once per fingerprint and appends in-cooldown repeats", () => {
	const dir = mkTarget("propose");
	fixtureRepo(dir, ["decision/detector-1"]);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs({ "--observation-hash": HASH_B }), dir).status, 0);

	const opened = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"],
		dir,
	);
	assert.equal(opened.status, 0, opened.stderr || opened.stdout);
	assert.equal(payload(opened).action, "opened");
	assert.equal(payload(opened).proposal.status, "open");
	assert.deepEqual(payload(opened).proposal.findings, [0]);
	assert.equal("body" in payload(opened).proposal, false);

	const appended = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "1", "--json"],
		dir,
	);
	assert.equal(appended.status, 0, appended.stderr || appended.stdout);
	assert.equal(payload(appended).action, "appended");
	assert.deepEqual(payload(appended).proposal.findings, [0, 1]);

	const duplicate = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "1", "--json"],
		dir,
	);
	assert.equal(duplicate.status, 1);
	assert.equal(envelope(duplicate).code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(envelope(duplicate).errors[0], /already referenced/);

	const proposals = runCli(["maintain", "proposals", "--target", ".", "--json"], dir);
	assert.equal(proposals.status, 0, proposals.stderr || proposals.stdout);
	assert.equal(payload(proposals).length, 1);
	const fingerprint = payload(proposals)[0].fingerprint;
	const filtered = runCli(
		["maintain", "proposals", "--target", ".", "--fingerprint", fingerprint, "--json"],
		dir,
	);
	assert.equal(payload(filtered).length, 1);
});

test("maintain propose escalates to triage outside the declared cooldown", () => {
	const dir = mkTarget("propose-cooldown");
	fixtureRepo(dir, ["decision/detector-1"]);
	assert.equal(runCli(registerArgs({ "--cooldown-ms": "1" }), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs({ "--observation-hash": HASH_B }), dir).status, 0);
	assert.equal(
		runCli(["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"], dir).status,
		0,
	);
	const escalated = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "1", "--json"],
		dir,
	);
	assert.equal(escalated.status, 1);
	assert.equal(envelope(escalated).code, "AMBER_E_MAINTAIN_PROPOSAL_EXISTS");
	assert.match(envelope(escalated).errors[0], /must be triaged/);
});

test("maintain propose refusals carry stable codes and fail reads closed", () => {
	const dir = mkTarget("propose-refusals");
	fixtureRepo(dir, ["decision/detector-1"]);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);

	const missing = runCli(["maintain", "propose", "--target", ".", "--json"], dir);
	assert.equal(missing.status, 1);
	assert.equal(envelope(missing).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(missing).errors[0], /--finding-index must be a non-negative integer/);

	const ghost = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "9", "--json"],
		dir,
	);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_MAINTAIN_NOT_FOUND");

	assert.equal(
		runCli(["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"], dir).status,
		0,
	);
	const proposalsLedger = path.join(path.dirname(findingsPath(dir)), "proposals.jsonl");
	fs.appendFileSync(proposalsLedger, '{"kind":"proposal"}\n');
	const corrupt = runCli(["maintain", "proposals", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT");
	const blocked = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"],
		dir,
	);
	assert.equal(blocked.status, 1);
	assert.equal(envelope(blocked).code, "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT");
});

function triageArgs(fingerprint, overrides = {}) {
	const flags = {
		"--fingerprint": fingerprint,
		"--outcome": "schedule",
		"--reason": "next sprint",
		"--decision-identity": "decision/triage-1",
		"--revision": "1",
		...overrides,
	};
	const args = ["maintain", "triage", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args;
}

test("maintain triage settles each outcome and only fix yields a candidate", () => {
	const dir = mkTarget("triage");
	fixtureRepo(dir, [
		"decision/detector-1",
		"decision/triage-1",
		"decision/triage-2",
		"decision/triage-3",
	]);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);
	const opened = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"],
		dir,
	);
	assert.equal(opened.status, 0, opened.stderr || opened.stdout);
	const fingerprint = payload(opened).proposal.fingerprint;

	const scheduled = runCli(triageArgs(fingerprint), dir);
	assert.equal(scheduled.status, 0, scheduled.stderr || scheduled.stdout);
	assert.equal(payload(scheduled).proposal.status, "triaged");
	assert.equal(payload(scheduled).proposal.triage.outcome, "schedule");
	assert.equal(payload(scheduled).proposal.triage.reason, "next sprint");
	// The owner identity is the verified principal snapshot, not a flag.
	assert.equal(payload(scheduled).proposal.triage.decision.principal, "alice@example.com");
	assert.equal(payload(scheduled).candidate, null);

	// Triage unblocks re-entry: the next observation opens a new proposal.
	assert.equal(runCli(detectArgs({ "--observation-hash": HASH_B }), dir).status, 0);
	const reopened = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "1", "--json"],
		dir,
	);
	assert.equal(reopened.status, 0, reopened.stderr || reopened.stdout);
	assert.equal(payload(reopened).action, "opened");

	const fixed = runCli(
		triageArgs(fingerprint, {
			"--outcome": "fix",
			"--reason": null,
			"--decision-identity": "decision/triage-2",
		}),
		dir,
	);
	assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
	const candidate = payload(fixed).candidate;
	assert.equal(candidate.type, "intent");
	assert.match(candidate.identity, /^intent\/maintain\/[0-9a-f]{16}$/);
	assert.match(candidate.body, /Evidence \(maintain Findings\)/);
	// Nothing is auto-admitted: the candidate identity is not a committed
	// artifact until a human takes it through the normal surface.
	const show = runCli(
		["artifact", "show", "--target", ".", "--type", "intent", "--id", candidate.identity, "--json"],
		dir,
	);
	assert.equal(show.status, 1);
	assert.equal(envelope(show).code, "AMBER_E_ARTIFACT_NOT_FOUND");

	// The next observation reopens once more; that proposal dismisses with
	// its reason preserved.
	assert.equal(
		runCli(detectArgs({ "--observation-hash": `sha256:${"c".repeat(64)}` }), dir).status,
		0,
	);
	const third = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "2", "--json"],
		dir,
	);
	assert.equal(third.status, 0, third.stderr || third.stdout);
	assert.equal(payload(third).action, "opened");
	const dismissed = runCli(
		triageArgs(payload(third).proposal.fingerprint, {
			"--outcome": "dismiss",
			"--reason": "expected load test",
			"--decision-identity": "decision/triage-3",
		}),
		dir,
	);
	assert.equal(dismissed.status, 0, dismissed.stderr || dismissed.stdout);
	assert.equal(payload(dismissed).proposal.triage.outcome, "dismiss");
	assert.equal(payload(dismissed).proposal.triage.reason, "expected load test");
	assert.equal(payload(dismissed).candidate, null);
});

test("maintain triage refusals carry stable codes", () => {
	const dir = mkTarget("triage-refusals");
	fixtureRepo(dir, ["decision/detector-1", "decision/triage-1"]);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	assert.equal(runCli(detectArgs(), dir).status, 0);
	const opened = runCli(
		["maintain", "propose", "--target", ".", "--finding-index", "0", "--json"],
		dir,
	);
	const fingerprint = payload(opened).proposal.fingerprint;

	const missingOutcome = runCli(triageArgs(fingerprint, { "--outcome": null }), dir);
	assert.equal(missingOutcome.status, 1);
	assert.equal(envelope(missingOutcome).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(missingOutcome).errors[0], /--outcome is required/);

	const vocabulary = runCli(triageArgs(fingerprint, { "--outcome": "promote" }), dir);
	assert.equal(vocabulary.status, 1);
	assert.equal(envelope(vocabulary).code, "AMBER_E_MAINTAIN_INVALID");

	const missingReason = runCli(triageArgs(fingerprint, { "--reason": null }), dir);
	assert.equal(missingReason.status, 1);
	assert.equal(envelope(missingReason).code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(envelope(missingReason).errors[0], /must preserve a non-empty reason/);

	const fixWithReason = runCli(triageArgs(fingerprint, { "--outcome": "fix" }), dir);
	assert.equal(fixWithReason.status, 1);
	assert.equal(envelope(fixWithReason).code, "AMBER_E_MAINTAIN_INVALID");

	const ghost = runCli(triageArgs(`sha256:${"f".repeat(64)}`), dir);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_MAINTAIN_NOT_FOUND");

	assert.equal(runCli(triageArgs(fingerprint), dir).status, 0);
	const closed = runCli(triageArgs(fingerprint), dir);
	assert.equal(closed.status, 1);
	assert.equal(envelope(closed).code, "AMBER_E_MAINTAIN_INVALID");
	assert.match(envelope(closed).errors[0], /triage of a closed proposal refuses/);
});
