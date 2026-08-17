"use strict";

// Single read-only git-presence + repo-snapshot primitive for `amber status`.
// Every value degrades to null/false on any git failure (non-git dir, missing
// binary, empty repo) so callers never try/catch. Re-exports isGitRepository as
// the canonical git-presence check. NOTE: completion-check's hasWorkEvidence is
// session-aware (filters .amber/) and is NOT reused here — status wants raw
// primitives; migrating hasWorkEvidence to this module is deferred (SP2).
const { gitOutput } = require("./git-exec");
const { isGitRepository } = require("./git-workflow-detector");

// Parse `git status --porcelain` output into the final path of each entry,
// reusing completion-check's hasWorkEvidence parsing shape: strip the status
// columns, keep only the destination side of `orig -> path` renames, unquote
// quoted paths, and dedupe. gitOutput trims the whole stdout, so an unstaged
// " M path" line arrives as "M path" — the status regex therefore takes one
// or two leading status characters (including T typechange), not a fixed
// slice. Porcelain always emits forward slashes, so no backslash rewriting
// happens (it would corrupt git's C-quoted escapes for non-ASCII paths).
// Returns [] for empty output; callers treat a null snapshot.dirtyPaths
// as "git failed".
const PORCELAIN_STATUS_AND_PATH = /^[\sMADRCUT?!X]{1,2}\s+(.+)$/;

function parsePorcelainPaths(porcelainOutput) {
	if (typeof porcelainOutput !== "string") return [];
	const seen = new Set();
	const paths = [];
	for (const line of porcelainOutput.split(/\r?\n/)) {
		const match = line.match(PORCELAIN_STATUS_AND_PATH);
		if (!match) continue;
		// Format: "XY <path>" or "XY <orig> -> <path>", optionally quoted.
		let p = match[1];
		const arrow = p.indexOf(" -> ");
		if (arrow >= 0) p = p.slice(arrow + 4);
		if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
		if (p === "" || seen.has(p)) continue;
		seen.add(p);
		paths.push(p);
	}
	return paths;
}

function getRepoSnapshot(targetRoot) {
	if (!isGitRepository(targetRoot)) {
		return {
			isGit: false,
			branch: null,
			dirty: false,
			dirtyUntrackedOnly: false,
			lastCommit: null,
			dirtyPaths: null,
		};
	}
	const branch = gitOutput(targetRoot, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
	const dirtyOutput = gitOutput(targetRoot, ["status", "--porcelain"]);
	const dirtyRaw = dirtyOutput || "";
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
		// Final path of every porcelain entry (rename destination, unquoted,
		// forward slashes, deduped); null when git itself failed.
		dirtyPaths: dirtyOutput === null ? null : parsePorcelainPaths(dirtyOutput),
	};
}

module.exports = { isGitRepository, getRepoSnapshot, parsePorcelainPaths };
