"use strict";

// Canonical user-facing domain language from CONTEXT.md.
// Internal JSON field names (e.g. targetProjectFilesCopied) stay for compatibility.

const ADOPTION_BOUNDARY_LABELS = {
	targetProjectFilesCopied: "Target repository files copied",
	targetProjectFilesWritten: "Target repository files written",
	targetProjectCommandsExecuted: "Target repository commands executed",
	dynamicWorkflowExecuted: "Dynamic Workflow executed",
	liveSubagentsInvoked: "Live subagents invoked",
};

const ADOPTION_BOUNDARY_KEYS = [
	"targetProjectFilesCopied",
	"targetProjectCommandsExecuted",
	"dynamicWorkflowExecuted",
	"liveSubagentsInvoked",
];

const ADOPTION_WRITE_BOUNDARY_KEYS = [
	"targetProjectFilesWritten",
	"targetProjectCommandsExecuted",
	"dynamicWorkflowExecuted",
	"liveSubagentsInvoked",
];

const MESSAGES = {
	adoptionReadOnlyBundleNotice:
		"This bundle is a read-only review artifact. It does not copy files from the target repository and does not run target-repository commands.",
	adoptionReportNoInit:
		"No target-repository files were initialized by this report.",
	adoptionReviewBeforeChange:
		"Review adoption gate findings before initializing or changing the target repository.",
	adoptionReadyForApproval:
		"Ready for human approval of the next safe Amber action.",
	adoptionKeepReadOnly:
		"Keep this record pending if the target repository should remain read-only.",
	adoptionCommandsOutsideArtifact:
		"Commands that write to the target repository or execute its tests remain outside this artifact.",
	requiredStarterFilesPendingApproval:
		"## Required Amber Starter Files Pending Approval",
	requiredStarterFiles: "## Required Amber Starter Files",
	maintenanceProposalTitle: "# Amber Maintenance Proposal",
	evolutionLogHeading: "# Amber Evolution Log",
	planGuardrailsCheck: "- Existing Amber guardrails still pass.",
	replayNoCommandsYet:
		"This prepared result contains no executed commands yet. Replay starts from the ledger, task evidence, and worktree path recorded here.",
	teamNotInstalled: "Team Amber is not installed; use team install first.",
	teamAlreadyInstalled:
		"Team Amber is already installed; use team update or team rollback.",
	wikiTemplateLinkHint:
		"Review the Amber template and add a link to docs/wiki/index.md if appropriate.",
};

function formatAdoptionBoundaryLines(boundaries, keys = ADOPTION_BOUNDARY_KEYS) {
	return keys.map(
		(key) =>
			`- ${ADOPTION_BOUNDARY_LABELS[key]}: ${boundaries[key]}`,
	);
}

function defaultAdoptionBoundaries() {
	return {
		targetProjectFilesCopied: false,
		targetProjectCommandsExecuted: false,
		dynamicWorkflowExecuted: false,
		liveSubagentsInvoked: false,
	};
}

function defaultAdoptionWriteBoundaries() {
	return {
		targetProjectFilesWritten: false,
		targetProjectCommandsExecuted: false,
		dynamicWorkflowExecuted: false,
		liveSubagentsInvoked: false,
	};
}

function cannotReadTaskEvidence(errorMessage) {
	return `Cannot read task evidence: ${errorMessage}`;
}

module.exports = {
	ADOPTION_BOUNDARY_LABELS,
	ADOPTION_BOUNDARY_KEYS,
	ADOPTION_WRITE_BOUNDARY_KEYS,
	MESSAGES,
	formatAdoptionBoundaryLines,
	defaultAdoptionBoundaries,
	defaultAdoptionWriteBoundaries,
	cannotReadTaskEvidence,
};