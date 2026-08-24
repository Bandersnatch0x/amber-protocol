"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

const { resolveTarget, unknownAction } = require("./command-helpers");

function phaseDispatch(args) {
	const targetRoot = resolveTarget(args);
	const sub = args._?.[0];
	const {
		gatherPhaseEvidence,
		validatePhaseEvidence,
		promotePhase,
		rollbackPhase,
		listTransitions,
		checkInvariantNonRegression,
	} = require("./core/phase-gates");
	if (sub === "evidence") {
		const evidence = gatherPhaseEvidence(targetRoot, args.phase);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(evidence, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "validate") {
		const validation = validatePhaseEvidence(targetRoot, args.phase);
		const exitCode = validation.complete ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify(
					{ complete: validation.complete, missing: validation.missing },
					null,
					2,
				),
				errors: validation.complete ? [] : [`missing evidence: ${validation.missing.join(", ")}`],
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "promote") {
		const result = promotePhase(targetRoot, args.phase, { authorization: args.auth || null });
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: result.ok ? JSON.stringify(result.transition, null, 2) : "",
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "rollback") {
		const result = rollbackPhase(targetRoot, args.phase, {
			checkpoint: args.checkpoint || null,
			reason: args.reason || null,
		});
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: result.ok ? JSON.stringify(result.transition, null, 2) : "",
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "transitions") {
		const transitions = listTransitions(targetRoot);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(transitions, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "invariants") {
		const result = checkInvariantNonRegression(targetRoot);
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify(result.invariants, null, 2),
				errors: result.ok ? [] : ["invariant regression detected"],
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("phase", [
			"evidence",
			"validate",
			"promote",
			"rollback",
			"transitions",
			"invariants",
		]),
	};
}

module.exports = { phaseDispatch };
