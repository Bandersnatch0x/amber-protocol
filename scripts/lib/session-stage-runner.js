"use strict";

// F062 T4 — session stage runner.
//
// Deep module owning `session run` / `session settle`: route/current-stage
// resolution, fail-closed ledger reading, lease checks, adapter dispatch,
// pending lifecycle, settlement idempotence, and cursor progression.
//
// The Session ledger is the sole cursor authority (ADR-0029 decision 7).
// manifest.completedStages / currentStage are projections of the ledger's
// ordered stage-completed prefix, never an independent cursor.
//
// Error vocabulary: this module adds none. Capability/registry refusals reuse
// F052's fail-closed codes verbatim (spec §"Capability and adapter
// resolution": "no parallel error vocabulary"); session-level refusals reuse
// the registered AMBER_E_INVALID_ARG / AMBER_E_SESSION_INCOMPLETE codes.

const path = require("node:path");
const crypto = require("node:crypto");

const { readSessionManifest, writeSessionManifest } = require("./session-manifest");
const { appendSessionEvent } = require("./session-timeline");
const { resolveVerbTarget } = require("./route-commands");
const { loadTargetRoutes } = require("./route-loader");
const { acquireLock, releaseLock } = require("./session-lock");
const { resolveStateDirForRead } = require("./state-dir-resolver");
const { appendLedgerRecord, readLedger, verifyLedgerChain, latestUnconsumedApproval } = require("./core/loop-ledger");
const { runGovernedCommand } = require("./core/governed-runner");
const { codedError } = require("./core/error-catalog");

// Closed settlement vocabulary (spec §"`settle` result and pending lifecycle").
const SETTLEMENT_STATUSES = Object.freeze([
	"succeeded",
	"skipped",
	"failed",
	"cancelled",
	"unknown",
	"timed_out",
	"rejected",
]);

// Only these two can advance the cursor, and `skipped` only for an optional stage.
const ADVANCING_STATUSES = Object.freeze(["succeeded", "skipped"]);

// The closed lease field set (spec §"Session lease").
const LEASE_FIELDS = Object.freeze([
	"ownerId",
	"tokenHash",
	"acquiredAt",
	"expiresAt",
	"ttlMs",
	"fence",
]);

// ── adapter table ───────────────────────────────────────────────────────────
// Implementation-owned, keyed by the EXACT capability pin (ADR-0029 §7). The
// F052 capability record has no provider field, so provider selection is
// neither route data nor caller input.
//
// ADR-0029 §7 is explicit that this is "a reviewed code change, not a new
// registry or a mutable target-repository record" — so the table is a frozen
// constant here, NOT a file under .amber/. A target repository cannot add a pin
// by editing its own state; adding one is a pull request against this table.
//
// An absent entry, or an entry whose provider class does not match the resolved
// capability, fails closed under AMBER_E_STAGE_ADAPTER_UNAVAILABLE. There is no
// fallback adapter and no fallback to caller-supplied command text.
//
// ponytail: ships empty. Amber registers no capability of its own yet, so every
// verb stage currently fails closed — which is the correct direction to fail.
// The first real pin lands here with its own review.
const ADAPTER_TABLE = new Map([
	// ["runner/x@1.0.0#cap.name@1", { capabilityPin, providerClass, adapterId, adapterVersion }],
]);

function lookupAdapter(capabilityPin) {
	return ADAPTER_TABLE.get(capabilityPin) || null;
}

