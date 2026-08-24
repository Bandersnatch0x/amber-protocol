"use strict";

/**
 * Sync Runtime session orchestration (#158 Stage 3, Team Hub).
 *
 * A sync session is the ordered pipeline: pull remote envelopes (admit and
 * apply them through the shared admission pipeline) → prepare the transport
 * report. Transport is preparation/report-only (F035 decision D1): the
 * session lists the envelopes, the affected `.amber/sync/**` paths, and the
 * proposed git operations as strings for a human to replay, but it NEVER
 * runs `git add`, `git commit`, or `git push` — reintroducing live transport
 * requires its own accepted ADR and governed Action. Envelopes are carried
 * by git (ADR-0019 D1): the .amber/sync/envelopes/ directory is committed to
 * the shared Team Hub repository and exchanged via git remote.
 *
 * Pull-path refusals (version/identity/generation/concurrent-edit) are
 * recorded in the conflict ledger (.amber/sync/conflicts.jsonl) and never
 * marked applied; invalid structural envelopes fail explicitly as errors
 * without touching the conflict ledger.
 *
 * Safety: the Sync Runtime never executes target-repository work, never
 * dispatches agents or tools, and never carries source code, secrets, agents,
 * or arbitrary files (baseline authority boundary 6).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { replayEnvelopes, listConflicts, listRefusedEnvelopeIds } = require("./sync-conflicts");
const { collectFilesBySuffix, toPortablePath } = require("./fs-utils");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

/**
 * Create a sync session record.
 * @param {string} cwd - Repository root.
 * @param {string} operation - e.g. "sync", "push", "pull".
 * @returns {object} Session record.
 */
function createSyncSession(cwd, operation) {
	return {
		sessionId: crypto.randomUUID(),
		operation,
		startedAt: new Date().toISOString(),
		status: "in-progress",
		target: cwd,
	};
}

/**
 * List envelopes currently in .amber/sync/envelopes/.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>} Parsed envelopes.
 */
