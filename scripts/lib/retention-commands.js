"use strict";

// F055 public CLI seam for retention classification, deterministic
// expiry evaluation, the Legal Hold lifecycle, the Holder registry, and
// deletion candidates with bounded authorization. This adapter parses
// flags only; the core owns every verdict, candidates are governance
// writes, and no content is ever deleted here.

const { defineCommand } = require("./subcommand-dispatcher");
const {
	readFailure,
	invalidArg,
	targetValue,
	requiredString,
	positiveInt,
	clockValue,
	resultEnvelope,
	missingValueFlag: firstMissingFlagValue,
} = require("./command-helpers");
const { parseTraceFlags } = require("./canonical-artifact-commands");

const READ_FAILURE_CODE = "AMBER_E_RETENTION_CORRUPT";
const HOLD_READ_FAILURE_CODE = "AMBER_E_RETENTION_HOLD_CORRUPT";
const HOLDER_READ_FAILURE_CODE = "AMBER_E_RETENTION_HOLDER_CORRUPT";
const CANDIDATE_READ_FAILURE_CODE = "AMBER_E_RETENTION_CANDIDATE_CORRUPT";

const VALUE_FLAGS = [
	["record", "--record"],
	["retentionClass", "--retention-class"],
	["policy", "--policy"],
	["sensitivity", "--sensitivity"],
	["now", "--now"],
	["type", "--type"],
	["id", "--id"],
	["subject", "--subject"],
	["reason", "--reason"],
	["decisionIdentity", "--decision-identity"],
	["revision", "--revision"],
	["status", "--status"],
	["holderVersion", "--holder-version"],
	["adapter", "--adapter"],
	["adapterVersion", "--adapter-version"],
	["surface", "--surface"],
	["approval", "--approval"],
	["body", "--body"],
	["scope", "--scope"],
	["traceVal", "--trace"],
	["candidate", "--candidate"],
	["holder", "--holder"],
	["receiptHash", "--receipt-hash"],
	["target", "--target"],
];

function missingValueFlag(args) {
	return firstMissingFlagValue(args, VALUE_FLAGS);
}

// Grammar: <type>:<identity>@<revision> — one committed record pin.
function parseRecord(raw) {
	const match = /^([a-z][a-z0-9-]*):(.+)@([1-9]\d*)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--record must be <type>:<identity>@<revision> (e.g. --record spec:spec/login@2); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { type: match[1], identity: match[2], revision: Number(match[3]) } };
}

// Grammar: <identity>@<revision> — one committed policy revision pin.
function parsePolicyPin(raw) {
	const match = /^(.+)@([1-9]\d*)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--policy must be <identity>@<revision> (e.g. --policy policy/tenant-retention@1); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { identity: match[1], revision: Number(match[2]) } };
}