// Test-only seam. The frozen-at-review table cannot be mutated through any CLI
// flag, Route file, or target-repository state; tests swap it wholesale and
// restore the pristine constant afterwards. Nothing outside this module's test
// suite calls this.
const PRISTINE_ADAPTER_TABLE = new Map(ADAPTER_TABLE);
function _setAdapterTableForTest(entries) {
	ADAPTER_TABLE.clear();
	if (entries) for (const entry of entries) ADAPTER_TABLE.set(entry.capabilityPin, { ...entry });
}
function _restoreAdapterTableForTest() {
	ADAPTER_TABLE.clear();
	for (const [pin, entry] of PRISTINE_ADAPTER_TABLE) ADAPTER_TABLE.set(pin, entry);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fail(code, message) {
	return { success: false, code, message: codedError(code, message), exitCode: 1 };
}

function sessionDirOf(projectRoot, sessionId) {
	return path.join(resolveStateDirForRead(projectRoot), "sessions", sessionId);
}

function ledgerPathOf(sessionDir) {
	return path.join(sessionDir, "ledger.jsonl");
}

/**
 * The capability pin as written in a verb stage target, i.e. the whole
 * `runnerId@version#capability@version` string. The adapter table is keyed by
 * this exact string so a version drift cannot silently reuse another entry.
 */
function capabilityPinOf(stageTarget) {
	return stageTarget;
}

/**
 * Verify a lease record against the caller's claim. The lease lives on the
 * manifest as a projection; expired, mismatched, or malformed ownership
 * refuses (spec §"Session lease").
 *
 * @param {{lease?: object}} manifest
 * @param {{ownerId: string, tokenHash: string, fence: number}} claim - Uses the
 *   lease-record spelling `fence`; the CLI-facing options object spells the
 *   same value `leaseFence` to match the `--lease-fence` flag.
 */
function verifyLease(manifest, claim, now = new Date()) {
	const lease = manifest.lease;
	if (!lease || typeof lease !== "object") {
		return { valid: false, reason: "session carries no lease; acquire one before run/settle" };
	}
	const unknown = Object.keys(lease).filter((key) => !LEASE_FIELDS.includes(key));
	if (unknown.length > 0) {
		return { valid: false, reason: `lease carries unknown field(s) ${unknown.sort().join(", ")}` };
	}
	for (const field of LEASE_FIELDS) {
		if (!(field in lease)) return { valid: false, reason: `lease is missing field ${field}` };
	}
	if (typeof lease.ownerId !== "string" || lease.ownerId.length === 0) {
		return { valid: false, reason: "lease.ownerId must be a non-empty agent id" };
	}
	if (lease.ownerId !== claim.ownerId) {
		return { valid: false, reason: "lease owner does not match the caller" };
	}
	if (lease.tokenHash !== claim.tokenHash) {
		return { valid: false, reason: "lease token does not match the recorded tokenHash" };
	}
	if (lease.fence !== claim.fence) {
		return {
			valid: false,
			reason: `lease fence ${claim.fence} does not match the current fence ${lease.fence}; reacquire the lease`,
		};
	}
	// Half-open window [acquiredAt, expiresAt).
	const expiresAt = Date.parse(lease.expiresAt);
	if (Number.isNaN(expiresAt)) {
		return { valid: false, reason: "lease.expiresAt is not an ISO-8601 timestamp" };
	}
	if (now.getTime() >= expiresAt) {
		return {
			valid: false,
			reason: `lease expired at ${lease.expiresAt}; reacquisition is explicit and creates a new fence`,
		};
	}
	return { valid: true, reason: null };
}

/**
 * Read the Session ledger fail-closed. A broken hash chain refuses rather than
 * letting a tampered prefix act as the cursor.
 */
function readCursorLedger(sessionDir) {
	const ledgerPath = ledgerPathOf(sessionDir);
	const chain = verifyLedgerChain(ledgerPath);
	if (!chain.intact) {
		return {
			ok: false,
			reason: `session ledger chain is broken at record ${chain.brokenAt}: ${chain.reason}`,
		};
	}
	return { ok: true, records: readLedger(ledgerPath) };
}

/**
 * The cursor: the ordered, contiguous prefix of stages the ledger records as
 * completed. Duplicates collapse; a stage recorded twice is still one step.
 */
function cursorFromLedger(records) {
	const completed = [];
	for (const record of records) {
		if (record.kind !== "stage_completed") continue;
		if (!completed.includes(record.stage)) completed.push(record.stage);
	}
	return completed;
}

function attemptsForStage(records, stageName) {
	return records.filter(
		(record) => record.kind === "stage_attempt_requested" && record.stageName === stageName,
	);
}

function findByIdempotencyKey(records, key) {
	return (
		records.find(
			(record) => record.kind === "stage_attempt_requested" && record.idempotencyKey === key,
		) || null
	);
}

function findSettlement(records, requestId) {
	return (
		records.find(
			(record) => record.kind === "stage_attempt_settled" && record.requestId === requestId,
		) || null
	);
}

function routeHashOf(route) {
	const { filePath: _filePath, ...clean } = route;
	return crypto.createHash("sha256").update(JSON.stringify(clean), "utf8").digest("hex");
}

function idempotencyKeyOf({ sessionId, routeHash, stageName, capabilityPin, attemptNumber, fence }) {
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify({ sessionId, routeHash, stageName, capabilityPin, attemptNumber, fence }),
			"utf8",
		)
		.digest("hex");
}

