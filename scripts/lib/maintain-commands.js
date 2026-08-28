"use strict";

// F054 public CLI seam for Control Band detectors, deterministic
// Findings, and Trigger Proposals. This adapter parses flags only; the
// core owns every verdict, is target-read-only, and never mutates
// canonical or target state.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_MAINTAIN_CORRUPT";
const FINDING_READ_FAILURE_CODE = "AMBER_E_MAINTAIN_FINDING_CORRUPT";
const PROPOSAL_READ_FAILURE_CODE = "AMBER_E_MAINTAIN_PROPOSAL_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["detectorVersion", "--detector-version"],
		["metric", "--metric"],
		["source", "--source"],
		["baseline", "--baseline"],
		["ruleVal", "--rule"],
		["windowMs", "--window-ms"],
		["scope", "--scope"],
		["cooldownMs", "--cooldown-ms"],
		["maxObservations", "--max-observations"],
		["decisionIdentity", "--decision-identity"],
		["revision", "--revision"],
		["subject", "--subject"],
		["windowFrom", "--window-from"],
		["windowTo", "--window-to"],
		["value", "--value"],
		["observationHash", "--observation-hash"],
		["fingerprint", "--fingerprint"],
		["findingIndex", "--finding-index"],
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

function requiredNumber(args, key, flag) {
	const raw = args[key];
	if (raw === undefined || String(raw).trim().length === 0)
		return { error: `${flag} must be a finite number; got ${JSON.stringify(raw)}` };
	const value = Number(raw);
	if (!Number.isFinite(value))
		return { error: `${flag} must be a finite number; got ${JSON.stringify(raw)}` };
	return { value };
}

function positiveInt(args, key, flag) {
	const value = Number(args[key]);
	if (!Number.isInteger(value) || value < 1)
		return { error: `${flag} must be a positive integer; got ${JSON.stringify(args[key])}` };
	return { value };
}

// Grammar: <tier>:<comparator>:<threshold> — one deterministic rule.
function parseRule(raw) {
	const match = /^([a-z][a-z0-9-]*):(ge|gt|le|lt):(-?\d+(?:\.\d+)?)$/.exec(String(raw));
	if (!match) {
		return {
			error: `--rule must be <tier>:<ge|gt|le|lt>:<threshold> (e.g. --rule warn:ge:100); got ${JSON.stringify(raw)}`,
		};
	}
	return { value: { tier: match[1], comparator: match[2], threshold: Number(match[3]) } };
}

function resultEnvelope(result) {
	// A null record is detect's in-band verdict: a tier with nothing appended.
	return {
		text: result.ok ? JSON.stringify(result.record ?? { tier: result.tier }, null, 2) : "",
		errors: result.errors,
		warnings: [],
		exitCode: result.ok ? 0 : 1,
		...(result.code ? { code: result.code } : {}),
	};
}

const dispatch = defineCommand({
	command: "maintain",
	actions: ["register-detector", "detect", "propose", "detectors", "findings", "proposals"],
	handlers: {
		"register-detector": (args) => {
			const { registerDetector } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "detector/error-rate"],
				["detectorVersion", "--detector-version", "1"],
				["metric", "--metric", "http-5xx-rate"],
				["source", "--source", "observability/api"],
				["scope", "--scope", "service/api"],
				["decisionIdentity", "--decision-identity", "decision/detector-1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const baseline = requiredNumber(args, "baseline", "--baseline");
			if (baseline.error) return invalidArg(baseline.error);
			if (!Array.isArray(args.rules) || args.rules.length === 0)
				return invalidArg(`--rule is required at least once (e.g. --rule warn:ge:100)`);
			const rules = [];
			for (const raw of args.rules) {
				const rule = parseRule(raw);
				if (rule.error) return invalidArg(rule.error);
				rules.push(rule.value);
			}
			const numbers = {};
			for (const [key, flag] of [
				["windowMs", "--window-ms"],
				["cooldownMs", "--cooldown-ms"],
				["maxObservations", "--max-observations"],
				["revision", "--revision"],
			]) {
				const parsed = positiveInt(args, key, flag);
				if (parsed.error) return invalidArg(parsed.error);
				numbers[key] = parsed.value;
			}
			return resultEnvelope(
				registerDetector(target.value, {
					id: String(args.id),
					version: String(args.detectorVersion),
					metric: String(args.metric),
					source: String(args.source),
					baseline: baseline.value,
					rules,
					windowMs: numbers.windowMs,
					scope: String(args.scope),
					cooldownMs: numbers.cooldownMs,
					maxObservations: numbers.maxObservations,
					outputType: "finding",
					decision: { identity: String(args.decisionIdentity), revision: numbers.revision },
				}),
			);
		},
		detect: (args) => {
			const { detect } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "detector/error-rate"],
				["detectorVersion", "--detector-version", "1"],
				["subject", "--subject", "service/api"],
				["windowFrom", "--window-from", "2026-08-29T00:00:00.000Z"],
				["windowTo", "--window-to", "2026-08-29T01:00:00.000Z"],
				["observationHash", "--observation-hash", "sha256:<64-hex>"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const value = requiredNumber(args, "value", "--value");
			if (value.error) return invalidArg(value.error);
			return resultEnvelope(
				detect(target.value, {
					detectorId: String(args.id),
					detectorVersion: String(args.detectorVersion),
					subject: String(args.subject),
					window: { from: String(args.windowFrom), to: String(args.windowTo) },
					value: value.value,
					inputHash: String(args.observationHash),
				}),
			);
		},
		propose: (args) => {
			const { propose } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const findingIndex = Number(args.findingIndex);
			if (
				args.findingIndex === undefined ||
				String(args.findingIndex).trim().length === 0 ||
				!Number.isInteger(findingIndex) ||
				findingIndex < 0
			)
				return invalidArg(
					`--finding-index must be a non-negative integer; got ${JSON.stringify(args.findingIndex)}`,
				);
			const result = propose(target.value, { findingIndex });
			return {
				...resultEnvelope(result),
				text: result.ok
					? JSON.stringify({ action: result.action, proposal: result.record }, null, 2)
					: "",
			};
		},
		detectors: (args) => {
			const { listDetectors } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			try {
				return { text: JSON.stringify(listDetectors(target.value), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		findings: (args) => {
			const { listFindings } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const detectorId = args.id === undefined ? null : String(args.id);
			if (detectorId !== null && detectorId.trim().length === 0)
				return invalidArg(`--id must be non-empty when provided; got ${JSON.stringify(args.id)}`);
			const fingerprint = args.fingerprint === undefined ? null : String(args.fingerprint);
			if (fingerprint !== null && fingerprint.trim().length === 0)
				return invalidArg(
					`--fingerprint must be non-empty when provided; got ${JSON.stringify(args.fingerprint)}`,
				);
			try {
				return {
					text: JSON.stringify(listFindings(target.value, { detectorId, fingerprint }), null, 2),
				};
			} catch (err) {
				const failure = readFailure(args, err, FINDING_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		proposals: (args) => {
			const { listProposals } = require("./core/maintain-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const fingerprint = args.fingerprint === undefined ? null : String(args.fingerprint);
			if (fingerprint !== null && fingerprint.trim().length === 0)
				return invalidArg(
					`--fingerprint must be non-empty when provided; got ${JSON.stringify(args.fingerprint)}`,
				);
			try {
				return { text: JSON.stringify(listProposals(target.value, { fingerprint }), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, PROPOSAL_READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function maintainDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { maintainDispatch };
