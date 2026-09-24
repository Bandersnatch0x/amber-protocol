"use strict";

// Harness Validation core (F073 H5; proposal §16/§17/§34/§51C).
//
// A ValidationReceipt is the artifact form of "did this run actually pass
// validation" — §16: validation produces a receipt, never just an exit code.
// The check set is CLOSED and deterministic (model-independent): every check
// reads the run's own frozen records, and `not-run` is the honest disclosure
// (a missing check can never silently read as passing). The receipt never
// touches the run's state machine — Task Result and Validation are two facts
// that cannot overwrite each other (§4.6), and eval may find problems but can
// never change governance (§17/§26): this module writes only its own record
// area and the additive run summary.

const fs = require("node:fs");
const path = require("node:path");

const { statePath, statePathForCreate } = require("../state-dir-resolver");
const { canonicalJson } = require("../core/context-hash");
const { getRun, ADMISSION_CHECK_NAMES } = require("./run-core");
const { readRunEvents } = require("./event-ledger");
const { listAttempts } = require("./attempt-core");
const { readExecutionRecord } = require("./execution-adapter");
const { emitHarnessEvent } = require("./event-ledger");
const { toolsSnapshot } = require("./tool-core");

const CODE_CORRUPT = "AMBER_E_HARNESS_VALIDATION_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";
const CODE_ARTIFACT_NOT_FOUND = "AMBER_E_ARTIFACT_NOT_FOUND";

// The closed check set (§16 static/dynamic/behavioral/evidence mapped onto
// the facts Amber actually owns). These six are ALWAYS evaluated.
const CHECK_NAMES = Object.freeze([
	"policy",
	"execution",
	"tools",
	"context",
	"evidence",
	"attempts",
]);
// F077: the one check that exists ONLY when a committed eval-result is bound
// onto the validation (`--eval-result <identity>@<revision>`). Absent on an
// unbound receipt so the unbound path stays byte-identical to F073 — a pass
// recorded before F077 is never silently revised.
const EVAL_CHECK_NAME = "eval";
const ALLOWED_CHECK_NAMES = Object.freeze([...CHECK_NAMES, EVAL_CHECK_NAME]);
const CHECK_STATUSES = Object.freeze(["pass", "fail", "not-run"]);
const EVAL_OVERALL = Object.freeze(["pass", "fail"]);

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

function validationDirForCreate(targetRoot, runId) {
	return statePathForCreate(targetRoot, "harness", "validations", safeId(runId));
}

function validationDirForRead(targetRoot, runId) {
	return statePath(targetRoot, "harness", "validations", safeId(runId));
}

// The closed inline shape of one receipt (the H2a ExecutionRecord precedent).
function receiptProblem(record) {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return "validation receipt is not an object";
	}
	if (typeof record.runId !== "string" || record.runId.length === 0) {
		return "validation receipt carries no runId";
	}
	if (!record.result || !["accepted", "rejected"].includes(record.result.status)) {
		return "validation receipt result.status must be accepted|rejected";
	}
	for (const check of record.checks || []) {
		if (!ALLOWED_CHECK_NAMES.includes(check.name)) {
			return `validation receipt carries unknown check ${JSON.stringify(check.name)}`;
		}
		if (!CHECK_STATUSES.includes(check.status)) {
			return `check ${JSON.stringify(check.name)} carries unknown status ${JSON.stringify(check.status)}`;
		}
		if (check.status === "not-run" && (typeof check.detail !== "string" || !check.detail)) {
			return `check ${JSON.stringify(check.name)} is not-run without a disclosed reason`;
		}
	}
	// F077: exactly one eval leg and the evalResult block appear together, or
	// neither appears. A duplicated leg would make one bound verdict read as
	// multiple judgments and therefore fails the closed shape.
	const evalChecks = (record.checks || []).filter((check) => check.name === EVAL_CHECK_NAME);
	if (evalChecks.length > 1) return "validation receipt carries duplicate eval checks";
	const hasEvalCheck = evalChecks.length === 1;
	if (hasEvalCheck !== (record.evalResult !== undefined)) {
		return hasEvalCheck
			? "validation receipt carries an eval check without its evalResult binding"
			: "validation receipt carries an evalResult binding without its eval check";
	}
	if (record.evalResult !== undefined) {
		const bound = record.evalResult;
		if (!bound || typeof bound !== "object" || Array.isArray(bound)) {
			return "validation receipt evalResult is not an object";
		}
		const boundFields = Object.keys(bound).sort();
		if (
			JSON.stringify(boundFields) !==
			JSON.stringify(["contentHash", "definition", "identity", "overall", "revision"])
		) {
			return `validation receipt evalResult carries unknown or missing fields: ${boundFields.join(", ")}`;
		}
		if (typeof bound.identity !== "string" || bound.identity.length === 0) {
			return "validation receipt evalResult carries no identity";
		}
		if (!Number.isInteger(bound.revision) || bound.revision < 1) {
			return "validation receipt evalResult revision must be a positive integer";
		}
		if (!/^sha256:[0-9a-f]{64}$/.test(bound.contentHash || "")) {
			return "validation receipt evalResult.contentHash must be sha256:<64-hex>";
		}
		if (!EVAL_OVERALL.includes(bound.overall)) {
			return `validation receipt evalResult.overall must be pass|fail; got ${JSON.stringify(bound.overall)}`;
		}
		if (bound.definition !== null) {
			const definition = bound.definition;
			if (
				!definition ||
				typeof definition !== "object" ||
				Array.isArray(definition) ||
				JSON.stringify(Object.keys(definition).sort()) !==
					JSON.stringify(["identity", "revision"]) ||
				typeof definition.identity !== "string" ||
				definition.identity.length === 0 ||
				!Number.isInteger(definition.revision) ||
				definition.revision < 1
			) {
				return "validation receipt evalResult.definition must be null or {identity, revision}";
			}
		}
		const evalCheck = evalChecks[0];
		if (evalCheck.status !== bound.overall) {
			return "validation receipt eval check status disagrees with evalResult.overall";
		}
		const { artifactGraphNodeId } = require("../core/artifact-graph-projection");
		if (evalCheck.pointer !== artifactGraphNodeId("eval-result", bound.identity, bound.revision)) {
			return "validation receipt eval check pointer disagrees with the bound eval-result revision";
		}
		if (typeof evalCheck.detail !== "string" || evalCheck.detail.length === 0) {
			return "validation receipt eval check carries no detail";
		}
	}
	return null;
}