/**
 * Resolve the current stage from the ledger cursor. Returns null when every
 * stage is complete. `gateAfter` on the last completed stage blocks the next
 * one until a gate_passed record exists for that gate.
 */
function resolveCurrentStage(route, records) {
	const completed = cursorFromLedger(records);
	const stages = Array.isArray(route.stages) ? route.stages : [];
	const index = completed.length;
	if (index >= stages.length) return { done: true, stage: null, stageIndex: stages.length };

	// gateAfter blocks the NEXT stage; the completed stage itself is recorded first.
	if (index > 0) {
		const previous = stages[index - 1];
		if (previous && previous.gateAfter) {
			const passed = records.some(
				(record) => record.kind === "gate_passed" && record.gateId === previous.gateAfter,
			);
			if (!passed) {
				return {
					done: false,
					blocked: previous.gateAfter,
					stage: null,
					stageIndex: index,
				};
			}
		}
	}
	return { done: false, blocked: null, stage: stages[index], stageIndex: index };
}

// ── run ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the current verb stage against the cursor: the stage to run, its
 * index, and its adapter tuple. Shared by the dry-run and execute paths so the
 * resolution rules cannot drift between them.
 */
function resolveVerbStage(projectRoot, route, records) {
	const current = resolveCurrentStage(route, records);
	if (current.done) {
		return { problem: fail("AMBER_E_INVALID_ARG", "every stage is complete; nothing to run") };
	}
	if (current.blocked) {
		return {
			problem: fail(
				"AMBER_E_GATE_UNCONFIRMED",
				`gate ${current.blocked} must pass before the next stage runs; run: amber session approve --session <id> --gate ${current.blocked}`,
			),
		};
	}
	const stage = current.stage;
	if (stage.type !== "verb") {
		return {
			problem: fail(
				"AMBER_E_INVALID_ARG",
				`stage ${stage.name} is type ${stage.type}; session run advances verb stages only`,
			),
		};
	}
	// F052 resolution first: an unregistered runner, version drift, integrity
	// mismatch, or unregistered capability keeps its own F052 code.
	const resolution = resolveVerbTarget(projectRoot, stage.target);
	if (!resolution.ok) {
		return { problem: fail(resolution.code || "AMBER_E_RUNNER_INVALID", resolution.errors[0]) };
	}
	const capabilityPin = capabilityPinOf(stage.target);
	const adapter = lookupAdapter(capabilityPin);
	if (!adapter) {
		return {
			problem: fail(
				"AMBER_E_STAGE_ADAPTER_UNAVAILABLE",
				`capability pin ${capabilityPin} has no entry in the implementation-owned adapter table; provider selection is never route data or caller input, and there is no fallback adapter`,
			),
		};
	}
	if (adapter.providerClass === "external") {
		return {
			problem: fail(
				"AMBER_E_STAGE_EXTERNAL_LIFECYCLE_REQUIRED",
				`capability ${capabilityPin} maps to the external provider class; a Session attempt never performs an external effect — use the F056 lifecycle (amber external propose → authorize → execute → settle)`,
			),
		};
	}
	return { stage, stageIndex: current.stageIndex, adapter, resolution, capabilityPin };
}

