"use strict";

// Regression test for ledger verify-anchoring printing "undefined" when no
// seal tag exists. The fix surfaces the domain-layer error instead.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dispatch } = require("../../scripts/lib/command-dispatcher");

function setupNoSeal() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-no-seal-"));
	// Init git (required for seal/verify-anchoring)
	require("child_process").execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
	require("child_process").execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
	require("child_process").execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, stdio: "ignore" });
	require("child_process").execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "ignore" });
	return dir;
}

test("ledger verify-anchoring prints a clear error instead of 'undefined undefined' when no seal exists", () => {
	const dir = setupNoSeal();
	const { result, exitCode } = dispatch("ledger", { _: ["verify-anchoring"], target: dir });
	assert.ok(result.text, "result.text exists");
	assert.equal(
		result.text.toLowerCase().includes("no seal tag found"),
		true,
		"error message includes 'no seal tag found'",
	);
	assert.equal(
		result.text.includes("undefined"),
		false,
		"message does NOT include the word 'undefined'",
	);
	assert.equal(exitCode, 1, "exit code is 1 for error");
	fs.rmSync(dir, { recursive: true, force: true });
});
