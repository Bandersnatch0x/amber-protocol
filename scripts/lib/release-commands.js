"use strict";

// F053 public CLI seam for release candidate preparation. This adapter
// parses flags only; the core owns every candidate verdict, never deploys,
// and touches no git state — preparation is a pure governance write.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { parseTraceFlags } = require("./canonical-artifact-commands");

const READ_FAILURE_CODE = "AMBER_E_RELEASE_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["commit", "--commit"],
		["changeArtifactVal", "--change-artifact"],
		["evidenceItemVal", "--evidence-item"],
		["reviewLogic", "--review-logic"],
		["reviewSecurity", "--review-security"],
		["reviewSpec", "--review-spec"],
		["environment", "--environment"],
		["releasePolicy", "--release-policy"],
		["runner", "--runner"],
		["runnerVersion", "--runner-version"],
		["capability", "--capability"],
		["capabilityVersion", "--capability-version"],
		["credential", "--credential"],
		["rollback", "--rollback"],
		["approval", "--approval"],
		["decisionIdentity", "--decision-identity"],
		["body", "--body"],
		["traceVal", "--trace"],
		["scope", "--scope"],
		["rehearsal", "--rehearsal"],
		["branchProtection", "--branch-protection"],
		["codeOwner", "--code-owner"],
		["releaseManager", "--release-manager"],
		["releaseGateIndex", "--release-gate-index"],
		["environmentGateIndex", "--environment-gate-index"],
		["requestHash", "--request-hash"],
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

// Grammar: <type>:<identity>@<revision> — one committed artifact pin.
function parseArtifactPin(raw) {
	const match = /^([a-z][a-z0-9-]*):(.+)@(\d+)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--change-artifact must be <type>:<identity>@<revision> (e.g. --change-artifact spec:spec/login@2); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { type: match[1], identity: match[2], revision: Number(match[3]) } };
}

// Grammar: <identity>@<revision> — one committed policy artifact pin.
function parsePolicyPin(raw) {
	const match = /^(.+)@(\d+)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--release-policy must be <identity>@<revision> (e.g. --release-policy policy/release@1); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { identity: match[1], revision: Number(match[2]) } };
}