// F077: resolve one `--eval-result <identity>@<revision>` pin to a COMMITTED
// eval-result revision through the canonical reader (never re-implemented —
// spelling variants, trace cycles, and hash mismatches refuse with the
// reader's own codes). Returns the frozen binding the receipt records plus
// the `eval` check. A result that records no `overall` verdict is a caller
// error (binding something that cannot judge), refused before any write.
function resolveEvalResultBinding(targetRoot, pin) {
	if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
		throw typedError(CODE_INVALID_ARG, "evalResult must be { identity, revision }");
	}
	if (typeof pin.identity !== "string" || pin.identity.length === 0) {
		throw typedError(CODE_INVALID_ARG, "evalResult.identity must be a non-empty string");
	}
	if (!Number.isInteger(pin.revision) || pin.revision < 1) {
		throw typedError(CODE_INVALID_ARG, "evalResult.revision must be a positive integer");
	}
	const { showArtifact } = require("../core/canonical-artifacts");
	const { artifactGraphNodeId } = require("../core/artifact-graph-projection");
	const revision = showArtifact(targetRoot, pin.identity, {
		type: "eval-result",
		revision: pin.revision,
	});
	if (revision === null) {
		throw typedError(
			CODE_ARTIFACT_NOT_FOUND,
			`no committed eval-result revision ${JSON.stringify(pin.identity)}@${pin.revision} exists; bind a committed eval-result (amber artifact list --type eval-result)`,
		);
	}
	const carrier = revision.envelope?.extensions?.evalResult;
	const overall = carrier?.result?.overall;
	if (!EVAL_OVERALL.includes(overall)) {
		throw typedError(
			CODE_INVALID_ARG,
			`eval-result ${JSON.stringify(pin.identity)}@${pin.revision} records no overall verdict (extensions.evalResult.result.overall must be pass|fail; got ${JSON.stringify(overall)}); a result that cannot judge cannot be bound`,
		);
	}
	const declared = carrier?.definition;
	let definition = null;
	if (declared !== undefined && declared !== null) {
		if (
			typeof declared !== "object" ||
			Array.isArray(declared) ||
			typeof declared.identity !== "string" ||
			declared.identity.length === 0 ||
			!Number.isInteger(declared.revision) ||
			declared.revision < 1
		) {
			throw typedError(
				CODE_INVALID_ARG,
				`eval-result ${JSON.stringify(pin.identity)}@${pin.revision} carries a malformed definition pin (extensions.evalResult.definition must be {identity, revision} when present); refusing to invent or discard provenance`,
			);
		}
		const definitionRevision = showArtifact(targetRoot, declared.identity, {
			type: "eval",
			revision: declared.revision,
		});
		if (definitionRevision === null) {
			throw typedError(
				CODE_ARTIFACT_NOT_FOUND,
				`eval-result ${JSON.stringify(pin.identity)}@${pin.revision} cites missing eval definition ${JSON.stringify(declared.identity)}@${declared.revision}; refusing a dangling provenance pointer`,
			);
		}
		definition = { identity: declared.identity, revision: declared.revision };
	}
	const pointer = artifactGraphNodeId("eval-result", pin.identity, pin.revision);
	const pointers = [pointer];
	if (definition !== null) {
		pointers.push(artifactGraphNodeId("eval", definition.identity, definition.revision));
	}
	return {
		binding: {
			identity: pin.identity,
			revision: pin.revision,
			contentHash: revision.contentHash,
			overall,
			definition,
		},
		check: {
			name: EVAL_CHECK_NAME,
			status: overall,
			detail: `the bound eval-result ${pin.identity}@${pin.revision} records overall ${overall}${definition ? ` (definition ${definition.identity}@${definition.revision})` : " (no definition pin recorded)"}`,
			pointer,
		},
		pointers,
	};
}

