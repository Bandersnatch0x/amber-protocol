"use strict";

// Harness Replay core (F073 H5; proposal §7/§26/§34/§43/§46.5).
//
// Replay is VERIFICATION, not re-execution: the §43 gate is that
// `amber harness replay run-123` completes WITHOUT chat history — the replay
// re-derives each §7 axis from the run's own frozen records and compares it
// to what the run froze. It never re-runs a command (retry is a new run,
// ADR-0101), never reads any conversation state, and never infers more than
// the records cite. Each axis lands `equivalent | drift | unevaluated`
// (unevaluated = no frozen fact to compare — disclosed, never guessed); the
// §7 candidate causes are the closed drift-kind enum, with `model-drift` as
// the EXPLICIT residual (Amber has no model introspection — it is reported
// only when named by the caller-facing verdict logic, never inferred from a
// hash).
//
// Regression proposals (§17) derive ONLY from recorded facts and are DATA for
// human review: no command here touches a policy, rule, contract, or grant —
// eval may find problems but can never change governance.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { canonicalJson } = require("../core/context-hash");
const { getRun, ADMISSION_CHECK_NAMES } = require("./run-core");
const { inspectHarnessContract } = require("./contract-core");
const { readRunEvents } = require("./event-ledger");
const { listAttempts } = require("./attempt-core");
const { toolsSnapshot } = require("./tool-core");
const { readExecutionRecord } = require("./execution-adapter");
const { isFinal } = require("./run-state-machine");

const CODE_CORRUPT = "AMBER_E_HARNESS_REPLAY_CORRUPT";
const CODE_NOTHING_TO_PROPOSE = "AMBER_E_HARNESS_REGRESSION_NOTHING_TO_PROPOSE";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// The closed §7 drift-kind enum. `model-drift` is the explicit residual
// candidate — never inferred from a hash.
const DRIFT_KINDS = Object.freeze([
	"environment-drift",
	"policy-drift",
	"tool-drift",
	"context-drift",
	"model-drift",
	"non-determinism",
]);

const AXIS_VERDICTS = Object.freeze(["equivalent", "drift", "unevaluated"]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

function replayDirForCreate(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "replays", safeId(runId));
}

function replayDirForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "replays", safeId(runId));
}

// The closed inline shape of one replay result.
function replayProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return "replay result is not an object";
	}
	if (typeof record.runId !== "string" || record.runId.length === 0) {
		return "replay result carries no runId";
	}
	if (!AXIS_VERDICTS.includes(record.verdict)) {
		return `replay verdict ${JSON.stringify(record.verdict)} is outside the closed set`;
	}
	for (const axis of record.axes || []) {
		if (!AXIS_VERDICTS.includes(axis.verdict)) {
			return `axis ${JSON.stringify(axis.name)} carries unknown verdict ${JSON.stringify(axis.verdict)}`;
		}
		if (axis.verdict === "unevaluated" && (typeof axis.detail !== "string" || !axis.detail)) {
			return `axis ${JSON.stringify(axis.name)} is unevaluated without a disclosed reason`;
		}
		if (axis.driftKind !== undefined && !DRIFT_KINDS.includes(axis.driftKind)) {
			return `axis ${JSON.stringify(axis.name)} carries unknown driftKind ${JSON.stringify(axis.driftKind)}`;
		}
	}
	return null;
}

