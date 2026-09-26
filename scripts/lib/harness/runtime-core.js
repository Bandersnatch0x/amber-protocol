"use strict";

// F080 H7 — bounded repository-local maintenance runtime.
//
// Authority ceiling (ADR-0103/F079): this module schedules ONLY closed-registry
// deterministic Amber-internal proposal jobs. It never accepts a command,
// module, callback, agent, workflow, model, connector, or external effect.
// The only subprocess operation is self-spawn/self-stop of scripts/amber-runtime.js.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { listArtifactRevisions } = require("../core/canonical-artifacts");
const {
	canonicalHashOf,
	decisionPinProblem,
	resolveRegistrationDecision,
	isPlainObject,
} = require("../core/registry-ledger");
const { emitHarnessEvent, readHarnessEvents } = require("./event-ledger");

const SCHEMA_VERSION = 1;
const DECISION_KINDS = Object.freeze(["acceptance", "approval"]);
const JOB_NAMES = Object.freeze(["draft-spec-review"]);
const AUTHORITY = Object.freeze({
	executesAnything: false,
	schedulesJobs: true,
	dispatchesAgents: false,
	writesExternalSystems: false,
});

const CODE_INVALID = "AMBER_E_HARNESS_RUNTIME_INVALID";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_RUNTIME_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_RUNTIME_CORRUPT";
const CODE_CONFLICT = "AMBER_E_HARNESS_RUNTIME_CONFLICT";
const CODE_DAEMON_RUNNING = "AMBER_E_HARNESS_RUNTIME_DAEMON_RUNNING";
const CODE_DAEMON_OWNERSHIP = "AMBER_E_HARNESS_RUNTIME_DAEMON_OWNERSHIP";

const MIN_EVERY_MS = 1_000;
const MAX_EVERY_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_VALIDITY_MS = 30 * 24 * 60 * 60 * 1_000;
const MIN_POLL_MS = 250;
const MAX_POLL_MS = 60_000;

function typedError(code, message) {
	const error = new Error(message);
	error.amberCode = code;
	return error;
}

function safeId(value) {
	return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

function scheduleDirCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "schedules");
}

function proposalDirCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "proposals");
}

function revocationDirCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "revocations");
}

function scheduleFile(targetRoot, id, create = false) {
	const dir = create
		? scheduleDirCreate(targetRoot)
		: statePath(targetRoot, "harness", "runtime", "schedules");
	return path.join(dir, `${safeId(id)}.json`);
}

function daemonFile(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "daemon.json");
}

function fenceFile(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "fence.json");
}

function startLockFile(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "runtime", "daemon-start.lock");
}

function parseInstant(value, label) {
	if (typeof value !== "string" || value.length === 0 || !Number.isFinite(Date.parse(value))) {
		throw typedError(
			CODE_INVALID,
			`${label} must be an ISO date-time; got ${JSON.stringify(value)}`,
		);
	}
	return Date.parse(value);
}

function exactFields(value, fields, label) {
	if (!isPlainObject(value)) throw typedError(CODE_INVALID, `${label} must be an object`);
	const actual = Object.keys(value).sort();
	const expected = [...fields].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw typedError(
			CODE_INVALID,
			`${label} fields must be exactly ${expected.join(", ")}; got ${actual.join(", ")}`,
		);
	}
}

function scheduleInput(input) {
	exactFields(
		input,
		[
			"apiVersion",
			"kind",
			"metadata",
			"job",
			"cadence",
			"validAt",
			"validUntil",
			"budget",
			"decision",
		],
		"schedule",
	);
	if (input.apiVersion !== "amber.dev/v1")
		throw typedError(CODE_INVALID, `schedule.apiVersion must be "amber.dev/v1"`);
	if (input.kind !== "HarnessMaintenanceSchedule")
		throw typedError(CODE_INVALID, `schedule.kind must be "HarnessMaintenanceSchedule"`);
	exactFields(input.metadata, ["id", "version"], "schedule.metadata");
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.metadata.id || ""))
		throw typedError(CODE_INVALID, "schedule.metadata.id must be a safe 1..128 character id");
	if (typeof input.metadata.version !== "string" || input.metadata.version.length === 0)
		throw typedError(CODE_INVALID, "schedule.metadata.version must be a non-empty string");
	if (!JOB_NAMES.includes(input.job))
		throw typedError(
			CODE_INVALID,
			`schedule.job must be one of the closed registry: ${JOB_NAMES.join(", ")}`,
		);
	exactFields(input.cadence, ["everyMs"], "schedule.cadence");
	if (
		!Number.isInteger(input.cadence.everyMs) ||
		input.cadence.everyMs < MIN_EVERY_MS ||
		input.cadence.everyMs > MAX_EVERY_MS
	) {
		throw typedError(
			CODE_INVALID,
			`schedule.cadence.everyMs must be an integer in [${MIN_EVERY_MS}, ${MAX_EVERY_MS}]`,
		);
	}
	const from = parseInstant(input.validAt, "schedule.validAt");
	const until = parseInstant(input.validUntil, "schedule.validUntil");
	if (until <= from) throw typedError(CODE_INVALID, "schedule validity window must be non-empty");
	if (until - from > MAX_VALIDITY_MS)
		throw typedError(CODE_INVALID, "schedule validity window may not exceed 30 days");
	exactFields(input.budget, ["maxRuns", "maxProposals"], "schedule.budget");
	if (
		!Number.isInteger(input.budget.maxRuns) ||
		input.budget.maxRuns < 1 ||
		input.budget.maxRuns > 1000
	)
		throw typedError(CODE_INVALID, "schedule.budget.maxRuns must be an integer in [1, 1000]");
	if (
		!Number.isInteger(input.budget.maxProposals) ||
		input.budget.maxProposals < 1 ||
		input.budget.maxProposals > 100
	)
		throw typedError(CODE_INVALID, "schedule.budget.maxProposals must be an integer in [1, 100]");
	const decisionProblem = decisionPinProblem(input.decision);
	if (decisionProblem !== null) throw typedError(CODE_INVALID, decisionProblem);
	return input;
}

