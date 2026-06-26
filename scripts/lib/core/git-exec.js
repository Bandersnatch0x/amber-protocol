"use strict";

const { spawnSync } = require("node:child_process");

// Canonical read-only git invocation for repository inspection. Returns trimmed
// stdout on success, or null on any failure (non-zero exit, missing binary,
// thrown error). Never throws — callers treat git data as best-effort and degrade
// when it is absent.
function gitOutput(targetRoot, args) {
	try {
		const res = spawnSync("git", args, { cwd: targetRoot, encoding: "utf8" });
		if (!res || res.status !== 0 || typeof res.stdout !== "string") {
			return null;
		}
		return res.stdout.trim();
	} catch {
		return null;
	}
}

module.exports = { gitOutput };