/**
 * Advance the Session by at most one stage.
 *
 * Dry-run resolves and returns the request without creating an attempt or
 * touching the cursor. Execute-mode requires lease proof, takes the atomic
 * session lock BEFORE any cursor read (spec write order: acquire and verify the
 * lease lock first), appends the immutable request event, dispatches to the
 * resolved adapter, and (for non-host-agent providers) settles in the same call.
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {{dryRun?: boolean, execute?: boolean, ownerId?: string, tokenHash?: string, leaseFence?: number}} options
 */
async function runSessionStage(projectRoot, sessionId, options = {}) {
	const execute = options.execute === true;
	const sessionDir = sessionDirOf(projectRoot, sessionId);

	const loaded = readSessionManifest(sessionDir);
	if (!loaded || loaded.corrupt) {
		return fail("AMBER_E_SESSION_INCOMPLETE", `session ${sessionId} is missing or corrupt`);
	}
	const { manifest } = loaded;

	if (["completed", "failed", "aborted"].includes(manifest.status)) {
		return fail(
			"AMBER_E_SESSION_INCOMPLETE",
			`session is ${manifest.status}; a terminal session accepts no run or settle`,
		);
	}

	// Execute-mode mutates state, so it needs lease proof AND the atomic lock.
	// Dry-run reads only and stays lock-free.
	if (execute) {
		const lease = verifyLease(manifest, {
			ownerId: options.ownerId,
			tokenHash: options.tokenHash,
			fence: options.leaseFence,
		});
		if (!lease.valid) return fail("AMBER_E_INVALID_ARG", lease.reason);
	}

	const { routes } = loadTargetRoutes(projectRoot);
	const route = routes.find((entry) => entry.routeId === manifest.route.id);
	if (!route) {
		return fail("AMBER_E_ROUTE_NOT_FOUND", `route ${manifest.route.id} is not defined in the target`);
	}

	if (!execute) {
		const cursorRead = readCursorLedger(sessionDir);
		if (!cursorRead.ok) return fail("AMBER_E_LEDGER_TAMPERED", cursorRead.reason);
		const resolved = resolveVerbStage(projectRoot, route, cursorRead.records);
		if (resolved.problem) return resolved.problem;
		// Dry-run projects the lease it WOULD run under, without taking the lock.
		resolved.fence = manifest.lease?.fence ?? 0;
		resolved.ownerId = manifest.lease?.ownerId ?? null;
		resolved.execute = false;
		resolved.requiresApproval = resolved.adapter.providerClass === "bounded-command";
		// Dry-run creates no attempt and never advances the cursor.
		return {
			success: true,
			dryRun: true,
			request: buildRequest(
				sessionId,
				manifest,
				route,
				resolved,
				attemptsForStage(cursorRead.records, resolved.stage.name).length + 1,
				latestUnconsumedApproval(cursorRead.records)?.approvalKey ?? null,
			),
			providerClass: resolved.adapter.providerClass,
		};
	}

	const lock = acquireLock(projectRoot, sessionId);
	if (!lock.success) return fail("AMBER_E_INVALID_ARG", lock.error);
	try {
		return executeAttempt(projectRoot, sessionId, sessionDir, manifest, route, options);
	} finally {
		releaseLock(projectRoot, sessionId);
	}
}

/**
 * Materialize the closed request identity (spec §"run request and attempt
 * identity"). attemptNumber and the idempotency key derive from the ledger
 * state; approvalRef binds the approval this attempt will consume when the
 * adapter requires one (bounded-command).
 */
