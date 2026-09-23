"use strict";

// Trusted-control governance contract §5.3 — the `ExecutionDomainAdapter`
// seam (v3.1 §26 five methods). This is the ONE seam the Core/domain split
// hangs from: Core never imports git semantics directly (G-invariant 8 /
// guard tests in tests/unit/core-domain-separation.test.js); a domain obtains
// its execution semantics by delegating through this contract.
//
// Relationship to F051: F051's `adapter-registry.js` is a read-only MIGRATION
// adapter (register/readReceipt/shadowCompare/cutover) with different
// semantics; the two share the ledger-family factory base and nothing else.
//
// First implementation: the Coding domain (worktree + git-exec). The
// ResearchProcess boundary (context-runtime contract §6) is the second
// consumer, implemented in `research-adapter.js` — the precondition §5.2
// records for any physical `src/` relocation, which stays deferred.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { statePath } = require("../state-dir-resolver");

const CODING_DOMAIN_ADAPTER_ID = "execution-domain/coding-worktree";
const CODING_DOMAIN_ADAPTER_VERSION = "1";

/**
 * Five-method contract, method 1 — capabilities(): the Coding domain's
 * declared capability face, delegating to the F052 registry (EFFECT_KINDS).
 */
function capabilities(cwd) {
	const { EFFECT_KINDS, CREDENTIAL_REQUIREMENTS } = require("./runner-registry");
	let registry = [];
	if (cwd) {
		try {
			const { foldRunnerRegistry } = require("./runner-registry");
			const fold = foldRunnerRegistry(cwd);
			registry = fold.capabilities;
		} catch {
			registry = [];
		}
	}
	return {
		adapterId: CODING_DOMAIN_ADAPTER_ID,
		adapterVersion: CODING_DOMAIN_ADAPTER_VERSION,
		effects: EFFECT_KINDS,
		credentialRequirements: CREDENTIAL_REQUIREMENTS,
		registry,
	};
}

/**
 * Five-method contract, method 2 — contexts(): the accessible context face,
 * delegating to the Loadout builder's read surface (presence declarations
 * only; no content reads here).
 */
function contexts(cwd) {
	const loadoutDir = statePath(cwd, "context", "loadouts");
	const loadouts = fs.existsSync(loadoutDir)
		? fs.readdirSync(loadoutDir).filter((f) => f.endsWith(".json"))
		: [];
	return {
		adapterId: CODING_DOMAIN_ADAPTER_ID,
		loadouts,
	};
}

/**
 * Five-method contract, method 3 — executions(): the execution boundary
 * declaration. The Coding domain executes one command inside an isolated
 * git worktree; every attempt is recorded in the governed ledger by the
 * caller (governed-runner owns the four gates — the adapter only carries the
 * domain semantics).
 */
function executions() {
	return {
		adapterId: CODING_DOMAIN_ADAPTER_ID,
		family: "CodingWorktree",
		isolation: "git-worktree",
		notes:
			"the four governance gates stay in governed-runner (Core); this adapter carries only worktree/spawn semantics",
	};
}

/**
 * Five-method contract, method 4 — verifiers(): the Coding domain's
 * verification face (evidence receipts verify + execution-validator
 * heuristics).
 */
function verifiers() {
	return [
		{ verifier: "evidence.verify", kind: "deterministic" },
		{
			verifier: "execution-validator",
			kind: "heuristic",
			note: "worktree-clean metadata check; the .git mtime heuristic extracts to this adapter during migration",
		},
	];
}

/**
 * Five-method contract, method 5 — validate(): run legality against the
 * Coding domain — a run is legal when the target is a git repository.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validate(targetRoot) {
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return { ok: false, reason: "the Coding domain requires a git repository target" };
	}
	return { ok: true };
}

// ── ExecutionBoundary mapping (§5.4) — the six boundary methods ─────────────

// The §5.5 row 11 split (governance contract G-9): the governed-runner's
// worktree+spawn EXECUTION semantics live HERE (the Coding domain boundary) —
// Core's four gates delegate through the adapter seam. The exact contract is
// the one governed-runner has always exposed: `{ result }` on success,
// `{ error }` on worktree-creation failure, and the captureDigest switch
// selecting raw bytes (named-command/F062 output digest) or the historical
// UTF-8 envelope.
function executeInWorktree(
	targetRoot,
	command,
	label,
	budgetMinutes,
	{ captureDigest = false } = {},
) {
	const { createWorktree, removeWorktree } = require("../worktree-manager");
	const safeLabel = String(label).replace(/[^A-Za-z0-9._-]/g, "-");
	const runId = `glx-${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
	const worktree = createWorktree(targetRoot, runId);
	if (!worktree.success) return { error: `Failed to create isolated worktree: ${worktree.error}` };
	try {
		return executeInPreparedWorkspace(worktree.path, command, budgetMinutes, { captureDigest });
	} finally {
		removeWorktree(targetRoot, runId);
	}
}

/**
 * F070 H2b: execute inside an ALREADY-PREPARED workspace (the ExecutionRecord's
 * effective workspace) instead of a throwaway worktree. Same spawn/capture
 * semantics as executeInWorktree; no worktree is created and none is removed —
 * the workspace must outlive the command so its mutations stay observable.
 */