// One §7 axis. Each re-derivation reads the run's frozen fact and compares it
// to the current tree — never a conversation, never a re-execution.
function deriveAxes(targetRoot, run) {
	const axes = [];
	const add = (name, verdict, detail, driftKind, pointer) =>
		axes.push({
			name,
			verdict,
			detail,
			...(driftKind ? { driftKind } : {}),
			...(pointer ? { pointer } : {}),
		});

	// contract: the admitted contract record still hashes to the frozen
	// snapshot (re-hash the STORED record, never re-admit). A missing,
	try {
		const admitted = inspectHarnessContract(targetRoot, { contractId: run.harness.contract });
		const same = admitted.snapshotHash === run.harness.contractSnapshotHash;
		add(
			"contract",
			same ? "equivalent" : "drift",
			same
				? "the admitted contract record still hashes to the frozen snapshot"
				: "the stored contract record no longer hashes to the frozen snapshot",
			same ? undefined : "environment-drift",
			`contract:${run.harness.contract}`,
		);
	} catch (err) {
		add(
			"contract",
			"drift",
			`the frozen contract ${run.harness.contract} no longer verifies (${err.amberCode || err.message})`,
			"environment-drift",
		);
	}

	// tools: the current registry hashes to the frozen snapshot.
	if (!run.tools) {
		add("tools", "unevaluated", "the run froze no tool snapshot (pre-H1 record)");
	} else {
		const current = toolsSnapshot(targetRoot);
		const same = current && current.snapshotHash === run.tools.snapshotHash;
		add(
			"tools",
			same ? "equivalent" : "drift",
			same
				? "the tool registry still hashes to the frozen snapshot"
				: "the tool registry changed since the run froze its snapshot",
			same ? undefined : "tool-drift",
			`tools:${run.tools.snapshotHash}`,
		);
	}

	// execution: the prepared record still exists with its frozen effective
	// boundary. A RELEASED workspace is the recorded fact (release is a
	// recorded step, not drift); record CORRUPTION is drift. The closed-shape
	// reader refuses a corrupt record — per-axis it lands as drift (the
	// frozen fact no longer verifies), never aborting the whole replay.
	let executionRecord;
	try {
		executionRecord = readExecutionRecord(targetRoot, { runId: run.id });
	} catch (err) {
		if (err.amberCode === "AMBER_E_HARNESS_EXEC_RECORD_CORRUPT") {
			add(
				"execution",
				"drift",
				"the prepared execution record fails its closed shape (corrupt)",
				"environment-drift",
				`execution-record:${safeId(run.id)}`,
			);
			executionRecord = undefined;
		} else {
			throw err;
		}
	}
	if (!executionRecord) {
		add(
			"execution",
			"unevaluated",
			"no prepared execution record — the run never executed under a contract",
		);
	} else if (executionRecord.comparison) {
		const released = Boolean(executionRecord.releasedAt);
		add(
			"execution",
			"equivalent",
			released
				? `the prepared workspace was released (recorded step, ${executionRecord.releasedAt}) — the frozen boundary is unchanged`
				: "the prepared execution record still carries its frozen effective boundary",
			undefined,
			`execution-record:${safeId(run.id)}`,
		);
	} else {
		add(
			"execution",
			"equivalent",
			"the prepared execution record still carries its frozen effective boundary",
			undefined,
			`execution-record:${safeId(run.id)}`,
		);
	}

	// context: the admission receipt is complete AND consistent with the
	// trail — the run.admitted event on the chain carries the six receipt
	// pointers, so a record that lost its receipt while the trail still
	// witnessed one is drift (record tampering), not silence. The grant
	// surface is NOT re-evaluated: grants are TTL-bound and the run's
	// authority was settled at admission.
	const admittedEvent = readRunEvents(targetRoot, run.id).find(
		(event) => event.kind === "run.admitted",
	);
	if (!run.admission && !admittedEvent) {
		add("context", "unevaluated", "no admission receipt on the run and none on the trail");
	} else if (!run.admission || !admittedEvent) {
		add(
			"context",
			"drift",
			!run.admission
				? "the trail witnessed an admission but the run record carries no receipt"
				: "the run record carries a receipt the trail never witnessed",
			"context-drift",
		);
	} else {
		const names = [...ADMISSION_CHECK_NAMES];
		const missing = names.filter(
			(name) => !run.admission.checks[name] || run.admission.checks[name].result !== "pass",
		);
		add(
			"context",
			missing.length === 0 ? "equivalent" : "drift",
			missing.length === 0
				? "the six-check admission receipt is complete and trail-witnessed"
				: `the admission receipt is incomplete: ${missing.join(", ")}`,
			missing.length === 0 ? undefined : "context-drift",
		);
	}

	// policy: the frozen ref is compared against the trail's policy verdict —
	// what the run actually operated under. A frozen ref with no trail
	// verdict has nothing to compare against: unevaluated (disclosed), never
	// guessed equivalent.
	const policyEvents = readRunEvents(targetRoot, run.id).filter(
		(event) => event.kind === "policy.evaluated",
	);
	if (!run.harness.policy && policyEvents.length === 0) {
		add("policy", "unevaluated", "the run froze no policy ref and the trail has no policy verdict");
	} else if (policyEvents.length === 0) {
		add(
			"policy",
			"unevaluated",
			`the frozen ref ${run.harness.policy} has no trail verdict to compare against`,
		);
	} else {
		const denied = policyEvents.find((event) => event.decision && event.decision.result === "deny");
		const trailPolicy = policyEvents[policyEvents.length - 1];
		// A trail verdict that cites no policy at all has nothing to compare
		// the frozen ref against: unevaluated (disclosed), never "agreed".
		if (!trailPolicy.decision || !trailPolicy.decision.policy) {
			add(
				"policy",
				"unevaluated",
				"the trail's policy verdict cites no policy ref to compare the frozen ref against",
			);
		} else {
			const consistent = !denied && trailPolicy.decision.policy === run.harness.policy;
			add(
				"policy",
				consistent ? "equivalent" : "drift",
				consistent
					? "the frozen policy ref is consistent with the trail's policy verdict"
					: denied
						? "the trail carries a deny policy verdict"
						: "the frozen policy ref differs from the trail's policy verdict",
				consistent ? undefined : "policy-drift",
			);
		}
	}

	// attempts: the run froze an `attempts` summary (count, last attempt id,
	// last attempt state) at its last attempt recording; the fold re-derives
	// the same summary from the records — a mismatch means the frozen fact and
	// the records no longer agree (non-determinism drift). A run with records
	// but no frozen summary is drift in the other direction (the summary was
	// never written while records exist).
	const attempts = listAttempts(targetRoot, { runId: run.id });
	if (attempts.length === 0 && !run.attempts) {
		add("attempts", "unevaluated", "the run has no attempt records and froze no summary");
	} else if (!run.attempts) {
		add(
			"attempts",
			"drift",
			`${attempts.length} attempt record(s) exist but the run froze no attempts summary`,
			"non-determinism",
			`attempts:${safeId(run.id)}`,
		);
	} else {
		const last = attempts[attempts.length - 1];
		const consistent =
			attempts.length === run.attempts.count &&
			last &&
			last.attemptId === run.attempts.lastAttemptId &&
			last.state === run.attempts.lastAttemptState;
		add(
			"attempts",
			consistent ? "equivalent" : "drift",
			consistent
				? `the attempt fold re-derives the frozen summary (${attempts.length} record(s))`
				: `the attempt fold disagrees with the frozen summary (records=${attempts.length}, frozen=${run.attempts.count})`,
			consistent ? undefined : "non-determinism",
			`attempts:${safeId(run.id)}`,
		);
	}
	return axes;
}

