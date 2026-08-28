"use strict";

// F052 public CLI seam for controlled Runner & capability registration and
// governed execution requests. This adapter parses flags only; the core
// owns every registry/request verdict and never spawns anything — a
// registered Runner is an external executor identity, not an execution
// path (ADR-0022).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { parseTraceFlags } = require("./canonical-artifact-commands");

const READ_FAILURE_CODE = "AMBER_E_RUNNER_REGISTRY_CORRUPT";
const REQUEST_READ_FAILURE_CODE = "AMBER_E_RUNNER_REQUEST_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["runnerVersion", "--runner-version"],
		["integrity", "--integrity"],
		["runnerOwner", "--runner-owner"],
		["capability", "--capability"],
		["capabilityVersion", "--capability-version"],
		["effectVal", "--effect"],
		["pathPrefixVal", "--path-prefix"],
		["timeoutMs", "--timeout-ms"],
		["credential", "--credential"],
		["rollback", "--rollback"],
		["decisionIdentity", "--decision-identity"],
		["revision", "--revision"],
		["repository", "--repository"],
		["path", "--path"],
		["scope", "--scope"],
		["environment", "--environment"],
		["inputHashVal", "--input-hash"],
		["requestHash", "--request-hash"],
		["credentialHandle", "--credential-handle"],
		["credentialPurpose", "--credential-purpose"],
		["credentialScope", "--credential-scope"],
		["credentialExpires", "--credential-expires"],
		["rehearsal", "--rehearsal"],
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

