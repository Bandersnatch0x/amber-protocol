"use strict";

// adoption-composer/index.js
// Main entry point for adoption artifact rendering.
// Consolidated from the original 682-line adoption-composer.js.
//
// This module is now organized into focused sub-modules:
// - shared-helpers.js: Common rendering utilities
// - report-renderer.js: Reports, indexes, diffs
// - gate-renderer.js: Gate and status documents
// - bundle-renderer.js: Bundle README, next actions, writer
// - decision-renderer.js: Decision records, apply plans, file selections

const {
	renderMarkdown,
	pushSection,
	pushBulletList,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushOptionalStarterWikiFiles,
	pushCheckboxFileList,
	pushCandidateCommands,
	pushUnknowns,
	pushHumanApprovalGates,
} = require("./shared-helpers");

const {
	renderAdoptionReport,
	renderAdoptionReportsIndex,
	renderAdoptionReportDiff,
} = require("./report-renderer");

const {
	renderAdoptionGateDocument,
	renderAdoptionStatusDocument,
} = require("./gate-renderer");

const {
	renderAdoptionBundleReadme,
	renderAdoptionNextActionsDocument,
	writeAdoptionBundleArtifact,
} = require("./bundle-renderer");

const {
	renderAdoptionDecisionRecord,
	renderAdoptionApplyPlan,
	renderAdoptionSelectedFiles,
} = require("./decision-renderer");

module.exports = {
	// Shared helpers (re-exported for backward compatibility)
	renderMarkdown,
	pushSection,
	pushBulletList,
	pushBoundaryBlock,
	pushGateFindings,
	pushStarterFileList,
	pushOptionalStarterWikiFiles,
	pushCheckboxFileList,
	pushCandidateCommands,
	pushUnknowns,
	pushHumanApprovalGates,

	// Report renderers
	renderAdoptionReport,
	renderAdoptionReportsIndex,
	renderAdoptionReportDiff,

	// Gate renderers
	renderAdoptionGateDocument,
	renderAdoptionStatusDocument,

	// Bundle renderers
	renderAdoptionBundleReadme,
	renderAdoptionNextActionsDocument,
	writeAdoptionBundleArtifact,

	// Decision renderers
	renderAdoptionDecisionRecord,
	renderAdoptionApplyPlan,
	renderAdoptionSelectedFiles,
};
