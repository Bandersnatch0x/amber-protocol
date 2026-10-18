"use strict";
const { trackTempDir } = require("../helpers/harness");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync, execFileSync } = require("node:child_process");
const L = require("../../scripts/lib/core/loop-ledger");
const { sealLedger, verifyAnchoring } = require("../../scripts/lib/core/ledger-seal");

function mkHarnessWithLedger() {
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-")));
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

function appendRecord(dir, session, approvalKey) {
	const ledgerDir = path.join(dir, ".amber", "sessions", session);
	fs.mkdirSync(ledgerDir, { recursive: true });
	const lp = path.join(ledgerDir, "ledger.jsonl");
	L.appendLedgerRecord(lp, { kind: "approved", approvalKey });
	return lp;
}

function commitChanges(dir) {
	execSync("git add -A && git commit -q -m update", { cwd: dir });
}

function removeAnchor(lp) {
	fs.rmSync(`${lp}.anchor`, { recursive: true, force: true });
}

function breakRecord(lp) {
	fs.writeFileSync(lp, fs.readFileSync(lp, "utf8").replace('"a1"', '"changed"'));
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

test("editing a sealed record flips verify to not-anchored", () => {
	const dir = mkHarnessWithLedger();
	sealLedger(dir);
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	fs.writeFileSync(lp, fs.readFileSync(lp, "utf8").replace('"a1"', '"a2"'));
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
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-")));
	fs.mkdirSync(path.join(dir, ".amber", "sessions", "S1"), { recursive: true });
	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, false);
	assert.ok(seal.errors.length > 0);
});

test("seal adopts a legacy unanchored ledger with --adopt-legacy", () => {
	const dir = mkHarnessWithLedger();
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	appendRecord(dir, "S1", "a2");
	removeAnchor(lp);
	commitChanges(dir);

	const seal = sealLedger(dir, { adoptLegacy: true });
	assert.strictEqual(seal.sealed, true);
	assert.deepStrictEqual(seal.adopted, [{ home: "sessions", sub: "S1", recordCount: 2 }]);
	assert.deepStrictEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 2 });
	assert.strictEqual(verifyAnchoring(dir).anchored, true);
	// The tag carries the provenance, so a verifier sees which ledgers were adopted.
	const message = execFileSync("git", ["tag", "-l", "--format=%(contents)", seal.tagName], {
		cwd: dir,
	})
		.toString()
		.trim();
	assert.deepStrictEqual(JSON.parse(message).adopted, [
		{ home: "sessions", sub: "S1", recordCount: 2 },
	]);
});

test("seal refuses an unanchored ledger without --adopt-legacy and writes no anchor", () => {
	const dir = mkHarnessWithLedger();
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	removeAnchor(lp);
	commitChanges(dir);

	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, false);
	assert.match(seal.errors.join("; "), /AMBER_E_LEDGER_ADOPT_REQUIRED/);
	assert.strictEqual(fs.existsSync(`${lp}.anchor`), false);
});

test("seal refuses a broken chain without creating its anchor", () => {
	const dir = mkHarnessWithLedger();
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	removeAnchor(lp);
	breakRecord(lp);
	commitChanges(dir);

	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, false);
	assert.match(seal.errors.join("; "), /AMBER_E_LEDGER_RESEAL_REFUSED/);
	assert.strictEqual(fs.existsSync(`${lp}.anchor`), false);
});

test("seal refuses mixed legacy and broken ledgers without adopting the legacy ledger", () => {
	const dir = mkHarnessWithLedger();
	const legacy = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	removeAnchor(legacy);
	const broken = appendRecord(dir, "S2", "a1");
	breakRecord(broken);
	commitChanges(dir);

	const seal = sealLedger(dir);
	assert.strictEqual(seal.sealed, false);
	assert.match(seal.errors.join("; "), /AMBER_E_LEDGER_RESEAL_REFUSED/);
	assert.strictEqual(fs.existsSync(`${legacy}.anchor`), false);
});

test("seal checks previous-seal drift before adopting a deleted anchor", () => {
	const dir = mkHarnessWithLedger();
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	appendRecord(dir, "S1", "a2");
	commitChanges(dir);
	assert.strictEqual(sealLedger(dir).sealed, true);
	// Drop the sealed tail AND the anchor: the remaining chain still hashes, so it reads
	// as a legacy anchor-missing ledger unless the drift check runs first. Adopting first
	// would write the anchor for the shortened chain and launder it past verify.
	const records = fs.readFileSync(lp, "utf8").trimEnd().split("\n");
	fs.writeFileSync(lp, `${records.slice(0, -1).join("\n")}\n`);
	removeAnchor(lp);
	commitChanges(dir);

	const seal = sealLedger(dir, { adoptLegacy: true });
	assert.strictEqual(seal.sealed, false);
	assert.strictEqual(fs.existsSync(`${lp}.anchor`), false);
});