// The closed check set, evaluated over the run's own records. Deterministic,
// model-independent; every `not-run` names its reason.
function evaluateChecks(targetRoot, run) {
	const checks = [];
	const add = (name, status, detail, pointer) =>
		checks.push({ name, status, detail, ...(pointer ? { pointer } : {}) });

	// policy: the trail carries a policy verdict and none is deny.
	const events = readRunEvents(targetRoot, run.id);
	const policyEvents = events.filter((event) => event.kind === "policy.evaluated");
	if (policyEvents.length === 0) {
		add("policy", "not-run", "no policy.evaluated event is on this run's trail yet");
	} else {
		const denied = policyEvents.find((event) => event.decision && event.decision.result === "deny");
		add(
			"policy",
			denied ? "fail" : "pass",
			denied
				? `a policy.evaluated event on the trail is a deny${denied.reason ? `: ${denied.reason}` : ""}`
				: `${policyEvents.length} policy.evaluated event(s) on the trail, none deny`,
		);
	}

	// execution: a prepared record's comparison must not be a violation; no
	// prepared record is an honest not-run (the run never executed).
	const executionRecord = readExecutionRecord(targetRoot, { runId: run.id });
	if (!executionRecord) {
		add("execution", "not-run", "no prepared execution record — the run never executed");
	} else {
		const verdict = executionRecord.comparison ? executionRecord.comparison.verdict : "unevaluated";
		add(
			"execution",
			verdict === "violation" ? "fail" : "pass",
			verdict === "violation"
				? "the declared/observed boundary comparison is a violation"
				: `execution comparison verdict is ${verdict}`,
			`execution-record:${safeId(run.id)}`,
		);
	}

	// tools: a frozen snapshot must still be discoverable; a pre-H1 run has
	// none — disclosed, never invented.
	if (!run.tools) {
		add("tools", "not-run", "no tool snapshot on the run (pre-H1 record or empty registry)");
	} else {
		const current = toolsSnapshot(targetRoot);
		add(
			"tools",
			current && current.snapshotHash === run.tools.snapshotHash ? "pass" : "fail",
			current && current.snapshotHash === run.tools.snapshotHash
				? `the tool registry still hashes to the frozen snapshot ${run.tools.snapshotHash}`
				: "the tool registry no longer hashes to the frozen snapshot (drift — replay names it)",
			`tools:${run.tools.snapshotHash}`,
		);
	}

	// context: the admission receipt is complete (the six checks all pass).
	if (!run.admission || !run.admission.checks) {
		add("context", "not-run", "no admission receipt on the run");
	} else {
		const complete = ADMISSION_CHECK_NAMES.every(
			(name) => run.admission.checks[name] && run.admission.checks[name].result === "pass",
		);
		add(
			"context",
			complete ? "pass" : "fail",
			complete
				? "the six-check admission receipt is complete"
				: "the admission receipt is incomplete",
		);
	}

	// evidence: the run's event chain verifies — the ledger fold re-walks the
	// chain (a corrupt chain throws through the reader, failing the whole
	// validation read closed before any receipt is written).
	const trailLength = readRunEvents(targetRoot, run.id).length;
	add(
		"evidence",
		trailLength > 0 ? "pass" : "not-run",
		// The detail is count-free on purpose: the receipt is content-
		// addressed, and a live trail grows with every new event — embedding
		// the count would make re-validating an unchanged run non-idempotent.
		trailLength > 0
			? "the event chain verified (the fold re-walked every run-scoped event)"
			: "the run has no events on the trail",
	);

	// attempts: every attempt is terminal — a running attempt dangles on a
	// settled run.
	const attempts = listAttempts(targetRoot, { runId: run.id });
	if (attempts.length === 0) {
		add("attempts", "not-run", "the run has no attempt records");
	} else {
		const dangling = attempts.filter((attempt) => attempt.state === "running");
		add(
			"attempts",
			dangling.length === 0 ? "pass" : "fail",
			dangling.length === 0
				? `all ${attempts.length} attempt record(s) are terminal`
				: `${dangling.length} attempt record(s) still running on a settled run`,
		);
	}
	return checks;
}