function listEnvelopes(cwd) {
	// Pure read of envelopes written by the sync transport (post-rename state
	// kind: never existed under .harness).
	const dir = statePath(cwd, "sync", "envelopes");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

function git(cwd, args) {
	try {
		const res = spawnSync("git", args, { cwd, encoding: "utf8" });
		if (res.status === 0) {
			return { exitCode: 0, stdout: (res.stdout || "").trim() };
		}
		return {
			exitCode: res.status === null ? -1 : res.status,
			stdout: "",
			stderr: (res.stderr || "").toString(),
		};
	} catch (err) {
		return { exitCode: 1, stdout: "", stderr: err.message };
	}
}

/**
 * Check whether a git remote is configured. Read-only query: the Sync Runtime
 * never mutates git state (F035 D1), it only reports whether `git push` would
 * be part of the proposed operations.
 * @param {string} cwd - Repository root.
 * @returns {boolean}
 */
function hasRemote(cwd) {
	const res = git(cwd, ["remote"]);
	return res.exitCode === 0 && res.stdout.length > 0;
}

/**
 * List every file under .amber/sync/ as a repository-relative POSIX path.
 * These are the paths the proposed `git add .amber/sync` would stage.
 * @param {string} cwd - Repository root.
 * @returns {Array<string>} Sorted repository-relative POSIX paths.
 */
function listSyncTreePaths(cwd) {
	const root = statePath(cwd, "sync");
	return collectFilesBySuffix(root)
		.map((abs) => toPortablePath(path.relative(path.resolve(cwd), abs)))
		.sort();
}

/**
 * Prepare the transport report for .amber/sync/ envelopes WITHOUT executing
 * any git command (F035 D1: transport is preparation/report-only, and there
 * is no --execute escape hatch). The report is replayable: it lists the
 * envelopes, the affected .amber/sync/** paths, and the proposed git
 * operations as strings for a human to review and run. `git push` is only
 * proposed when a remote is configured (read-only query).
 * @param {string} cwd - Repository root.
 * @returns {{
 *   mode: string,
 *   envelopeCount: number,
 *   envelopeIds: string[],
 *   envelopePaths: string[],
 *   affectedPaths: string[],
 *   proposedOps: string[],
 *   remoteConfigured: boolean,
 *   conflictCount: number,
 *   refusedCount: number,
 *   note: string,
 *   errors: string[],
 * }}
 */
function pushEnvelopes(cwd) {
	const envelopes = listEnvelopes(cwd);
	const envelopeIds = envelopes
		.map((envelope) => envelope.envelopeId)
		.filter((id) => typeof id === "string");
	// Envelopes always live in the canonical sync home (post-rename state
	// kind), matching the `git add .amber/sync` proposal below.
	const envelopeDir = toPortablePath(
		path.relative(path.resolve(cwd), statePathForCreate(cwd, "sync", "envelopes")),
	);
	const envelopePaths = envelopeIds.map((id) => `${envelopeDir}/${id}.json`).sort();
	const affectedPaths = listSyncTreePaths(cwd);
	const remoteConfigured = hasRemote(cwd);
	const proposedOps =
		envelopePaths.length === 0
			? []
			: [
					"git add .amber/sync",
					`git commit -m "amber sync: ${envelopePaths.length} envelope(s)"`,
					...(remoteConfigured ? ["git push"] : []),
				];
	const conflictCount = listConflicts(cwd).length;
	const refusedCount = listRefusedEnvelopeIds(cwd).size;
	let note;
	if (envelopePaths.length === 0) {
		note = "No envelopes to prepare; no git operations proposed.";
	} else if (remoteConfigured) {
		note = `Prepared ${envelopePaths.length} envelope(s) for transport; proposed git operations were NOT executed.`;
	} else {
		note = `Prepared ${envelopePaths.length} envelope(s) for transport; no remote configured — git push not proposed. No git operations were executed.`;
	}
	return {
		mode: "prepare",
		envelopeCount: envelopes.length,
		envelopeIds,
		envelopePaths,
		affectedPaths,
		proposedOps,
		remoteConfigured,
		conflictCount,
		refusedCount,
		note,
		errors: [],
	};
}

/**
 * Pull (admit and apply) all on-disk envelopes through the shared admission
 * pipeline (schema → path/type → protocol → tenant → repository →
 * generation → content hash). Every semantic refusal (version/identity/
 * generation/concurrent-edit) is recorded as one pending conflict in
 * .amber/sync/conflicts.jsonl and never marked applied; invalid structural
 * envelopes (schema/path) fail explicitly in `errors` without touching the
 * conflict ledger. Pulls are idempotent across passes.
 * @param {string} cwd - Repository root.
 * @returns {{validated: number, refused: number, conflicts: Array<object>, errors: string[]}}
 */
function pullEnvelopes(cwd) {
	const result = replayEnvelopes(cwd);
	return {
		validated: result.applied,
		refused: result.conflicts.length,
		conflicts: result.conflicts,
		errors: result.errors,
	};
}

/**
 * Run a full sync session: pull (admit + apply) → prepare the transport
 * report. No git command is ever executed (F035 D1). Semantic refusals are
 * persisted as conflicts and surface in the summary; only invalid structural
 * envelopes fail the session through `errors`.
 * @param {string} cwd - Repository root.
 * @returns {{session: object, summary: object, errors: string[]}}
 */
function runSyncSession(cwd) {
	const session = createSyncSession(cwd, "sync");
	const errors = [];

	const pulled = pullEnvelopes(cwd);
	errors.push(...pulled.errors);

	const preparation = pushEnvelopes(cwd);
	errors.push(...preparation.errors);

	session.status = errors.length > 0 ? "failed" : "completed";
	session.finishedAt = new Date().toISOString();

	return {
		session,
		summary: {
			pulled: pulled.validated,
			refused: pulled.refused,
			conflicts: pulled.conflicts,
			preparation,
		},
		errors,
	};
}

module.exports = {
	createSyncSession,
	listEnvelopes,
	pushEnvelopes,
	pullEnvelopes,
	runSyncSession,
};
