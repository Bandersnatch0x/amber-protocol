"use strict";
const fs = require("node:fs");
const path = require("node:path");

const CANONICAL_STATE_DIR = ".amber";
const LEGACY_STATE_DIR = ".harness";

let warnedLegacyRead = false;
let warnedBothExist = false;

// Read resolution: prefer .amber; fall back to legacy .harness (warn once).
function resolveStateDirForRead(projectRoot, options = {}) {
	const amberDir = path.join(projectRoot, CANONICAL_STATE_DIR);
	const legacyDir = path.join(projectRoot, LEGACY_STATE_DIR);
	const amberExists = fs.existsSync(amberDir);
	const legacyExists = fs.existsSync(legacyDir);
	if (amberExists) {
		if (legacyExists && !warnedBothExist && !options.quiet) {
			process.stderr.write(
				"[amber] both .amber and .harness exist; using .amber and ignoring .harness " +
					"(run `amber migrate state` to consolidate)\n",
			);
			warnedBothExist = true;
		}
		return amberDir;
	}
	if (legacyExists) {
		if (!warnedLegacyRead && !options.quiet) {
			process.stderr.write(
				"[amber] reading legacy .harness state; new entities are created under .amber " +
					"(run `amber migrate state` to migrate)\n",
			);
			warnedLegacyRead = true;
		}
		return legacyDir;
	}
	return amberDir;
}

// Create resolution: new entities always live under .amber.
function resolveStateDirForCreate(projectRoot) {
	return path.join(projectRoot, CANONICAL_STATE_DIR);
}

/**
 * Build a path under the read-resolved state dir (legacy .harness fallback
 * applies). Use for reading state that may predate the rename.
 * @param {string} projectRoot
 * @param {...string} segments
 */
function statePath(projectRoot, ...segments) {
	return path.join(resolveStateDirForRead(projectRoot), ...segments);
}

/**
 * Build a path for state that is about to be created or written: always
 * under .amber, never the legacy dir.
 * @param {string} projectRoot
 * @param {...string} segments
 */
function statePathForCreate(projectRoot, ...segments) {
	return path.join(resolveStateDirForCreate(projectRoot), ...segments);
}

// test hook: reset once-per-process warning latches
function resetWarnings() {
	warnedLegacyRead = false;
	warnedBothExist = false;
}

module.exports = {
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
	resolveStateDirForRead,
	resolveStateDirForCreate,
	statePath,
	statePathForCreate,
	resetWarnings,
};
