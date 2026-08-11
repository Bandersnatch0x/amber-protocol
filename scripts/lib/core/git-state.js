"use strict";

// Single read-only git-presence + repo-snapshot primitive for `amber status`.
// Every value degrades to null/false on any git failure (non-git dir, missing
// binary, empty repo) so callers never try/catch. Re-exports isGitRepository as
// the canonical git-presence check. NOTE: completion-check's hasWorkEvidence is
// session-aware (filters .amber/) and is NOT reused here — status wants raw
// primitives; migrating hasWorkEvidence to this module is deferred (SP2).
const { gitOutput } = require("./git-exec");
const { isGitRepository } = require("./git-workflow-detector");

function getRepoSnapshot(targetRoot) {
	if (!isGitRepository(targetRoot)) {
		return {
			isGit: false,
			branch: null,
			dirty: false,
			dirtyUntrackedOnly: false,
			lastCommit: null,
		};
	}
	const branch = gitOutput(targetRoot, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
	const dirtyRaw = gitOutput(targetRoot, ["status", "--porcelain"]) || "";
	const lines = dirtyRaw.split(/\r?\n/).filter(Boolean);
	// porcelain: "?? path" / "!! path" are untracked/ignored; anything else is
	// a tracked-file change (M/A/D/R/C/U in the first two columns).
	const untrackedOnly =
		lines.length > 0 && lines.every((line) => line.startsWith("??") || line.startsWith("!!"));
	const dirty = lines.length > 0;
	const lastCommit = gitOutput(targetRoot, ["log", "-1", "--format=%h %s"]) || null;
	return {
		isGit: true,
		branch,
		dirty,
		// True when the only noise is untracked/ignored paths (e.g. local .scratch/).
		// Callers can still treat dirty=true as "not clean"; this flag softens the label.
		dirtyUntrackedOnly: dirty && untrackedOnly,
		lastCommit,
	};
}

module.exports = { isGitRepository, getRepoSnapshot };
