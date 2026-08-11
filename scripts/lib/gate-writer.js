"use strict";

const fs = require("fs");
const path = require("path");
const { writeJson } = require("./core/fs-utils");

// Persists route gates to disk so the web viewer (apps/web) can render them.
//
// Filesystem contract — must match apps/web/server/lib/gate-reader.ts:
//   .amber/sessions/{sessionId}/gates/{gateId}.gate.json      (gate definition)
//   .amber/sessions/{sessionId}/gates/{gateId}.decision.json  (resolution)
//
// The web's validateGateId allows [a-zA-Z0-9_-]+, which every route gate id
// already satisfies; we still guard here so a malformed route definition can't
// write outside the gates dir.
const GATE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function gatesDir(sessionDir) {
	return path.join(sessionDir, "gates");
}

function isValidGateId(gateId) {
	return typeof gateId === "string" && GATE_ID_PATTERN.test(gateId);
}

// Build a gateId -> stageName lookup from a route. A route attaches a gate to a
// stage via `stage.gateAfter`, so the gate's stage is the stage that triggers
// it. Gates with no owning stage fall back to "unknown" (mirrors gate-reader).
function buildGateStageMap(route) {
	const map = new Map();
	for (const stage of route?.stages || []) {
		if (!stage.gateAfter) continue;
		if (map.has(stage.gateAfter)) {
			// Two stages claim the same gate. The first assignment wins so the
			// gate stays anchored to its original stage; the duplicate is a
			// route definition error that should be fixed there.
			console.error(
				`route gate "${stage.gateAfter}" is referenced by stage "${stage.name}" ` +
					`but is already owned by stage "${map.get(stage.gateAfter)}" (ignoring duplicate)`,
			);
			continue;
		}
		map.set(stage.gateAfter, stage.name);
	}
	return map;
}

// Write one `.gate.json` (pending definition). Idempotent at the call site:
// callers should avoid clobbering a gate that already has a decision.
// triggeredAt defaults to now; the backfill script passes the session's
// historical createdAt so re-materialized gates keep their original time.
function writeGateDefinition(sessionDir, sessionId, gate, stage, triggeredAt) {
	if (!isValidGateId(gate.id)) {
		return false;
	}
	const filePath = path.join(gatesDir(sessionDir), `${gate.id}.gate.json`);
	// Idempotent: never overwrite an existing gate definition (it may already
	// have a decision). Callers that need to recreate should delete first.
	if (fs.existsSync(filePath)) {
		return false;
	}
	writeJson(filePath, {
		gateId: gate.id,
		sessionId,
		type: gate.type || "user-approval",
		stage: stage || "unknown",
		description: gate.description || "",
		triggeredAt: triggeredAt || new Date().toISOString(),
	});
	return true;
}

// Materialize every gate declared by a route as a pending `.gate.json`. Called
// at session creation so the web viewer shows gates as "pending" before any
// approval happens. Returns the number of gate files written. triggeredAt lets
// the backfill script stamp historical sessions with their original createdAt.
function writeRouteGates(sessionDir, sessionId, route, triggeredAt) {
	const gates = route?.gates || [];
	if (gates.length === 0) {
		return 0;
	}
	const stageMap = buildGateStageMap(route);
	let written = 0;
	for (const gate of gates) {
		if (writeGateDefinition(sessionDir, sessionId, gate, stageMap.get(gate.id), triggeredAt)) {
			written++;
		}
	}
	return written;
}

// Write a `.decision.json` recording how a gate was resolved. Matches the
// GateDecision shape read by gate-reader.ts (decision/resolvedAt/resolvedBy/
// reason). resolvedBy is "human" since approvals come from `amber session
// approve`. resolvedAt defaults to now; the backfill passes the timestamp of
// the original gate_passed event.
function writeGateDecision(sessionDir, gateId, decision, reason, resolvedAt) {
	if (!isValidGateId(gateId)) {
		return false;
	}
	const filePath = path.join(gatesDir(sessionDir), `${gateId}.decision.json`);
	// Idempotent: never overwrite an existing decision. A gate can only be
	// resolved once; subsequent calls with the same gateId are no-ops.
	if (fs.existsSync(filePath)) {
		return false;
	}
	const data = {
		decision,
		resolvedAt: resolvedAt || new Date().toISOString(),
		resolvedBy: "human",
	};
	if (reason) {
		data.reason = reason;
	}
	writeJson(filePath, data);
	return true;
}

module.exports = {
	buildGateStageMap,
	writeGateDefinition,
	writeRouteGates,
	writeGateDecision,
};