function resolveHumanDecision(targetRoot, pin, label) {
	let revisions;
	try {
		revisions = listArtifactRevisions(targetRoot);
	} catch (error) {
		throw typedError(error.amberCode || CODE_CORRUPT, error.message || String(error));
	}
	const resolved = resolveRegistrationDecision(revisions, pin, DECISION_KINDS, label);
	if (resolved.problem) throw typedError(CODE_INVALID, resolved.problem);
	return resolved.decision;
}

function scheduleHashBody(record) {
	const { snapshotHash: _snapshotHash, ...body } = record;
	return body;
}

function schedulePointer(id, hash) {
	return `maintenance-schedule:${id}#${hash}`;
}

function scheduleBasePointer(id) {
	return `maintenance-schedule:${id}`;
}

function eventHasSchedule(event, id) {
	return (event.pointers || []).some(
		(pointer) =>
			pointer === scheduleBasePointer(id) || pointer.startsWith(`${scheduleBasePointer(id)}#`),
	);
}

function registrationEvent(events, id) {
	return events.find(
		(event) => event.kind === "runtime.schedule.registered" && eventHasSchedule(event, id),
	);
}

function revocationEvent(events, id) {
	return events.find(
		(event) => event.kind === "runtime.schedule.revoked" && eventHasSchedule(event, id),
	);
}

function readJsonClosed(file, label) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw typedError(CODE_CORRUPT, `${label} is not valid JSON: ${error.message}`);
	}
}

function readScheduleRecord(targetRoot, id, events = null) {
	const file = scheduleFile(targetRoot, id, false);
	if (!fs.existsSync(file))
		throw typedError(CODE_NOT_FOUND, `no runtime schedule ${JSON.stringify(id)}`);
	const record = readJsonClosed(file, `runtime schedule ${JSON.stringify(id)}`);
	const input = {
		apiVersion: record.apiVersion,
		kind: record.kind,
		metadata: record.metadata,
		job: record.job,
		cadence: record.cadence,
		validAt: record.validAt,
		validUntil: record.validUntil,
		budget: record.budget,
		decision: record.decision
			? { identity: record.decision.identity, revision: record.decision.revision }
			: record.decision,
	};
	try {
		scheduleInput(input);
	} catch (error) {
		throw typedError(
			CODE_CORRUPT,
			`runtime schedule ${JSON.stringify(id)} fails its closed shape: ${error.message}`,
		);
	}
	if (
		!record.decision ||
		!DECISION_KINDS.includes(record.decision.decisionKind) ||
		typeof record.decision.principal !== "string" ||
		!Number.isFinite(Date.parse(record.admittedAt))
	)
		throw typedError(
			CODE_CORRUPT,
			`runtime schedule ${JSON.stringify(id)} carries malformed authority`,
		);
	const expected = canonicalHashOf(scheduleHashBody(record));
	if (record.snapshotHash !== expected)
		throw typedError(
			CODE_CORRUPT,
			`runtime schedule ${JSON.stringify(id)} no longer matches its Snapshot Hash`,
		);
	const trail = events || readHarnessEvents(targetRoot);
	const witness = registrationEvent(trail, id);
	if (!witness || witness.inputHash !== record.snapshotHash)
		throw typedError(
			CODE_CORRUPT,
			`runtime schedule ${JSON.stringify(id)} has no matching registration witness on the Harness ledger`,
		);
	return record;
}

function listScheduleFiles(targetRoot) {
	const dir = statePath(targetRoot, "harness", "runtime", "schedules");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => path.join(dir, name));
}

