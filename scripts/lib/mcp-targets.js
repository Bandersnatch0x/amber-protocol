"use strict";

// Deep configured-repository module for the Amber MCP server.
//
// Owns the **configured repository invariant**: every Action and Function
// operates only on the canonical real path of a repository explicitly
// configured at server startup. `_target` cannot escape that set, and
// descendant reads cannot escape a configured root through `..`, absolute
// paths, symlinks, or Windows junctions.
//
// Design reference: docs/plans/F018-Amber-MCP.md (Slice 2) and
// docs/wiki/amber-ontology-mcp.md. This module is policy-pure: it throws on
// violations and never reads beyond the configured surface.

const fs = require("node:fs");
const path = require("node:path");

// ---- canonicalization ---------------------------------------------------

// Resolve a path to its canonical real path. Throws an explicit error when the
// entry is missing or not a directory — fail-closed, never a silent fallback.
function canonicalizeDirectory(target) {
	const resolved = path.resolve(target);
	let real;
	try {
		real = fs.realpathSync(resolved);
	} catch (err) {
		throw new Error(`target is not an existing directory: ${target} (${err.code || err.message})`, {
			cause: err,
		});
	}
	// realpathSync resolves symlinks/junctions but not the directory check.
	let stat;
	try {
		stat = fs.statSync(real);
	} catch (err) {
		throw new Error(`target is not an existing directory: ${target} (${err.code || err.message})`, {
			cause: err,
		});
	}
	if (!stat.isDirectory()) {
		throw new Error(`target is not a directory: ${target}`);
	}
	return real;
}

// Build the configured target set once at startup.
//   primary  -> the --target path (required)
//   extra    -> additional --targets entries
// Returns { primary, targets: [primary, ...unique extras], index: Set } where
// every entry is a canonical real path. Rejects missing, non-directory, and
// duplicate (by real path) entries explicitly.
function buildConfiguredTargets({ primary, extras = [] }) {
	if (!primary) {
		throw new Error("a primary --target repository is required");
	}
	const canonicalPrimary = canonicalizeDirectory(primary);
	const index = new Set([canonicalPrimary]);
	const targets = [canonicalPrimary];
	for (const raw of extras) {
		const canonical = canonicalizeDirectory(raw);
		if (index.has(canonical)) {
			throw new Error(`duplicate configured target (same real path as another): ${raw}`);
		}
		index.add(canonical);
		targets.push(canonical);
	}
	return { primary: canonicalPrimary, targets, index };
}

// ---- containment --------------------------------------------------------

// Lexical containment: is `child` equal to or nested under `root`? Both must
// already be absolute. Uses path.sep so it is correct on POSIX and Windows.
function isDescendant(child, root) {
	const c = path.resolve(child);
	const r = path.resolve(root);
	if (c === r) return true;
	const prefix = r + path.sep;
	return c.startsWith(prefix);
}

// Canonical, real-path-aware containment. Resolves symlinks/junctions on the
// child when it exists, so a link that points outside the root is rejected.
// For a non-existent child (a read probe before the file is known to exist),
// falls back to lexical containment against the already-canonical root — the
// root itself was canonicalized at startup, so `..`/absolute escape is caught.
function containsRealPath(child, root) {
	const lexical = path.resolve(root, child);
	if (!isDescendant(lexical, root)) return false;
	if (fs.existsSync(lexical)) {
		let real;
		try {
			real = fs.realpathSync(lexical);
		} catch {
			return false;
		}
		return isDescendant(real, root);
	}
	// The leaf may not exist yet, but an existing ancestor can still be a
	// symlink/junction that redirects the eventual read outside the root.
	let ancestor = path.dirname(lexical);
	while (isDescendant(ancestor, root) && ancestor !== root && !fs.existsSync(ancestor)) {
		ancestor = path.dirname(ancestor);
	}
	try {
		return isDescendant(fs.realpathSync(ancestor), root);
	} catch {
		return false;
	}
}

// Resolve a repository-relative path for a read, rejecting every escape vector:
// absolute paths, `..` traversal, and symlink/junction redirection. Existing
// entries return the canonical path that passed containment validation; only
// missing entries return a validated lexical path for existence probes.
function resolveRepoPath(root, rel, { mustExist = false } = {}) {
	if (typeof rel !== "string" || rel === "") {
		throw new Error("path is empty");
	}
	if (path.isAbsolute(rel)) {
		throw new Error(`path must be repository-relative, got absolute path: ${rel}`);
	}
	const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
	const resolved = path.resolve(realRoot, rel);
	if (!isDescendant(resolved, realRoot)) {
		throw new Error(`path escapes repository root: ${rel}`);
	}
	if (fs.existsSync(resolved)) {
		let canonical;
		try {
			canonical = fs.realpathSync(resolved);
		} catch (error) {
			throw new Error(`path cannot be resolved safely: ${rel}`, { cause: error });
		}
		if (!isDescendant(canonical, realRoot)) {
			throw new Error(`path escapes repository root via link: ${rel}`);
		}
		return canonical;
	}
	if (!containsRealPath(rel, realRoot)) {
		throw new Error(`path escapes repository root via link: ${rel}`);
	}
	if (mustExist) {
		const error = new Error(`path does not exist: ${rel}`);
		error.code = "ENOENT";
		throw error;
	}
	return resolved;
}

// Resolve a descendant path only after proving its base is an exact member of
// the configured repository set. Function handlers use this interface so an
// arbitrary `base` argument cannot widen the server's startup configuration.
function resolveConfiguredRepoPath({ configured, target, relativePath, mustExist = false }) {
	const canonicalTarget = canonicalizeDirectory(target || configured.primary);
	if (!configured.index.has(canonicalTarget)) {
		throw new Error(`path base is not a configured repository: ${target}`);
	}
	return resolveRepoPath(canonicalTarget, relativePath, { mustExist });
}

// ---- _target resolution -------------------------------------------------

// Resolve a per-call `_target` override to an exact member of the configured
// set. Relative overrides are resolved against `cwd` first, then compared by
// canonical real path. Returns the canonical target, or null when no override
// was supplied (caller falls back to the primary). Throws on escape / unknown.
function resolveTargetOverride({ override, configured, cwd }) {
	if (override === undefined || override === null || override === "") return null;
	const base = cwd || process.cwd();
	const resolved = path.resolve(base, override);
	let canonical;
	try {
		const stat = fs.statSync(resolved);
		if (!stat.isDirectory()) {
			throw new Error(`_target is not a directory: ${override}`);
		}
		canonical = fs.realpathSync(resolved);
		// Re-verify after realpath: a symlink swap between stat and realpath
		// could change the target type. Consistent with canonicalizeDirectory.
		if (!fs.statSync(canonical).isDirectory()) {
			throw new Error(`_target resolved to a non-directory: ${override}`);
		}
	} catch (err) {
		if (err.code === "ENOENT") {
			throw new Error(`_target does not exist: ${override}`, { cause: err });
		}
		throw err;
	}
	if (!configured.index.has(canonical)) {
		throw new Error(
			`_target is not a configured repository: ${override} ` +
				`(configure it with --targets; see the _target migration note)`,
		);
	}
	return canonical;
}

module.exports = {
	canonicalizeDirectory,
	buildConfiguredTargets,
	isDescendant,
	resolveConfiguredRepoPath,
	resolveRepoPath,
	resolveTargetOverride,
};