/**
 * Validate one run: the closed deterministic check set over the run's own
 * records, one receipt record, one `validation.completed` event. Re-validating
 * an unchanged run is idempotent per content (same checks → same receiptId →
 * the existing receipt is returned); a changed run yields a new receipt.
 * The receipt never touches the run's state machine.
 *
 * F077: an optional `evalResult` pin ({ identity, revision }) binds one
 * committed eval-result revision onto this validation — the check set grows
 * the `eval` leg (a projection of the result's own `overall`), the receipt
 * records the binding, and the event carries the eval-prefixed pointers.
 * Without the pin the receipt is byte-identical to F073.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} [opts.now]
 * @param {{identity: string, revision: number}} [opts.evalResult]
 */
function validateRun(targetRoot, { runId, now, evalResult } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to validate a run");
	}
	const { run } = getRun(targetRoot, { runId });
	// Resolve the binding BEFORE evaluating anything: a refused pin writes
	// nothing (no receipt, no event, no summary).
	const bound = evalResult === undefined ? null : resolveEvalResultBinding(targetRoot, evalResult);
	const at = now || new Date().toISOString();
	const checks = evaluateChecks(targetRoot, run);
	if (bound !== null) checks.push(bound.check);
	const failed = checks.filter((check) => check.status === "fail");
	const status = failed.length === 0 ? "accepted" : "rejected";
	// Content-addressed identity: same run content + same checks → same id →
	// the append below dedups (validating an unchanged run twice is
	// idempotent); a changed run produces a new receipt. A bound eval-result
	// is part of `checks` (its pointer names the revision), so binding is a
	// new receipt and re-binding the same result is idempotent.
	const identity = canonicalJson(JSON.stringify({ runId, runState: run.state, checks }));
	const crypto = require("node:crypto");
	const receiptId = `vr-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
	const receipt = {
		receiptId,
		runId,
		at,
		state: run.state,
		checks,
		result: { status },
		...(bound !== null ? { evalResult: bound.binding } : {}),
	};
	const problem = receiptProblem(receipt);
	if (problem) throw typedError(CODE_CORRUPT, `refusing to store a malformed receipt: ${problem}`);
	const file = path.join(validationDirForCreate(targetRoot, runId), `${safeId(receiptId)}.json`);
	let idempotent = false;
	if (fs.existsSync(file)) {
		idempotent = true;
	} else {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(receipt, null, "\t")}\n`, "utf8");
		emitHarnessEvent(targetRoot, {
			kind: "validation.completed",
			schemaVersion: 1,
			at,
			runId,
			actor: run.subject ? run.subject.agent : undefined,
			reason: `validation ${status}: ${checks.map((c) => `${c.name}=${c.status}`).join(", ")}`,
			// The receipt pointer stays first; a bound validation appends the
			// canonical `<type>/<identity>@<revision>` references (ADR-0021) —
			// the closed eval/ and eval-result/ prefixes `harness eval --run`
			// and `harness trace` already read (F074).
			pointers: [
				`validation-receipt:${safeId(runId)}#${receiptId}`,
				...(bound !== null ? bound.pointers : []),
			],
		});
		refreshValidationSummary(targetRoot, { runId, receipt });
	}
	return { ok: true, receipt, receiptFile: file, idempotent };
}

// The run record's additive `validation` summary (ADR-0012): the latest
// receipt's status + instant. Absent on runs never validated.
function refreshValidationSummary(targetRoot, { runId, receipt } = {}) {
	const { run } = getRun(targetRoot, { runId });
	run.validation = {
		status: receipt.result.status,
		receiptId: receipt.receiptId,
		receiptedAt: receipt.at,
	};
	const runFile = statePath(targetRoot, "harness", "runs", `${safeId(runId)}.json`);
	fs.writeFileSync(runFile, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
	return { ok: true, summary: run.validation };
}

/**
 * List one run's receipts (chronological). A missing directory is empty.
 */
function listReceipts(targetRoot, { runId } = {}) {
	if (!runId || typeof runId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--run <id> is required to list receipts");
	}
	const dir = validationDirForRead(targetRoot, runId);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const problem = receiptProblem(record);
				if (problem) {
					throw typedError(CODE_CORRUPT, `validation receipt fails its closed shape: ${problem}`);
				}
				return record;
			} catch (err) {
				if (err.amberCode) throw err;
				throw typedError(CODE_CORRUPT, `validation receipt is not valid JSON: ${name}`);
			}
		});
}

module.exports = {
	validateRun,
	listReceipts,
	CHECK_NAMES,
	EVAL_CHECK_NAME,
	ALLOWED_CHECK_NAMES,
	CHECK_STATUSES,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
	CODE_ARTIFACT_NOT_FOUND,
};