function allScheduleRecords(targetRoot, events = null) {
	const trail = events || readHarnessEvents(targetRoot);
	return listScheduleFiles(targetRoot).map((file) => {
		const raw = readJsonClosed(file, `runtime schedule ${path.basename(file)}`);
		return readScheduleRecord(targetRoot, raw.metadata?.id || path.basename(file, ".json"), trail);
	});
}

function decisionPointer(id, revision) {
	return `runtime-decision:${id}@${revision}`;
}

// Spends are derived from the ledger, not from the record directory: the
// registering/revoking event carries a runtime-decision pointer, so the
// single-use invariant survives a hand-edited or missing record file.
function decisionSpentIn(fold, decision) {
	const marker = decisionPointer(decision.identity, decision.revision);
	for (const event of fold) {
		if (typeof event.kind !== "string" || !event.kind.startsWith("runtime.")) continue;
		if (!(event.pointers || []).includes(marker)) continue;
		return event.pointers[0] || event.kind;
	}
	return null;
}

// The in-lock guard for both schedule append paths. It re-derives the
// single-use spend and the id's uniqueness from the fold the governed append
// just read while holding the ledger lock, so two concurrent writers can
// never both consume one Decision or double-register one id. A non-null
// result refuses the append verbatim (ADR-0028 guard contract).
function scheduleAppendGuard(kind, id, decision) {
	return (fold) => {
		const spentBy = decisionSpentIn(fold, decision);
		if (spentBy !== null)
			return {
				ok: false,
				code: CODE_CONFLICT,
				record: null,
				errors: [
					`decision ${decision.identity}@${decision.revision} is already spent by ${spentBy}; a runtime Decision authorizes exactly one schedule or revocation`,
				],
			};
		const matching = fold.filter((event) => eventHasSchedule(event, id));
		if (kind === "register") {
			if (matching.some((event) => event.kind === "runtime.schedule.registered"))
				return {
					ok: false,
					code: CODE_CONFLICT,
					record: null,
					errors: [`runtime schedule ${JSON.stringify(id)} is already registered`],
				};
			return null;
		}
		if (!matching.some((event) => event.kind === "runtime.schedule.registered"))
			return {
				ok: false,
				code: CODE_NOT_FOUND,
				record: null,
				errors: [`no runtime schedule ${JSON.stringify(id)} is registered`],
			};
		if (matching.some((event) => event.kind === "runtime.schedule.revoked"))
			return {
				ok: false,
				code: CODE_CONFLICT,
				record: null,
				errors: [`runtime schedule ${JSON.stringify(id)} is already revoked`],
			};
		return null;
	};
}

function writeRecordExclusive(file, record, label) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	try {
		fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
	} catch (error) {
		if (error && error.code === "EEXIST")
			throw typedError(CODE_CONFLICT, `${label} already exists; runtime records are write-once`);
		throw error;
	}
}

function admitSchedule(targetRoot, input, { now } = {}) {
	const candidate = scheduleInput(input);
	const file = scheduleFile(targetRoot, candidate.metadata.id, true);
	if (fs.existsSync(file)) {
		const existing = readScheduleRecord(targetRoot, candidate.metadata.id);
		const comparable = {
			apiVersion: existing.apiVersion,
			kind: existing.kind,
			metadata: existing.metadata,
			job: existing.job,
			cadence: existing.cadence,
			validAt: existing.validAt,
			validUntil: existing.validUntil,
			budget: existing.budget,
			decision: { identity: existing.decision.identity, revision: existing.decision.revision },
		};
		if (canonicalHashOf(comparable) === canonicalHashOf(candidate))
			return {
				ok: true,
				schedule: existing,
				idempotent: true,
				scheduleFile: file,
				pointer: schedulePointer(existing.metadata.id, existing.snapshotHash),
			};
		throw typedError(
			CODE_CONFLICT,
			`runtime schedule ${JSON.stringify(candidate.metadata.id)} already exists with different content`,
		);
	}
	const decision = resolveHumanDecision(
		targetRoot,
		candidate.decision,
		"runtime schedule registration",
	);
	const admittedAt = now || new Date().toISOString();
	parseInstant(admittedAt, "admission time");
	const record = {
		schemaVersion: SCHEMA_VERSION,
		apiVersion: candidate.apiVersion,
		kind: candidate.kind,
		metadata: candidate.metadata,
		job: candidate.job,
		cadence: candidate.cadence,
		validAt: candidate.validAt,
		validUntil: candidate.validUntil,
		budget: candidate.budget,
		decision,
		authority: AUTHORITY,
		admittedAt,
	};
	record.snapshotHash = canonicalHashOf(record);
	writeRecordExclusive(file, record, `runtime schedule ${JSON.stringify(candidate.metadata.id)}`);
	let appended;
	try {
		appended = emitHarnessEvent(
			targetRoot,
			{
				kind: "runtime.schedule.registered",
				schemaVersion: SCHEMA_VERSION,
				at: admittedAt,
				actor: decision.principal,
				inputHash: record.snapshotHash,
				reason: `registered bounded maintenance schedule ${candidate.metadata.id} for ${candidate.job}`,
				pointers: [
					schedulePointer(candidate.metadata.id, record.snapshotHash),
					decisionPointer(decision.identity, decision.revision),
				],
			},
			scheduleAppendGuard("register", candidate.metadata.id, candidate.decision),
		);
	} catch (error) {
		fs.rmSync(file, { force: true });
		throw error;
	}
	if (!appended || appended.ok !== true) {
		// The in-lock guard refused: a record must never survive without its
		// ledger witness.
		fs.rmSync(file, { force: true });
		throw typedError(
			(appended && appended.code) || CODE_CONFLICT,
			(appended && appended.errors && appended.errors[0]) || "schedule registration refused",
		);
	}
	return {
		ok: true,
		schedule: record,
		idempotent: false,
		scheduleFile: file,
		pointer: schedulePointer(candidate.metadata.id, record.snapshotHash),
	};
}