function buildRequest(sessionId, manifest, route, resolved, attemptNumber, approvalRef) {
	const routeHash = routeHashOf(route);
	const idempotencyKey = idempotencyKeyOf({
		sessionId,
		routeHash,
		stageName: resolved.stage.name,
		capabilityPin: resolved.capabilityPin,
		attemptNumber,
		fence: resolved.fence,
	});
	return {
		requestId: crypto.randomUUID(),
		sessionId,
		routeId: route.routeId,
		routeVersion: route.version || manifest.route.version,
		routeHash,
		stageName: resolved.stage.name,
		stageIndex: resolved.stageIndex,
		stageType: resolved.stage.type,
		stageTarget: resolved.stage.target,
		capabilityPin: resolved.capabilityPin,
		adapterId: resolved.adapter.adapterId,
		adapterVersion: resolved.adapter.adapterVersion,
		attemptId: crypto.randomUUID(),
		attemptNumber,
		idempotencyKey,
		leaseOwnerId: resolved.ownerId,
		leaseFence: resolved.fence,
		inputDigest: null,
		executionMode: resolved.execute ? "execute" : "dry-run",
		...(resolved.requiresApproval ? { approvalRef } : {}),
		requestedAt: new Date().toISOString(),
		deadlineAt: new Date(Date.now() + 300_000).toISOString(),
	};
}

// The execute path, already inside the session lock. The cursor is read here —
// never before the lock — so a concurrent run cannot double-write the same
// idempotency key (spec §"Durable records and crash recovery" write order).
function executeAttempt(projectRoot, sessionId, sessionDir, manifest, route, options) {
	const cursorRead = readCursorLedger(sessionDir);
	if (!cursorRead.ok) return fail("AMBER_E_LEDGER_TAMPERED", cursorRead.reason);
	const records = cursorRead.records;

	const resolved = resolveVerbStage(projectRoot, route, records);
	if (resolved.problem) return resolved.problem;
	const { stage, adapter, resolution, capabilityPin } = resolved;

	resolved.fence = options.leaseFence;
	resolved.ownerId = options.ownerId;
	resolved.execute = true;
	// bounded-command consumes a single-use Approval inside governed-runner;
	// bind the key this attempt intends to consume so the request names it.
	resolved.requiresApproval = adapter.providerClass === "bounded-command";
	const approvalRef = resolved.requiresApproval
		? (latestUnconsumedApproval(records)?.approvalKey ?? null)
		: null;

	const attemptNumber = attemptsForStage(records, stage.name).length + 1;
	const request = buildRequest(sessionId, manifest, route, resolved, attemptNumber, approvalRef);

	// An identical request hash returns the existing record instead of forking
	// a second attempt with the same identity.
	const duplicate = findByIdempotencyKey(records, request.idempotencyKey);
	if (duplicate) {
		return {
			success: true,
			duplicate: true,
			request: duplicate,
			providerClass: adapter.providerClass,
		};
	}

	const ledgerPath = ledgerPathOf(sessionDir);
	appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "stage_attempt_requested",
		...request,
		status: "pending",
		recordedAt: new Date().toISOString(),
	});
	appendSessionEvent(sessionDir, {
		type: "stage_started",
		data: {
			stage: stage.name,
			requestId: request.requestId,
			attemptId: request.attemptId,
			capabilityPin,
			providerClass: adapter.providerClass,
		},
	});

	// host-agent: Amber records the request and stops. It never starts an Agent.
	if (adapter.providerClass === "host-agent") {
		return {
			success: true,
			pending: true,
			request,
			providerClass: adapter.providerClass,
		};
	}

	// bounded-command: read-only/verification only. The worktree is removed in
	// governed-runner's finally block, so file output cannot survive
	// (decision 6). The capability NAME is the policy rule id — decision 1's
	// named command and decision 2's capability pin meet here.
	if (adapter.providerClass === "bounded-command") {
		const outcome = runGovernedCommand({
			target: projectRoot,
			commandId: resolution.capability.name,
			producer: request.leaseOwnerId,
			evidenceId: `evidence/${sessionId}/${request.attemptId}`,
			capabilityPin,
			requestId: request.requestId,
			attemptId: request.attemptId,
			ledgerPath,
			budgetMinutes: 5,
			subject: { sessionId, stage: stage.name },
			label: `${sessionId}:${stage.name}`,
		});
		if (outcome.executed) {
			// A real execution settles in the same call, success or failure — the
			// request never stays pending after the command ran.
			const settled = settleInternal(projectRoot, sessionId, sessionDir, route, request, {
				status: outcome.exitCode === 0 ? "succeeded" : "failed",
				exitCode: outcome.exitCode,
				outputDigest: outcome.outputDigest ?? null,
				evidenceId: outcome.evidence?.id ?? null,
				stdoutPreview: outcome.stdoutTail ?? "",
				stderrPreview: outcome.stderrTail ?? "",
			});
			return outcome.exitCode === 0
				? settled
				: {
						...settled,
						success: false,
						message: `Command exited ${outcome.exitCode}`,
						exitCode: 1,
					};
		}
		// Refusal (policy, approval, isolation, ledger): the attempt never ran.
		// Record the terminal rejected event so the request is not left pending,
		// then surface the refusal (spec: a refused submission is rejected and
		// does not advance the cursor).
		const reason = outcome.errors.join("; ");
		const settled = settleInternal(projectRoot, sessionId, sessionDir, route, request, {
			status: "rejected",
			reason,
			errorCode: "AMBER_E_POLICY_DENY",
		});
		return { ...settled, success: false, message: reason, exitCode: 1 };
	}

	// native: deterministic Amber code. No capability is registered as native
	// yet, so this refuses rather than pretending to have run something.
	return fail(
		"AMBER_E_STAGE_ADAPTER_UNAVAILABLE",
		`adapter ${adapter.adapterId} declares provider class native, but no native handler is bound to ${capabilityPin}`,
	);
}

