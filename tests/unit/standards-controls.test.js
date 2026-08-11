"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mapStandards } = require("../../scripts/lib/core/standards");
const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-std2-"));
}

test("empty repo: every risk present=false (no controls deployed)", () => {
	const dir = tmpDir();
	const r = mapStandards(dir, "owasp-agentic");
	assert.ok(
		r.risks.every((x) => x.present === false),
		"no controls in an empty repo",
	);
	assert.ok(
		r.controls === undefined || typeof r.controls === "object",
		"controls object may exist",
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("rules.json with a deny rule marks ASI02 present", () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "d", action: "deny", match: "regex", pattern: "rm -rf", mapsTo: ["ASI02"] }],
		}),
	);
	const r = mapStandards(dir, "owasp-agentic");
	assert.equal(r.risks.find((x) => x.id === "ASI02").present, true);
	// ASI04 needs an allow rule, not just a deny — honest
	assert.equal(r.risks.find((x) => x.id === "ASI04").present, false);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("rules.json with an allow rule marks ASI04 present (command pinning)", () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "a", action: "allow", match: "prefix", pattern: "node ", mapsTo: ["ASI04"] }],
		}),
	);
	const r = mapStandards(dir, "owasp-agentic");
	assert.equal(r.risks.find((x) => x.id === "ASI04").present, true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a non-empty hash-chain ledger marks ASI06 present", () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, ".amber", "loops", "c1"), { recursive: true });
	appendLedgerRecord(path.join(dir, ".amber", "loops", "c1", "ledger.jsonl"), {
		kind: "approved",
		approvalKey: "ap1",
	});
	const r = mapStandards(dir, "owasp-agentic");
	assert.equal(r.risks.find((x) => x.id === "ASI06").present, true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("an approved ledger record marks ASI09 present", () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, ".amber", "loops", "c1"), { recursive: true });
	appendLedgerRecord(path.join(dir, ".amber", "loops", "c1", "ledger.jsonl"), {
		kind: "approved",
		approvalKey: "ap1",
	});
	const r = mapStandards(dir, "owasp-agentic");
	assert.equal(r.risks.find((x) => x.id === "ASI09").present, true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("runtime-only risks (ASI01/03/05/07/08/10) are never present regardless of state", () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			rules: [
				{ id: "x", action: "deny", mapsTo: ["ASI01", "ASI03", "ASI05", "ASI07", "ASI08", "ASI10"] },
			],
		}),
	);
	const r = mapStandards(dir, "owasp-agentic");
	for (const id of ["ASI01", "ASI03", "ASI05", "ASI07", "ASI08", "ASI10"]) {
		assert.equal(
			r.risks.find((x) => x.id === id).present,
			false,
			`${id} must stay out-of-scope/present=false`,
		);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a controls summary object is returned for transparency", () => {
	const dir = tmpDir();
	const r = mapStandards(dir, "owasp-agentic");
	assert.ok(r.controls && typeof r.controls === "object");
	assert.ok("hasPolicyRules" in r.controls);
	assert.ok("hasHashChainLedger" in r.controls);
	assert.ok("hasApprovalRecord" in r.controls);
	fs.rmSync(dir, { recursive: true, force: true });
});