/**
 * Replay one run: re-derive the §7 axes from the run's own frozen records and
 * compare. No chat history, no conversation state, no re-execution. The
 * result is content-addressed (same facts → same replayId → idempotent).
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} [opts.now]
 */
function replayRun(targetRoot, { runId, now } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to replay a run");
	}
	const { run } = getRun(targetRoot, { runId });
	const at = now || new Date().toISOString();
	const axes = deriveAxes(targetRoot, run);
	const drifted = axes.filter((axis) => axis.verdict === "drift");
	const verdict = drifted.length === 0 ? "equivalent" : "drift";
	const identity = crypto
		.createHash("sha256")
		.update(canonicalIdentity({ runId, runState: run.state, axes }))
		.digest("hex")
		.slice(0, 16);
	const replayId = `rp-${identity}`;
	const result = {
		replayId,
		runId,
		at,
		state: run.state,
		original: { status: isFinal(run.state) ? run.state : "non-final" },
		replay: { status: verdict },
		axes,
		verdict,
		...(drifted.length > 0
			? { driftKinds: [...new Set(drifted.map((axis) => axis.driftKind).filter(Boolean))] }
			: {}),
	};
	const problem = replayProblem(result);
	if (problem) throw typedError(CODE_CORRUPT, `refusing to store a malformed replay: ${problem}`);
	const file = path.join(replayDirForCreate(targetRoot, runId), `${safeId(replayId)}.json`);
	let idempotent = false;
	if (fs.existsSync(file)) {
		idempotent = true;
	} else {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(result, null, "\t")}\n`, "utf8");
		refreshReplaySummary(targetRoot, { runId, result });
	}
	return { ok: true, replay: result, replayFile: file, idempotent };
}

// Deterministic key-sorted serialization for content identity — the repo's
// canonicalJson (recursive sorted keys), the same canonicalization canonical
// artifacts and checkpoint digests use. One helper, not two.
function canonicalIdentity(value) {
	return canonicalJson(JSON.stringify(value));
}

// The run record's additive `replay` summary (ADR-0012): the latest verdict.
function refreshReplaySummary(targetRoot, { runId, result } = {}) {
	const { run } = getRun(targetRoot, { runId });
	run.replay = { verdict: result.verdict, replayId: result.replayId, replayedAt: result.at };
	const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
	return { ok: true, summary: run.replay };
}

// The closed inline shape of one regression proposal.
function proposalProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return "regression proposal is not an object";
	}
	if (typeof record.runId !== "string" || record.runId.length === 0) {
		return "regression proposal carries no runId";
	}
	if (!Array.isArray(record.causeKinds) || record.causeKinds.length === 0) {
		return "regression proposal carries no causeKinds";
	}
	for (const kind of record.causeKinds) {
		if (!DRIFT_KINDS.includes(kind) && !["run-failure"].includes(kind)) {
			return `regression proposal carries unknown cause kind ${JSON.stringify(kind)}`;
		}
	}
	return null;
}

/**
 * Derive a regression proposal from RECORDED FACTS only (the F054 discipline:
 * never caller input). A run proposes when its terminal outcome is
 * failed/cancelled or its latest replay found drift; a clean passing run has
 * nothing to propose (explicit refusal, not an empty success). The proposal
 * is DATA for human review — §17: eval finds problems, humans change
 * governance; nothing here mutates a policy, rule, contract, or grant.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} [opts.now]
 */
function proposeRegression(targetRoot, { runId, now } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to propose a regression");
	}
	const { run } = getRun(targetRoot, { runId });
	const at = now || new Date().toISOString();
	const causeKinds = [];
	if (["failed", "cancelled"].includes(run.state)) {
		causeKinds.push("run-failure");
	}
	const replays = listReplays(targetRoot, { runId });
	// The LATEST replay by its recorded `at` (content-hash filenames carry no
	// clock — filename order would let the proposal cite an arbitrary replay).
	const latest = replays.length > 0 ? replays.reduce((a, b) => (a.at > b.at ? a : b)) : null;
	if (latest && latest.verdict === "drift") {
		causeKinds.push(...(latest.driftKinds || []));
	}
	if (causeKinds.length === 0) {
		throw typedError(
			CODE_NOTHING_TO_PROPOSE,
			`run "${runId}" is ${run.state} with no drift on record — a clean passing run proposes nothing (proposals derive from recorded facts only)`,
		);
	}
	const identity = crypto
		.createHash("sha256")
		.update(canonicalIdentity({ runId, runState: run.state, causeKinds }))
		.digest("hex")
		.slice(0, 16);
	const proposalId = `rg-${identity}`;
	const proposal = {
		proposalId,
		runId,
		at,
		causeKinds: [...new Set(causeKinds)],
		...(latest ? { replayId: latest.replayId, replayVerdict: latest.verdict } : {}),
		validation: run.validation ? { status: run.validation.status } : undefined,
		humanReviewRequired: true,
	};
	const problem = proposalProblem(proposal);
	if (problem) throw typedError(CODE_CORRUPT, `refusing to store a malformed proposal: ${problem}`);
	const file = path.join(replayDirForCreate(targetRoot, runId), `${safeId(proposalId)}.json`);
	let idempotent = false;
	if (fs.existsSync(file)) {
		idempotent = true;
	} else {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(proposal, null, "\t")}\n`, "utf8");
	}
	return { ok: true, proposal, proposalFile: file, idempotent };
}

