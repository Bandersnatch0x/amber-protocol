"use strict";

// Handoff writer: regenerate session-handoff.md from LIVE repo state (features,
// evidence, latest session, git, and the inferred next step) so the file a
// second session reads reflects reality instead of the install template.
// Read-only inputs; the only write is session-handoff.md itself.

const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget } = require("./core/fs-utils");
const { localIsoDate } = require("./core/text-utils");
const { getRepoSnapshot } = require("./core/git-state");
const { classifyDirtyPaths, renderDirtyPathsSection } = require("./core/dirty-paths");

/** Display strings for handoff Repo State — reuses status's git snapshot. */
function gitInfo(targetRoot) {
	const snap = getRepoSnapshot(targetRoot);
	if (!snap.isGit) {
		return { branch: "unknown", dirty: "not a git repository", lastCommit: "none" };
	}
	let dirty = "clean";
	if (snap.dirty) {
		dirty = snap.dirtyUntrackedOnly
			? "untracked only (no tracked edits)"
			: "dirty (tracked and/or untracked changes)";
	}
	return {
		branch: snap.branch || "unknown",
		dirty,
		lastCommit: snap.lastCommit || "none",
	};
}

/**
 * Normalize one feature_list evidence entry to a display record.
 *
 * feature_list allows BOTH free-text strings (common for early "passing"
 * evidence) and structured objects from recordFeatureEvidence / session verify.
 * Spreading a string (`{ ... "npm test: ok" }`) enumerates character indices
 * and drops command/result — every string entry then renders as `(none)`.
 */
function normalizeEvidenceEntry(featureId, entry) {
	if (typeof entry === "string") {
		const text = entry.trim();
		if (!text) return null;
		return {
			feature: featureId,
			command: null,
			result: text,
			date: null,
			sessionId: null,
			freeText: true,
		};
	}
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
	return {
		feature: featureId,
		command: entry.command || null,
		result: entry.result || entry.notes || null,
		date: entry.date || null,
		sessionId: entry.sessionId || null,
		freeText: false,
	};
}

function collectEvidence(features) {
	const all = [];
	for (const f of features) {
		for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
			const normalized = normalizeEvidenceEntry(f.id, e);
			if (normalized) all.push(normalized);
		}
	}
	return all;
}

function formatEvidenceLine(e) {
	if (e.freeText || (!e.command && e.result)) {
		return `- ${e.feature}: ${e.result}`;
	}
	const sid = e.sessionId ? `, session ${String(e.sessionId).slice(0, 8)}` : "";
	return `- ${e.feature}: \`${e.command || "(none)"}\` → ${e.result || "(none)"} (${e.date || "?"}${sid})`;
}

// F023: finish-phase reminder. When the focus feature was accepted with matched
// write-back triggers and no booked review, the handoff names the feature, the
// triggered categories, and the remedy command. Read-only; null when quiet.
function learningWriteBackLines(targetRoot, ctx) {
	if (!ctx || ctx.focus.type !== "feature" || !ctx.focus.id) return null;
	let inspection;
	try {
		const { inspectLearningWriteBack } = require("./core/learning-writeback");
		inspection = inspectLearningWriteBack(targetRoot, { featureId: ctx.focus.id });
	} catch {
		return null;
	}
	if (!inspection || inspection.status !== "unreviewed") return null;
	const categories = inspection.matchedCategories.join(", ");
	return [
		`- Feature ${ctx.focus.id} was accepted with work touching ${categories} paths — the learning write-back review is not booked yet.`,
		"- Inspect with `amber learnings --feature <id>`, then book with `--reviewed [--surface <path>]`.",
	];
}

// F026: finish-time dirty-worktree classification. Groups the live snapshot's
// dirty paths into Amber-managed churn (ignored), the focus feature's booked
// work (bail back: commit before finishing), and outside-scope files (FYI
// only). Read-only — handoff never stages, commits, or prompts; null when the
// tree is clean or only managed churn is present.
function dirtyWorktreeSection(targetRoot, ctx) {
	const snap = getRepoSnapshot(targetRoot);
	if (!snap.isGit || snap.dirtyPaths === null) return null;
	const focusFeaturePaths =
		ctx &&
		ctx.focus.type === "feature" &&
		ctx.focus.id &&
		ctx.state &&
		Array.isArray(ctx.state.features)
			? ctx.state.features.find((f) => f && f.id === ctx.focus.id)
			: null;
	const featurePaths =
		focusFeaturePaths && Array.isArray(focusFeaturePaths.paths)
			? focusFeaturePaths.paths.filter((p) => typeof p === "string" && p.trim() !== "")
			: [];
	const classification = classifyDirtyPaths(snap.dirtyPaths, { featurePaths });
	return renderDirtyPathsSection(classification);
}