function executeInPreparedWorkspace(
	workspacePath,
	command,
	budgetMinutes,
	{ captureDigest = false } = {},
) {
	let result;
	const startedAt = new Date().toISOString();
	try {
		const spawned = spawnSync(command, {
			shell: true,
			cwd: workspacePath,
			// The legacy command seam intentionally keeps its historical UTF-8
			// envelope.  Only the named-command/F062 seam needs raw bytes for the
			// complete output digest.
			encoding: captureDigest ? "buffer" : "utf8",
			timeout: budgetMinutes * 60_000,
		});
		if (!captureDigest) {
			result = {
				command,
				exitCode: spawned.status === null ? -1 : spawned.status,
				stdout: (spawned.stdout || "").slice(-4000),
				stderr: (spawned.stderr || "").slice(-2000),
			};
			return { result };
		}
		const stdout = Buffer.isBuffer(spawned.stdout)
			? spawned.stdout
			: Buffer.from(spawned.stdout || "", "utf8");
		const stderr = Buffer.isBuffer(spawned.stderr)
			? spawned.stderr
			: Buffer.from(spawned.stderr || "", "utf8");
		const timedOut = spawned.error?.code === "ETIMEDOUT";
		const exitCode = spawned.status === null ? -1 : spawned.status;
		const signal = spawned.signal || null;
		const finishedAt = new Date().toISOString();
		result = {
			command,
			exitCode,
			signal,
			timedOut,
			startedAt,
			finishedAt,
			terminalStatus: timedOut ? "timed_out" : exitCode === 0 ? "succeeded" : "failed",
			stdout,
			stderr,
		};
	} catch (error) {
		const finishedAt = new Date().toISOString();
		result = {
			command,
			exitCode: -1,
			...(captureDigest
				? {
						signal: error.signal || null,
						timedOut: error.code === "ETIMEDOUT",
						startedAt,
						finishedAt,
						terminalStatus: error.code === "ETIMEDOUT" ? "timed_out" : "failed",
						stdout: Buffer.alloc(0),
						stderr: Buffer.from(String(error.message || error), "utf8"),
					}
				: { stdout: "", stderr: String(error.message || error).slice(-2000) }),
		};
	}
	return { result };
}

/**
 * prepare: create the isolated worktree (delegates to worktree-manager).
 */
function prepare(targetRoot, label) {
	const { createWorktree } = require("../worktree-manager");
	const safeLabel = String(label).replace(/[^A-Za-z0-9._-]/g, "-");
	const runId = `glx-${safeLabel}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	const worktree = createWorktree(targetRoot, runId);
	if (!worktree.success) {
		return { ok: false, error: `Failed to create isolated worktree: ${worktree.error}` };
	}
	return { ok: true, runId, worktreePath: worktree.path };
}

/**
 * execute: spawn the command inside the prepared worktree (delegates to the
 * spawn seam the governed-runner uses).
 */
function execute(worktreePath, command, { timeoutMs = 300_000 } = {}) {
	const spawned = spawnSync(command, {
		shell: true,
		cwd: worktreePath,
		encoding: "utf8",
		timeout: timeoutMs,
	});
	return {
		ok: spawned.status === null ? false : spawned.status === 0,
		exitCode: spawned.status === null ? -1 : spawned.status,
		stdout: (spawned.stdout || "").slice(-4000),
		stderr: (spawned.stderr || "").slice(-2000),
	};
}

/**
 * observe: post-run file-state observation (E3 class, context-runtime §2.1 —
 * the dirty-path classification of the worktree).
 */
function observe(targetRoot) {
	const { getRepoSnapshot } = require("./git-state");
	const snapshot = getRepoSnapshot(targetRoot);
	return {
		adapterId: CODING_DOMAIN_ADAPTER_ID,
		dirty: snapshot.dirty ?? false,
		dirtyPaths: snapshot.dirtyPaths ?? [],
	};
}

/**
 * checkpoint: the session manifest records the worktree reference.
 */
function checkpoint(sessionManifest, worktreePath) {
	return { ...sessionManifest, worktree: worktreePath ?? sessionManifest.worktree ?? null };
}

/**
 * interrupt/cleanup: remove the worktree (delegates to worktree-manager).
 */
function cleanup(targetRoot, runId) {
	const { removeWorktree } = require("../worktree-manager");
	const removed = removeWorktree(targetRoot, runId);
	return { ok: removed.success !== false, removed };
}

module.exports = {
	CODING_DOMAIN_ADAPTER_ID,
	CODING_DOMAIN_ADAPTER_VERSION,
	capabilities,
	contexts,
	executions,
	verifiers,
	validate,
	executeInWorktree,
	executeInPreparedWorkspace,
	prepare,
	execute,
	observe,
	checkpoint,
	cleanup,
};
