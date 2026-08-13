"use strict";

// Maintenance Governance Console command adapter (F014-M3).
//
// Owns the full ten-subcommand Maintenance surface: action recognition,
// aliases, argument shaping, registry-path resolution, structured envelopes,
// and unknown-action guidance. Domain implementations stay behind the
// maintenance/internal seam; the dispatcher delegates here with no subcommand
// knowledge of its own.

const path = require("node:path");

const { resolveTarget } = require("../../core/fs-utils");
const { runMaintenanceAction } = require("../../core/maintenance");
const { detectScaffoldDrift } = require("../../core/scaffold-version-drift");
const { writeDistillProposal } = require("../../distill-candidates");
const { createSubcommandDispatcher } = require("../../subcommand-dispatcher");

const MAINTENANCE_ACTIONS = [
	"inspect",
	"propose",
	"stale-docs",
	"wiki-lint",
	"pack-drift",
	"upgrade-preview",
	"evolution-rollup",
	"regression-proposals",
	"scaffold-drift",
	"distill",
];

const ACTION_ALIASES = {
	proposal: "propose",
};

function unknownMaintenanceAction() {
	return {
		errors: [`maintenance requires one of: ${MAINTENANCE_ACTIONS.join(", ")}.`],
		warnings: [],
	};
}

function handleScaffoldDrift(args) {
	const targetRoot = resolveTarget(args.target);
	const drift = detectScaffoldDrift(targetRoot);
	return { target: targetRoot, scaffoldDrift: drift, errors: [], warnings: [] };
}

function handleDistill(args) {
	const targetRoot = resolveTarget(args.target);
	const outputPath =
		args.output || path.join(targetRoot, "docs", "maintenance", "distill-proposals.md");
	const proposal = writeDistillProposal(targetRoot, outputPath, args);
	return {
		target: targetRoot,
		outputPath: proposal.outputPath,
		candidateCount: proposal.candidateCount,
		errors: [],
		warnings: [],
	};
}

// Eight dispatch-owned actions delegate to runMaintenanceAction; the two
// local handlers (scaffold-drift, distill) keep their distinct envelopes.
const DISPATCH_OWNED = MAINTENANCE_ACTIONS.filter(
	(action) => action !== "scaffold-drift" && action !== "distill",
);

const maintenanceDispatch = createSubcommandDispatcher({
	actions: MAINTENANCE_ACTIONS,
	aliases: ACTION_ALIASES,
	handlers: {
		"scaffold-drift": handleScaffoldDrift,
		distill: handleDistill,
		...Object.fromEntries(
			DISPATCH_OWNED.map((action) => [
				action,
				(args) => runMaintenanceAction(action, args.target, args),
			]),
		),
	},
	unknownHandler: unknownMaintenanceAction,
	envelope: (result) => ({ result }),
});

module.exports = {
	MAINTENANCE_ACTIONS,
	maintenanceDispatch,
	unknownMaintenanceAction,
};