/**
 * List one run's replay results, oldest first by their recorded `at` (id
 * tiebreak) — content-hash filenames carry no clock, so filename order would
 * be arbitrary. A missing directory is empty.
 */
function listReplays(targetRoot, { runId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to list replays");
	}
	const dir = replayDirForRead(targetRoot, runId);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.startsWith("rp-") && name.endsWith(".json"))
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const problem = replayProblem(record);
				if (problem) {
					throw typedError(CODE_CORRUPT, `replay result fails its closed shape: ${problem}`);
				}
				return record;
			} catch (err) {
				if (err.amberCode) throw err;
				throw typedError(CODE_CORRUPT, `replay result is not valid JSON: ${name}`);
			}
		})
		.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.replayId < b.replayId ? -1 : 1));
}

// F076: the cross-run comparison — the SAME six-axis derivation the replay
// engine uses (composed, never re-implemented), folded over two runs' frozen
// facts. The outcome states are reported side by side but NEVER compared
// into the verdict: outcome is the runs' own business (a FAILED run under an
// equivalent world is exactly the no-progress signal the attempts axis
// already reports). Response-only: a diff of two immutable records is
// reproducible by re-running the command — no receipt/proposal artifact.
const DIFF_AXIS_VERDICTS = Object.freeze(["same", "differs", "only-a", "only-b"]);
const DIFF_VERDICTS = Object.freeze(["equivalent-world", "world-drift", "incomparable"]);

/**
 * Diff two runs over the replay axes. Both flags are required; the runs must
 * share the same declared subject.task (two declared tasks that differ are
 * `unrelated` and refused — comparing unrelated worlds is not a diff).
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.fromRunId @param {string} opts.toRunId
 */