function decisionValue(args) {
	const identity = requiredString(
		args,
		"decisionIdentity",
		"--decision-identity",
		"decision/runner-ci",
	);
	if (identity.error) return identity;
	const revision = positiveInt(args, "revision", "--revision");
	if (revision.error) return revision;
	return { value: { identity: identity.value, revision: revision.value } };
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

const dispatch = defineCommand({
	command: "runner",
	actions: ["register", "capability", "request", "authorize", "requests", "show", "list"],
	handlers: {
		register: (args) => {
			const { registerRunner } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "runner/ci"],
				["runnerVersion", "--runner-version", "1.0.0"],
				["integrity", "--integrity", "sha256:<64-hex>"],
				["runnerOwner", "--runner-owner", "platform-team"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const decision = decisionValue(args);
			if (decision.error) return invalidArg(decision.error);
			return resultEnvelope(
				registerRunner(target.value, {
					id: String(args.id),
					version: String(args.runnerVersion),
					integrityDigest: String(args.integrity),
					owner: String(args.runnerOwner),
					decision: decision.value,
				}),
			);
		},
		capability: (args) => {
			const { registerRunnerCapability } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "runner/ci"],
				["runnerVersion", "--runner-version", "1.0.0"],
				["capability", "--capability", "deploy.staging-web"],
				["capabilityVersion", "--capability-version", "1"],
				["credential", "--credential", "scoped"],
				["rollback", "--rollback", "runbook/staging-rollback"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			if (!Array.isArray(args.effects) || args.effects.length === 0)
				return invalidArg(`--effect is required at least once (e.g. --effect deploy)`);
			const timeout = positiveInt(args, "timeoutMs", "--timeout-ms");
			if (timeout.error) return invalidArg(timeout.error);
			const decision = decisionValue(args);
			if (decision.error) return invalidArg(decision.error);
			return resultEnvelope(
				registerRunnerCapability(target.value, {
					runnerId: String(args.id),
					runnerVersion: String(args.runnerVersion),
					name: String(args.capability),
					capabilityVersion: String(args.capabilityVersion),
					effects: args.effects.map((effect) => String(effect)),
					pathPrefixes:
						Array.isArray(args.pathPrefixes) && args.pathPrefixes.length > 0
							? args.pathPrefixes.map((prefix) => String(prefix))
							: null,
					timeoutMsMax: timeout.value,
					credentialRequirement: String(args.credential),
					rollback: String(args.rollback),
					decision: decision.value,
				}),
			);
		},
		request: (args) => {
			const { submitRunnerRequest } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "runner/ci"],
				["runnerVersion", "--runner-version", "1.0.0"],
				["capability", "--capability", "deploy.staging-web"],
				["capabilityVersion", "--capability-version", "1"],
				["repository", "--repository", "repo/main"],
				["environment", "--environment", "staging"],
				["credential", "--credential", "scoped"],
				["rollback", "--rollback", "runbook/staging-rollback"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			if (!Array.isArray(args.paths) || args.paths.length === 0)
				return invalidArg(`--path is required at least once (e.g. --path deploy/staging/web)`);
			if (!Array.isArray(args.effects) || args.effects.length === 0)
				return invalidArg(`--effect is required at least once (e.g. --effect deploy)`);
			const timeout = positiveInt(args, "timeoutMs", "--timeout-ms");
			if (timeout.error) return invalidArg(timeout.error);
			const credentialFlags = [
				["credentialHandle", "--credential-handle", "cred-7f3a"],
				["credentialPurpose", "--credential-purpose", "staging-deploy"],
				["credentialScope", "--credential-scope", "deploy/staging"],
				["credentialExpires", "--credential-expires", "2027-01-01T00:00:00.000Z"],
			];
			let credential = null;
			if (credentialFlags.some(([key]) => args[key] !== undefined)) {
				const values = {};
				for (const [key, flag, example] of credentialFlags) {
					const required = requiredString(args, key, flag, example);
					if (required.error) return invalidArg(required.error);
					values[key] = required.value;
				}
				credential = {
					handle: values.credentialHandle,
					purpose: values.credentialPurpose,
					scope: values.credentialScope,
					expiresAt: values.credentialExpires,
				};
			}
			return resultEnvelope(
				submitRunnerRequest(target.value, {
					capability: {
						runnerId: String(args.id),
						runnerVersion: String(args.runnerVersion),
						name: String(args.capability),
						capabilityVersion: String(args.capabilityVersion),
					},
					target: {
						repository: String(args.repository),
						paths: args.paths.map((entry) => String(entry)),
					},
					scope: args.scope === undefined ? null : String(args.scope),
					environment: String(args.environment),
					inputHashes: Array.isArray(args.inputHashes)
						? args.inputHashes.map((entry) => String(entry))
						: [],
					timeoutMs: timeout.value,
					effects: args.effects.map((effect) => String(effect)),
					credentialRequirement: String(args.credential),
					credential,
					rehearsal: args.rehearsal === undefined ? null : String(args.rehearsal),
					rollback: String(args.rollback),
				}),
			);
		},
		authorize: (args) => {
			const { authorizeRunnerRequest } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["requestHash", "--request-hash", "sha256:<64-hex>"],
				["approval", "--approval", "approval/deploy-42"],
				["decisionIdentity", "--decision-identity", "decision/deploy-42"],
				["body", "--body", '"# Decision: authorize deploy"'],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const traces = parseTraceFlags(args.traceArgs);
			if (traces.error) return invalidArg(traces.error);
			return resultEnvelope(
				authorizeRunnerRequest(target.value, {
					requestHash: String(args.requestHash),
					approval: String(args.approval),
					decisionIdentity: String(args.decisionIdentity),
					body: String(args.body),
					traces: traces.value,
					scope: args.scope === undefined ? null : String(args.scope),
				}),
			);
		},
		requests: (args) => {
			const {
				listRunnerRequests,
				ENVIRONMENTS,
				REQUEST_STATUSES,
			} = require("./core/runner-registry");
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
			const status = args.status === undefined ? null : String(args.status);
			if (status !== null && !REQUEST_STATUSES.includes(status)) {
				return invalidArg(
					`--status must be one of ${REQUEST_STATUSES.join(", ")}; got ${JSON.stringify(args.status)}`,
				);
			}
			try {
				return {
					text: JSON.stringify(listRunnerRequests(target.value, { environment, status }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, REQUEST_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		show: (args) => {
			const { showRunner } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "runner/ci");
			if (id.error) return invalidArg(id.error);
			try {
				const runner = showRunner(target.value, id.value);
				if (runner === null) {
					return {
						text: "",
						errors: [`runner ${JSON.stringify(id.value)} is not registered`],
						warnings: [],
						exitCode: 1,
						code: "AMBER_E_RUNNER_NOT_FOUND",
					};
				}
				return { text: JSON.stringify(runner, null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		list: (args) => {
			const { listRunners } = require("./core/runner-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			try {
				return { text: JSON.stringify(listRunners(target.value), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function runnerDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { runnerDispatch };
