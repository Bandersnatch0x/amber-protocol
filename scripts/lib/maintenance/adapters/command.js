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

// Long-standing alias accepted by runMaintenanceAction. The adapter resolves
// it before the action whitelist check so alias behavior is unchanged.
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
	return { result: { target: targetRoot, scaffoldDrift: drift, errors: [], warnings: [] } };
}

function handleDistill(args) {
	const targetRoot = resolveTarget(args.target);
	const outputPath =
		args.output || path.join(targetRoot, "docs", "maintenance", "distill-proposals.md");
	const proposal = writeDistillProposal(targetRoot, outputPath, args);
	return {
		result: {
			target: targetRoot,
			outputPath: proposal.outputPath,
			candidateCount: proposal.candidateCount,
			errors: [],
			warnings: [],
		},
	};
}

/**
 * Dispatch a Maintenance subcommand to its implementation.
 * Preserves the runMaintenanceAction envelope contract for the eight
 * dispatch-owned actions; scaffold-drift and distill keep their distinct
 * envelopes exactly as the former outer-handler branches produced them.
 */
function maintenanceDispatch(action, args) {
	if (action === "scaffold-drift") {
		return handleScaffoldDrift(args);
	}
	if (action === "distill") {
		return handleDistill(args);
	}
	const resolved = ACTION_ALIASES[action] || action;
	if (!resolved || !MAINTENANCE_ACTIONS.includes(resolved)) {
		return { result: unknownMaintenanceAction() };
	}
	return { result: runMaintenanceAction(resolved, args.target, args) };
}

module.exports = {
	MAINTENANCE_ACTIONS,
	maintenanceDispatch,
	unknownMaintenanceAction,
};
