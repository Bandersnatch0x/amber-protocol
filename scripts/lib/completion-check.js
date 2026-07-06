"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readSessionEvents } = require("./session-timeline");
const { readSessionManifest } = require("./session-manifest");
const { resolveStateDirForRead } = require("./state-dir-resolver");
const { gitOutput } = require("./core/git-exec");

function getSessionDir(projectRoot, sessionId) {
	const stateDir = resolveStateDirForRead(projectRoot, { quiet: true });
	return path.join(stateDir, "sessions", sessionId);
}

function hasOpenBlockers(manifest) {
	const blockers = manifest.blockers;
	if (!Array.isArray(blockers)) return false;
	return blockers.some((b) => b && b.status !== "resolved" && b.status !== "closed");
}

// Work evidence: did anything actually change during this session? In a git repo,
// that means a dirty tree OR at least one commit since the session was created.
// Non-git targets cannot be assessed, so they are not blocked (best-effort git,
// matching the rest of the codebase). Amber's own bookkeeping under the state dir
// (.amber/ or legacy .harness/) is excluded from the dirty-tree check — a session
// dirties those files simply by recording its timeline/ledger, which is not work.
function hasWorkEvidence(projectRoot, manifest) {
	const inRepo = gitOutput(projectRoot, ["rev-parse", "--is-inside-work-tree"]) === "true";
	if (!inRepo) return true;
	const dirtyRaw = gitOutput(projectRoot, ["status", "--porcelain"]) || "";
	const realChanges = dirtyRaw
		.split("\n")
		.filter(Boolean)
		.filter((line) => {
			// Format: "XY <path>" or "XY <orig> -> <path>", optionally quoted.
			let p = line.slice(3);
			const arrow = p.indexOf(" -> ");
			if (arrow >= 0) p = p.slice(arrow + 4);
			if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
			return !p.startsWith(".amber/") && !p.startsWith(".harness/");
		});
	if (realChanges.length > 0) return true;
	const since = manifest.createdAt || null;
	if (since) {
		// Compare the latest commit's timestamp to createdAt at millisecond precision
		// in JS. git's --since drops sub-second precision, so a commit made the same
		// second the session was created would be wrongly included — and a no-work
		// repo would then pass "work present". The latest commit is the newest, so it
		// alone tells us whether any commit landed during the session.
		const latest = gitOutput(projectRoot, ["log", "-1", "--format=%cI"]);
		if (latest) {
			const commitDate = Date.parse(latest);
			const createdDate = Date.parse(since);
			if (!Number.isNaN(commitDate) && !Number.isNaN(createdDate) && commitDate > createdDate) {
				return true;
			}
		}
	}
	return false;
}

function evaluateCompletion(projectRoot, sessionId, options = {}) {
	const strict = Boolean(options.strict);
	const sessionDir = getSessionDir(projectRoot, sessionId);
	const loaded = readSessionManifest(sessionDir);
	if (loaded === null) {
		return {
			status: "fail",
			reasons: [],
			missing: ["manifest not found"],
		};
	}
	if (loaded.corrupt) {
		return {
			status: "fail",
			reasons: [],
			missing: ["manifest is corrupt"],
		};
	}
	const manifest = loaded.manifest;
	const timelineEvents = readSessionEvents(sessionDir);
	const eventTypes = new Set(timelineEvents.map((event) => event.type));

	// In strict mode, verification counts only if a command actually ran (executed:true).
	const executedVerification = timelineEvents.some(
		(e) => e.type === "stage_completed" && e.data && e.data.executed === true,
	);
	const claimVerification =
		eventTypes.has("stage_completed") ||
		(Array.isArray(manifest.completedStages) && manifest.completedStages.length > 0);

	const checks = [
		{
			reason: "goal present",
			missing: "goal",
			satisfied: Boolean(manifest.goal),
		},
		{
			reason: "timeline present",
			missing: "timeline",
			satisfied: timelineEvents.length > 0,
		},
		{
			reason: "verification present",
			missing: "verification",
			satisfied: strict ? executedVerification : claimVerification,
		},
		{
			reason: "approval present",
			missing: "approval",
			satisfied: eventTypes.has("gate_passed") || manifest.status === "completed",
		},
		{
			reason: "work present",
			missing: "work",
			satisfied: hasWorkEvidence(projectRoot, manifest),
		},
		{
			reason: "handoff present",
			missing: "handoff",
			satisfied: Boolean(
				(manifest.handoff && manifest.handoff.path) ||
					fs.existsSync(path.join(projectRoot, "session-handoff.md")),
			),
		},
		{
			reason: "no open blockers",
			missing: "open blockers",
			satisfied: !hasOpenBlockers(manifest),
		},
	];

	const reasons = checks.filter((check) => check.satisfied).map((check) => check.reason);
	const missing = checks.filter((check) => !check.satisfied).map((check) => check.missing);

	return {
		status: missing.length === 0 ? "pass" : "fail",
		reasons,
		missing,
	};
}

function formatCompletion(evalResult) {
	const lines = [
		`Completion check status: ${evalResult.status}`,
		`Reasons: ${evalResult.reasons.join(", ") || "none"}`,
	];
	if (evalResult.missing.length > 0) {
		lines.push(`Missing: ${evalResult.missing.join(", ")}`);
	}
	return lines.join("\n");
}

function buildCompletionResult(projectRoot, sessionId, options = {}) {
	const evalResult = evaluateCompletion(projectRoot, sessionId, options);
	const failing = options.strict && evalResult.status !== "pass";
	return {
		text: formatCompletion(evalResult),
		errors: failing ? evalResult.missing : [],
		warnings: evalResult.status !== "pass" ? evalResult.missing : [],
	};
}

module.exports = { evaluateCompletion, formatCompletion, buildCompletionResult };