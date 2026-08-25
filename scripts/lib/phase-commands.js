"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget } = require("./command-helpers");

const dispatch = defineCommand({
	command: "phase",
	actions: ["evidence", "validate", "promote", "rollback", "transitions", "invariants"],
	handlers: {
		evidence: (args) => {
			const { gatherPhaseEvidence } = require("./core/phase-gates");
			const evidence = gatherPhaseEvidence(resolveTarget(args), args.phase);
			return { text: JSON.stringify(evidence, null, 2) };
		},
		validate: (args) => {
			const { validatePhaseEvidence } = require("./core/phase-gates");
			const validation = validatePhaseEvidence(resolveTarget(args), args.phase);
			return {
				text: JSON.stringify(
					{ complete: validation.complete, missing: validation.missing },
					null,
					2,
				),
				errors: validation.complete ? [] : [`missing evidence: ${validation.missing.join(", ")}`],
				warnings: [],
				exitCode: validation.complete ? 0 : 1,
			};
		},
		promote: (args) => {
			const { promotePhase } = require("./core/phase-gates");
			const result = promotePhase(resolveTarget(args), args.phase, {
				authorization: args.auth || null,
			});
			return {
				text: result.ok ? JSON.stringify(result.transition, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
		rollback: (args) => {
			const { rollbackPhase } = require("./core/phase-gates");
			const result = rollbackPhase(resolveTarget(args), args.phase, {
				checkpoint: args.checkpoint || null,
				reason: args.reason || null,
			});
			return {
				text: result.ok ? JSON.stringify(result.transition, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
		transitions: (args) => {
			const { listTransitions } = require("./core/phase-gates");
			return { text: JSON.stringify(listTransitions(resolveTarget(args)), null, 2) };
		},
		invariants: (args) => {
			const { checkInvariantNonRegression } = require("./core/phase-gates");
			const result = checkInvariantNonRegression(resolveTarget(args));
			return {
				text: JSON.stringify(result.invariants, null, 2),
				errors: result.ok ? [] : ["invariant regression detected"],
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
	},
});

function phaseDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { phaseDispatch };
