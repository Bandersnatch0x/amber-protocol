"use strict";

// F050 ticket 7 (#232) — Canonical Eval admission.
//
// `amber eval run` stays report-only (F058); this module is the explicit
// admission seam that turns the deterministic instruction-surface suite into
// canonical artifacts and then into ordinary Evidence. The Eval artifacts do
// not carry Decision fields, do not consume Approval, and do not grant runtime
// authority. They only provide versioned, replayable provenance that a Gate can
// require through the existing Evidence receipt path.

const path = require("node:path");

const { admitArtifact, showArtifact } = require("./canonical-artifacts");
const { recordEvidence } = require("./evidence-receipts");
const { resolveActivePrincipal } = require("./principal-registry");
const { sha256, canonicalJson } = require("./context-hash");
const {
	SUITE_ID,
	SUITE_VERSION,
	ASSURANCE,
	runInstructionSurfaceEvals,
	listInstructionSurfaceEvals,
} = require("./instruction-surface-evals");

const EVAL_DEFINITION_SCHEMA_VERSION = 1;
const EVAL_RESULT_SCHEMA_VERSION = 1;
const DEFAULT_DEFINITION_IDENTITY = "eval/instruction-surface";
const DEFAULT_EVIDENCE_SUBJECT = "eval.instruction-surface";

