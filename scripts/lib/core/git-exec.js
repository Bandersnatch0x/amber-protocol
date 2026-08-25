"use strict";

const { spawnSync } = require("node:child_process");

// Canonical git invocation seam (F037, survey Finding 4): the only module in
// scripts/lib that spawns git. Every caller builds its failure policy on top of
// gitExec's {ok, status, stdout, stderr}. Never throws; status is -1 when the
// spawn throws or produces no status (missing binary); stdout/stderr are
// trimmed strings, "" when git produced none.
function gitExec(targetRoot, args) {
	try {
		const res = spawnSync("git", args, { cwd: targetRoot, encoding: "utf8" });
		const status = res && typeof res.status === "number" ? res.status : -1;
		return {
			ok: status === 0,
			status,
			stdout: (res && typeof res.stdout === "string" && res.stdout.trim()) || "",
			stderr: (res && typeof res.stderr === "string" && res.stderr.trim()) || "",
		};
	} catch (e) {
		// Synchronous spawn rejection (e.g. malformed args): surface the message
		// through stderr so gitRun's historical catch behavior is preserved.
		return { ok: false, status: -1, stdout: "", stderr: String((e && e.message) || e) };
	}
}

// Canonical read-only git invocation for repository inspection. Returns trimmed
// stdout on success, or null on any failure (non-zero exit, missing binary,
// thrown error). Never throws — callers treat git data as best-effort and degrade
// when it is absent.
function gitOutput(targetRoot, args) {
	const res = gitExec(targetRoot, args);
	return res.ok ? res.stdout : null;
}

// Canonical write git invocation (tag/commit/etc). Returns {ok, stdout, stderr}.
// ok mirrors exit status; never throws — callers decide how to surface failure.
function gitRun(targetRoot, args) {
	const res = gitExec(targetRoot, args);
	return { ok: res.ok, stdout: res.stdout, stderr: res.stderr };
}

// True when targetRoot sits inside a git work tree (the same check
// git-workflow-detector's isGitRepository performs, exposed here as the seam's
// canonical repo-presence primitive). Never throws.
function isRepository(targetRoot) {
	const res = gitExec(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
	return res.ok && res.stdout === "true";
}

// Read one effective git config value (local > global > system). Returns the
// trimmed value, or "" when the key is unset or anything fails. Never throws.
function configGet(targetRoot, key) {
	const res = gitExec(targetRoot, ["config", key]);
	return res.ok ? res.stdout : "";
}

module.exports = { gitExec, gitOutput, gitRun, isRepository, configGet };