function revocationFile(targetRoot, id) {
	return path.join(revocationDirCreate(targetRoot), `${safeId(id)}.json`);
}

function revokeSchedule(targetRoot, { scheduleId, decision: pin, reason, now } = {}) {
	if (!scheduleId || typeof scheduleId !== "string")
		throw typedError(CODE_INVALID, "--schedule <id> is required");
	if (!reason || typeof reason !== "string")
		throw typedError(CODE_INVALID, "--reason <text> is required");
	const events = readHarnessEvents(targetRoot);
	const schedule = readScheduleRecord(targetRoot, scheduleId, events);
	if (revocationEvent(events, scheduleId))
		throw typedError(
			CODE_CONFLICT,
			`runtime schedule ${JSON.stringify(scheduleId)} is already revoked`,
		);
	const pinProblem = decisionPinProblem(pin);
	if (pinProblem !== null) throw typedError(CODE_INVALID, pinProblem);
	const decision = resolveHumanDecision(targetRoot, pin, "runtime schedule revocation");
	const at = now || new Date().toISOString();
	parseInstant(at, "revocation time");
	const record = {
		schemaVersion: SCHEMA_VERSION,
		scheduleId,
		scheduleSnapshotHash: schedule.snapshotHash,
		decision,
		reason,
		at,
	};
	record.snapshotHash = canonicalHashOf(record);
	const file = revocationFile(targetRoot, scheduleId);
	writeRecordExclusive(file, record, `runtime revocation ${JSON.stringify(scheduleId)}`);
	let appended;
	try {
		appended = emitHarnessEvent(
			targetRoot,
			{
				kind: "runtime.schedule.revoked",
				schemaVersion: SCHEMA_VERSION,
				at,
				actor: decision.principal,
				inputHash: record.snapshotHash,
				reason: reason.slice(0, 2000),
				pointers: [
					schedulePointer(scheduleId, schedule.snapshotHash),
					`runtime-revocation:${scheduleId}#${record.snapshotHash}`,
					decisionPointer(decision.identity, decision.revision),
				],
			},
			scheduleAppendGuard("revoke", scheduleId, pin),
		);
	} catch (error) {
		fs.rmSync(file, { force: true });
		throw error;
	}
	if (!appended || appended.ok !== true) {
		fs.rmSync(file, { force: true });
		throw typedError(
			(appended && appended.code) || CODE_CONFLICT,
			(appended && appended.errors && appended.errors[0]) || "schedule revocation refused",
		);
	}
	return {
		ok: true,
		revocation: record,
		revocationFile: file,
		pointer: `runtime-revocation:${scheduleId}#${record.snapshotHash}`,
	};
}

function scheduleEvents(events, id) {
	return events.filter((event) => eventHasSchedule(event, id));
}

function completedEvents(events, id) {
	return scheduleEvents(events, id).filter((event) => event.kind === "runtime.job.completed");
}

function failedEvents(events, id) {
	return scheduleEvents(events, id).filter((event) => event.kind === "runtime.job.failed");
}

function uniqueProposalCount(events, id) {
	const proposals = new Set();
	for (const event of completedEvents(events, id)) {
		for (const pointer of event.pointers || []) {
			if (pointer.startsWith("runtime-proposal:")) proposals.add(pointer);
		}
	}
	return proposals.size;
}

