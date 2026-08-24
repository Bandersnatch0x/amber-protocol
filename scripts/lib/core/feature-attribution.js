"use strict";

/**
 * Feature attribution reads (architecture review #1).
 *
 * A plan belongs to the feature named in its `Feature:` header, and a session
 * carries a feature too. When accept runs with a session, the two must agree —
 * otherwise accepting would mark/append the WRONG feature (e.g. accept F001's
 * plan while completing an F002 session). These read-only helpers surface both
 * so the accept handler can validate before acceptPlan mutates
 * feature_list.json.
 *
 * Extracted from command-dispatcher.js: the domain reads now live in a core
 * module (locality — plan/session feature logic sits with the artifacts it
 * reads) and are testable in isolation. Reads only; never writes.
 */

const fs = require("node:fs");
const path = require("node:path");
const { readPlanField } = require("./planning");

/**
 * Resolve the feature id a session manifest carries, or null when unknown.
 * @param {string} targetRoot - Repository root.
 * @param {string} sessionId - Session id.
 * @returns {string|null}
 */
function resolveSessionFeature(targetRoot, sessionId) {
	try {
		const { resolveStateDirForRead } = require("../state-dir-resolver");
		const { readSessionManifest } = require("../session-manifest");
		const stateDir = resolveStateDirForRead(targetRoot, { quiet: true });
		const loaded = readSessionManifest(path.join(stateDir, "sessions", sessionId));
		if (!loaded || loaded.corrupt || !loaded.manifest) return null;
		return loaded.manifest.feature || null;
	} catch {
		return null;
	}
}

/**
 * Resolve the feature named in a plan's `Feature:` header, or null when the
 * plan is unreadable or names no feature.
 * @param {string} targetRoot - Repository root.
 * @param {string} planRelPath - Plan path relative to the root.
 * @returns {string|null}
 */
function readPlanFeature(targetRoot, planRelPath) {
	if (!planRelPath) return null;
	try {
		const abs = path.resolve(targetRoot, planRelPath);
		if (!fs.existsSync(abs)) return null;
		return readPlanField(fs.readFileSync(abs, "utf8"), "Feature") || null;
	} catch {
		return null;
	}
}

module.exports = {
	resolveSessionFeature,
	readPlanFeature,
};
