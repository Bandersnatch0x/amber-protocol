"use strict";

/**
 * Sync Runtime session orchestration (#158 Stage 3, Team Hub).
 *
 * A sync session is the ordered pipeline: pull remote envelopes → validate
 * and apply → pack local artifacts → commit → push. Envelopes are carried by
 * git (ADR-0019 D1): the .amber/sync/envelopes/ directory is committed to the
 * shared Team Hub repository and exchanged via git remote.
 *
 * Safety: the Sync Runtime never executes target-repository work, never
 * dispatches agents or tools, and never carries source code, secrets, agents,
 * or arbitrary files (baseline authority boundary 6).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ENVELOPES_DIR, validateEnvelope, unpackEnvelope } = require("./sync-remote");

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
	const dir = path.join(cwd, ENVELOPES_DIR);
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
 * Check whether a git remote is configured.
 * @param {string} cwd - Repository root.
 * @returns {boolean}
 */
function hasRemote(cwd) {
	const res = git(cwd, ["remote"]);
	return res.exitCode === 0 && res.stdout.length > 0;
}

/**
 * Commit and push .amber/sync/ envelopes to the shared remote.
 * @param {string} cwd - Repository root.
 * @returns {{committed: number, pushed: boolean, note: string, errors: string[]}}
 */
function pushEnvelopes(cwd) {
	const envelopes = listEnvelopes(cwd);
	if (envelopes.length === 0) {
		return { committed: 0, pushed: false, note: "No envelopes to push.", errors: [] };
	}
	const res = git(cwd, ["add", ".amber/sync"]);
	if (res.exitCode !== 0) {
		return {
			committed: 0,
			pushed: false,
			note: "",
			errors: [`git add failed: ${res.stderr || res.stdout}`],
		};
	}
	const commit = git(cwd, ["commit", "-m", `amber sync: ${envelopes.length} envelope(s)`]);
	const committed = commit.exitCode === 0 ? envelopes.length : 0;
	let pushed = false;
	let note;
	if (committed > 0 && hasRemote(cwd)) {
		const push = git(cwd, ["push"]);
		pushed = push.exitCode === 0;
		note = pushed
			? `Pushed ${committed} envelope(s) to remote.`
			: `Committed ${committed} envelope(s); push skipped (remote error).`;
	} else if (committed > 0) {
		note = `Committed ${committed} envelope(s); no remote configured — local sync only.`;
	} else {
		note = "No changes to commit.";
	}
	return { committed, pushed, note, errors: [] };
}

/**
 * Validate all on-disk envelopes. This is the apply step: every envelope is
 * validated and compatibility-checked; incompatible envelopes are refused.
 * @param {string} cwd - Repository root.
 * @returns {{validated: number, refused: number, errors: string[]}}
 */
function pullEnvelopes(cwd) {
	const envelopes = listEnvelopes(cwd);
	let validated = 0;
	let refused = 0;
	const errors = [];
	for (const envelope of envelopes) {
		const validation = validateEnvelope(envelope);
		if (!validation.valid) {
			refused += 1;
			errors.push(`envelope ${envelope.envelopeId || "?"}: ${validation.errors.join("; ")}`);
			continue;
		}
		const applied = unpackEnvelope(cwd, envelope);
		if (applied.errors.length > 0) {
			refused += 1;
			errors.push(`envelope ${envelope.envelopeId || "?"}: ${applied.errors.join("; ")}`);
			continue;
		}
		validated += 1;
	}
	return { validated, refused, errors };
}

/**
 * Run a full sync session: pull → validate → pack new → commit → push.
 * @param {string} cwd - Repository root.
 * @returns {{session: object, summary: object, errors: string[]}}
 */
function runSyncSession(cwd) {
	const session = createSyncSession(cwd, "sync");
	const errors = [];

	const pulled = pullEnvelopes(cwd);
	errors.push(...pulled.errors);

	const pushed = pushEnvelopes(cwd);
	errors.push(...pushed.errors);

	session.status = errors.length > 0 ? "failed" : "completed";
	session.finishedAt = new Date().toISOString();

	return {
		session,
		summary: {
			pulled: pulled.validated,
			refused: pulled.refused,
			committed: pushed.committed,
			pushed: pushed.pushed,
			note: pushed.note,
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