// ── settle ──────────────────────────────────────────────────────────────────

/**
 * Validate a settlement result against the closed contract. A non-zero exit
 * paired with `succeeded`, or a success without Evidence, fails closed.
 */
function settlementProblem(settlement, stage) {
	if (!settlement || typeof settlement !== "object") {
		return "settlement result must be an object";
	}
	if (!SETTLEMENT_STATUSES.includes(settlement.status)) {
		return `status must be one of ${SETTLEMENT_STATUSES.join(" | ")}; got ${JSON.stringify(settlement.status)}`;
	}
	if (settlement.status === "succeeded") {
		if (settlement.exitCode !== undefined && settlement.exitCode !== null && settlement.exitCode !== 0) {
			return `status "succeeded" cannot carry a non-zero exitCode (${settlement.exitCode})`;
		}
		if (!settlement.evidenceId) {
			return 'status "succeeded" requires an Evidence receipt id; a run without Evidence cannot advance the cursor';
		}
	}
	if (settlement.status === "skipped" && stage && stage.optional !== true) {
		return `stage ${stage.name} is not optional and cannot be skipped`;
	}
	return null;
}

/**
 * Build the durable settlement record from a raw result. Shared by the live
 * settlement and the duplicate check so both normalize identically — an "exact
 * duplicate" is the same closed result, not merely the same status.
 */
function buildSettlementRecord(request, settlement) {
	return {
		schemaVersion: 2,
		kind: "stage_attempt_settled",
		requestId: request.requestId,
		attemptId: request.attemptId,
		stageName: request.stageName,
		status: settlement.status,
		startedAt: settlement.startedAt ?? null,
		finishedAt: settlement.finishedAt ?? null,
		exitCode: settlement.exitCode ?? null,
		signal: settlement.signal ?? null,
		timedOut: settlement.timedOut === true,
		outputDigest: settlement.outputDigest ?? null,
		stdoutPreview: (settlement.stdoutPreview ?? "").slice(-4000),
		stderrPreview: (settlement.stderrPreview ?? "").slice(-2000),
		evidenceId: settlement.evidenceId ?? null,
		artifactRefs: settlement.artifactRefs ?? [],
		errorCode: settlement.errorCode ?? null,
		reason: settlement.reason ?? null,
		recordedAt: new Date().toISOString(),
	};
}

