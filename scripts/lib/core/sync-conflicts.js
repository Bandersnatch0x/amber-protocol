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

const { admitEnvelope } = require("./sync-remote");
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

function refusedLedgerPath(cwd) {
	return path.join(cwd, ".amber", "sync", "refused.jsonl");
}

function readLedgerIds(ledgerPath) {
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

function listAppliedEnvelopeIds(cwd) {
	return readLedgerIds(appliedLedgerPath(cwd));
}

function listRefusedEnvelopeIds(cwd) {
	return readLedgerIds(refusedLedgerPath(cwd));
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
 * Track a semantically refused envelope for replay idempotency. A refused
 * envelope is NEVER marked applied (F035 S3); this separate ledger is what
 * keeps repeated replays from recording duplicate conflicts.
 * @param {string} cwd - Repository root.
 * @param {string} envelopeId - Envelope id.
 */
function markEnvelopeRefused(cwd, envelopeId) {
	ensureSyncDir(cwd);
	fs.appendFileSync(
		refusedLedgerPath(cwd),
		JSON.stringify({ envelopeId, refusedAt: new Date().toISOString() }) + "\n",
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
 * Apply a single envelope through the shared admission pipeline
 * (schema → path/type → protocol → tenant → repository → generation →
 * content hash). Every semantic refusal is recorded as one pending
 * conflict and never marks the envelope applied; invalid input (schema or
 * path admission) is neither applied nor recorded as a semantic conflict,
 * and no outside file is ever read or hashed.
 * @param {string} cwd - Repository root.
 * @param {object} envelope - The envelope to apply.
 * @returns {{ok: boolean, action: string, conflict: object|null, errors: string[]}}
 */
function applyEnvelope(cwd, envelope) {
	const admission = admitEnvelope(cwd, envelope);
	if (admission.status === "invalid") {
		return { ok: false, action: "invalid", conflict: null, errors: admission.errors };
	}
	if (admission.status === "refused") {
		const conflict = recordConflict(cwd, {
			conflictType: admission.conflictType,
			envelopeId: envelope.envelopeId,
			artifactPath: admission.artifactPath || envelope.artifactRef.path,
			detail: admission.errors.join("; "),
		}).record;
		return { ok: false, action: "conflict", conflict, errors: admission.errors };
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
	const alreadyRefused = listRefusedEnvelopeIds(cwd);
	for (const envelope of envelopes) {
		if (alreadyApplied.has(envelope.envelopeId)) {
			// idempotent: already applied in a previous replay, skip
			continue;
		}
		if (alreadyRefused.has(envelope.envelopeId)) {
			// idempotent: already refused in a previous replay, skip — the
			// conflict was recorded once and must not be duplicated
			continue;
		}
		const result = applyEnvelope(cwd, envelope);
		if (result.ok) {
			applied += 1;
			markEnvelopeApplied(cwd, envelope.envelopeId);
		} else if (result.action === "conflict") {
			conflicts.push(result.conflict);
			// a refused envelope is terminal in this replay pass — track it in
			// the refused ledger so repeated replays do not duplicate the
			// record, while it never counts as applied
			markEnvelopeRefused(cwd, envelope.envelopeId);
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
	refusedLedgerPath,
	recordConflict,
	listConflicts,
	applyEnvelope,
	replayEnvelopes,
	appliedLedgerPath,
	listAppliedEnvelopeIds,
	listRefusedEnvelopeIds,
	markEnvelopeApplied,
	markEnvelopeRefused,
};