function diffRuns(targetRoot, { fromRunId, toRunId } = {}) {
	if (!fromRunId || typeof fromRunId !== "string" || !toRunId || typeof toRunId !== "string") {
		throw typedError(
			CODE_INVALID_ARG,
			"--from <runId> and --to <runId> are both required for harness diff (a one-sided diff is not a diff)",
		);
	}
	const { run: runA } = getRun(targetRoot, { runId: fromRunId });
	const { run: runB } = getRun(targetRoot, { runId: toRunId });
	const taskA = runA.subject ? (runA.subject.task ?? null) : null;
	const taskB = runB.subject ? (runB.subject.task ?? null) : null;
	// Fail closed on an undisclosed relationship: different declared tasks
	// refuse outright, and a mixed declaration (one run names a task, the
	// other does not) cannot confirm a shared world — refused too, with the
	// reason named. Only equal declared tasks, or no task on either side,
	// proceed (the latter disclosed as such, never read as "same").
	if (taskA !== null && taskB !== null && taskA !== taskB) {
		throw typedError(
			CODE_INVALID_ARG,
			`the runs declare different tasks (${JSON.stringify(taskA)} vs ${JSON.stringify(taskB)}) — comparing unrelated worlds is refused; diff runs of one task`,
		);
	}
	if ((taskA === null) !== (taskB === null)) {
		throw typedError(
			CODE_INVALID_ARG,
			`only one run declares a task (${JSON.stringify(taskA)} vs ${JSON.stringify(taskB)}) — the relationship is undisclosed; diff runs that both declare the same task (or neither)`,
		);
	}
	const axesA = deriveAxes(targetRoot, runA);
	const axesB = deriveAxes(targetRoot, runB);
	// The folded identity: for axes whose frozen fact is a WORLD-scoped
	// artifact (contract, tools), the derivation's pointer IS the frozen fact
	// identity — two runs under different tool snapshots both derive `drift`
	// against the current registry, and folding on the verdict alone would
	// read that pair as the same world. For run-scoped axes (execution,
	// attempts — their records are per-run by design), the verdict + drift
	// kind is the sensible identity.
	const RUN_SCOPED_DIFF_AXES = new Set(["execution", "attempts"]);
	const axes = axesA.map((axisA) => {
		const axisB = axesB.find((axis) => axis.name === axisA.name);
		let comparison;
		if (!axisB || axisB.verdict === "unevaluated") {
			comparison = axisA.verdict === "unevaluated" ? "same" : "only-a";
		} else if (axisA.verdict === "unevaluated") {
			comparison = "only-b";
		} else if (
			!RUN_SCOPED_DIFF_AXES.has(axisA.name) &&
			axisA.pointer !== undefined &&
			axisB.pointer !== undefined
		) {
			comparison =
				axisA.pointer === axisB.pointer && axisA.verdict === axisB.verdict ? "same" : "differs";
		} else {
			// Run-scoped records or pointerless axes: same verdict + same
			// drift kind means the two runs froze the same fact.
			comparison =
				axisA.verdict === axisB.verdict && (axisA.driftKind ?? null) === (axisB.driftKind ?? null)
					? "same"
					: "differs";
		}
		return {
			name: axisA.name,
			from: axisA.verdict,
			to: axisB ? axisB.verdict : "unevaluated",
			comparison,
		};
	});
	// The spec's verdict, exactly: world-drift when any shared axis differs;
	// equivalent-world when every shared axis is same (one-sided facts are
	// disclosed in the axes, never guessed into the verdict); incomparable
	// when the runs share no evaluated axis fact at all.
	const differs = axes.some((axis) => axis.comparison === "differs");
	const sharedEvaluated = axes.some(
		(axis) => axis.from !== "unevaluated" && axis.to !== "unevaluated",
	);
	const verdict = differs ? "world-drift" : sharedEvaluated ? "equivalent-world" : "incomparable";
	return {
		ok: true,
		from: { runId: fromRunId, state: runA.state, task: taskA },
		to: { runId: toRunId, state: runB.state, task: taskB },
		// Unreachable as "same task" for mixed declarations — they refuse
		// above; this field only ever reads "same task" or the disclosed
		// no-task case.
		related:
			taskA === null && taskB === null ? "undisclosed (neither run declares a task)" : "same task",
		verdict,
		axes,
	};
}

module.exports = {
	replayRun,
	proposeRegression,
	listReplays,
	deriveAxes,
	diffRuns,
	DIFF_AXIS_VERDICTS,
	DIFF_VERDICTS,
	DRIFT_KINDS,
	AXIS_VERDICTS,
	CODE_CORRUPT,
	CODE_NOTHING_TO_PROPOSE,
	CODE_INVALID_ARG,
};
