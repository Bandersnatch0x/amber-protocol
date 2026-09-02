"use strict";

// Optional F049/F050 doctor health: when `.amber/artifacts|gates|approvals`
// exist, doctor runs fail-closed read-only integrity through the existing
// list/show seams. Absent dirs skip the checks (doctor behavior unchanged).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { doctor } = require("../../scripts/lib/core/doctor");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");

const ARTIFACTS_CHECK = "Canonical artifacts store";
const GATES_CHECK = "Gate outcome ledger";
const APPROVALS_CHECK = "Approval registry";
const GOVERNED_CHECKS = [ARTIFACTS_CHECK, GATES_CHECK, APPROVALS_CHECK];

const FIXTURES = path.join(__dirname, "..", "fixtures");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-doctor-f049-${label}-`));
}

function checkNamed(result, name) {
	return result.checks.find((check) => check.name === name);
}

function snapshotTree(root) {
	const files = {};
	if (!fs.existsSync(root)) return files;
	const walk = (rel) => {
		const abs = path.join(root, rel);
		for (const name of fs.readdirSync(abs).sort()) {
			const childRel = rel ? `${rel}/${name}` : name;
			const childAbs = path.join(root, childRel);
			if (fs.statSync(childAbs).isDirectory()) walk(childRel);
			else {
				files[childRel] = crypto
					.createHash("sha256")
					.update(fs.readFileSync(childAbs))
					.digest("hex");
			}
		}
	};
	walk("");
	return files;
}

function copyFixtureFile(dir, destRel, fixtureRel) {
	const dest = path.join(dir, destRel);
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(path.join(FIXTURES, fixtureRel), dest);
}

function admitIntent(dir) {
	const result = admitArtifact(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: "# Intent: login bug\n\nOutcome: users can log in again.\n",
		provenance: { author: "product-owner", source: "ticket#42" },
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result;
}

function journalPath(dir) {
	return path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug", "journal.jsonl");
}

test("doctor skips F049/F050 checks when artifacts/gates/approvals dirs are absent", () => {
	const dir = mkTarget("skip");
	const result = doctor(dir);
	for (const name of GOVERNED_CHECKS) {
		assert.equal(checkNamed(result, name), undefined, `${name} must be skipped`);
	}
	assert.equal(
		result.errors.some((error) => /AMBER_E_(ARTIFACT|GATE|APPROVAL)_/.test(error)),
		false,
		`unexpected governed-state errors: ${result.errors.join("; ")}`,
	);
});

test("present empty artifacts/gates/approvals dirs pass with stable check names", () => {
	const dir = mkTarget("empty-present");
	fs.mkdirSync(path.join(dir, ".amber", "artifacts"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".amber", "gates"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".amber", "approvals"), { recursive: true });
	const before = snapshotTree(path.join(dir, ".amber"));
	const result = doctor(dir);
	assert.deepEqual(snapshotTree(path.join(dir, ".amber")), before, "doctor must not write");

	const artifacts = checkNamed(result, ARTIFACTS_CHECK);
	const gates = checkNamed(result, GATES_CHECK);
	const approvals = checkNamed(result, APPROVALS_CHECK);
	assert.ok(artifacts, "Canonical artifacts store check present");
	assert.ok(gates, "Gate outcome ledger check present");
	assert.ok(approvals, "Approval registry check present");
	assert.equal(artifacts.passed, true);
	assert.equal(gates.passed, true);
	assert.equal(approvals.passed, true);
	assert.equal(artifacts.remedy, undefined);
	assert.equal(gates.remedy, undefined);
	assert.equal(approvals.remedy, undefined);
	assert.equal(
		result.errors.some((error) => /AMBER_E_(ARTIFACT|GATE|APPROVAL)_/.test(error)),
		false,
		`empty stores must not error: ${result.errors.join("; ")}`,
	);
});

test("healthy artifact store / gate outcomes / approval registry pass", () => {
	const dir = mkTarget("healthy");
	admitIntent(dir);
	copyFixtureFile(
		dir,
		path.join(".amber", "gates", "outcomes.jsonl"),
		"gate/outcomes-lifecycle.golden.jsonl",
	);
	copyFixtureFile(
		dir,
		path.join(".amber", "approvals", "registry.jsonl"),
		"approval/registry-lifecycle.golden.jsonl",
	);
	const before = snapshotTree(path.join(dir, ".amber"));
	const result = doctor(dir);
	assert.deepEqual(snapshotTree(path.join(dir, ".amber")), before, "doctor must not write");

	const artifacts = checkNamed(result, ARTIFACTS_CHECK);
	const gates = checkNamed(result, GATES_CHECK);
	const approvals = checkNamed(result, APPROVALS_CHECK);
	assert.equal(artifacts.passed, true, artifacts.detail);
	assert.equal(gates.passed, true, gates.detail);
	assert.equal(approvals.passed, true, approvals.detail);
	assert.match(artifacts.detail, /1 committed artifact/);
	assert.match(gates.detail, /2 outcome/);
	assert.match(approvals.detail, /2 approval/);
	assert.equal(
		result.errors.some((error) => /AMBER_E_(ARTIFACT|GATE|APPROVAL)_/.test(error)),
		false,
		`healthy stores must not error: ${result.errors.join("; ")}`,
	);
});

test("corrupt artifact journal fails closed with AMBER_E_ARTIFACT_JOURNAL_CORRUPT", () => {
	const dir = mkTarget("artifact-corrupt");
	admitIntent(dir);
	fs.appendFileSync(journalPath(dir), "{ not json\n");
	const before = snapshotTree(path.join(dir, ".amber"));
	const result = doctor(dir);
	assert.deepEqual(snapshotTree(path.join(dir, ".amber")), before, "doctor must not repair");

	const artifacts = checkNamed(result, ARTIFACTS_CHECK);
	assert.equal(artifacts.passed, false);
	assert.match(artifacts.detail, /AMBER_E_ARTIFACT_JOURNAL_CORRUPT/);
	assert.match(artifacts.remedy, /amber artifact list/);
	assert.match(artifacts.remedy, /amber artifact show/);
	assert.ok(
		result.errors.some((error) => error.includes("AMBER_E_ARTIFACT_JOURNAL_CORRUPT")),
	);
});

test("tampered artifact Body fails closed with AMBER_E_ARTIFACT_HASH_MISMATCH", () => {
	const dir = mkTarget("artifact-hash");
	admitIntent(dir);
	fs.writeFileSync(
		path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug", "rev-1.md"),
		"# tampered\n",
	);
	const result = doctor(dir);
	const artifacts = checkNamed(result, ARTIFACTS_CHECK);
	assert.equal(artifacts.passed, false);
	assert.match(artifacts.detail, /AMBER_E_ARTIFACT_HASH_MISMATCH/);
	assert.ok(result.errors.some((error) => error.includes("AMBER_E_ARTIFACT_HASH_MISMATCH")));
});

test("broken gate outcome hash chain fails closed with AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT", () => {
	const dir = mkTarget("gate-chain");
	copyFixtureFile(
		dir,
		path.join(".amber", "gates", "outcomes.jsonl"),
		"gate/outcomes-lifecycle.golden.jsonl",
	);
	const ledger = path.join(dir, ".amber", "gates", "outcomes.jsonl");
	const events = fs
		.readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	events[0].verdict = "pass-edited";
	fs.writeFileSync(ledger, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
	const before = snapshotTree(path.join(dir, ".amber"));
	const result = doctor(dir);
	assert.deepEqual(snapshotTree(path.join(dir, ".amber")), before, "doctor must not repair");

	const gates = checkNamed(result, GATES_CHECK);
	assert.equal(gates.passed, false);
	assert.match(gates.detail, /AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT/);
	assert.match(gates.remedy, /amber gate list/);
	assert.match(gates.remedy, /amber gate show/);
	assert.ok(
		result.errors.some((error) => error.includes("AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT")),
	);
});

test("unreadable gate outcome ledger fails closed with AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT", () => {
	const dir = mkTarget("gate-unreadable");
	const ledger = path.join(dir, ".amber", "gates", "outcomes.jsonl");
	fs.mkdirSync(ledger, { recursive: true });
	const result = doctor(dir);
	const gates = checkNamed(result, GATES_CHECK);
	assert.equal(gates.passed, false);
	assert.match(gates.detail, /AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT/);
	assert.ok(
		result.errors.some((error) => error.includes("AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT")),
	);
});

test("broken approval registry hash chain fails closed with AMBER_E_APPROVAL_REGISTRY_CORRUPT", () => {
	const dir = mkTarget("approval-chain");
	copyFixtureFile(
		dir,
		path.join(".amber", "approvals", "registry.jsonl"),
		"approval/registry-lifecycle.golden.jsonl",
	);
	const ledger = path.join(dir, ".amber", "approvals", "registry.jsonl");
	const events = fs
		.readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	events[0].subject = "spec/tampered@9";
	fs.writeFileSync(ledger, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
	const before = snapshotTree(path.join(dir, ".amber"));
	const result = doctor(dir);
	assert.deepEqual(snapshotTree(path.join(dir, ".amber")), before, "doctor must not repair");

	const approvals = checkNamed(result, APPROVALS_CHECK);
	assert.equal(approvals.passed, false);
	assert.match(approvals.detail, /AMBER_E_APPROVAL_REGISTRY_CORRUPT/);
	assert.match(approvals.remedy, /amber approval list/);
	assert.match(approvals.remedy, /amber approval show/);
	assert.ok(
		result.errors.some((error) => error.includes("AMBER_E_APPROVAL_REGISTRY_CORRUPT")),
	);
});

test("unreadable approval registry fails closed with AMBER_E_APPROVAL_REGISTRY_CORRUPT", () => {
	const dir = mkTarget("approval-unreadable");
	const ledger = path.join(dir, ".amber", "approvals", "registry.jsonl");
	fs.mkdirSync(ledger, { recursive: true });
	const result = doctor(dir);
	const approvals = checkNamed(result, APPROVALS_CHECK);
	assert.equal(approvals.passed, false);
	assert.match(approvals.detail, /AMBER_E_APPROVAL_REGISTRY_CORRUPT/);
	assert.ok(
		result.errors.some((error) => error.includes("AMBER_E_APPROVAL_REGISTRY_CORRUPT")),
	);
});

test("doctor source reuses list/show read seams and adds no write/repair path", () => {
	const source = fs.readFileSync(path.join(__dirname, "../../scripts/lib/core/doctor.js"), "utf8");
	assert.match(source, /listArtifacts/);
	assert.match(source, /showArtifact/);
	assert.match(source, /listGateOutcomes/);
	assert.match(source, /showGateOutcome/);
	assert.match(source, /listApprovals/);
	assert.match(source, /showApproval/);
	for (const forbidden of [
		"admitArtifact",
		"grantApproval",
		"revokeApproval",
		"consumeApproval",
		"evaluateGate",
		"appendJSONL",
		"writeJSONL",
		"recoverDanglingPrepared",
	]) {
		assert.equal(source.includes(forbidden), false, `doctor must not call ${forbidden}`);
	}
});
