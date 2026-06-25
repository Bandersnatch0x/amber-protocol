"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readTimeline } = require("./timeline-reader");
const { resolveStateDirForRead } = require("./state-dir-resolver");

function getSessionDir(projectRoot, sessionId) {
	const stateDir = resolveStateDirForRead(projectRoot, { quiet: true });
	return path.join(stateDir, "sessions", sessionId);
}

function hasOpenBlockers(manifest) {
	const blockers = manifest.blockers;
	if (!Array.isArray(blockers)) return false;
	return blockers.some((b) => b && b.status !== "resolved" && b.status !== "closed");
}

function evaluateCompletion(projectRoot, sessionId) {
	const sessionDir = getSessionDir(projectRoot, sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");
	const timelinePath = path.join(sessionDir, "timeline.jsonl");

	if (!fs.existsSync(manifestPath)) {
		return {
			status: "fail",
			reasons: [],
			missing: ["manifest not found"],
		};
	}

	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch {
		// A present but unparseable manifest fails the gate, symmetric with the
		// missing case above, instead of crashing the completion check.
		return {
			status: "fail",
			reasons: [],
			missing: ["manifest is corrupt"],
		};
	}
	const timelineEvents = readTimeline(timelinePath);
	const eventTypes = new Set(timelineEvents.map((event) => event.type));

	// Check feature_list.json for supplementary evidence (bridges the two systems).
	let hasFeatureEvidence = false;
	try {
		const featureListPath = path.join(projectRoot, "feature_list.json");
		if (fs.existsSync(featureListPath)) {
			const featureData = JSON.parse(fs.readFileSync(featureListPath, "utf8"));
			if (Array.isArray(featureData.features)) {
				hasFeatureEvidence = featureData.features.some(
					(f) => f && Array.isArray(f.evidence) && f.evidence.length > 0,
				);
			}
		}
	} catch (_) {
		// feature_list.json is optional — skip if missing or corrupt.
	}

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
			satisfied:
				eventTypes.has("stage_completed") ||
				(Array.isArray(manifest.completedStages) &&
					manifest.completedStages.length > 0),
		},
		{
			reason: "approval present",
			missing: "approval",
			satisfied:
				eventTypes.has("gate_passed") || manifest.status === "completed",
		},
		{
			reason: "feature evidence present",
			missing: "feature evidence",
			satisfied:
				// Satisfied if session has verification OR feature_list.json has evidence.
				eventTypes.has("stage_completed") ||
				(Array.isArray(manifest.completedStages) &&
					manifest.completedStages.length > 0) ||
				hasFeatureEvidence,
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
	const evalResult = evaluateCompletion(projectRoot, sessionId);
	const failing = options.strict && evalResult.status !== "pass";
	return {
		text: formatCompletion(evalResult),
		errors: failing ? evalResult.missing : [],
		warnings: evalResult.status !== "pass" ? evalResult.missing : [],
	};
}

module.exports = { evaluateCompletion, formatCompletion, buildCompletionResult };