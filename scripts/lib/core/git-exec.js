"use strict";

const { spawnSync } = require("node:child_process");

// Canonical git invocation seam (F037, survey Finding 4): the only module in
// scripts/lib that spawns git. Every caller builds its failure policy on top of
// gitExec's {ok, status, stdout, stderr}. Never throws; status is -1 when the
// spawn throws or produces no status (missing binary); stdout/stderr are
// trimmed strings, "" when git produced none.
// `preserveWhitespace` keeps stdout byte-faithful. Trimming is right for values a
// human reads (a config value, a rev-parse answer) but destroys payloads where
// leading/trailing whitespace is data: `git ls-files -z` yields raw paths, and a
// file legally named " leading.txt" loses its space and stops resolving on disk.
// Payload callers pass true and do their own NUL handling.
function gitExec(targetRoot, args, options = {}) {
	const preserveWhitespace = Boolean(options.preserveWhitespace);
	// spawnSync's default ceiling is 1 MB. A repo with a few thousand files
	// already exceeds that for `ls-files -z`, and ENOBUFS surfaces as a null
	// status — a silent failure unless a caller can raise the ceiling.
	const spawnOptions = { cwd: targetRoot, encoding: "utf8" };
	if (options.maxBuffer) spawnOptions.maxBuffer = options.maxBuffer;
	if (options.timeout) spawnOptions.timeout = options.timeout;
	try {
		const res = spawnSync("git", args, spawnOptions);
		const status = res && typeof res.status === "number" ? res.status : -1;
		const stdout = res && typeof res.stdout === "string" ? res.stdout : "";
		return {
			ok: status === 0,
			status,
			stdout: preserveWhitespace ? stdout : stdout.trim(),
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

// Same failure policy as gitOutput, but the bytes are returned untouched. Use it
// whenever git's output is a payload rather than a value — NUL-separated lists,
// raw paths, porcelain formats — because trimming there silently corrupts data.
// Null still means "the call failed".
function gitOutputRaw(targetRoot, args, options = {}) {
	const res = gitExec(targetRoot, args, { ...options, preserveWhitespace: true });
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

module.exports = { gitExec, gitOutput, gitOutputRaw, gitRun, isRepository, configGet };
