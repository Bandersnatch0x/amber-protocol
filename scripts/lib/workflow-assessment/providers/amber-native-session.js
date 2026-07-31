"use strict";

// ADR-0008 P2: Amber-native session observation provider. Reads
// .amber/sessions/<id>/manifest.json + timeline.jsonl and extracts normalized
// observation signals (goal, route/stage transitions, validation outcomes,
// failures/retries, approvals, duration). Implements the provider-neutral
// observation contract for the amber-native provider.
//
// Raw transcript content, prompts, and assistant text are never persisted —
// only event types and structured fields. Privacy by default.

const path = require("node:path");
const { readSessionEvents } = require("../../session-timeline");
const { readAllSessionManifests } = require("../../session-manifest");
const { getSessionsDir } = require("../../session-commands");

// Map timeline events to normalized observation signals.
function summarizeSession(manifest, events) {
	const goal = manifest.goal || null;
	const routeId = manifest.route?.id || null;
	const status = manifest.status || null;
	const feature = manifest.feature || null;

	const stageTransitions = [];
	const validationOutcomes = [];
	const failures = [];
	const approvals = [];
	const denials = [];
	let retries = 0;

	for (const e of events) {
		switch (e.type) {
			case "stage_started":
				stageTransitions.push({ stage: e.stage || null, type: "started" });
				break;
			case "stage_completed":
				stageTransitions.push({ stage: e.stage || null, type: "completed" });
				break;
			case "stage_failed":
				failures.push({ stage: e.stage || null, error: e.error?.message || null });
				retries += 1;
				break;
			case "verification_failed":
				validationOutcomes.push({ stage: e.stage || null, result: "failed", error: e.error?.message || null });
				break;
			case "gate_triggered":
				approvals.push({ stage: e.stage || null, gate: e.data?.gateId || null, phase: "triggered" });
				break;
			case "gate_passed":
				approvals.push({ stage: e.stage || null, gate: e.data?.gateId || null, phase: "passed" });
				break;
			case "gate_failed":
				denials.push({ stage: e.stage || null, gate: e.data?.gateId || null });
				break;
			case "session_failed":
			case "session_aborted":
				failures.push({ stage: null, error: e.error?.message || e.type });
				break;
			case "error":
				failures.push({ stage: e.stage || null, error: e.error?.message || "unspecified" });
				break;
			default:
				break;
		}
	}

	const durationMs = (() => {
		if (events.length < 2) return null;
		const first = events[0].timestamp;
		const last = events[events.length - 1].timestamp;
		if (!first || !last) return null;
		const t = new Date(last) - new Date(first);
		// Timeline events are append-ordered but timestamps can drift (manual
		// edit, clock skew); clamp negatives to 0 to honor schema minimum:0
		// rather than invalidate the whole report.
		return Number.isFinite(t) && t >= 0 ? t : 0;
	})();

	return {
		sessionId: manifest.sessionId,
		provider: "amber-native",
		goal,
		routeId,
		status,
		feature,
		stageTransitions: stageTransitions.length,
		validationFailures: validationOutcomes.length,
		failures: failures.length,
		retries,
		approvals: approvals.length,
		denials: denials.length,
		durationMs,
	};
}

function collectSessionObservations(targetRoot) {
	const sessionsDir = getSessionsDir(targetRoot);
	const manifests = readAllSessionManifests(sessionsDir);
	if (manifests.length === 0) {
		return { present: false, sessions: [], coverage: "unavailable" };
	}
	const sessions = manifests.map((manifest) => {
		const sessionDir = path.join(sessionsDir, manifest.sessionId);
		const events = readSessionEvents(sessionDir);
		return summarizeSession(manifest, events);
	});
	return {
		present: true,
		sessions,
		coverage: "covered",
	};
}

module.exports = { collectSessionObservations, summarizeSession };
