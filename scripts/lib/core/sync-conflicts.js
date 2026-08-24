"use strict";

/**
 * Sync Runtime conflict preservation + idempotent replay (#165).
 *
 * Conflicts are recorded append-only in .amber/sync/conflicts.jsonl and never
 * silently overwrite local artifacts. Replay is idempotent: an envelope that
 * was already applied (artifact hash matches) is skipped; an envelope whose
 * artifact diverged records a conflict and refuses to apply.
 *
 * Safety: only .amber/ artifacts may be enveloped/applied. Source code,
 * secrets, agents, tools, and arbitrary files are never transported
 * (baseline authority boundary 6; #158 user stories 19-20).
 */

const fs = require("node:fs");
const path = require("node:path");

const {
	validateEnvelope,
	checkCompatibility,
	hashFile,
	resolveSyncArtifact,
} = require("./sync-remote");
const { readJSONL, appendJSONL } = require("./jsonl");

const CONFLICT_TYPES = Object.freeze([
	"concurrent-edit",
	"generation-mismatch",
	"version-mismatch",
	"identity-mismatch",
]);
const RESOLUTIONS = Object.freeze([
	"pending",
	"local-wins",
	"remote-wins",
	"manual-merge-required",
]);

class ConflictError extends Error {}

function conflictLedgerPath(cwd) {
	return path.join(cwd, ".amber", "sync", "conflicts.jsonl");
}

function ensureSyncDir(cwd) {
	fs.mkdirSync(path.join(cwd, ".amber", "sync"), { recursive: true });
}

function appliedLedgerPath(cwd) {
	return path.join(cwd, ".amber", "sync", "applied.jsonl");
}

function listAppliedEnvelopeIds(cwd) {
	const ledgerPath = appliedLedgerPath(cwd);
	if (!fs.existsSync(ledgerPath)) return new Set();
	return new Set(
		fs
			.readFileSync(ledgerPath, "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line).envelopeId;
				} catch {
					return null;
				}
			})
			.filter(Boolean),
	);
}

function markEnvelopeApplied(cwd, envelopeId) {
	ensureSyncDir(cwd);
	fs.appendFileSync(
		appliedLedgerPath(cwd),
		JSON.stringify({ envelopeId, appliedAt: new Date().toISOString() }) + "\n",
		"utf8",
	);
}

/**
 * Append a conflict record to the ledger (append-only, never overwrites).
 * @param {string} cwd - Repository root.
 * @param {{conflictType: string, envelopeId: string, artifactPath: string, detail: string, resolution?: string}} entry
 * @returns {{record: object}}
 */
function recordConflict(cwd, entry) {
	if (!CONFLICT_TYPES.includes(entry.conflictType)) {
		throw new ConflictError(`unknown conflictType "${entry.conflictType}"`);
	}
	ensureSyncDir(cwd);
	const record = {
		conflictType: entry.conflictType,
		envelopeId: entry.envelopeId,
		artifactPath: entry.artifactPath,
		detail: entry.detail,
		resolution: entry.resolution || "pending",
		recordedAt: new Date().toISOString(),
	};
	appendJSONL(conflictLedgerPath(cwd), record);
	return { record };
}

/**
 * List all recorded conflicts in ledger order.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 */
function listConflicts(cwd) {
	return readJSONL(conflictLedgerPath(cwd), { onCorrupt: "skip" });
}

/**
 * Apply a single envelope: validate, compatibility-check, admit the artifact
 * path, hash-match. On hash mismatch or incompatibility, records a conflict
 * and refuses — the local artifact is never silently overwritten. An invalid
 * artifact path fails as invalid input: it is neither applied nor recorded as
 * a semantic conflict, and no outside file is ever read or hashed.
 * @param {string} cwd - Repository root.
 * @param {object} envelope - The envelope to apply.
 * @returns {{ok: boolean, action: string, conflict: object|null, errors: string[]}}
 */
function applyEnvelope(cwd, envelope) {
	const validation = validateEnvelope(envelope);
	if (!validation.valid) {
		return { ok: false, action: "invalid", conflict: null, errors: validation.errors };
	}
	const compat = checkCompatibility(envelope);
	if (!compat.compatible) {
		const conflict = recordConflict(cwd, {
			conflictType: "version-mismatch",
			envelopeId: envelope.envelopeId,
			artifactPath: envelope.artifactRef.path,
			detail: compat.reasons.join("; "),
		}).record;
		return { ok: false, action: "conflict", conflict, errors: compat.reasons };
	}
	let canonicalPath;
	try {
		canonicalPath = resolveSyncArtifact(cwd, envelope.artifactType, envelope.artifactRef.path);
	} catch (err) {
		return { ok: false, action: "invalid", conflict: null, errors: [err.message] };
	}
	const absPath = path.join(cwd, canonicalPath);
	if (!fs.existsSync(absPath)) {
		// artifact missing: nothing to overwrite, nothing to protect — treat as applied
		return { ok: true, action: "applied", conflict: null, errors: [] };
	}
	const localHash = hashFile(absPath);
	if (localHash !== envelope.artifactRef.hash) {
		const conflict = recordConflict(cwd, {
			conflictType: "concurrent-edit",
			envelopeId: envelope.envelopeId,
			artifactPath: canonicalPath,
			detail: `local hash ${localHash} differs from envelope ${envelope.artifactRef.hash}; local artifact preserved`,
		}).record;
		return {
			ok: false,
			action: "conflict",
			conflict,
			errors: ["local artifact diverged from envelope; refusing to overwrite"],
		};
	}
	return { ok: true, action: "applied", conflict: null, errors: [] };
}

/**
 * Replay all on-disk envelopes idempotently.
 * @param {string} cwd - Repository root.
 * @returns {{applied: number, conflicts: Array<object>, errors: string[]}}
 */
function replayEnvelopes(cwd) {
	const envDir = path.join(cwd, ".amber", "sync", "envelopes");
	const envelopes = [];
	if (fs.existsSync(envDir)) {
		for (const name of fs
			.readdirSync(envDir)
			.filter((f) => f.endsWith(".json"))
			.sort()) {
			try {
				envelopes.push(JSON.parse(fs.readFileSync(path.join(envDir, name), "utf8")));
			} catch {
				// skip unreadable envelope
			}
		}
	}
	let applied = 0;
	const conflicts = [];
	const errors = [];
	const alreadyApplied = listAppliedEnvelopeIds(cwd);
	for (const envelope of envelopes) {
		if (alreadyApplied.has(envelope.envelopeId)) {
			// idempotent: already applied in a previous replay, skip
			continue;
		}
		const result = applyEnvelope(cwd, envelope);
		if (result.ok) {
			applied += 1;
			markEnvelopeApplied(cwd, envelope.envelopeId);
		} else if (result.action === "conflict") {
			conflicts.push(result.conflict);
			// a conflict is terminal for this envelope in this replay pass —
			// mark it handled so repeated replays do not duplicate the record
			markEnvelopeApplied(cwd, envelope.envelopeId);
		} else {
			errors.push(...result.errors);
		}
	}
	return { applied, conflicts, errors };
}

module.exports = {
	CONFLICT_TYPES,
	RESOLUTIONS,
	ConflictError,
	conflictLedgerPath,
	recordConflict,
	listConflicts,
	applyEnvelope,
	replayEnvelopes,
	appliedLedgerPath,
	listAppliedEnvelopeIds,
	markEnvelopeApplied,
};