const dispatch = defineCommand({
	command: "retention",
	actions: [
		"classify",
		"evaluate",
		"classifications",
		"hold",
		"release",
		"holds",
		"holder",
		"holders",
		"candidate",
		"authorize",
		"candidates",
		"execute",
		"settle",
		"status",
		"proof",
	],
	handlers: {
		classify: (args) => {
			const { classify } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["record", "--record", "spec:spec/login@2"],
				["retentionClass", "--retention-class", "operational"],
				["policy", "--policy", "policy/tenant-retention@1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const record = parseRecord(args.record);
			if (record.error) return invalidArg(record.error);
			const policy = parsePolicyPin(args.policy);
			if (policy.error) return invalidArg(policy.error);
			return resultEnvelope(
				classify(target.value, {
					record: record.value,
					retentionClass: String(args.retentionClass),
					policy: policy.value,
					sensitivity: args.sensitivity === undefined ? "none" : String(args.sensitivity),
					minimized: args.minimized === true,
				}),
			);
		},
		evaluate: (args) => {
			const { evaluateRetention } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				evaluateRetention(target.value, clock.value ? { now: clock.value } : {}),
			);
		},
		classifications: (args) => {
			const { listClassifications } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const type = args.type === undefined ? null : String(args.type);
			if (type !== null && type.trim().length === 0)
				return invalidArg(
					`--type must be non-empty when provided; got ${JSON.stringify(args.type)}`,
				);
			const identity = args.id === undefined ? null : String(args.id);
			if (identity !== null && identity.trim().length === 0)
				return invalidArg(`--id must be non-empty when provided; got ${JSON.stringify(args.id)}`);
			try {
				return {
					text: JSON.stringify(listClassifications(target.value, { type, identity }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		hold: (args) => {
			const { hold } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "hold/litigation-42"],
				["reason", "--reason", "litigation hold"],
				["decisionIdentity", "--decision-identity", "decision/hold-42"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const hasRecord = args.record !== undefined;
			const hasSubject = args.subject !== undefined;
			if (hasRecord === hasSubject)
				return invalidArg(
					"a hold scope names exactly one of --record <type>:<identity>@<rev> or --subject <identity>",
				);
			let scope;
			if (hasRecord) {
				const record = parseRecord(args.record);
				if (record.error) return invalidArg(record.error);
				scope = { record: record.value };
			} else {
				const subject = String(args.subject);
				if (subject.trim().length === 0)
					return invalidArg(`--subject must be non-empty; got ${JSON.stringify(args.subject)}`);
				scope = { subject };
			}
			return resultEnvelope(
				hold(target.value, {
					id: String(args.id),
					scope,
					reason: String(args.reason),
					decision: { identity: String(args.decisionIdentity), revision: revision.value },
				}),
			);
		},
		release: (args) => {
			const { releaseHold } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "hold/litigation-42"],
				["decisionIdentity", "--decision-identity", "decision/release-42"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			return resultEnvelope(
				releaseHold(target.value, {
					id: String(args.id),
					decision: { identity: String(args.decisionIdentity), revision: revision.value },
				}),
			);
		},
		holds: (args) => {
			const { listHolds, HOLD_STATUSES } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const status = args.status === undefined ? null : String(args.status);
			if (status !== null && !HOLD_STATUSES.includes(status))
				return invalidArg(
					`--status must be one of ${HOLD_STATUSES.join(", ")}; got ${JSON.stringify(args.status)}`,
				);
			try {
				return { text: JSON.stringify(listHolds(target.value, { status }), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, HOLD_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		holder: (args) => {
			const { registerHolder } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "holder/canonical-body"],
				["holderVersion", "--holder-version", "1"],
				["surface", "--surface", "canonical-body"],
				["adapter", "--adapter", "adapter/store"],
				["adapterVersion", "--adapter-version", "1.0.0"],
				["decisionIdentity", "--decision-identity", "decision/holder-1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			return resultEnvelope(
				registerHolder(target.value, {
					id: String(args.id),
					version: String(args.holderVersion),
					surface: String(args.surface),
					adapter: { id: String(args.adapter), version: String(args.adapterVersion) },
					decision: { identity: String(args.decisionIdentity), revision: revision.value },
				}),
			);
		},
		holders: (args) => {
			const { listHolders } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			try {
				return { text: JSON.stringify(listHolders(target.value), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, HOLDER_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		candidate: (args) => {
			const { prepareDeletionCandidate } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "deletion/2026-08");
			if (id.error) return invalidArg(id.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				prepareDeletionCandidate(
					target.value,
					{ id: id.value },
					clock.value ? { now: clock.value } : {},
				),
			);
		},
		authorize: (args) => {
			const { authorizeDeletion } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "deletion/2026-08"],
				["approval", "--approval", "approval/deletion-42"],
				["decisionIdentity", "--decision-identity", "decision/deletion-42"],
				["body", "--body", '"# Authorize deletion"'],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			return resultEnvelope(
				authorizeDeletion(target.value, {
					id: String(args.id),
					approval: String(args.approval),
					decisionIdentity: String(args.decisionIdentity),
					body: String(args.body),
					traces: traces.value,
					scope: args.scope === undefined ? null : String(args.scope),
				}),
			);
		},
		candidates: (args) => {
			const { listDeletionCandidates, CANDIDATE_STATUSES } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const status = args.status === undefined ? null : String(args.status);
			if (status !== null && !CANDIDATE_STATUSES.includes(status))
				return invalidArg(
					`--status must be one of ${CANDIDATE_STATUSES.join(", ")}; got ${JSON.stringify(args.status)}`,
				);
			try {
				return {
					text: JSON.stringify(listDeletionCandidates(target.value, { status }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, CANDIDATE_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		execute: (args) => {
			const { executeDeletion } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "deletion-tx/2026-08"],
				["candidate", "--candidate", "deletion/2026-08"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			return resultEnvelope(
				executeDeletion(target.value, {
					id: String(args.id),
					candidateId: String(args.candidate),
				}),
			);
		},
		settle: (args) => {
			const { settleHolder } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "deletion-tx/2026-08"],
				["holder", "--holder", "holder/canonical-body"],
				["holderVersion", "--holder-version", "1"],
				["status", "--status", "settled"],
				["receiptHash", "--receipt-hash", "sha256:<64-hex>"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			return resultEnvelope(
				settleHolder(target.value, {
					transactionId: String(args.id),
					holder: { id: String(args.holder), version: String(args.holderVersion) },
					status: String(args.status),
					receiptHash: String(args.receiptHash),
				}),
			);
		},
		status: (args) => {
			const { deletionStatus } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "deletion-tx/2026-08");
			if (id.error) return invalidArg(id.error);
			return resultEnvelope(deletionStatus(target.value, id.value));
		},
		proof: (args) => {
			const { deletionProof } = require("./core/retention-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "deletion-tx/2026-08");
			if (id.error) return invalidArg(id.error);
			return resultEnvelope(deletionProof(target.value, id.value));
		},
	},
});

function retentionDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { retentionDispatch };