function scheduleStatus(targetRoot, schedule, events, now = new Date().toISOString()) {
	const nowMs = parseInstant(now, "now");
	const relevant = scheduleEvents(events, schedule.metadata.id);
	const completed = completedEvents(events, schedule.metadata.id);
	const failed = failedEvents(events, schedule.metadata.id);
	const runs = completed.length + failed.length;
	const proposals = uniqueProposalCount(events, schedule.metadata.id);
	const terminal = relevant
		.filter((event) =>
			[
				"runtime.schedule.revoked",
				"runtime.budget.stopped",
				"runtime.no-progress.stopped",
			].includes(event.kind),
		)
		.at(-1);
	let status = "active";
	let reason = null;
	if (terminal) {
		status = terminal.kind === "runtime.schedule.revoked" ? "revoked" : "stopped";
		reason = `${terminal.kind}${terminal.reason ? `: ${terminal.reason}` : ""}`;
	} else if (nowMs < Date.parse(schedule.validAt)) status = "not-yet-valid";
	else if (nowMs >= Date.parse(schedule.validUntil)) status = "expired";
	else if (runs >= schedule.budget.maxRuns) {
		status = "budget-exhausted";
		reason = "maxRuns";
	} else if (proposals >= schedule.budget.maxProposals) {
		status = "budget-exhausted";
		reason = "maxProposals";
	}
	const lastAttempt = [...relevant]
		.reverse()
		.find((event) => ["runtime.job.completed", "runtime.job.failed"].includes(event.kind));
	const nextDueAt = lastAttempt
		? new Date(Date.parse(lastAttempt.at) + schedule.cadence.everyMs).toISOString()
		: schedule.validAt;
	return { status, reason, runs, proposals, nextDueAt };
}

function listSchedules(targetRoot, { now } = {}) {
	const at = now || new Date().toISOString();
	const events = readHarnessEvents(targetRoot);
	return allScheduleRecords(targetRoot, events)
		.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
		.map((schedule) => ({ schedule, runtime: scheduleStatus(targetRoot, schedule, events, at) }));
}

function showSchedule(targetRoot, { scheduleId, now } = {}) {
	const events = readHarnessEvents(targetRoot);
	const schedule = readScheduleRecord(targetRoot, scheduleId, events);
	return {
		schedule,
		runtime: scheduleStatus(targetRoot, schedule, events, now || new Date().toISOString()),
	};
}

function listMarkdownFiles(root) {
	const files = [];
	if (!fs.existsSync(root)) return files;
	const walk = (dir) => {
		for (const entry of fs
			.readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
		}
	};
	walk(root);
	return files;
}

function draftSpecReview(targetRoot) {
	const root = path.join(targetRoot, "docs", "specs");
	const findings = [];
	for (const file of listMarkdownFiles(root)) {
		const text = fs.readFileSync(file, "utf8");
		if (/^\*\*Status:\*\*\s*draft\s*$/imu.test(text)) {
			findings.push({
				kind: "draft-spec-review",
				path: path.relative(targetRoot, file).replaceAll("\\", "/"),
			});
		}
	}
	return { job: "draft-spec-review", findings };
}

const JOBS = Object.freeze({
	"draft-spec-review": Object.freeze({
		name: "draft-spec-review",
		description:
			"Propose human review for docs/specs Markdown files whose canonical Status is draft.",
		authority: AUTHORITY,
		run: draftSpecReview,
	}),
});

function listJobs() {
	return JOB_NAMES.map((name) => ({
		name,
		description: JOBS[name].description,
		authority: AUTHORITY,
	}));
}

function proposalRecord(targetRoot, schedule, result, at) {
	const outputHash = canonicalHashOf({ job: result.job, findings: result.findings });
	if (result.findings.length === 0) return { outputHash, proposal: null, created: false };
	const proposalId = `mp-${outputHash.slice("sha256:".length, "sha256:".length + 20)}`;
	const proposal = {
		schemaVersion: SCHEMA_VERSION,
		proposalId,
		scheduleId: schedule.metadata.id,
		scheduleSnapshotHash: schedule.snapshotHash,
		job: result.job,
		findings: result.findings,
		outputHash,
		createdAt: at,
		authority: AUTHORITY,
	};
	proposal.snapshotHash = canonicalHashOf(proposal);
	const file = path.join(proposalDirCreate(targetRoot), `${proposalId}.json`);
	let created = false;
	let stored = proposal;
	if (!fs.existsSync(file)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		try {
			fs.writeFileSync(file, `${JSON.stringify(proposal, null, "\t")}\n`, {
				encoding: "utf8",
				flag: "wx",
			});
			created = true;
		} catch (error) {
			// A concurrent writer won the same content address: fall through to
			// the read-back, which re-verifies the stored bytes.
			if (!error || error.code !== "EEXIST") throw error;
		}
	}
	if (!created) {
		const existing = readJsonClosed(file, `runtime proposal ${proposalId}`);
		if (existing.outputHash !== outputHash || existing.scheduleId !== schedule.metadata.id)
			throw typedError(
				CODE_CORRUPT,
				`runtime proposal ${proposalId} conflicts with its content address`,
			);
		const { snapshotHash: _snapshotHash, ...existingBody } = existing;
		if (existing.snapshotHash !== canonicalHashOf(existingBody))
			throw typedError(
				CODE_CORRUPT,
				`runtime proposal ${proposalId} no longer matches its Snapshot Hash`,
			);
		stored = existing;
	}
	return { outputHash, proposal: { ...stored, file }, created };
}

