"use strict";

// F057 public CLI seam for the break-glass grant registry. This adapter
// parses flags only; the core owns every verdict. Nothing here executes
// anything — a grant is a governance record, and neither --yes nor
// --force ever routes into this surface.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_BREAKGLASS_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["incident", "--incident"],
		["purpose", "--purpose"],
		["capability", "--capability"],
		["exactTarget", "--exact-target"],
		["scope", "--scope"],
		["environment", "--environment"],
		["risk", "--risk"],
		["credential", "--credential"],
		["validFrom", "--valid-from"],
		["validUntil", "--valid-until"],
		["reviewBy", "--review-by"],
		["reason", "--reason"],
		["decisionIdentity", "--decision-identity"],
		["revision", "--revision"],
		["status", "--status"],
		["now", "--now"],
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

function clockValue(args) {
	if (args.now === undefined) return { value: null };
	const now = new Date(String(args.now));
	if (Number.isNaN(now.getTime()))
		return { error: `--now must be an ISO-8601 timestamp; got ${JSON.stringify(args.now)}` };
	return { value: now };
}

// Grammar: one kind-prefixed registered-capability pin —
//   runner:<runnerId>@<runnerVersion>/<name>@<capabilityVersion>
//   external:<effect-id>@<version>
function parseCapabilityPin(raw) {
	const value = String(raw);
	const runner = /^runner:([^@]+)@([^/]+)\/([^@]+)@([^@/]+)$/.exec(value);
	if (runner) {
		return {
			value: {
				kind: "runner",
				runnerId: runner[1],
				runnerVersion: runner[2],
				name: runner[3],
				capabilityVersion: runner[4],
			},
		};
	}
	const external = /^external:([^@]+)@([^@/]+)$/.exec(value);
	if (external) {
		return { value: { kind: "external", id: external[1], version: external[2] } };
	}
	return {
		error: `--capability must be runner:<runnerId>@<runnerVersion>/<name>@<capabilityVersion> or external:<effect-id>@<version>; got ${JSON.stringify(raw)}`,
	};
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
	command: "breakglass",
	actions: ["grant", "revoke", "grants"],
	handlers: {
		grant: (args) => {
			const { grantBreakGlass } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "breakglass/incident-42-restore"],
				["incident", "--incident", "incident/42"],
				["purpose", "--purpose", "restore-login-service"],
				["capability", "--capability", "external:effect/ticket-comment@1"],
				["exactTarget", "--exact-target", "tracker/amber-protocol"],
				["scope", "--scope", "issues"],
				["environment", "--environment", "production"],
				["risk", "--risk", "high"],
				["credential", "--credential", "scoped"],
				["validFrom", "--valid-from", "2026-08-29T00:00:00.000Z"],
				["validUntil", "--valid-until", "2026-08-29T01:00:00.000Z"],
				["reviewBy", "--review-by", "2026-09-01T00:00:00.000Z"],
				["decisionIdentity", "--decision-identity", "decision/breakglass-42"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const capability = parseCapabilityPin(args.capability);
			if (capability.error) return invalidArg(capability.error);
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				grantBreakGlass(
					target.value,
					{
						id: String(args.id),
						incident: String(args.incident),
						purpose: String(args.purpose),
						capability: capability.value,
						target: String(args.exactTarget),
						scope: String(args.scope),
						environment: String(args.environment),
						risk: String(args.risk),
						credentials: String(args.credential),
						validFrom: String(args.validFrom),
						validUntil: String(args.validUntil),
						reviewBy: String(args.reviewBy),
						decision: { identity: String(args.decisionIdentity), revision: revision.value },
					},
					clock.value === null ? {} : { now: clock.value },
				),
			);
		},
		revoke: (args) => {
			const { revokeBreakGlass } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "breakglass/incident-42-restore"],
				["reason", "--reason", '"credential compromise suspected"'],
				["decisionIdentity", "--decision-identity", "decision/breakglass-revoke-42"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				revokeBreakGlass(
					target.value,
					{
						id: String(args.id),
						reason: String(args.reason),
						decision: { identity: String(args.decisionIdentity), revision: revision.value },
					},
					clock.value === null ? {} : { now: clock.value },
				),
			);
		},
		grants: (args) => {
			const { listBreakGlassGrants, GRANT_STATUSES } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const status = args.status === undefined ? null : String(args.status);
			if (status !== null && !GRANT_STATUSES.includes(status))
				return invalidArg(
					`--status must be one of ${GRANT_STATUSES.join(", ")}; got ${JSON.stringify(args.status)}`,
				);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			try {
				return {
					text: JSON.stringify(
						listBreakGlassGrants(target.value, { status, now: clock.value }),
						null,
						2,
					),
				};
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function breakglassDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { breakglassDispatch };
