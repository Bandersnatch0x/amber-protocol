"use strict";

// F052 public CLI seam for controlled Runner & capability registration.
// This adapter parses flags only; the core owns every registry verdict and
// never spawns anything — a registered Runner is an external executor
// identity, not an execution path (ADR-0022).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_RUNNER_REGISTRY_CORRUPT";

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
	actions: ["register", "capability", "show", "list"],
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