function latestSameStop(events, id, kind, reason) {
	const latest = [...scheduleEvents(events, id)].reverse().find((event) => event.kind === kind);
	return latest && latest.reason === reason ? latest : null;
}

function emitStopOnce(targetRoot, events, schedule, kind, reason, at) {
	if (latestSameStop(events, schedule.metadata.id, kind, reason)) return false;
	emitHarnessEvent(targetRoot, {
		kind,
		schemaVersion: SCHEMA_VERSION,
		at,
		reason,
		pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
	});
	return true;
}

function tickOne(targetRoot, schedule, events, at) {
	const runtime = scheduleStatus(targetRoot, schedule, events, at);
	if (["revoked", "stopped", "expired", "not-yet-valid"].includes(runtime.status)) {
		const reason = `${runtime.status}${runtime.reason ? `: ${runtime.reason}` : ""}`;
		if (!latestSameStop(events, schedule.metadata.id, "runtime.wake.skipped", reason)) {
			emitHarnessEvent(targetRoot, {
				kind: "runtime.wake.skipped",
				schemaVersion: SCHEMA_VERSION,
				at,
				reason,
				pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
			});
		}
		// A terminally stopped or revoked schedule reports the STOP fact; a
		// window that has not opened or has closed reports a skip.
		const terminal = runtime.status === "stopped" || runtime.status === "revoked";
		return { scheduleId: schedule.metadata.id, status: terminal ? "stopped" : "skipped", reason };
	}
	if (runtime.status === "budget-exhausted") {
		const reason = `runtime budget exhausted: ${runtime.reason}`;
		emitStopOnce(targetRoot, events, schedule, "runtime.budget.stopped", reason, at);
		return { scheduleId: schedule.metadata.id, status: "stopped", reason };
	}
	if (Date.parse(at) < Date.parse(runtime.nextDueAt)) {
		const reason = `not due until ${runtime.nextDueAt}`;
		if (!latestSameStop(events, schedule.metadata.id, "runtime.wake.skipped", reason)) {
			emitHarnessEvent(targetRoot, {
				kind: "runtime.wake.skipped",
				schemaVersion: SCHEMA_VERSION,
				at,
				reason,
				pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
			});
		}
		return { scheduleId: schedule.metadata.id, status: "skipped", reason };
	}
	emitHarnessEvent(targetRoot, {
		kind: "runtime.wake.started",
		schemaVersion: SCHEMA_VERSION,
		at,
		inputHash: schedule.snapshotHash,
		reason: `runtime wake for ${schedule.job}`,
		pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
	});
	try {
		const result = JOBS[schedule.job].run(targetRoot);
		const stored = proposalRecord(targetRoot, schedule, result, at);
		const pointers = [schedulePointer(schedule.metadata.id, schedule.snapshotHash)];
		if (stored.proposal)
			pointers.push(
				`runtime-proposal:${stored.proposal.proposalId}#${stored.proposal.snapshotHash}`,
			);
		emitHarnessEvent(targetRoot, {
			kind: "runtime.job.completed",
			schemaVersion: SCHEMA_VERSION,
			at,
			inputHash: schedule.snapshotHash,
			outputHash: stored.outputHash,
			reason: `${schedule.job} completed with ${result.findings.length} finding(s)`,
			pointers,
		});
		const previous = [...completedEvents(events, schedule.metadata.id)].reverse()[0];
		const noProgress = Boolean(previous && previous.outputHash === stored.outputHash);
		if (noProgress) {
			emitHarnessEvent(targetRoot, {
				kind: "runtime.no-progress.stopped",
				schemaVersion: SCHEMA_VERSION,
				at,
				outputHash: stored.outputHash,
				reason: `two consecutive ${schedule.job} runs produced the same output`,
				pointers,
			});
		}
		// One terminal stop fact per schedule. No-progress wins when the same
		// completion also reaches a numeric budget; both facts remain visible
		// in the completion counters, but only one stop is appended.
		if (!noProgress) {
			const runsAfter = runtime.runs + 1;
			const proposalsAfter = runtime.proposals + (stored.proposal && stored.created ? 1 : 0);
			if (runsAfter >= schedule.budget.maxRuns || proposalsAfter >= schedule.budget.maxProposals) {
				const dimension = runsAfter >= schedule.budget.maxRuns ? "maxRuns" : "maxProposals";
				emitHarnessEvent(targetRoot, {
					kind: "runtime.budget.stopped",
					schemaVersion: SCHEMA_VERSION,
					at,
					reason: `runtime budget exhausted: ${dimension}`,
					pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
				});
			}
		}
		return {
			scheduleId: schedule.metadata.id,
			status: "completed",
			findings: result.findings.length,
			outputHash: stored.outputHash,
			proposal: stored.proposal,
			proposalCreated: stored.created,
		};
	} catch (error) {
		emitHarnessEvent(targetRoot, {
			kind: "runtime.job.failed",
			schemaVersion: SCHEMA_VERSION,
			at,
			reason: String(error.message || error).slice(0, 2000),
			pointers: [schedulePointer(schedule.metadata.id, schedule.snapshotHash)],
		});
		return {
			scheduleId: schedule.metadata.id,
			status: "failed",
			error: error.message || String(error),
		};
	}
}