const dispatch = defineCommand({
	command: "release",
	actions: ["prepare", "authorize", "deploy", "rollback", "transactions", "show", "list"],
	handlers: {
		prepare: (args) => {
			const { prepareReleaseCandidate } = require("./core/release-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "release/2026-08-web"],
				["commit", "--commit", "<40-hex sha>"],
				["reviewLogic", "--review-logic", "evidence/review-logic"],
				["reviewSecurity", "--review-security", "evidence/review-security"],
				["reviewSpec", "--review-spec", "evidence/review-spec"],
				["environment", "--environment", "staging"],
				["releasePolicy", "--release-policy", "policy/release@1"],
				["runner", "--runner", "runner/ci"],
				["runnerVersion", "--runner-version", "1.0.0"],
				["capability", "--capability", "deploy.staging-web"],
				["capabilityVersion", "--capability-version", "1"],
				["credential", "--credential", "scoped"],
				["rollback", "--rollback", "evidence/rollback-plan"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			if (!Array.isArray(args.changeArtifacts) || args.changeArtifacts.length === 0)
				return invalidArg(
					`--change-artifact is required at least once (e.g. --change-artifact spec:spec/login@2)`,
				);
			const artifacts = [];
			for (const raw of args.changeArtifacts) {
				const pin = parseArtifactPin(raw);
				if (pin.error) return invalidArg(pin.error);
				artifacts.push(pin.value);
			}
			if (!Array.isArray(args.evidenceItems) || args.evidenceItems.length === 0)
				return invalidArg(
					`--evidence-item is required at least once (e.g. --evidence-item evidence/test-run)`,
				);
			const policy = parsePolicyPin(args.releasePolicy);
			if (policy.error) return invalidArg(policy.error);
			const result = prepareReleaseCandidate(target.value, {
				releaseId: String(args.id),
				change: { commit: String(args.commit), artifacts },
				evidence: args.evidenceItems.map((entry) => String(entry)),
				review: {
					logic: String(args.reviewLogic),
					security: String(args.reviewSecurity),
					specCompliance: String(args.reviewSpec),
				},
				environment: String(args.environment),
				policy: policy.value,
				capability: {
					runnerId: String(args.runner),
					runnerVersion: String(args.runnerVersion),
					name: String(args.capability),
					capabilityVersion: String(args.capabilityVersion),
				},
				credentialsClass: String(args.credential),
				rollbackPlan: String(args.rollback),
			});
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		authorize: (args) => {
			const { authorizeRelease } = require("./core/release-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "release/web-42");
			if (id.error) return invalidArg(id.error);
			const input = { releaseId: id.value };
			if (args.approval !== undefined) input.approval = String(args.approval);
			if (args.decisionIdentity !== undefined)
				input.decisionIdentity = String(args.decisionIdentity);
			if (args.body !== undefined) input.body = String(args.body);
			if (args.traceArgs !== undefined) {
				const traces = parseTraceFlags(args.traceArgs);
				if (traces.error) return invalidArg(traces.error);
				input.traces = traces.value;
			}
			if (args.scope !== undefined) input.scope = String(args.scope);
			if (args.rehearsal !== undefined) input.rehearsal = String(args.rehearsal);
			if (args.branchProtection !== undefined)
				input.branchProtection = String(args.branchProtection);
			for (const [key, flag] of [
				["codeOwner", "--code-owner"],
				["releaseManager", "--release-manager"],
			]) {
				if (args[key] === undefined) continue;
				const pin = parsePolicyPin(args[key]);
				if (pin.error)
					return invalidArg(
						`${flag} must be <identity>@<revision> (e.g. ${flag} decision/code-owner@1); got ${JSON.stringify(args[key])}`,
					);
				input[key] = pin.value;
			}
			for (const [key, flag] of [
				["releaseGateIndex", "--release-gate-index"],
				["environmentGateIndex", "--environment-gate-index"],
			]) {
				if (args[key] === undefined) continue;
				const index = Number(args[key]);
				if (!Number.isInteger(index) || index < 0 || String(args[key]).trim().length === 0)
					return invalidArg(
						`${flag} must be a non-negative integer; got ${JSON.stringify(args[key])}`,
					);
				input[key] = index;
			}
			const result = authorizeRelease(target.value, input);
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		deploy: (args) => transactionHandler(args, "deployRelease"),
		rollback: (args) => transactionHandler(args, "rollbackRelease"),
		transactions: (args) => {
			const { listReleaseTransactions } = require("./core/release-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const releaseId = args.id === undefined ? null : String(args.id);
			if (releaseId !== null && releaseId.trim().length === 0) {
				return invalidArg(`--id must be non-empty when provided; got ${JSON.stringify(args.id)}`);
			}
			try {
				return {
					text: JSON.stringify(listReleaseTransactions(target.value, { releaseId }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, "AMBER_E_RELEASE_TX_CORRUPT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		show: (args) => {
			const { showReleaseCandidate } = require("./core/release-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "release/2026-08-web");
			if (id.error) return invalidArg(id.error);
			try {
				const candidate = showReleaseCandidate(target.value, id.value);
				if (candidate === null) {
					return {
						text: "",
						errors: [`release candidate ${JSON.stringify(id.value)} is not prepared`],
						warnings: [],
						exitCode: 1,
						code: "AMBER_E_RELEASE_NOT_FOUND",
					};
				}
				return { text: JSON.stringify(candidate, null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		list: (args) => {
			const { listReleaseCandidates } = require("./core/release-registry");
			const { ENVIRONMENTS } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const environment = args.environment === undefined ? null : String(args.environment);
			if (environment !== null && !ENVIRONMENTS.includes(environment)) {
				return invalidArg(
					`--environment must be one of ${ENVIRONMENTS.join(", ")}; got ${JSON.stringify(args.environment)}`,
				);
			}
			try {
				return {
					text: JSON.stringify(listReleaseCandidates(target.value, { environment }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

// deploy and rollback share one flag contract; the core owns which
// lifecycle rules apply per operation.
function transactionHandler(args, verb) {
	const core = require("./core/release-registry");
	const truncated = missingValueFlag(args);
	if (truncated)
		return invalidArg(`${truncated} requires a value; it was the last token on the command line`);
	const target = targetValue(args);
	if (target.error) return invalidArg(target.error);
	for (const [key, flag, example] of [
		["id", "--id", "release/web-42"],
		["requestHash", "--request-hash", "sha256:<64-hex>"],
	]) {
		const required = requiredString(args, key, flag, example);
		if (required.error) return invalidArg(required.error);
	}
	const result = core[verb](target.value, {
		releaseId: String(args.id),
		requestHash: String(args.requestHash),
	});
	return {
		text: result.ok ? JSON.stringify(result.record, null, 2) : "",
		errors: result.errors,
		warnings: [],
		exitCode: result.ok ? 0 : 1,
		...(result.code ? { code: result.code } : {}),
	};
}

function releaseDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { releaseDispatch };
