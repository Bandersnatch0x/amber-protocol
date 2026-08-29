"use strict";

// F057 public CLI seam for the break-glass grant registry. This adapter
// parses flags only; the core owns every verdict. Nothing here executes
// anything — a grant is a governance record, and neither --yes nor
// --force ever routes into this surface.

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

const READ_FAILURE_CODE = "AMBER_E_BREAKGLASS_CORRUPT";

const VALUE_FLAGS = [
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
	["request", "--request"],
	["receipt", "--receipt"],
	["outcome", "--outcome"],
	["necessity", "--necessity"],
	["impact", "--impact"],
	["followUp", "--follow-up"],
	["decisionIdentity", "--decision-identity"],
	["revision", "--revision"],
	["status", "--status"],
	["now", "--now"],
	["target", "--target"],
];

function missingValueFlag(args) {
	return firstMissingFlagValue(args, VALUE_FLAGS);
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

const dispatch = defineCommand({
	command: "breakglass",
	actions: ["grant", "revoke", "grants", "use", "show", "settle", "review", "status"],
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
		use: (args) => {
			const { useBreakGlass } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "breakglass/incident-42-restore"],
				["request", "--request", "request/ticket-comment-288"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				useBreakGlass(
					target.value,
					{ id: String(args.id), reference: String(args.request) },
					clock.value === null ? {} : { now: clock.value },
				),
			);
		},
		show: (args) => {
			const { showBreakGlassGrant } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "breakglass/incident-42-restore");
			if (id.error) return invalidArg(id.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			let record;
			try {
				record = showBreakGlassGrant(
					target.value,
					id.value,
					clock.value === null ? {} : { now: clock.value },
				);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (record === null)
				return {
					text: "",
					errors: [`grant ${JSON.stringify(id.value)} does not exist`],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_BREAKGLASS_NOT_FOUND",
				};
			return { text: JSON.stringify(record, null, 2) };
		},
		settle: (args) => {
			const { settleBreakGlass } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "breakglass/incident-42-restore"],
				["receipt", "--receipt", "execution/ticket-comment-1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				settleBreakGlass(
					target.value,
					{ id: String(args.id), receipt: String(args.receipt) },
					clock.value === null ? {} : { now: clock.value },
				),
			);
		},
		review: (args) => {
			const { reviewBreakGlass } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "breakglass/incident-42-restore"],
				["outcome", "--outcome", '"service restored"'],
				["necessity", "--necessity", '"release path was 40 minutes out"'],
				["impact", "--impact", '"one ticket comment created"'],
				["followUp", "--follow-up", '"add a standing runbook"'],
				["decisionIdentity", "--decision-identity", "decision/breakglass-review-42"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			return resultEnvelope(
				reviewBreakGlass(
					target.value,
					{
						id: String(args.id),
						outcome: String(args.outcome),
						necessity: String(args.necessity),
						impact: String(args.impact),
						followUp: String(args.followUp),
						decision: { identity: String(args.decisionIdentity), revision: revision.value },
					},
					clock.value === null ? {} : { now: clock.value },
				),
			);
		},
		status: (args) => {
			const { breakGlassStatus } = require("./core/breakglass-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "breakglass/incident-42-restore");
			if (id.error) return invalidArg(id.error);
			const clock = clockValue(args);
			if (clock.error) return invalidArg(clock.error);
			let record;
			try {
				record = breakGlassStatus(
					target.value,
					id.value,
					clock.value === null ? {} : { now: clock.value },
				);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (record === null)
				return {
					text: "",
					errors: [`grant ${JSON.stringify(id.value)} does not exist`],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_BREAKGLASS_NOT_FOUND",
				};
			return { text: JSON.stringify(record, null, 2) };
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