// The closed result fields of a settlement record — everything except the
// bookkeeping stamp. Two settlements of one attempt must agree on all of them.
function settlementFingerprint(record) {
	const { recordedAt: _stamp, ...closed } = record;
	return JSON.stringify(closed);
}

function settleInternal(projectRoot, sessionId, sessionDir, route, request, settlement) {
	const ledgerPath = ledgerPathOf(sessionDir);
	const stage = (route.stages || []).find((entry) => entry.name === request.stageName) || null;

	const record = buildSettlementRecord(request, settlement);
	appendLedgerRecord(ledgerPath, record);

	const advances =
		ADVANCING_STATUSES.includes(settlement.status) &&
		(settlement.status !== "skipped" || stage?.optional === true) &&
		(settlement.status !== "succeeded" || Boolean(settlement.evidenceId));

	if (!advances) {
		appendSessionEvent(sessionDir, {
			type: "stage_failed",
			data: { stage: request.stageName, requestId: request.requestId, status: settlement.status },
		});
		return {
			success: true,
			settled: true,
			advanced: false,
			settlement: record,
			request,
		};
	}

	// Record the completion BEFORE refreshing the projection, so a crash between
	// the two leaves the ledger authoritative and the projection rebuildable.
	appendLedgerRecord(ledgerPath, {
		schemaVersion: 2,
		kind: "stage_completed",
		sessionId,
		stage: request.stageName,
		requestId: request.requestId,
		attemptId: request.attemptId,
		evidenceId: record.evidenceId,
		outputDigest: record.outputDigest,
		recordedAt: new Date().toISOString(),
	});

	refreshProjection(projectRoot, sessionId, sessionDir, route);

	appendSessionEvent(sessionDir, {
		type: "stage_completed",
		data: {
			stage: request.stageName,
			requestId: request.requestId,
			attemptId: request.attemptId,
			status: settlement.status,
		},
	});

	return { success: true, settled: true, advanced: true, settlement: record, request };
}

/**
 * Rebuild manifest.completedStages / currentStage from the ledger cursor. The
 * manifest is a projection: this never invents a stage the ledger does not
 * record, and replaying it after a crash is safe.
 */
function refreshProjection(projectRoot, sessionId, sessionDir, route) {
	const cursorRead = readCursorLedger(sessionDir);
	if (!cursorRead.ok) return null;
	const completed = cursorFromLedger(cursorRead.records);
	const current = resolveCurrentStage(route, cursorRead.records);

	const loaded = readSessionManifest(sessionDir);
	if (!loaded || loaded.corrupt) return null;
	const next = { ...loaded.manifest, completedStages: completed };
	if (current.done) {
		delete next.currentStage;
	} else if (current.stage) {
		next.currentStage = current.stage.name;
	}
	return writeSessionManifest(sessionDir, next);
}

/**
 * Settle one pending request. The binding contract is closed: the caller must
 * present the pending request's own `requestId`, `attemptId`, and `requestHash`
 * (the request's idempotency key) plus lease proof whose owner matches the
 * owner the request was created under. An exact duplicate settlement — the same
 * closed result, not merely the same status — is idempotent; any difference is
 * a conflict.
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {string} requestId
 * @param {object} settlement
 * @param {{ownerId?: string, tokenHash?: string, leaseFence?: number, attemptId?: string, requestHash?: string}} options
 */