function tickRuntime(targetRoot, { scheduleId, now } = {}) {
	const at = now || new Date().toISOString();
	parseInstant(at, "--now");
	const events = readHarnessEvents(targetRoot);
	let schedules = allScheduleRecords(targetRoot, events).sort((a, b) =>
		a.metadata.id.localeCompare(b.metadata.id),
	);
	if (scheduleId !== undefined) {
		schedules = schedules.filter((schedule) => schedule.metadata.id === scheduleId);
		if (schedules.length === 0)
			throw typedError(CODE_NOT_FOUND, `no runtime schedule ${JSON.stringify(scheduleId)}`);
	}
	const results = [];
	for (const schedule of schedules) {
		const freshEvents = readHarnessEvents(targetRoot);
		results.push(tickOne(targetRoot, schedule, freshEvents, at));
	}
	return { ok: true, at, results, authority: AUTHORITY };
}

function isProcessRunning(pid) {
	if (!Number.isInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (_error) {
		return false;
	}
}

function readDaemonState(targetRoot) {
	const file = daemonFile(targetRoot);
	if (!fs.existsSync(file)) return null;
	const state = readJsonClosed(file, "runtime daemon state");
	if (
		!Number.isInteger(state.pid) ||
		state.pid < 1 ||
		typeof state.leaseId !== "string" ||
		!Number.isInteger(state.fence) ||
		state.fence < 1 ||
		path.resolve(state.target || "") !== path.resolve(targetRoot)
	)
		throw typedError(CODE_CORRUPT, "runtime daemon state fails its closed ownership shape");
	return state;
}

function nextFence(targetRoot) {
	const file = fenceFile(targetRoot);
	let current = 0;
	if (fs.existsSync(file)) {
		const record = readJsonClosed(file, "runtime fence");
		if (!Number.isInteger(record.fence) || record.fence < 0)
			throw typedError(CODE_CORRUPT, "runtime fence is malformed");
		current = record.fence;
	}
	const next = current + 1;
	fs.writeFileSync(file, `${JSON.stringify({ fence: next }, null, "\t")}\n`, "utf8");
	return next;
}

function acquireStartLock(targetRoot) {
	const file = startLockFile(targetRoot);
	try {
		const fd = fs.openSync(file, "wx");
		return () => {
			try {
				fs.closeSync(fd);
			} finally {
				fs.rmSync(file, { force: true });
			}
		};
	} catch (error) {
		throw typedError(CODE_CONFLICT, `runtime daemon start is already locked: ${error.message}`);
	}
}

function startDaemon(targetRoot, { pollMs, now } = {}) {
	const poll = pollMs === undefined ? 5_000 : Number(pollMs);
	if (!Number.isInteger(poll) || poll < MIN_POLL_MS || poll > MAX_POLL_MS)
		throw typedError(
			CODE_INVALID,
			`--poll-ms must be an integer in [${MIN_POLL_MS}, ${MAX_POLL_MS}]`,
		);
	const release = acquireStartLock(targetRoot);
	try {
		const previous = readDaemonState(targetRoot);
		const at = now || new Date().toISOString();
		parseInstant(at, "daemon start time");
		if (previous && isProcessRunning(previous.pid))
			throw typedError(
				CODE_DAEMON_RUNNING,
				`runtime daemon is already running as pid ${previous.pid}`,
			);
		if (previous) {
			emitHarnessEvent(targetRoot, {
				kind: "runtime.daemon.recovered",
				schemaVersion: SCHEMA_VERSION,
				at,
				reason: `recovered stale runtime daemon owner pid ${previous.pid} fence ${previous.fence}`,
				pointers: [`runtime-daemon:${previous.leaseId}#${previous.fence}`],
			});
			fs.rmSync(daemonFile(targetRoot), { force: true });
		}
		const fence = nextFence(targetRoot);
		const leaseId = crypto.randomUUID();
		const worker = path.join(__dirname, "..", "..", "amber-runtime.js");
		const child = spawn(
			process.execPath,
			[
				worker,
				"--target",
				path.resolve(targetRoot),
				"--poll-ms",
				String(poll),
				"--lease",
				leaseId,
				"--fence",
				String(fence),
			],
			{ detached: true, stdio: "ignore", windowsHide: true },
		);
		if (!child.pid) throw typedError(CODE_CONFLICT, "runtime daemon spawn returned no pid");
		const state = {
			schemaVersion: SCHEMA_VERSION,
			pid: child.pid,
			leaseId,
			fence,
			target: path.resolve(targetRoot),
			pollMs: poll,
			startedAt: at,
		};
		fs.writeFileSync(daemonFile(targetRoot), `${JSON.stringify(state, null, "\t")}\n`, "utf8");
		emitHarnessEvent(targetRoot, {
			kind: "runtime.daemon.started",
			schemaVersion: SCHEMA_VERSION,
			at,
			reason: `bounded maintenance daemon started pid ${child.pid} fence ${fence}`,
			pointers: [`runtime-daemon:${leaseId}#${fence}`],
		});
		child.unref();
		return { ok: true, state, authority: AUTHORITY };
	} finally {
		release();
	}
}

function daemonStatus(targetRoot) {
	const state = readDaemonState(targetRoot);
	if (!state) return { ok: true, status: "stopped", state: null, authority: AUTHORITY };
	return {
		ok: true,
		status: isProcessRunning(state.pid) ? "running" : "stale",
		state,
		authority: AUTHORITY,
	};
}

function sleepSync(ms) {
	const shared = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(shared, 0, 0, ms);
}

function stopDaemon(targetRoot, { now } = {}) {
	const state = readDaemonState(targetRoot);
	if (!state) return { ok: true, status: "stopped", idempotent: true };
	const at = now || new Date().toISOString();
	parseInstant(at, "daemon stop time");
	if (isProcessRunning(state.pid)) {
		try {
			process.kill(state.pid, "SIGTERM");
		} catch (error) {
			throw typedError(
				CODE_DAEMON_OWNERSHIP,
				`failed to signal runtime daemon pid ${state.pid}: ${error.message}`,
			);
		}
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline && isProcessRunning(state.pid)) sleepSync(50);
		if (isProcessRunning(state.pid))
			throw typedError(
				CODE_DAEMON_OWNERSHIP,
				`runtime daemon pid ${state.pid} did not stop within 5s`,
			);
	}
	fs.rmSync(daemonFile(targetRoot), { force: true });
	emitHarnessEvent(targetRoot, {
		kind: "runtime.daemon.stopped",
		schemaVersion: SCHEMA_VERSION,
		at,
		reason: `bounded maintenance daemon stopped pid ${state.pid} fence ${state.fence}`,
		pointers: [`runtime-daemon:${state.leaseId}#${state.fence}`],
	});
	return { ok: true, status: "stopped", idempotent: false, state };
}