function fail(code, errors) {
	return { ok: false, code, definition: null, outcome: null, evidence: null, suite: null, errors };
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function resultHashOf(suite) {
	return sha256(canonicalJson(JSON.stringify(suite)));
}

function hashSuffix(hash) {
	return hash.replace(/^sha256:/, "").slice(0, 16);
}

function definitionEnvelope() {
	return {
		eval: {
			contractVersion: EVAL_DEFINITION_SCHEMA_VERSION,
			suiteId: SUITE_ID,
			suiteVersion: SUITE_VERSION,
			assurance: ASSURANCE,
			modelIndependent: true,
			evals: listInstructionSurfaceEvals(),
		},
	};
}

function definitionBody() {
	return [
		"# Eval Definition: instruction-surface",
		"",
		"Deterministic, model-independent assessment suite for Amber instruction surfaces.",
		"Results supply replayable Evidence and never Approval or execution authority.",
	].join("\n");
}

function outcomeBody(suite) {
	return [
		"# Eval Result: instruction-surface",
		"",
		`Suite: ${suite.suiteId}`,
		`Version: ${suite.version}`,
		`Overall: ${suite.overall}`,
		`Eval count: ${suite.evalCount}`,
		`Failed count: ${suite.failedCount}`,
	].join("\n");
}

function admitActiveDefinition(cwd, identity) {
	let current;
	try {
		current = showArtifact(cwd, identity, { type: "eval" });
	} catch (err) {
		return {
			ok: false,
			code: err.amberCode || "AMBER_E_ARTIFACT_NOT_FOUND",
			errors: [err.message || String(err)],
		};
	}
	if (current !== null) {
		if (current.lifecycle !== "active") {
			return {
				ok: false,
				code: "AMBER_E_INVALID_ARG",
				errors: [
					`eval definition "${identity}" is ${current.lifecycle}, but canonical Eval admission requires an active definition`,
				],
			};
		}
		return { ok: true, receipt: current, errors: [] };
	}

	const body = definitionBody();
	const extensions = definitionEnvelope();
	const draft = admitArtifact(cwd, {
		type: "eval",
		identity,
		body,
		extensions,
	});
	if (!draft.ok) return { ok: false, code: draft.code, errors: draft.errors };
	const active = admitArtifact(cwd, {
		type: "eval",
		identity,
		body,
		extensions,
		expectedHead: draft.receipt.revision,
		transition: "activate",
	});
	if (!active.ok) return { ok: false, code: active.code, errors: active.errors };
	return { ok: true, receipt: active.receipt, errors: [] };
}

function admitEvalOutcome(cwd, { identity, suite, definition, targetRoot, resultHash }) {
	const body = outcomeBody(suite);
	const extensions = {
		evalResult: {
			resultVersion: EVAL_RESULT_SCHEMA_VERSION,
			suiteId: suite.suiteId,
			suiteVersion: suite.version,
			assurance: ASSURANCE,
			modelIndependent: suite.modelIndependent === true,
			target: path.resolve(targetRoot),
			resultHash,
			definition: {
				identity: definition.identity,
				revision: definition.revision,
				contentHash: definition.contentHash,
			},
			result: suite,
		},
	};
	const admitted = admitArtifact(cwd, {
		type: "eval-result",
		identity,
		body,
		extensions,
	});
	if (!admitted.ok) return { ok: false, code: admitted.code, errors: admitted.errors };
	return { ok: true, receipt: admitted.receipt, errors: [] };
}

function admitInstructionSurfaceEval(cwd, input = {}, opts = {}) {
	const producer = input.producer;
	if (!isNonEmptyString(producer)) {
		return fail("AMBER_E_INVALID_ARG", [
			`producer is required: canonical Eval admission records replayable Evidence through a registered producer Principal; got ${JSON.stringify(producer)}`,
		]);
	}
	const suiteName = input.suite ?? SUITE_ID;
	if (suiteName !== SUITE_ID) {
		return fail("AMBER_E_INVALID_ARG", [
			`unknown eval suite ${JSON.stringify(suiteName)} (expected "${SUITE_ID}")`,
		]);
	}
	const definitionIdentity = input.definitionIdentity || DEFAULT_DEFINITION_IDENTITY;
	const evidenceSubject = input.subject || DEFAULT_EVIDENCE_SUBJECT;
	if (!isNonEmptyString(definitionIdentity)) {
		return fail("AMBER_E_INVALID_ARG", [
			`definitionIdentity must be a non-empty artifact identity; got ${JSON.stringify(definitionIdentity)}`,
		]);
	}
	if (!isNonEmptyString(evidenceSubject)) {
		return fail("AMBER_E_INVALID_ARG", [
			`subject must be a non-empty Evidence subject; got ${JSON.stringify(evidenceSubject)}`,
		]);
	}
	try {
		const resolvedProducer = resolveActivePrincipal(cwd, producer, { now: opts.now ?? new Date() });
		if (!resolvedProducer.ok) return fail(resolvedProducer.code, [resolvedProducer.message]);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_PRINCIPAL_REGISTRY_CORRUPT", [
			err.message || String(err),
		]);
	}

	const suite = runInstructionSurfaceEvals(cwd, opts);
	const resultHash = resultHashOf(suite);
	const definitionResult = admitActiveDefinition(cwd, definitionIdentity);
	if (!definitionResult.ok) return fail(definitionResult.code, definitionResult.errors);

	const outcomeIdentity =
		input.outcomeIdentity || `eval-result/instruction-surface/${hashSuffix(resultHash)}`;
	if (!isNonEmptyString(outcomeIdentity)) {
		return fail("AMBER_E_INVALID_ARG", [
			`outcomeIdentity must be a non-empty artifact identity; got ${JSON.stringify(outcomeIdentity)}`,
		]);
	}
	const outcomeResult = admitEvalOutcome(cwd, {
		identity: outcomeIdentity,
		suite,
		definition: definitionResult.receipt,
		targetRoot: cwd,
		resultHash,
	});
	if (!outcomeResult.ok) return fail(outcomeResult.code, outcomeResult.errors);

	const evidenceId =
		input.evidenceId || `evidence/eval-instruction-surface-${hashSuffix(resultHash)}`;
	if (!isNonEmptyString(evidenceId)) {
		return fail("AMBER_E_INVALID_ARG", [
			`evidenceId must be a non-empty Evidence receipt id; got ${JSON.stringify(evidenceId)}`,
		]);
	}
	const evidenceResult = recordEvidence(
		cwd,
		{
			id: evidenceId,
			producer,
			assurance: ASSURANCE,
			replayOf: `eval-result:${outcomeResult.receipt.identity}@${outcomeResult.receipt.revision}`,
			subject: evidenceSubject,
			status: suite.overall,
			inputs: [`amber eval run --suite ${SUITE_ID}`],
			tools: ["amber eval"],
			environment: {
				target: path.resolve(cwd),
				suiteId: SUITE_ID,
				suiteVersion: String(SUITE_VERSION),
			},
			outputs: [
				JSON.stringify({
					suiteId: suite.suiteId,
					version: suite.version,
					overall: suite.overall,
					evalCount: suite.evalCount,
					failedCount: suite.failedCount,
					resultHash,
				}),
			],
		},
		{ now: opts.now },
	);
	if (!evidenceResult.ok) return fail(evidenceResult.code, evidenceResult.errors, suite);

	return {
		ok: true,
		code: null,
		definition: definitionResult.receipt,
		outcome: outcomeResult.receipt,
		evidence: evidenceResult.receipt,
		suite,
		errors: [],
	};
}

module.exports = {
	EVAL_DEFINITION_SCHEMA_VERSION,
	EVAL_RESULT_SCHEMA_VERSION,
	DEFAULT_DEFINITION_IDENTITY,
	DEFAULT_EVIDENCE_SUBJECT,
	resultHashOf,
	admitInstructionSurfaceEval,
};
