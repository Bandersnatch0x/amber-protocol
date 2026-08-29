"use strict";

// F056 public CLI seam for the External Effect registry: contract
// registration, request proposals, and drift-bound authorization. This
// adapter parses flags only; the core owns every verdict, and nothing
// here ever executes an external operation — every write is governance.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { parseTraceFlags } = require("./canonical-artifact-commands");

const READ_FAILURE_CODE = "AMBER_E_EXTERNAL_CORRUPT";
const PROPOSAL_READ_FAILURE_CODE = "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["effectVersion", "--effect-version"],
		["owner", "--owner"],
		["system", "--system"],
		["operation", "--operation"],
		["externalTarget", "--external-target"],
		["scope", "--scope"],
		["idempotency", "--idempotency"],
		["credential", "--credential"],
		["receiptFieldVal", "--receipt-field"],
		["compensationEffect", "--compensation-effect"],
		["timeoutMs", "--timeout-ms"],
		["adapter", "--adapter"],
		["adapterVersion", "--adapter-version"],
		["decisionIdentity", "--decision-identity"],
		["revision", "--revision"],
		["effectVal", "--effect"],
		["payloadHash", "--payload-hash"],
		["approval", "--approval"],
		["body", "--body"],
		["traceVal", "--trace"],
		["status", "--status"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

function targetValue(args) {
	if (args.target === undefined || args.target === null) return { value: resolveTarget(args) };
	const target = String(args.target);
	if (target.trim().length === 0)
		return { error: `--target must be non-empty; got ${JSON.stringify(args.target)}` };
	return { value: target };
}

function requiredString(args, key, flag, example) {
	const value = args[key] === undefined ? null : String(args[key]);
	if (value === null || value.trim().length === 0) {
		return {
			error: `${flag} is required and must be non-empty (e.g. ${flag} ${example}); got ${JSON.stringify(args[key])}`,
		};
	}
	return { value };
}

function positiveInt(args, key, flag) {
	const value = Number(args[key]);
	if (!Number.isInteger(value) || value < 1)
		return { error: `${flag} must be a positive integer; got ${JSON.stringify(args[key])}` };
	return { value };
}

function resultEnvelope(result) {
	return {
		text: result.ok ? JSON.stringify(result.record, null, 2) : "",
		errors: result.errors,
		warnings: [],
		exitCode: result.ok ? 0 : 1,
		...(result.code ? { code: result.code } : {}),
	};
}

// Grammar: <id>@<version> — one registered effect contract pin.
function parseEffectPin(raw) {
	const match = /^(.+)@([^@]+)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--effect must be <id>@<version> (e.g. --effect effect/ticket-comment@1); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { id: match[1], version: match[2] } };
}

const dispatch = defineCommand({
	command: "external",
	actions: ["register", "effects", "propose", "authorize", "proposals"],
	handlers: {
		register: (args) => {
			const { registerExternalEffect } = require("./core/external-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "effect/ticket-comment"],
				["effectVersion", "--effect-version", "1"],
				["owner", "--owner", "platform-team"],
				["system", "--system", "ticketing"],
				["operation", "--operation", "comment.create"],
				["externalTarget", "--external-target", "tracker/amber-protocol"],
				["scope", "--scope", "issues/288"],
				["idempotency", "--idempotency", "idempotent"],
				["credential", "--credential", "scoped"],
				["adapter", "--adapter", "adapter/tracker"],
				["adapterVersion", "--adapter-version", "1"],
				["decisionIdentity", "--decision-identity", "decision/effect-1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const receiptFields = (args.receiptFields ?? []).map((field) => String(field));
			if (receiptFields.length === 0)
				return invalidArg(
					"--receipt-field is required at least once: the contract declares which receipt fields the external system must return (e.g. --receipt-field commentId)",
				);
			const irreversible = args.irreversible === true;
			const compensationEffect =
				args.compensationEffect === undefined ? null : String(args.compensationEffect);
			if (irreversible === (compensationEffect !== null))
				return invalidArg(
					"exactly one of --compensation-effect <effect-id> or --irreversible is required: every contract declares how the effect is undone, or that it cannot be",
				);
			const timeoutMs = positiveInt(args, "timeoutMs", "--timeout-ms");
			if (timeoutMs.error) return invalidArg(timeoutMs.error);
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const result = registerExternalEffect(target.value, {
				id: String(args.id),
				version: String(args.effectVersion),
				owner: String(args.owner),
				system: String(args.system),
				operation: String(args.operation),
				target: String(args.externalTarget),
				scope: String(args.scope),
				idempotency: String(args.idempotency),
				credentials: String(args.credential),
				receiptFields,
				compensation: irreversible
					? { kind: "irreversible" }
					: { kind: "effect", effect: compensationEffect },
				timeoutMs: timeoutMs.value,
				adapter: { id: String(args.adapter), version: String(args.adapterVersion) },
				decision: { identity: String(args.decisionIdentity), revision: revision.value },
			});
			return resultEnvelope(result);
		},
		effects: (args) => {
			const { listExternalEffects, EXTERNAL_SYSTEMS } = require("./core/external-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const system = args.system === undefined ? null : String(args.system);
			if (system !== null && !EXTERNAL_SYSTEMS.includes(system))
				return invalidArg(
					`--system must be one of ${EXTERNAL_SYSTEMS.join(", ")}; got ${JSON.stringify(args.system)}`,
				);
			try {
				return {
					text: JSON.stringify(listExternalEffects(target.value, { system }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		propose: (args) => {
			const { proposeExternalEffect } = require("./core/external-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "request/ticket-comment-288"],
				["effectVal", "--effect", "effect/ticket-comment@1"],
				["payloadHash", "--payload-hash", "sha256:<64-hex>"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const effect = parseEffectPin(args.effectVal);
			if (effect.error) return invalidArg(effect.error);
			return resultEnvelope(
				proposeExternalEffect(target.value, {
					id: String(args.id),
					effect: effect.value,
					payloadHash: String(args.payloadHash),
				}),
			);
		},
		authorize: (args) => {
			const { authorizeExternalEffect } = require("./core/external-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "request/ticket-comment-288"],
				["approval", "--approval", "approval/external-42"],
				["decisionIdentity", "--decision-identity", "decision/external-42"],
				["body", "--body", '"# Authorize external effect"'],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			return resultEnvelope(
				authorizeExternalEffect(target.value, {
					id: String(args.id),
					approval: String(args.approval),
					decisionIdentity: String(args.decisionIdentity),
					body: String(args.body),
					traces: traces.value,
					scope: args.scope === undefined ? null : String(args.scope),
				}),
			);
		},
		proposals: (args) => {
			const { listExternalProposals, PROPOSAL_STATUSES } = require("./core/external-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const status = args.status === undefined ? null : String(args.status);
			if (status !== null && !PROPOSAL_STATUSES.includes(status))
				return invalidArg(
					`--status must be one of ${PROPOSAL_STATUSES.join(", ")}; got ${JSON.stringify(args.status)}`,
				);
			try {
				return {
					text: JSON.stringify(listExternalProposals(target.value, { status }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, PROPOSAL_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function externalDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { externalDispatch };