function ownershipMatches(targetRoot, expected) {
	const state = readDaemonState(targetRoot);
	return Boolean(
		state &&
		state.pid === process.pid &&
		state.leaseId === expected.leaseId &&
		state.fence === expected.fence,
	);
}

async function runDaemonWorker(targetRoot, { pollMs, leaseId, fence, maxTicks } = {}) {
	const expected = { leaseId, fence: Number(fence) };
	let stopping = false;
	let wakeDelay = null;
	const limit = Number.isInteger(maxTicks) && maxTicks > 0 ? maxTicks : Infinity;
	let ticks = 0;
	const requestStop = () => {
		stopping = true;
		if (wakeDelay) wakeDelay();
	};
	process.on("SIGTERM", requestStop);
	process.on("SIGINT", requestStop);
	// Parent writes daemon.json immediately after spawn. Wait briefly for the
	// ownership record instead of racing it.
	const readyDeadline = Date.now() + 2_000;
	while (Date.now() < readyDeadline && !ownershipMatches(targetRoot, expected)) {
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	if (!ownershipMatches(targetRoot, expected))
		return { ok: false, reason: "ownership-not-established" };
	while (!stopping && ticks < limit) {
		if (!ownershipMatches(targetRoot, expected)) return { ok: false, reason: "ownership-lost" };
		tickRuntime(targetRoot, {});
		ticks += 1;
		if (ticks >= limit) break;
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				wakeDelay = null;
				resolve();
			}, pollMs);
			wakeDelay = () => {
				clearTimeout(timer);
				wakeDelay = null;
				resolve();
			};
		});
	}
	return { ok: true, reason: stopping ? "stopped" : "max-ticks", ticks };
}

module.exports = {
	SCHEMA_VERSION,
	AUTHORITY,
	JOB_NAMES,
	CODE_INVALID,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_CONFLICT,
	CODE_DAEMON_RUNNING,
	CODE_DAEMON_OWNERSHIP,
	admitSchedule,
	revokeSchedule,
	listSchedules,
	showSchedule,
	listJobs,
	tickRuntime,
	startDaemon,
	stopDaemon,
	daemonStatus,
	runDaemonWorker,
	isProcessRunning,
};
