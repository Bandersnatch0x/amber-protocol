"use strict";

// F055 T1 (#283) — `amber retention` CLI seam: governed classification,
// deterministic read-only evaluation, fail-closed refusals with stable
// codes, and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { classificationsPath } = require("../scripts/lib/core/retention-registry");

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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-retention-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function fixtureRepo(dir) {
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/login", body: "# L\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "policy",
			identity: "policy/tenant-retention",
			body: "# Tenant retention\n",
			extensions: {
				retention: {
					classes: { operational: { ttlMs: 3_600_000, legalBasis: "ops-contract" } },
				},
			},
		}).ok,
		true,
	);
}

function classifyArgs(overrides = {}) {
	const flags = {
		"--record": "intent:intent/login@1",
		"--retention-class": "operational",
		"--policy": "policy/tenant-retention@1",
		...overrides,
	};
	const args = ["retention", "classify", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args;
}

test("retention classify, classifications, and evaluate form the governed lifecycle", () => {
	const dir = mkTarget("lifecycle");
	fixtureRepo(dir);
	const classified = runCli(classifyArgs(), dir);
	assert.equal(classified.status, 0, classified.stderr || classified.stdout);
	assert.equal(payload(classified).retentionClass, "operational");
	assert.equal(payload(classified).ttlMs, 3_600_000);
	assert.equal(payload(classified).legalBasis, "ops-contract");

	const listed = runCli(["retention", "classifications", "--target", ".", "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr || listed.stdout);
	assert.equal(payload(listed).length, 1);
	assert.equal(payload(listed)[0].current, true);

	const classifiedAt = payload(classified).at;
	const expired = new Date(Date.parse(classifiedAt) + 3_600_000).toISOString();
	const retained = runCli(
		["retention", "evaluate", "--target", ".", "--now", classifiedAt, "--json"],
		dir,
	);
	assert.equal(retained.status, 0, retained.stderr || retained.stdout);
	assert.equal(payload(retained).entries[0].verdict, "retained");
	const eligible = runCli(
		["retention", "evaluate", "--target", ".", "--now", expired, "--json"],
		dir,
	);
	assert.equal(payload(eligible).entries[0].verdict, "expired-eligible");
});

test("retention refusals carry stable codes and never write", () => {
	const dir = mkTarget("refusals");
	fixtureRepo(dir);

	const badRecord = runCli(classifyArgs({ "--record": "intent/login" }), dir);
	assert.equal(badRecord.status, 1);
	assert.equal(envelope(badRecord).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badRecord).errors[0], /--record must be <type>:<identity>@<revision>/);

	const badPolicy = runCli(classifyArgs({ "--policy": "policy/tenant-retention" }), dir);
	assert.equal(badPolicy.status, 1);
	assert.equal(envelope(badPolicy).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badPolicy).errors[0], /--policy must be <identity>@<revision>/);

	const vocabulary = runCli(classifyArgs({ "--retention-class": "forever" }), dir);
	assert.equal(vocabulary.status, 1);
	assert.equal(envelope(vocabulary).code, "AMBER_E_RETENTION_INVALID");

	const unresolvedPolicy = runCli(classifyArgs({ "--policy": "policy/ghost@1" }), dir);
	assert.equal(unresolvedPolicy.status, 1);
	assert.equal(envelope(unresolvedPolicy).code, "AMBER_E_RETENTION_INVALID");
	assert.match(
		envelope(unresolvedPolicy).errors[0],
		/does not resolve to a committed policy artifact revision/,
	);

	const unsafe = runCli(classifyArgs({ "--sensitivity": "personal" }), dir);
	assert.equal(unsafe.status, 1);
	assert.equal(envelope(unsafe).code, "AMBER_E_RETENTION_INVALID");
	assert.match(envelope(unsafe).errors[0], /must be minimized before classification/);
	const minimized = runCli(
		classifyArgs({ "--sensitivity": "personal" }).concat(["--minimized"]),
		dir,
	);
	assert.equal(minimized.status, 0, minimized.stderr || minimized.stdout);
	assert.equal(payload(minimized).minimized, true);

	const ghost = runCli(classifyArgs({ "--record": "intent:intent/ghost@1" }), dir);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_RETENTION_NOT_FOUND");

	const truncated = runCli(["retention", "classify", "--target", ".", "--json", "--record"], dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(truncated).errors[0], /--record requires a value/);

	const badNow = runCli(
		["retention", "evaluate", "--target", ".", "--now", "yesterday", "--json"],
		dir,
	);
	assert.equal(badNow.status, 1);
	assert.equal(envelope(badNow).code, "AMBER_E_INVALID_ARG");
});

test("retention corrupt ledgers fail reads closed at the CLI seam", () => {
	const dir = mkTarget("corrupt");
	fixtureRepo(dir);
	assert.equal(runCli(classifyArgs(), dir).status, 0);
	fs.appendFileSync(classificationsPath(dir), '{"kind":"classification"}\n');
	const listed = runCli(["retention", "classifications", "--target", ".", "--json"], dir);
	assert.equal(listed.status, 1);
	assert.equal(envelope(listed).code, "AMBER_E_RETENTION_CORRUPT");
	const evaluated = runCli(["retention", "evaluate", "--target", ".", "--json"], dir);
	assert.equal(evaluated.status, 1);
	assert.equal(envelope(evaluated).code, "AMBER_E_RETENTION_CORRUPT");
});

test("retention help and unknown actions route through the shared dispatcher", () => {
	const dir = mkTarget("help");
	const help = runCli(["retention", "--help"], dir);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /classify --record <type>:<identity>@<rev>/);
	assert.match(help.stdout, /evaluate \[--now <iso>\]/);
	const unknown = runCli(["retention", "delete", "--target", ".", "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.match(
		envelope(unknown).errors[0],
		/retention requires classify, evaluate, or classifications/,
	);
});
