"use strict";

// Handoff writer: regenerate session-handoff.md from LIVE repo state (features,
// evidence, latest session, git, and the inferred next step) so the file a
// second session reads reflects reality instead of the install template.
// Read-only inputs; the only write is session-handoff.md itself.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveTarget } = require("./core/fs-utils");

function gitInfo(targetRoot) {
	const run = (args) => {
		try {
			const res = spawnSync("git", args, { cwd: targetRoot, encoding: "utf8" });
			return res.status === 0 ? (res.stdout || "").trim() : "";
		} catch {
			return "";
		}
	};
	const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
	const porcelain = run(["status", "--porcelain"]);
	const dirty = porcelain
		? `${porcelain.split(/\r?\n/).filter(Boolean).length} file(s) uncommitted`
		: "clean";
	const lastCommit = run(["log", "-1", "--format=%h %s"]) || "none";
	return { branch, dirty, lastCommit };
}

function collectEvidence(features) {
	const all = [];
	for (const f of features) {
		for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
			all.push({ feature: f.id, ...e });
		}
	}
	return all;
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
			Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(", ")
		: "No features registered.";

	const summary = session
		? `Active session \`${session.sessionId}\` — "${session.goal}" (${session.status}). ${featureSummary}`
		: `No active session. ${featureSummary}`;

	const runtime = lastEvidence
		? [
				`- Command: ${lastEvidence.command || "(none)"}`,
				`- Result: ${lastEvidence.result || "(none)"}`,
				`- When: ${lastEvidence.date || "unknown"}`,
			]
		: ["- Command: not run yet", "- Result: pending"];

	const featureState = features.length
		? features.map((f) => `- ${f.id} [${f.status || "not_started"}] ${f.title || ""}`.trimEnd())
		: ["None."];

	const evidenceLines = evidence.length
		? evidence.map((e) => {
				const sid = e.sessionId ? `, session ${String(e.sessionId).slice(0, 8)}` : "";
				return `- ${e.feature}: \`${e.command || "(none)"}\` → ${e.result || "(none)"} (${e.date || "?"}${sid})`;
			})
		: ["- No verification evidence recorded yet."];

	const failing = features.filter((f) => (f.status || "") === "failing");
	const blockers = failing.length
		? failing.map((f) => `- ${f.id} is failing — see its evidence.`)
		: ["None recorded."];

	const nextActions = next
		? [`1. ${next.label} — ${next.why}`, `   \`${next.remedy}\``]
		: ["1. All lifecycle steps complete for the current focus — start the next feature."];

	return [
		"# Session Handoff",
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

module.exports = { writeHandoff, renderHandoff };