function renderHandoff(targetRoot) {
	const { gatherState, buildContext, inferNextStep } = require("./core/lifecycle");
	const { findMostRecentSession, loadSessionManifest } = require("./session-commands");

	const state = gatherState(targetRoot);
	const ctx = buildContext(targetRoot, {});
	const next = inferNextStep(ctx);
	const git = gitInfo(targetRoot);
	const features = state.features;
	const evidence = collectEvidence(features);
	const lastEvidence = evidence[evidence.length - 1] || null;

	let session = null;
	const latestId = findMostRecentSession(targetRoot, {});
	if (latestId) {
		const loaded = loadSessionManifest(targetRoot, latestId);
		session = loaded && loaded.manifest ? loaded.manifest : null;
	}

	const statusCounts = features.reduce((acc, f) => {
		const s = f.status || "not_started";
		acc[s] = (acc[s] || 0) + 1;
		return acc;
	}, {});
	const featureSummary = features.length
		? `${features.length} feature(s): ` +
			Object.entries(statusCounts)
				.map(([s, n]) => `${n} ${s}`)
				.join(", ")
		: "No features registered.";

	// Completed/failed/aborted sessions are history, not "active".
	const terminal = new Set(["completed", "failed", "aborted", "accepted"]);
	const summary = session
		? terminal.has(String(session.status || ""))
			? `Latest session \`${session.sessionId}\` — "${session.goal}" (${session.status}). ${featureSummary}`
			: `Active session \`${session.sessionId}\` — "${session.goal}" (${session.status}). ${featureSummary}`
		: `No active session. ${featureSummary}`;

	const runtime = lastEvidence
		? lastEvidence.freeText || (!lastEvidence.command && lastEvidence.result)
			? [
					`- Command: (free-text evidence)`,
					`- Result: ${lastEvidence.result}`,
					`- When: ${lastEvidence.date || "unknown"}`,
				]
			: [
					`- Command: ${lastEvidence.command || "(none)"}`,
					`- Result: ${lastEvidence.result || "(none)"}`,
					`- When: ${lastEvidence.date || "unknown"}`,
				]
		: ["- Command: not run yet", "- Result: pending"];

	const featureState = features.length
		? features.map((f) => `- ${f.id} [${f.status || "not_started"}] ${f.title || ""}`.trimEnd())
		: ["None."];

	const evidenceLines = evidence.length
		? evidence.map(formatEvidenceLine)
		: ["- No verification evidence recorded yet."];

	const failing = features.filter((f) => (f.status || "") === "failing");
	const blockers = failing.length
		? failing.map((f) => `- ${f.id} is failing — see its evidence.`)
		: ["None recorded."];

	const nextActions = next
		? [`1. ${next.label} — ${next.why}`, `   \`${next.remedy}\``]
		: ["1. All lifecycle steps complete for the current focus — start the next feature."];

	const learningLines = learningWriteBackLines(targetRoot, ctx);
	const dirtySection = dirtyWorktreeSection(targetRoot, ctx);

	// Local calendar date — matches operator "today" (UTC ISO can lag behind
	// evening Asia/local sessions) and validateHandoff's "Last Updated:" scrape.
	const lastUpdated = localIsoDate();

	return [
		"# Session Handoff",
		"",
		`Last Updated: ${lastUpdated}`,
		"",
		"## Summary",
		"",
		summary,
		"",
		"## Repo State",
		"",
		`- Branch: ${git.branch}`,
		`- Uncommitted changes: ${git.dirty}`,
		`- Last commit: ${git.lastCommit}`,
		"",
		"## Runtime / Verification State",
		"",
		...runtime,
		"",
		"## Feature State",
		"",
		...featureState,
		"",
		"## Verification Evidence",
		"",
		...evidenceLines,
		"",
		"## Blockers",
		"",
		...blockers,
		"",
		"## Next Actions",
		"",
		...nextActions,
		...(learningLines ? ["", "## Learning write-back", "", ...learningLines] : []),
		...(dirtySection ? ["", dirtySection] : []),
		"",
	].join("\n");
}

// Regenerate session-handoff.md from live state. Returns { path, changed }.
// changed is false when the freshly-rendered content matches what is on disk
// (idempotent no-op), true when written (or, in dryRun, when it would change).
function writeHandoff(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const handoffPath = path.join(targetRoot, "session-handoff.md");
	const content = renderHandoff(targetRoot);
	const existing = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, "utf8") : null;
	const changed = existing !== content;
	if (changed && !options.dryRun) {
		fs.writeFileSync(handoffPath, content);
	}
	return { path: handoffPath, changed };
}

module.exports = { writeHandoff, renderHandoff, normalizeEvidenceEntry, collectEvidence };
