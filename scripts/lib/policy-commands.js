"use strict";

// F050 ticket 5 (#230) — Policy evaluation CLI surface
// (evaluate/show/list). Policy Contracts are admitted through the existing
// artifact surface (`amber artifact admit --type policy --extension
// policy.policyVersion=1 ...`); this adapter only parses flags and forwards to
// the core evaluator, which owns deny-wins semantics, separation of duties,
// explicit delegation, and the immutable policy outcome ledger.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_POLICY_MISSING";
const POLICY_MISSING_CODE = "AMBER_E_POLICY_MISSING";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function writeFailure(err) {
	return {
		text: "",
		errors: [err.message || String(err)],
		warnings: [],
		exitCode: 1,
		...(err.amberCode ? { code: err.amberCode } : {}),
	};
}

function missingValueFlag(args) {
	const valueFlags = [
		["orgPolicy", "--org-policy"],
		["tenantPolicy", "--tenant-policy"],
		["repoPolicy", "--repo-policy"],
		["playPolicy", "--play-policy"],
		["gatePolicy", "--gate-policy"],
		["subject", "--subject"],
		["submitter", "--submitter"],
		["capability", "--capability"],
		["approval", "--approval"],
		["gateOutcomeIndex", "--gate-outcome-index"],
		["delegator", "--delegator"],
		["now", "--now"],
		["index", "--index"],
		["verdict", "--verdict"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

function targetFlagValue(args) {
	if (args.target === undefined || args.target === null) return { value: resolveTarget(args) };
	const target = String(args.target);
	if (target.trim().length === 0) {
		return {
			error: `--target must be a non-empty repository path when provided; got ${JSON.stringify(args.target)}`,
		};
	}
	return { value: target };
}

function optionalString(value) {
	return value === undefined ? null : String(value);
}

function requiredFlag(args, key, flag, example) {
	const value = optionalString(args[key]);
	if (value === null || value.trim().length === 0) {
		return {
			error: `${flag} is required and must be a non-empty value (e.g. ${flag} ${example}); got ${JSON.stringify(args[key])}`,
		};
	}
	return { value };
}

function nowFlagValue(args) {
	if (args.now === undefined) return { value: undefined };
	const parsed = new Date(String(args.now));
	if (Number.isNaN(parsed.getTime())) {
		return {
			error: `--now must be an ISO-8601 date, or a date-time carrying an explicit zone (Z or ±hh:mm) — e.g. 2027-01-31 or 2027-01-31T09:00:00Z; got ${JSON.stringify(args.now)}`,
		};
	}
	return { value: parsed };
}

function indexFlagValue(args) {
	if (args.index === undefined) return { value: null };
	const index = Number(args.index);
	if (!Number.isInteger(index) || index < 0) {
		return {
			error: `--index must be a non-negative integer naming the 0-based policy outcome ledger line to show; got ${JSON.stringify(args.index)}`,
		};
	}
	return { value: index };
}

function gateOutcomeIndexFlagValue(args) {
	const required = requiredFlag(args, "gateOutcomeIndex", "--gate-outcome-index", "0");
	if (required.error) return required;
	const index = Number(required.value);
	if (!Number.isInteger(index) || index < 0) {
		return {
			error: `--gate-outcome-index must be a non-negative integer naming the 0-based Gate Outcome ledger line; got ${JSON.stringify(args.gateOutcomeIndex)}`,
		};
	}
	return { value: index };
}

function verdictFilterValue(args) {
	if (args.verdict === undefined) return { value: null };
	const verdict = String(args.verdict);
	if (verdict !== "pass" && verdict !== "deny") {
		return {
			error: `--verdict must be one of the closed set (pass, deny); got ${JSON.stringify(args.verdict)}`,
		};
	}
	return { value: verdict };
}

const dispatch = defineCommand({
	command: "policy",
	actions: ["evaluate", "show", "list"],
	handlers: {
		evaluate: (args) => {
			const { evaluatePolicy } = require("./core/policy-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line, so the declared input would otherwise be dropped silently`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const orgPolicy = requiredFlag(args, "orgPolicy", "--org-policy", "policy/org");
			if (orgPolicy.error) return invalidArg(orgPolicy.error);
			const tenantPolicy = requiredFlag(args, "tenantPolicy", "--tenant-policy", "policy/tenant");
			if (tenantPolicy.error) return invalidArg(tenantPolicy.error);
			const subject = requiredFlag(args, "subject", "--subject", "spec/login@2");
			if (subject.error) return invalidArg(subject.error);
			const submitter = requiredFlag(args, "submitter", "--submitter", "dev@example.com");
			if (submitter.error) return invalidArg(submitter.error);
			const capability = requiredFlag(args, "capability", "--capability", "release");
			if (capability.error) return invalidArg(capability.error);
			const approval = requiredFlag(args, "approval", "--approval", "approval/login-42");
			if (approval.error) return invalidArg(approval.error);
			const gateOutcomeIndex = gateOutcomeIndexFlagValue(args);
			if (gateOutcomeIndex.error) return invalidArg(gateOutcomeIndex.error);
			const now = nowFlagValue(args);
			if (now.error) return invalidArg(now.error);
			let result;
			try {
				result = evaluatePolicy(
					target.value,
					{
						policies: {
							org: orgPolicy.value,
							tenant: tenantPolicy.value,
							...(args.repoPolicy !== undefined ? { repo: String(args.repoPolicy) } : {}),
							...(args.playPolicy !== undefined ? { play: String(args.playPolicy) } : {}),
							...(args.gatePolicy !== undefined ? { gate: String(args.gatePolicy) } : {}),
						},
						subject: subject.value,
						submitter: submitter.value,
						capability: capability.value,
						approval: approval.value,
						gateOutcomeIndex: gateOutcomeIndex.value,
						...(args.delegator !== undefined ? { delegator: String(args.delegator) } : {}),
						...(now.value !== undefined ? { now: now.value } : {}),
					},
					{},
				);
			} catch (err) {
				return writeFailure(err);
			}
			return {
				text: result.outcome ? JSON.stringify(result.outcome, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showPolicyOutcome } = require("./core/policy-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const index = indexFlagValue(args);
			if (index.error) return invalidArg(index.error);
			if (index.value === null) {
				return invalidArg(
					"--index <n> is required: policy show names one immutable outcome by its 0-based ledger line",
				);
			}
			let record;
			try {
				record = showPolicyOutcome(target.value, { index: index.value });
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			if (!record) {
				return {
					text: "",
					errors: [`no policy outcome recorded at index ${index.value}`],
					warnings: [],
					exitCode: 1,
					code: POLICY_MISSING_CODE,
				};
			}
			return { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listPolicyOutcomes } = require("./core/policy-evaluation");
			const truncated = missingValueFlag(args);
			if (truncated) {
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			}
			const target = targetFlagValue(args);
			if (target.error) return invalidArg(target.error);
			const verdict = verdictFilterValue(args);
			if (verdict.error) return invalidArg(verdict.error);
			let records;
			try {
				records = listPolicyOutcomes(target.value, {
					subject: optionalString(args.subject),
					submitter: optionalString(args.submitter),
					capability: optionalString(args.capability),
					verdict: verdict.value,
				});
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(records, null, 2) };
		},
	},
});

function policyDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { policyDispatch };
