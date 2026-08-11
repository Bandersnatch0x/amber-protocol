"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const L = require("../../scripts/lib/core/loop-ledger");
const { sealLedger, verifyAnchoring } = require("../../scripts/lib/core/ledger-seal");

function mkHarnessWithLedger() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-"));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
	const ledgerDir = path.join(dir, ".amber", "sessions", "S1");
	fs.mkdirSync(ledgerDir, { recursive: true });
	L.appendLedgerRecord(path.join(ledgerDir, "ledger.jsonl"), {
		kind: "approved",
		approvalKey: "a1",
	});
	fs.writeFileSync(path.join(dir, "x"), "1");
	execSync("git add -A && git commit -q -m init", { cwd: dir });
	return dir;
}

test("seal creates a tag and verifies anchored immediately after", () => {
	const dir = mkHarnessWithLedger();
	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, true);
	assert.match(seal.tagName, /^amber-ledger-seal-/);
	const v = verifyAnchoring(dir);
	assert.strictEqual(v.anchored, true);
	assert.strictEqual(v.ledgerChangedSinceSeal, 0);
});

test("appending a record after seal flips verify to not-anchored", () => {
	const dir = mkHarnessWithLedger();
	sealLedger(dir);
	L.appendLedgerRecord(path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl"), {
		kind: "executed",
		consumedApprovalKey: "a1",
	});
	const v = verifyAnchoring(dir);
	assert.strictEqual(v.anchored, false);
	assert.strictEqual(v.ledgerChangedSinceSeal, 1);
	assert.strictEqual(v.drift[0].status, "tail-changed");
});

test("verify on a repo with no seal reports anchored:false", () => {
	const dir = mkHarnessWithLedger();
	const v = verifyAnchoring(dir);
	assert.strictEqual(v.anchored, false);
	assert.match(v.errors[0], /no seal tag/i);
});

test("seal refuses on a non-git repo", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-"));
	fs.mkdirSync(path.join(dir, ".amber", "sessions", "S1"), { recursive: true });
	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, false);
	assert.ok(seal.errors.length > 0);
});