async function settleSessionRequest(projectRoot, sessionId, requestId, settlement, options = {}) {
	const sessionDir = sessionDirOf(projectRoot, sessionId);

	const loaded = readSessionManifest(sessionDir);
	if (!loaded || loaded.corrupt) {
		return fail("AMBER_E_SESSION_INCOMPLETE", `session ${sessionId} is missing or corrupt`);
	}
	const { manifest } = loaded;

	if (["completed", "failed", "aborted"].includes(manifest.status)) {
		return fail(
			"AMBER_E_SESSION_INCOMPLETE",
			`session is ${manifest.status}; a terminal session accepts no run or settle`,
		);
	}

	const lease = verifyLease(manifest, {
		ownerId: options.ownerId,
		tokenHash: options.tokenHash,
		fence: options.leaseFence,
	});
	if (!lease.valid) return fail("AMBER_E_INVALID_ARG", lease.reason);

	const cursorRead = readCursorLedger(sessionDir);
	if (!cursorRead.ok) return fail("AMBER_E_LEDGER_TAMPERED", cursorRead.reason);
	const records = cursorRead.records;

	const request = records.find(
		(record) => record.kind === "stage_attempt_requested" && record.requestId === requestId,
	);
	if (!request) {
		return fail("AMBER_E_INVALID_ARG", `no request ${requestId} is recorded for session ${sessionId}`);
	}

	// Binding contract: the settlement must name the pending attempt's own
	// identity, not just a request id (spec §"settle result and pending
	// lifecycle"). requestHash is the request's idempotency key.
	if (!options.attemptId || options.attemptId !== request.attemptId) {
		return fail(
			"AMBER_E_INVALID_ARG",
			"settle requires the pending request's own --attempt-id; a settlement binds one exact attempt",
		);
	}
	if (!options.requestHash || options.requestHash !== request.idempotencyKey) {
		return fail(
			"AMBER_E_INVALID_ARG",
			"settle requires the pending request's own --request-hash (its idempotency key); a settlement binds one exact request",
		);
	}
	if (request.leaseOwnerId && options.ownerId !== request.leaseOwnerId) {
		return fail(
			"AMBER_E_INVALID_ARG",
			`request ${requestId} was created by owner ${request.leaseOwnerId}; only that owner may settle it`,
		);
	}

	const existing = findSettlement(records, requestId);
	if (existing) {
		// Idempotent only when the resubmission is the SAME closed result — the
		// same status with a different exit code or Evidence is a conflict.
		const resubmitted = settlementFingerprint(buildSettlementRecord(request, settlement ?? {}));
		if (resubmitted === settlementFingerprint(existing)) {
			return { success: true, settled: true, duplicate: true, settlement: existing, request };
		}
		return fail(
			"AMBER_E_INVALID_ARG",
			`request ${requestId} already settled with a different result; a different result for the same attempt is a conflict, not an update`,
		);
	}

	if (Date.parse(request.deadlineAt) <= Date.now()) {
		return fail(
			"AMBER_E_INVALID_ARG",
			`request ${requestId} passed its deadline ${request.deadlineAt} and is expired; retry with a fresh run`,
		);
	}

	const { routes } = loadTargetRoutes(projectRoot);
	const route = routes.find((entry) => entry.routeId === manifest.route.id);
	if (!route) {
		return fail("AMBER_E_ROUTE_NOT_FOUND", `route ${manifest.route.id} is not defined in the target`);
	}
	const stage = (route.stages || []).find((entry) => entry.name === request.stageName) || null;

	const problem = settlementProblem(settlement, stage);
	if (problem) return fail("AMBER_E_INVALID_ARG", problem);

	const lock = acquireLock(projectRoot, sessionId);
	if (!lock.success) return fail("AMBER_E_INVALID_ARG", lock.error);
	try {
		return settleInternal(projectRoot, sessionId, sessionDir, route, request, settlement);
	} finally {
		releaseLock(projectRoot, sessionId);
	}
}

module.exports = {
	runSessionStage,
	settleSessionRequest,
	lookupAdapter,
	verifyLease,
	cursorFromLedger,
	idempotencyKeyOf,
	SETTLEMENT_STATUSES,
	// Test-only seams (see _setAdapterTableForTest).
	_setAdapterTableForTest,
	_restoreAdapterTableForTest,
};
