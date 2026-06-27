"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkGovernance } = require("../../scripts/lib/hooks-command");

function tmpRepo(featureList) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hooks-"));
	if (featureList) {
		fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify(featureList));
	}
	return dir;
}

test("C1: a 'passing' feature with no evidence is blocked with its code", () => {
	const dir = tmpRepo({ features: [{ id: "F1", status: "passing", evidence: [] }] });
	const r = checkGovernance(dir, {});
	assert.equal(r.errors.length > 0, true);
	assert.ok(r.errors.join("\n").includes("AMBER_E_FEATURE_NO_EVIDENCE"));
	assert.ok(r.errors.join("\n").includes("AMBER_E_HOOK_PRECOMMIT_BLOCKED"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("C1: a 'passing' feature WITH evidence passes clean", () => {
	const dir = tmpRepo({
		features: [
			{
				id: "F1",
				status: "passing",
				evidence: [{ date: "2026-06-27", command: "npm test", result: "ok" }],
			},
		],
	});
	const r = checkGovernance(dir, {});
	assert.deepEqual(r.errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("not_started features and missing feature_list are clean", () => {
	const a = tmpRepo({ features: [{ id: "F1", status: "not_started", evidence: [] }] });
	assert.deepEqual(checkGovernance(a, {}).errors, []);
	const b = tmpRepo(null);
	assert.deepEqual(checkGovernance(b, {}).errors, []);
	fs.rmSync(a, { recursive: true, force: true });
	fs.rmSync(b, { recursive: true, force: true });
});

test("--warn-only downgrades errors to warnings (exit clean)", () => {
	const dir = tmpRepo({ features: [{ id: "F1", status: "accepted", evidence: [] }] });
	const r = checkGovernance(dir, { warnOnly: true });
	assert.deepEqual(r.errors, []);
	assert.ok(r.warnings.length > 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a literal-null feature_list does not crash", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hooks-"));
	fs.writeFileSync(path.join(dir, "feature_list.json"), "null");
	assert.deepEqual(checkGovernance(dir, {}).errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});
