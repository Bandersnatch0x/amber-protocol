"use strict";

const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TEMPLATE_ROOT = path.join(REPO_ROOT, "templates");

const DEFAULT_TEAM_REGISTRY = path.join(
	REPO_ROOT,
	"registry",
	"amber-protocol.registry.json",
);

const MINIMUM_HARNESS_FILES = [
	"AGENTS.md",
	"CLAUDE.md",
	"feature_list.json",
	"PROGRESS.md",
	"session-handoff.md",
	"clean-state-checklist.md",
	"evaluator-rubric.md",
	"docs/wiki/index.md",
	"docs/wiki/product/overview.md",
	"docs/wiki/architecture/system-map.md",
	"docs/wiki/engineering/runbook.md",
	"docs/wiki/engineering/verification.md",
	"docs/wiki/agent/amber.md",
	"docs/wiki/agent/continuous-improvement.md",
	"docs/wiki/agent/workflow-packets.md",
	".workflow/continuous-improvement/state.json",
	"docs/wiki/glossary.md",
];

const OPTIONAL_STARTER_WIKI_FILES = [
	"docs/wiki/product/feature-map.md",
	"docs/wiki/product/user-scenarios.md",
	"docs/wiki/architecture/module-boundaries.md",
	"docs/wiki/architecture/data-flow.md",
	"docs/wiki/architecture/decisions/0001-record-architecture-decisions.md",
	"docs/wiki/engineering/local-development.md",
	"docs/wiki/engineering/release.md",
	"docs/wiki/engineering/troubleshooting.md",
	"docs/wiki/agent/working-rules.md",
	"docs/wiki/agent/prompt-recipes.md",
	"docs/wiki/agent/failure-patterns.md",
	"docs/wiki/features/F001-example-feature.md",
];

const REQUIRED_HARNESS_FILES = MINIMUM_HARNESS_FILES;

// Feature lifecycle statuses. `accepted` is written by `amber accept` (planning.js);
// `passing` is written by feature verify evidence. `completed` is NOT valid —
// use passing/accepted. Doctor + validate-feature-list enforce at-most-one in_progress.
const VALID_STATUSES = new Set([
	"not_started",
	"in_progress",
	"blocked",
	"passing",
	"accepted",
]);

const REQUIRED_HANDOFF_SECTIONS = [
	"Summary",
	"Repo State",
	"Runtime / Verification State",
	"Feature State",
	"Verification Evidence",
	"Blockers",
	"Next Actions",
];

const WIKI_CONTEXT_STARTER_FILES = new Set([
	"docs/wiki/product/overview.md",
	"docs/wiki/product/feature-map.md",
	"docs/wiki/product/user-scenarios.md",
	"docs/wiki/architecture/system-map.md",
	"docs/wiki/architecture/module-boundaries.md",
	"docs/wiki/architecture/data-flow.md",
	"docs/wiki/architecture/decisions/0001-record-architecture-decisions.md",
	"docs/wiki/engineering/runbook.md",
	"docs/wiki/engineering/verification.md",
	"docs/wiki/engineering/local-development.md",
	"docs/wiki/engineering/release.md",
	"docs/wiki/engineering/troubleshooting.md",
	"docs/wiki/features/F001-example-feature.md",
]);

// The CLI's own version, stamped into install provenance so a later
// `amber maintenance scaffold-drift` can report "installed by Amber X.Y.Z".
const CLI_VERSION = require("../../../package.json").version;

// Amber-controlled content: reference docs Amber ships AND owns the canonical
// content for. The project should not author these. Safe to overwrite when
// provenance proves the file is stale (unchanged since install). The hash guard
// reclassifies any user-edited file as "customized" so it is never clobbered.
// NOTE: "optional to install" (OPTIONAL_STARTER_WIKI_FILES) and "who owns the
// content" are ORTHOGONAL axes — some files here are also optional starters.
const AMBER_CONTROLLED_CONTENT_FILES = new Set([
	"clean-state-checklist.md",
	"evaluator-rubric.md",
	"docs/wiki/index.md",
	"docs/wiki/glossary.md",
	"docs/wiki/agent/amber.md",
	"docs/wiki/agent/continuous-improvement.md",
	"docs/wiki/agent/workflow-packets.md",
	"docs/wiki/agent/working-rules.md",
	"docs/wiki/agent/prompt-recipes.md",
	"docs/wiki/agent/failure-patterns.md",
]);

// Runtime state files Amber's init scaffolds but must NEVER overwrite — refreshing
// these would destroy accumulated project state.
const AMBER_STATE_FILES = new Set([
	".workflow/continuous-improvement/state.json",
]);

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;

module.exports = {
	REPO_ROOT,
	TEMPLATE_ROOT,
	DEFAULT_TEAM_REGISTRY,
	MINIMUM_HARNESS_FILES,
	OPTIONAL_STARTER_WIKI_FILES,
	REQUIRED_HARNESS_FILES,
	VALID_STATUSES,
	REQUIRED_HANDOFF_SECTIONS,
	WIKI_CONTEXT_STARTER_FILES,
	CLI_VERSION,
	AMBER_CONTROLLED_CONTENT_FILES,
	AMBER_STATE_FILES,
	SEMVER_PATTERN,
};
