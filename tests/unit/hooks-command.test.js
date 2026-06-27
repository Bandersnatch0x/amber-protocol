"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkGovernance } = require("../../scripts/lib/hooks-command");

const {
	installHook,
	uninstallHook,
	statusHook,
	HOOK_MARKER,
} = require("../../scripts/lib/hooks-command");

function tmpGitRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gh-"));
	fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
	return dir;
}

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

test("install writes a marked pre-commit shim with LF + forward-slash node path", () => {
	const dir = tmpGitRepo();
	const r = installHook(dir, {});
	assert.deepEqual(r.errors, []);
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	const body = fs.readFileSync(hook, "utf8");
	assert.ok(body.startsWith("#!/bin/sh"));
	assert.ok(body.includes(HOOK_MARKER));
	assert.ok(body.includes("hooks check"));
	assert.ok(!body.includes("\\"), "no backslashes in the shim path");
	assert.ok(!body.includes("\r"), "LF endings only");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install --warn-only bakes the literal flag into the shim", () => {
	const dir = tmpGitRepo();
	installHook(dir, { warnOnly: true });
	const body = fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8");
	assert.ok(body.includes("--warn-only"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install is idempotent on its own managed hook", () => {
	const dir = tmpGitRepo();
	installHook(dir, {});
	const r = installHook(dir, {});
	assert.deepEqual(r.errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install refuses to clobber a foreign hook and backs it up", () => {
	const dir = tmpGitRepo();
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
	const r = installHook(dir, {});
	assert.equal(r.errors.length, 0);
	assert.ok(fs.existsSync(hook + ".amber-backup"), "foreign hook backed up");
	assert.ok(fs.readFileSync(hook, "utf8").includes(HOOK_MARKER), "now amber-managed");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("status reports installed / not-installed", () => {
	const dir = tmpGitRepo();
	assert.ok(statusHook(dir).text.toLowerCase().includes("not installed"));
	installHook(dir, {});
	assert.ok(statusHook(dir).text.toLowerCase().includes("installed"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("uninstall removes only an amber-managed hook and restores a backup", () => {
	const dir = tmpGitRepo();
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
	installHook(dir, {});
	const r = uninstallHook(dir, {});
	assert.deepEqual(r.errors, []);
	assert.ok(fs.readFileSync(hook, "utf8").includes("echo mine"), "foreign hook restored");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install errors clearly when there is no .git dir", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-nogit-"));
	const r = installHook(dir, {});
	assert.ok(r.errors.length > 0);
	fs.rmSync(dir, { recursive: true, force: true });
});
