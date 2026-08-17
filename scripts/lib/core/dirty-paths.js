"use strict";

// Finish-time dirty-worktree classification (F026).
//
// Pure, deterministic routing of `git status --porcelain` paths into three
// buckets: Amber-managed churn (expected, ignored), the focus feature's own
// uncommitted work (bail back: commit before finishing), and everything else
// (outside scope — reported once, never touched). No fs, no git, no writes:
// the caller supplies the path list, this module only sorts it.

// Normalize one candidate path: accept Windows separators, drop a leading
// "./", collapse to forward slashes. Returns null for non-strings/blank.
function normalizeDirtyPath(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
}

// Amber's own bookkeeping: the state dir (current `.amber/` or legacy
// `.harness/`), the `.amber-backup` suffix hooks-command already uses, and
// the regenerated handoff file itself (Amber's own output re-dirties the
// tree on every second consecutive handoff run).
function isManagedPath(normalized) {
	return (
		normalized === ".amber" ||
		normalized.startsWith(".amber/") ||
		normalized === ".harness" || // legacy state dir itself
		normalized.startsWith(".harness/") ||
		normalized.endsWith(".amber-backup") ||
		normalized === "session-handoff.md"
	);
}

// Segment-boundary containment: `path` matches a booked feature path when it
// IS that path or lives under it as a directory — "src/a.js" matches "src"
// and "src/", but "srcx/a.js" must not match "src".
function isUnderOrEqualTo(normalized, bookedPath) {
	if (normalized === bookedPath) return true;
	if (bookedPath.endsWith("/")) return normalized.startsWith(bookedPath);
	return normalized.startsWith(bookedPath + "/");
}

// git abbreviates a fully-untracked directory to "dir/" in porcelain output,
// so the booked file inside it never appears verbatim. A dirty DIRECTORY that
// contains a booked path is this session's work too (tracked changes are
// always files; only untracked dirs end with "/").
function isDirectoryContainingBookedPath(normalized, bookedPaths) {
	if (!normalized.endsWith("/")) return false;
	return bookedPaths.some((bookedPath) => isUnderOrEqualTo(bookedPath, normalized));
}

/**
 * Classify dirty worktree paths into managed / focusWork / outsideScope.
 *
 * - managed: `.amber/`, legacy `.harness/`, or `*.amber-backup` — expected
 *   session-state churn.
 * - focusWork: path equal to or under (segment boundary) one of the focus
 *   feature's booked `paths` — this session's own work.
 * - outsideScope: everything else — parallel or unbooked work.
 *
 * Null/undefined/empty input and non-string entries are filtered; the three
 * arrays preserve input order. Pure: no filesystem, no git, no writes.
 */
function classifyDirtyPaths(dirtyPaths, { featurePaths = [] } = {}) {
	const managed = [];
	const focusWork = [];
	const outsideScope = [];

	const booked = (Array.isArray(featurePaths) ? featurePaths : [])
		.map(normalizeDirtyPath)
		.filter(Boolean);

	const candidates = Array.isArray(dirtyPaths) ? dirtyPaths : [];
	for (const entry of candidates) {
		const normalized = normalizeDirtyPath(entry);
		if (!normalized) continue;
		if (isManagedPath(normalized)) {
			managed.push(normalized);
		} else if (
			booked.some((bookedPath) => isUnderOrEqualTo(normalized, bookedPath)) ||
			isDirectoryContainingBookedPath(normalized, booked)
		) {
			focusWork.push(normalized);
		} else {
			outsideScope.push(normalized);
		}
	}

	return { managed, focusWork, outsideScope };
}

// The section renders only when there is something to act on: a fully clean
// tree or managed-only churn stays quiet (noise reduction).
function shouldRenderSection(classification) {
	if (!classification) return false;
	return classification.focusWork.length > 0 || classification.outsideScope.length > 0;
}

/**
 * Render the conditional "Dirty worktree" handoff section. Returns null when
 * the classification is quiet (clean tree or managed-only churn); otherwise a
 * text block: booked-work paths with a single bail-back line, outside-scope
 * paths with a single FYI line, and managed churn summarized as a count.
 * Read-only by construction — it only formats strings.
 */
function renderDirtyPathsSection(classification) {
	if (!shouldRenderSection(classification)) return null;

	const lines = ["## Dirty worktree", ""];
	if (classification.focusWork.length > 0) {
		for (const p of classification.focusWork) lines.push(`- ${p}`);
		lines.push(
			"- this session's booked work is uncommitted — commit it before finishing; handoff does not commit.",
		);
	}
	if (classification.outsideScope.length > 0) {
		for (const p of classification.outsideScope) lines.push(`- ${p}`);
		lines.push("- not booked to the focus feature — parallel work or unbooked; left untouched.");
	}
	if (classification.managed.length > 0) {
		lines.push(
			`- plus ${classification.managed.length} Amber-managed path(s) (session state) — ignored.`,
		);
	}
	return lines.join("\n");
}

module.exports = { classifyDirtyPaths, renderDirtyPathsSection };
