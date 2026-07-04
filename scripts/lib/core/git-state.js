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
		return { isGit: false, branch: null, dirty: false, lastCommit: null };
	}
	const branch = gitOutput(targetRoot, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
	const dirtyRaw = gitOutput(targetRoot, ["status", "--porcelain"]);
	const dirty = Boolean(dirtyRaw && dirtyRaw.length > 0);
	const lastCommit = gitOutput(targetRoot, ["log", "-1", "--format=%h %s"]) || null;
	return { isGit: true, branch, dirty, lastCommit };
}

module.exports = { isGitRepository, getRepoSnapshot };
