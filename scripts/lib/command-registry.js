"use strict";

const { COMMAND_CAPABILITIES, capabilityKey } = require("./mcp-action-contracts");
// F025: break-loop help renders the taxonomy and menu from the same single
// source the scaffold uses (scripts/lib/core/break-loop.js), so the two can
// never disagree.
const { renderTaxonomyLines, renderMenuLines } = require("./core/break-loop");
const { renderLearningOwnerLines } = require("./core/learning-owner-routing");

// Command ownership metadata lives with the Command Definitions. Capability
// manifests are validated against this projection, never used to invent it.
const TYPED_COMMAND_NAMES = new Set([
	"session",
	"route",
	"context",
	"governance",
	"ledger",
	"loop",
	"memory",
]);

// Per-command help text shown by `amber <command> --help`.
// Single-line summaries are plain strings; multi-line summaries are arrays
// joined with newlines. Command order is an external CLI contract, while help,
// output policy, and handler binding remain owned by this registration module.
const COMMAND_HELP = {
	init: "Create missing Amber starter files without overwriting existing files. Supports --dry-run.",
	audit:
		"Inspect an existing project without writing files. Supports --summary for bounded text output.",
	wiki: [
		"Create missing Wiki starter files, skip existing files, then validate links. Supports --dry-run.",
		"",
		"Subcommands:",
		"  (none)             Scaffold the base wiki skeleton (idempotent).",
		"  knowledge          Knowledge Plan + Structured Knowledge Base (declarative plan format).",
		"    knowledge plan        Pre-flight inspection + propose or update the plan.",
		"    knowledge scaffold    Scaffold docs/wiki/knowledge-plan.json (or --yaml).",
		"    knowledge inspect     Dump the loaded plan.",
		"    knowledge report      Coverage report against declared documents + notes + cards.",
		"    knowledge validate    Schema validation of the plan.",
		"    knowledge build       Materialize structured knowledge pages under docs/wiki/knowledge/.",
		"",
		"Examples:",
		"  amber wiki knowledge plan --target .",
		"  amber wiki knowledge scaffold --target . --yaml",
		"  amber wiki knowledge build --target .",
		"  amber wiki knowledge report --target .",
	],
	handoff: [
		"Regenerate live handoff state or produce the portable handoff bundle.",
		"",
		"Subcommands:",
		"  (none)             Regenerate session-handoff.md from live state and validate it.",
		"  bundle             Write README, summary, evidence, next-actions, risks, recovery commands, and manifest.",
		"  validate           Validate a handoff bundle directory.",
		"",
		"Examples:",
		"  amber handoff --target path/to/repo",
		"  amber handoff bundle --target path/to/repo",
		"  amber handoff bundle --target path/to/repo --output-dir .amber/handoff/latest",
		"  amber handoff validate --target path/to/repo --bundle-dir .amber/handoff/latest",
	],
	doctor: "Run Amber guardrail checks and target classification.",
	drift:
		"CI-native drift gate. Exit 1 if any artifact/wiki/scaffold drift. Supports --scope, --format gh-annotations, --no-fail.",
	plan: [
		"Create a feature-linked vertical-slice plan from a registered feature.",
		"",
		"Required options:",
		"  --target <dir>       Path to the target repository.",
		"  --feature <id>       Feature id (e.g. F001) — must already exist in feature_list.json.",
		"  --title <text>       Short human-readable title for the plan.",
		"",
		"Optional:",
		"  --dry-run            Preview without writing files.",
		"",
		"Examples:",
		'  amber plan --target . --feature F001 --title "Small slice"',
		'  amber plan --target . --feature F002 --title "AccountChargeDrawer dual-step" --dry-run',
	],
	gate: [
		"Validate that a plan is tied to feature state and has user confirmation, or confirm it.",
		"",
		"Options:",
		"  --plan <path>       Relative path to the plan to gate-check or confirm.",
		"  --confirm           Set the plan's User Confirmation field to confirmed.",
		"",
		"Examples:",
		"  amber gate --target . --plan docs/plans/F001-small-slice.md",
		"  amber gate --target . --plan docs/plans/F001-small-slice.md --confirm",
	],
	review: "Review a plan against static Amber standards and release-readiness checks.",
	accept: [
		"Accept a reviewed plan and append an Amber evolution record.",
		"",
		"Options:",
		"  --plan <path>       Relative path to the plan to accept.",
		"  --session <id>      Optional session id; prints completion-check status as a warning.",
		"  --strict             When used with --session, turn missing completion-check evidence into errors.",
		"",
		"Example:",
		"  amber accept --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  amber accept --target path/to/repo --plan docs/plans/F001-small-slice.md --session <session-id>",
	],
	learnings: [
		"Inspect post-accept learning write-back triggers for a feature, or book the review.",
		"Read-only inspection by default; --reviewed books the review on the feature entry.",
		"",
		"Options:",
		"  --feature <id>     Feature to inspect (defaults to the current lifecycle focus).",
		"  --reviewed         Book the learning review (requires --feature; overwrites any prior booking).",
		"  --owner <id>       Durable Amber surface that owns the learned behavior; exactly one is required when booking.",
		"                     Canonical owner routes:",
		...renderLearningOwnerLines("                       "),
		"  --surface <path>   Knowledge surface the review was written to. Repeatable;",
		"                     a single flag also accepts a comma-separated list.",
		"  --json             Emit the machine-readable envelope.",
		"",
		"Boundary: Amber detects and reminds; it never writes knowledge docs itself.",
		"",
		"Examples:",
		"  amber learnings --target .",
		"  amber learnings --target . --feature F001",
		"  amber learnings --target . --feature F001 --reviewed --owner command --surface docs/specs/f001.md",
	],
	"break-loop": [
		"Scaffold and validate a post-mortem for a defect class that recurred after a fix (recurrence >= 2).",
		"The default action scaffolds; `validate` refuses placeholder content.",
		"",
		"Actions:",
		"  (none)             Scaffold docs/quality/break-loops/<date>-<slug>.md; never overwrites an existing file.",
		"  validate           Check every section is filled: ids chosen, write-back surface + test",
		"                     anchor + runnable verification command present.",
		"",
		"Options:",
		"  --issue <n>        Reference number of the recurring issue, required to scaffold (recorded only, no tracker access).",
		'  --title "<t>"      Post-mortem title, required to scaffold; needs at least one ASCII letter or digit (becomes the filename slug).',
		"  --recurrence <n>   How many times the class has come back, required to scaffold; must be >= 2.",
		"  --file <path>      Post-mortem file to validate (validate action).",
		"  --json             Emit the machine-readable envelope.",
		"",
		"Root-cause taxonomy (pick one primary by id):",
		...renderTaxonomyLines("  "),
		"",
		"Prevention-mechanism menu (pick one by id):",
		...renderMenuLines("  "),
		"",
		"Boundary: Amber scaffolds and validates — the analysis is the operator's.",
		"No issue-tracker access, no recurrence auto-detection, no execution.",
		"",
		"Examples:",
		'  amber break-loop --target . --issue 122 --title "Evidence dates drift" --recurrence 2',
		"  amber break-loop validate --target . --file docs/quality/break-loops/2026-08-15-Evidence-dates-drift.md",
	],
	pack: "Inspect or validate declarative workflow packs without executing them.",
	ledger:
		"Export, seal, or verify-anchoring for Amber's tamper-evident ledgers. export emits JSON/CSV/OTLP-JSON for SIEM.",
	profile:
		"⚠️  DEPRECATED: Inspect declarative project profiles. Will be removed in v2 — use 'amber governance' instead.",
	task: "⚠️  DEPRECATED: Prepare isolated task ledger, evidence, replay, and worktree artifacts. Will be removed in v2.",
	result:
		"⚠️  DEPRECATED: Inspect replayable task result artifacts without relying on chat history. Will be removed in v2.",
	agent:
		"⚠️  DEPRECATED: Create and control auditable worker/reviewer dispatch records without executing agent work. Will be removed in v2.",
	team: [
		"⚠️  DEPRECATED: Inspect, install, pin, update, and roll back local team distribution metadata. Will be removed in v2.",
		"",
		"Use install --dry-run to preview .amber/team metadata writes before creating local state.",
	],
	maintenance:
		"Inspect stale docs, wiki lint readiness, upgrade guidance, drift, distill candidates, and reviewable maintenance proposals.",
	adoption: [
		"⚠️  DEPRECATED: Generate, list, or index safe adoption report artifacts without modifying target repositories. Will be removed in v2 — use 'amber governance audit' instead.",
		"",
		"Examples:",
		"  amber adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
		"  amber adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle",
		"  amber adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md",
		"  amber adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record.md",
		"  amber adoption apply-plan --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-apply-plan.md --dry-run",
		"  amber adoption selected-files --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-selected-files.md --include AGENTS.md",
	],
	loop: [
		"Inspect loop contracts, write dry-run ledger previews, and record manual loop evidence without live scheduling.",
		"Loop status accepts one ledger JSON file or a directory and reports bounded no-progress signals without executing anything.",
		"",
		"Examples:",
		"  amber loop inspect --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --json",
		'  amber loop recommend --target . --goal "continuous improvement" --json',
		"  amber loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --output .amber/loops/daily-amber-triage/ledger-preview.json --json",
		"  amber loop record --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --trigger-source manual --stop-reason reviewer-gate-required --output .amber/loops/daily-amber-triage/manual-ledger.json --json",
		"  amber loop status --ledger .amber/loops/daily-amber-triage/manual-ledger.json --json",
		"  amber loop status --ledger .amber/loops/daily-amber-triage/history --json",
		"  amber loop validate-loop --contract path/to/contract.json --json",
	],
	route: [
		"Inspect, validate, and dry-run delivery routes from routes/*.route.json.",
		"",
		"Subcommands:",
		"  list                 List all routes (id, version, stage count).",
		"  inspect <id>         Print a route's stage tree and full JSON.",
		"  validate <file>      Validate a route file; non-zero exit on invalid.",
		"  test <id> --dry-run  Print the ordered stage sequence and gate points.",
		"",
		"Examples:",
		"  amber route list",
		"  amber route inspect feature-standard",
		"  amber route validate routes/feature-standard.route.json",
		"  amber route test bugfix-quick --dry-run",
	],
	session: [
		"Manage session lifecycle: start, status, list, abort, continue, complete-check, verify, approve, complete.",
		"",
		"Subcommands:",
		'  start --goal "..." [--route <id>] [--budget <n>] [--worktree] [--mode interactive]',
		"      Create a new session, write manifest + timeline, optionally create worktree.",
		"  status [<id>]",
		"      Show status of current session or specified session by ID.",
		"  list",
		"      List all sessions in reverse chronological order.",
		"  abort <id>",
		"      Set session status to aborted, write abort event, cleanup worktree.",
		"  continue [<id>]",
		"      Continue a paused or incomplete session from its current stage.",
		"  complete-check --session <id> [--strict]",
		"      Report whether a session has enough evidence to be treated as complete.",
		"  complete --session <id> [--strict]",
		"      Mark a session completed (governance terminal state). Requires complete-check to pass.",
		"  verify --session <id> [--stage <name>] [--command <cmd>] [--result <text>] [--execute]",
		"      Record verification evidence. Without --execute, records a self-reported claim.",
		"      With --execute, runs --command and records the real exit code.",
		"  approve --session <id> [--gate <gate-id>]",
		"      Record a gate_passed event so complete-check sees approval evidence.",
		"",
		"Session completion flow:",
		'  amber session start --goal "..."',
		"  amber session continue",
		"  amber session verify --session <id>",
		"  amber session approve --session <id> --gate <gate-id>",
		"  amber session complete-check --session <id>",
		"  amber session complete --session <id>",
		"",
		"Route auto-matching:",
		"  Goals are matched against route trigger goalPattern regexes:",
		"    bugfix-quick     — ^(fix|resolve|patch|repair)\\s+.*(bug|defect|issue|error|crash)",
		"    feature-standard — ^(add|implement|create|build)\\s+.*feature",
		"    refactor-safe    — ^(refactor|restructure|clean\\s*up|simplify|extract)\\b",
		"  Pass --route <id> to bypass auto-matching.",
		"",
		"Two-layer approval gates:",
		"  Plan-level:  amber gate --confirm  → edits User Confirmation in the plan .md file.",
		"  Session-level: amber session approve → records gate_passed in the session timeline.",
		"  Both layers must be satisfied for complete-check --strict to pass.",
		"",
		"Examples:",
		'  amber session start --goal "implement user auth" --confirm',
		'  amber session start --goal "fix login bug" --route bugfix-quick --worktree --confirm',
		'  amber session start --goal "add feature" --mode interactive --confirm',
		"  amber session status",
		"  amber session list",
		"  amber session abort <session-id>",
		"  amber session continue",
		"  amber session complete-check --session <session-id>",
		"  amber session verify --session <session-id> --confirm",
		"  amber session approve --session <session-id>",
	],
	migrate: [
		"Backfill version metadata in recognized Amber JSON artifacts, or migrate",
		"legacy state and wiki naming to the Amber Protocol layout.",
		"",
		"Subcommands:",
		"  state        Merge legacy .harness state into .amber without overwriting.",
		"  wiki         Rename docs/wiki/agent/harness.md to amber.md and fix links.",
		"  (none)       Backfill recognized artifacts in .amber, routes, and workflow-packs.",
		"",
		"Options:",
		"  --archive-legacy  Rename .harness to a timestamped backup after clean state migration.",
		"  --dry-run         Preview changes without writing files (artifact mode).",
		"",
		"Examples:",
		"  amber migrate --target <path>",
		"  amber migrate state --target <path>",
		"  amber migrate wiki --target <path>",
	],
	execution: [
		"Validate execution boundaries and integration contracts.",
		"",
		"Subcommands:",
		"  validate-integration  Validate integration contract structure and hardstops.",
		"  readiness             Review plan for execution boundary violations.",
		"",
		"Examples:",
		"  amber execution validate-integration --contract path/to/contract.json --json",
		"  amber execution readiness --plan path/to/plan.md --target path/to/repo --json",
	],
	security: [
		"Run security governance checks in report-only mode.",
		"",
		"Subcommands:",
		"  audit [--target <dir>] [--output <file>]  Generate a security audit report without mutating target code.",
		"",
		"Examples:",
		"  amber security audit --target path/to/repo",
		"  amber security audit --target path/to/repo --output docs/security-audit.md",
	],
	feature: [
		"Add, list, remove features in feature_list.json, record verification evidence, and book feature paths.",
		"",
		"Subcommands:",
		"  add    --id <id> --title <text> [--priority <n>] [--area <area>] [--behavior <text>] [--verify <step>...] [--paths <p,p> | --path <p>]...",
		"         Register a new feature in feature_list.json. To be doctor-valid, pass --area, --behavior, and at least one --verify.",
		"  list",
		"         List all registered features with status.",
		"  remove --id <id>",
		"         Remove a feature from feature_list.json.",
		"  verify --feature <id> [--command <cmd>] [--result <text>] [--notes <text>]",
		"         Record verification evidence for a feature.",
		"  evidence --feature <id>",
		"         List all recorded evidence for a feature.",
		"  paths  --feature <id> [--path <p>]...",
		"         Book paths onto a feature (append-only, comma-splits each value, skips duplicates).",
		"         Without --path it inspects the feature's current paths read-only.",
		"",
		"Examples:",
		'  amber feature add --id F001 --title "User login" --priority 1 --area auth --behavior "User logs in with email" --verify "npm test" --paths src/auth',
		"  amber feature list",
		"  amber feature remove --id F001",
		'  amber feature verify --feature F001 --command "npm test" --result "42 passed"',
		"  amber feature evidence --feature F001",
		"  amber feature paths --target . --feature F001 --path src/new.js",
	],
	clean: [
		"Remove amber-generated files from the target repository (reverse of init).",
		"",
		"Options:",
		"  --dry-run    Preview which files would be removed without deleting them.",
		"",
		"Examples:",
		"  amber clean --target path/to/repo",
		"  amber clean --target path/to/repo --dry-run",
	],
	next: [
		"Infer the repo's position in the Amber lifecycle and print the next command to run (read-only).",
		"",
		"Lifecycle: [audit on existing] → init → governance report → … → verify → approve(--gate id) → handoff bundle → complete-check --strict → session complete → accept → learnings (when write-back triggers matched).",
		"Session evaluation matches complete-check --strict (executed verification + live handoff, not init scaffold).",
		"Existing projects: next recommends a read-only audit first; audit writes no file, so next advances straight to init.",
		"",
		"Options:",
		"  --target <dir>     Path to the target repository.",
		"  --feature <id>     Focus a specific feature's lifecycle.",
		"  --session <id>     Focus a specific session's lifecycle.",
		"  --objective <text> Give an objective; next suggests a matching route and",
		"                     workflow pack from route manifest metadata (read-only advisor).",
		"  --json             Emit the machine-readable envelope.",
		"",
		"With no --feature/--session, next auto-selects a focus and states which it chose.",
		"Without --objective, next is the pure lifecycle inference (unchanged).",
		"",
		"Examples:",
		"  amber next --target .",
		"  amber next --target . --feature F001",
		"  amber next --target . --session <session-id> --json",
		'  amber next --target . --objective "add payment integration"',
		'  amber next --target . --objective "fix login bug" --json',
	],
	explain: [
		"Look up Amber error codes, or regenerate the troubleshooting reference.",
		"",
		"Usage:",
		"  amber explain                 List every error code with its layer.",
		"  amber explain <code>          Show cause + fix for one code (bare suffix ok).",
		"  amber explain --markdown <p>  Write the error-code table to a standalone reference file.",
		"",
		"Examples:",
		"  amber explain",
		"  amber explain AMBER_E_FEATURE_NO_EVIDENCE",
		"  amber explain feature_no_evidence",
		"  amber explain --markdown docs/ERROR_CODES.md",
	],
	hooks: [
		"Manage the opt-in git pre-commit governance guard.",
		"",
		"Subcommands:",
		"  install [--warn-only] [--force]",
		"        Install a .git/hooks/pre-commit guard. --warn-only never blocks; --force overwrites a foreign hook.",
		"  uninstall   Remove the Amber guard (restores any backed-up hook).",
		"  status      Report whether the guard is installed and its mode.",
		"  check [--warn-only]",
		"        Run the governance checks now (this is what the hook invokes).",
		"",
		"  breadcrumb print [--format json|text]",
		"        Render the per-turn <amber-workflow-state> block (read-only; default json envelope).",
		"  breadcrumb install [--platform claude]",
		"        Opt-in merge of the breadcrumb command into .claude/settings.json hooks.UserPromptSubmit.",
		"  breadcrumb uninstall",
		"        Remove the Amber-managed breadcrumb entry; foreign entries are preserved.",
		"  breadcrumb status",
		"        Report whether the breadcrumb hook is installed (and echo its command).",
		"",
		"The breadcrumb is opt-in and never auto-installed (amber init does not add it).",
		"The hook only reads governance metadata; it never runs project build/test commands.",
		"Bypass once with: AMBER_SKIP_HOOKS=1 git commit ... (breadcrumb print is silent too).",
		"",
		"Examples:",
		"  amber hooks install --target .",
		"  amber hooks status --target .",
		"  amber hooks check --target .",
		"  amber hooks uninstall --target .",
		"  amber hooks breadcrumb print --target . --format text",
		"  amber hooks breadcrumb install --target . --platform claude",
		"  amber hooks breadcrumb status --target .",
	],
	governance: [
		"Create, inspect, and report governance controls for a target repository.",
		"",
		"Subcommands:",
		"  docs         Generate governance documents (CODE_OF_CONDUCT.md, CONTRIBUTING.md, GOVERNANCE.md).",
		"  evidence     Export governance evidence from sessions or tasks.",
		"  policy       Show governance policy (defaults and overrides).",
		"  audit        Generate comprehensive audit report with policy, sessions, and executions.",
		"  readiness    Report local governance readiness for higher-autonomy agent work.",
		"  report       Score the delivery loop and emit structured next actions.",
		"",
		"Examples:",
		"  amber governance docs --target path/to/repo",
		"  amber governance docs --target path/to/repo --json",
		"  amber governance evidence --session <id> --output evidence.md",
		"  amber governance evidence --task <id> --output evidence.md --json",
		"  amber governance policy --target path/to/repo",
		"  amber governance policy --target path/to/repo --json",
		"  amber governance audit --target path/to/repo --output audit.md",
		"  amber governance audit --target path/to/repo --output audit.md --since 2025-01-01",
		"  amber governance audit --target path/to/repo --output audit.md --json",
		"  amber governance readiness --target path/to/repo --json",
		"  amber governance readiness --target path/to/repo --output docs/governance-readiness.md",
		"  amber governance report --target path/to/repo",
		"  amber governance report --target path/to/repo --output docs/governance-report.md --confirm",
	],
	status: [
		"Show a curated one-line overview of repo state: git branch, Amber init status,",
		"install freshness, and scaffold/artifact/wiki drift counts. Read-only, thin",
		"front-door — does NOT duplicate doctor or maintenance inspect.",
		"",
		"Options:",
		"  --target <dir>     Path to the target repository.",
		"  --json             Emit machine-readable JSON.",
		"",
		"Examples:",
		"  amber status --target .",
		"  amber status --target . --json",
	],
	sync: [
		"Detect scaffold and artifact drift between installed files and shipped",
		"templates, and prepare distributed sync transport.",
		"",
		"amber sync (no subcommand): drift report between installed files and",
		"shipped templates. Dry-run by default (no changes made). With --execute,",
		"refreshes stale Amber-owned scaffold files and caches customized/",
		"ambiguous proposals.",
		"",
		"Subcommands:",
		"  envelope <pack|unpack|compat|validate>",
		"        Pack a governed artifact into a sync envelope under",
		"        .amber/sync/envelopes/, or validate/unpack/compat-check one.",
		"  session <run|push|pull|list|replay|conflicts|approve|ledger>",
		"        run: pull (admit + apply) then prepare transport. push: prepare",
		"        transport (report-only by default; the report lists envelopes,",
		"        affected paths, and proposed git operations as structured,",
		"        schema-governed ops — schemas/sync-transport-report.schema.json).",
		"        push --execute --yes: ADR-0020 Stage A (F041) governed local",
		"        commit — git add .amber/sync/envelopes + transport decision",
		"        records, then git commit, behind identity, policy, single-use",
		"        approval, and path-and-state confinement gates; every attempt",
		"        is recorded in the hash-chained transport ledger",
		"        (.amber/sync/transport/ledger.jsonl). git push is NEVER",
		"        executed. approve --reviewer <name>: record the single-use",
		"        transport approval. ledger: verify the transport ledger chain.",
		"        pull/replay: apply envelopes through the admission pipeline;",
		"        version/identity/generation/concurrent-edit refusals are",
		"        recorded in .amber/sync/conflicts.jsonl. list: show envelopes.",
		"        conflicts: show the conflict ledger.",
		"",
		"Options:",
		"  --target <dir>     Path to the target repository.",
		"  --execute          (drift refresh / sync session push) Refresh stale",
		"                     Amber-owned files, or run the governed transport",
		"                     commit (requires --yes + a prior approval).",
		"  --yes              Explicit confirmation for governed mutations",
		"                     (non-interactive invocations fail closed without it).",
		"  --json             Emit machine-readable JSON.",
		"",
		"Examples:",
		"  amber sync --target .",
		"  amber sync --target . --execute",
		"  amber sync session run --target .",
		"  amber sync session push --target .",
		"  amber sync session approve --reviewer <name> --target .",
		"  amber sync session push --execute --yes --target .",
		"  amber sync session ledger --target .",
		"  amber sync session conflicts --target .",
	],
	workflow: [
		"Assess agent-workflow effectiveness across five dimensions, separate from",
		"governance readiness. Read-only by default. See ADR-0008.",
		"",
		"Subcommands:",
		"  assess [--format json|markdown] [--output-dir <path>] [--no-sessions]",
		"        Produce a workflow-effectiveness report. Sessions (amber-native)",
		"        are included by default; --no-sessions emits a repository-only",
		"        baseline. --format json is the default output. --output-dir writes",
		"        the report to a file instead of stdout (assess only).",
		"  findings   (P2) List findings from a prior report.",
		"  plan --report <path> --finding <id> [--dry-run]",
		"        Bridge a finding to a dry-run amber plan draft (review before applying).",
		"  compare    (P3) Compare two reports across schema versions.",
		"",
		"Notes:",
		"  --json has no effect on workflow output; use --format to pick json/markdown.",
		"",
		"Examples:",
		"  amber workflow assess --target . --format json",
		"  amber workflow assess --target . --format markdown --output-dir docs/quality/",
		"  amber workflow assess --target . --no-sessions",
	],
	context: [
		"Govern the context write and load paths (ADR-0009/0010/0015): emit distillation",
		"contracts, judge agent output, verify page health, assemble task-scoped Loadouts,",
		"and report metrics. Amber never calls a model — an agent executes the contract.",
		"",
		"Subcommands:",
		"  request --page <id> [--title <t>] [--source <ref>] [--knowledge-kind <kind>] [--supersedes <id>] [--reason <r>] [--max-words <n>] [--force]",
		"        Scan evidence, bundle hash-bearing sources, write a distillation contract",
		"        to .amber/context/requests/. Sources are mutable by default; refs under",
		"        .amber/ and docs/adr/ are immutable (excerpt-snapshotted).",
		"        --source and --supersedes may repeat. --force supersedes an open request.",
		"  ingest --request <id> --payload <file.json>",
		"        Judge the agent's output: schema, citation completeness, payload-to-request",
		"        binding, request-owned scope, and source freshness. The matching request",
		"        is required for every accepted or no-change outcome.",
		'        A payload of {"outcome":"no-change"} rebases hashes without touching content.',
		"  verify [--json]",
		"        Health-check every page: stale / tampered / missing / obsolete / orphaned,",
		"        with AMBER_E_CONTEXT_* codes plus separately derived lifecycle and assurance.",
		"  list / show --page <id> / delete --page <id>",
		"        Inspect or manage accepted pages. list accepts --knowledge-kind <kind>.",
		"  refresh",
		"        Scan pages for source changes: cosmetic changes absorbed silently",
		"        (raw-only), real changes generate refresh requests.",
		"  stats [--window <n>] [--knowledge-kind <kind>]",
		"        Report over .amber/context/events.jsonl: filter rate, pass rate,",
		"        no-change rate, unknown-block share, assurance, and source density.",
		"        --window considers only the last <n> events (trend regression).",
		"  load --route <id> [--feature <id>] [--budget <n>] [--since <ts>] [--page <id>] [--knowledge-kind <kind>]",
		"        Assemble a task-scoped Loadout: three target-local Required Artifacts plus",
		"        a freshness-gated, budgeted selection of Context Pages, written to",
		"        .amber/context/loadouts/<route>[-<feature>].json.",
		"  preview --route <id> [--feature <id>] [--budget <n>] [--since <ts>] [--page <id>] [--knowledge-kind <kind>]",
		"        Assemble and print the same Loadout without writing files or events.",
		"  verify --loadout <file>",
		"        Re-check Required Artifacts and required-tier Pages (path and hash) right",
		"        before the agent loads them; missing, escaped, or changed inputs fail closed.",
		"  projection <status|rebuild>",
		"        Check or rebuild the disposable, hash-bound Context index projection.",
		"  benchmark --fixture <file> [--mode <smoke|full>]",
		"        Run deterministic Loadout quality metrics against a target-local fixture.",
		"  source-adapter --fixture <file> [--enable] [--allow-transcript]",
		"        Produce unaccepted Source Bundle candidates from the local fixture adapter.",
		"        Disabled by default; transcript sources require explicit opt-in and redaction.",
		"  retention [--older-than-days <n>]",
		"        Report age, reachability, lineage protection, and eligibility. Never deletes.",
		"",
		"Examples:",
		"  amber context request --target . --page governed-execution",
		"  amber context ingest --target . --request kd-2026-08-07-a3f1 --payload page.json --confirm",
		"  amber context verify --target . --json",
		"  amber context refresh --target .",
		"  amber context load --target . --route feature-standard --feature F015",
		"  amber context verify --target . --loadout .amber/context/loadouts/feature-standard-F015.json",
		"  amber context projection status --target .",
		"  amber context benchmark --target . --fixture fixtures/context-benchmark.json",
		"  amber context source-adapter --target . --fixture fixtures/context-source.json --enable",
		"  amber context retention --target . --older-than-days 90",
		"  amber context stats --target .",
	],
	memory: [
		"Govern the memory write-back pipeline (Governed Memory Layer): request, ingest,",
		"approve, book, and abandon memory entries, plus a read-only status projection.",
		"Amber never writes knowledge docs itself — humans curate MEMORY.md; Amber registers.",
		"",
		"Subcommands:",
		"  request    Produce a memory request (trigger / conversion / escape-hatch / ratification pre-nomination).",
		"  ingest     Mechanically admit request entries into the registry as proposals (all-or-nothing).",
		"  approve    Human, entry-level approval gate (--entry-id, --decision approve|reject, --reason).",
		"  book       Register a MEMORY.md surface hash and promote booked entries to active.",
		"             --ratify --claim <text> ratifies a human direct edit directly (γ-free).",
		"  abandon    Explicit human abandon of a request or entry (terminal ledger marker).",
		"  status     Read-only three-section projection (entries / gamma / alpha).",
		"",
		"Boundary: Amber detects, admits, and registers; humans curate MEMORY.md and approve.",
		"",
		"Examples:",
		"  amber memory status --target . --json",
		"  amber memory approve --target . --entry-id <id> --decision approve",
		"  amber memory abandon --target . --entry <id>",
	],
	projection: [
		"Manage rebuildable read-only projections (ADR-0019 D5; ADR-0012 amendment):",
		"Governance Graph, Governed Knowledge Base, and Visualization Workbench.",
		"Projections are derived from canonical Amber artifacts and are never canonical",
		"authority — rebuild() regenerates from canonical state at any time.",
		"",
		"Subcommands:",
		"  rebuild --type <governance-graph|knowledge-base|visualization-workbench>",
		"        Rebuild a projection from canonical artifacts (.amber/context/pages/).",
		"  status --type <type>  Report projection state: missing, current, or drifted.",
		"  list                  List all projections and their status.",
		"",
		"Examples:",
		"  amber projection rebuild --type governance-graph --target . --json",
		"  amber projection status --type knowledge-base --target . --json",
	],
	knowledge: [
		"Govern the Knowledge Base lifecycle (ADR-0009 amendment; baseline",
		"Governed Knowledge Base bounded context): admission with provenance",
		"and explicit authorization, immutable reviewable records, freshness,",
		"refresh, retirement, and reuse lineage. Queries are exact-scope and",
		"fail closed.",
		"",
		"Subcommands:",
		"  admit --page <id> --auth <authorization>",
		"        Admit a Knowledge Record from a canonical Context Page.",
		"  list                  List all Knowledge Records.",
		"  status --id <record-id>  Report record freshness (fresh/stale).",
		"  retire --id <record-id> --reason <text>",
		"        Retire a record explicitly.",
		"  query --scope <page-id>  Exact-scope query; unknown scope denied.",
		"",
		"Examples:",
		"  amber knowledge admit --page p1 --auth human-approve --target . --json",
		"  amber knowledge status --id <record-id> --target . --json",
	],
	phase: [
		"Manage Phase 0-4 gate evidence, promotion, and rollback (#168).",
		"Each phase gate requires complete deterministic evidence; promotion",
		"requires explicit authorization; rollback requires a checkpoint",
		"(destructive rollback is impossible) and records append-only lineage.",
		"",
		"Subcommands:",
		"  evidence --phase <phase-0..phase-4>  Show the gate evidence.",
		"  validate --phase <phase>  Check evidence completeness.",
		"  promote --phase <phase> --auth <authorization>",
		"        Promote with complete evidence + explicit authorization.",
		"  rollback --phase <phase> --checkpoint <id> [--reason <text>]",
		"        Roll back to a checkpoint (never destructive).",
		"  transitions              List append-only lineage.",
		"  invariants               Check invariant non-regression.",
		"",
		"Examples:",
		"  amber phase validate --phase phase-0 --target . --json",
		"  amber phase promote --phase phase-0 --auth human-approve --target . --json",
	],
	artifact: [
		"Admit and read Canonical Planning Artifacts (F049; ADR-0023).",
		"Each revision binds a human-readable Artifact Body to a",
		"machine-actionable Envelope in one atomic admission, settled through",
		"durable prepared/committed/aborted journal records. Only committed",
		"revisions are visible; history is append-only and immutable — there",
		"is no in-place mutation path for a committed revision.",
		"",
		"Registered Artifact Types (closed registry): intent, spec, plan. Each",
		"has a closed lifecycle of named transitions — intent: draft ->",
		"accepted via --transition accept; spec/plan: draft -> approved via",
		"--transition approve. A transition is admitted as a new revision",
		"(superseding the head); it never mutates a committed revision.",
		"",
		"Typed Trace lineage (versioned registry: refines, realizes,",
		"supersedes): a Spec must refine exactly one accepted Intent revision",
		"and a Plan must realize exactly one approved Spec revision (required",
		"planning lineage; a Plan cannot realize an Intent directly — the",
		"omitted-Spec policy). A generic or unregistered relation cannot",
		"satisfy required lineage, and Traces crossing scope boundaries are",
		"rejected.",
		"",
		"Subcommands:",
		"  admit --id <identity> --body <markdown>",
		"        Admit a new revision; returns the admission receipt.",
		"        --type <intent|spec|plan> selects the Artifact Type (default",
		"        intent). --expected-head <n> (or --supersedes-revision <n>)",
		"        declares the compare-and-swap precondition: admission fails",
		"        closed as a conflict when the head moved, so concurrent",
		"        editors cannot overwrite or duplicate a committed revision.",
		"        An exact duplicate retry (same Body, provenance, and expected",
		"        head) returns the original receipt with no new revision; the",
		"        same Body with different envelope content fails closed as an",
		"        idempotency conflict. --idempotency-key <key> is optional",
		"        retry metadata — reusing a key with different content fails",
		"        closed; keys never determine artifact identity.",
		"        --transition <name> applies a registered lifecycle transition",
		"        (the new revision carries the target state).",
		"        --trace <type>:<identity>[@<revision>] declares a typed Trace",
		"        (repeatable); the target type is derived from the registered",
		"        Trace contract, and the revision defaults to the target's",
		"        current committed head. --scope <tag> is an optional",
		"        confinement tag — Traces are confined to one scope.",
		"  show --id <identity> [--type <type>] [--revision <n>]",
		"        Show a committed revision.",
		"  list                  List committed artifacts (current revision each).",
		"",
		"Examples:",
		'  amber artifact admit --id intent/login-bug --body "# Intent: login bug" --target . --json',
		'  amber artifact admit --id intent/login-bug --body "..." --expected-head 1 --transition accept --target .',
		'  amber artifact admit --type spec --id spec/login-spec --body "..." --trace refines:intent/login-bug --target . --json',
		'  amber artifact admit --type plan --id plan/login-plan --body "..." --trace realizes:spec/login-spec --target . --json',
		"  amber artifact show --id intent/login-bug --revision 1 --target . --json",
		"  amber artifact list --target . --json",
	],
};

const OPTION_PATTERN = /--[a-z][a-z0-9-]*/g;

function optionsIn(text) {
	return [...new Set(String(text || "").match(OPTION_PATTERN) || [])];
}

function optionValuesIn(text) {
	const values = [];
	const pattern = /(--[a-z][a-z0-9-]*)\s+(?:<([^<>]+)>|([a-z0-9-]+(?:\|[a-z0-9-]+)+))/g;
	for (const match of String(text || "").matchAll(pattern)) {
		const choices = match[2] || match[3] || "";
		if (!choices.includes("|")) continue;
		values.push([match[1], choices.split("|")]);
	}
	return values;
}

function splitUsageAlternatives(line) {
	const alternatives = [];
	let start = 0;
	let squareDepth = 0;
	let angleDepth = 0;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === "[") squareDepth += 1;
		else if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
		else if (character === "<") angleDepth += 1;
		else if (character === ">") angleDepth = Math.max(0, angleDepth - 1);
		else if (
			character === "|" &&
			squareDepth === 0 &&
			angleDepth === 0 &&
			/\s/.test(line[index - 1] || "") &&
			/\s/.test(line[index + 1] || "")
		) {
			alternatives.push(line.slice(start, index).trim());
			start = index + 1;
		}
	}
	alternatives.push(line.slice(start).trim());
	return alternatives.filter(Boolean);
}

function intersectionOf(lists) {
	if (lists.length === 0) return [];
	return [...new Set(lists[0])].filter((value) => lists.every((list) => list.includes(value)));
}

function documentedSubcommands(command) {
	const discovered = new Set();
	const commandPattern = new RegExp(
		`amber\\s+${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:<([^>]+)>|([a-z][a-z0-9-]*))`,
		"g",
	);
	for (const line of commandUsageLine(command).split("\n").flatMap(splitUsageAlternatives)) {
		for (const match of line.matchAll(commandPattern)) {
			if (match[1]) {
				for (const choice of match[1].split("|")) discovered.add(choice);
			} else if (match[2]) discovered.add(match[2]);
		}
	}

	const help = COMMAND_DEFINITIONS[command]?.help;
	const lines = Array.isArray(help) ? help : [help];
	let inSubcommands = false;
	for (const line of lines) {
		const text = String(line || "");
		const trimmed = text.trim();
		if (["Subcommands:", "Actions:"].includes(trimmed)) {
			inSubcommands = true;
			continue;
		}
		if (inSubcommands && /^[A-Z][A-Za-z -]+:$/.test(trimmed)) {
			inSubcommands = false;
			continue;
		}
		if (!inSubcommands) continue;
		if (!/^ {2}\S/.test(text)) continue;
		for (const alternative of trimmed.split(/\s+\/\s+/)) {
			const match = alternative.match(/^([a-z][a-z0-9-]*)(?:\s|$)/);
			if (match) discovered.add(match[1]);
		}
	}
	return [...discovered].sort();
}

function requiredOptionsIn(syntax) {
	const required = [];
	let optionalDepth = 0;
	for (let index = 0; index < syntax.length; index += 1) {
		const character = syntax[index];
		if (character === "[") {
			optionalDepth += 1;
			continue;
		}
		if (character === "]") {
			optionalDepth = Math.max(0, optionalDepth - 1);
			continue;
		}
		if (optionalDepth !== 0 || syntax.slice(index, index + 2) !== "--") continue;
		const match = syntax.slice(index).match(/^--[a-z][a-z0-9-]*/);
		if (!match) continue;
		required.push(match[0]);
		index += match[0].length - 1;
	}
	return [...new Set(required)];
}

function invocationLines(command, subcommand) {
	const usageLines = commandUsageLine(command)
		.split("\n")
		.flatMap(splitUsageAlternatives)
		.map((line) => line.trim());
	const help = COMMAND_DEFINITIONS[command]?.help;
	const helpLines = (Array.isArray(help) ? help : [help])
		.flatMap((line) => String(line || "").split(/\s+\/\s+/))
		.map((line) => line.trim());
	const commandPrefix = `amber ${command}`;

	if (!subcommand) {
		const common = usageLines.filter((line) => {
			const normalized = line.replace(/^Usage:\s*/, "").trim();
			return normalized.startsWith(`${commandPrefix} --`) || normalized === commandPrefix;
		});
		return {
			common,
			specific: [],
			syntax: common,
			sharedOptions: [],
			sharedRequiredOptions: [],
		};
	}

	const pathTokens = subcommand.split(/\s+/).filter(Boolean);
	const matchesInvocation = (line) => {
		const normalized = line.replace(/^Usage:\s*/, "").trim();
		let remaining = normalized.startsWith(`${commandPrefix} `)
			? normalized.slice(commandPrefix.length).trim()
			: normalized;
		for (const token of pathTokens) {
			if (remaining === token || remaining.startsWith(`${token} `)) {
				remaining = remaining.slice(token.length).trim();
				continue;
			}
			const choices = remaining.match(/^<([^>]+)>/);
			if (!choices || !choices[1].split("|").includes(token)) return false;
			remaining = remaining.slice(choices[0].length).trim();
		}
		return true;
	};
	const usageSpecific = usageLines.filter(matchesInvocation);
	const helpSpecific = helpLines.filter(matchesInvocation);
	const specific = [...usageSpecific, ...helpSpecific];
	const common = [];
	const sharedOptions = intersectionOf(usageLines.map(optionsIn));
	const sharedRequiredOptions = intersectionOf(usageLines.map(requiredOptionsIn));
	const syntax = [
		...usageSpecific,
		...helpSpecific.filter(
			(line) =>
				!line
					.replace(/^Usage:\s*/, "")
					.trim()
					.startsWith("amber "),
		),
	];
	return { common, specific, syntax, sharedOptions, sharedRequiredOptions };
}

// Project the human-facing Command Definition into the static invocation
// contract consumed by generators and other non-executing adapters. This keeps
// accepted options beside the CLI's own help/usage source instead of adding a
// second skill-only command or flag allowlist.
function commandInvocationContract(command, subcommand = null) {
	if (!COMMAND_DEFINITIONS[command]) return null;
	const lines = invocationLines(command, subcommand);
	const allowedOptions = [
		...new Set([
			...lines.sharedOptions,
			...[...lines.common, ...lines.specific].flatMap(optionsIn),
		]),
	];
	const requiredOptions = [
		...new Set([...lines.sharedRequiredOptions, ...lines.syntax.flatMap(requiredOptionsIn)]),
	];
	const valueEntries = [...lines.common, ...lines.specific].flatMap(optionValuesIn);
	const allowedValues = {};
	for (const [option, values] of valueEntries) {
		allowedValues[option] = [...new Set([...(allowedValues[option] || []), ...values])].sort();
	}
	return Object.freeze({
		command,
		subcommand,
		recognized: subcommand ? lines.specific.length > 0 : lines.common.length > 0,
		allowedOptions: Object.freeze(allowedOptions.sort()),
		requiredOptions: Object.freeze(requiredOptions.sort()),
		allowedValues: Object.freeze(
			Object.fromEntries(
				Object.entries(allowedValues)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([option, values]) => [option, Object.freeze(values)]),
			),
		),
	});
}

const DEFAULT_SUMMARY = "Run Amber Protocol command.";

const COMMAND_OUTPUT = {
	init: {
		dryRun: true,
		usage:
			"Usage: amber init --target <repo> [--with-wiki] [--skip-detection] [--json] [--dry-run]",
	},
	audit: { summary: true },
	wiki: { dryRun: true },
	plan: {
		dryRun: true,
		usage: "Usage: amber plan --target <repo> --feature <id> --title <title> [--json] [--dry-run]",
	},
	team: {
		usage: [
			"Usage: amber team <inspect|install|pin|update|rollback> --target <repo> [--json]",
			"       amber team install --target <repo> --version <version> --preset <preset> [--dry-run] [--json]",
			"       amber team update --target <repo> --version <version> [--dry-run|--confirm] [--json]",
		].join("\n"),
	},
	gate: {
		usage: "Usage: amber gate --target <repo> --plan <relative-plan-path> [--confirm] [--json]",
	},
	review: { usage: "Usage: amber review --target <repo> --plan <relative-plan-path> [--json]" },
	accept: {
		usage:
			"Usage: amber accept --target <repo> --plan <relative-plan-path> [--session <id>] [--strict] [--json]",
	},
	learnings: {
		usage:
			"Usage: amber learnings --target <repo> [--feature <id>] [--reviewed --owner <id>] [--surface <path>] [--json]",
	},
	"break-loop": {
		usage:
			'Usage: amber break-loop --target <repo> --issue <n> --title "<title>" --recurrence <n> | amber break-loop validate --target <repo> --file <path> [--json]',
	},
	handoff: {
		usage: [
			"Usage: amber handoff --target <repo> [--json]",
			"       amber handoff bundle --target <repo> [--output-dir <dir>] [--json]",
			"       amber handoff validate --target <repo> [--bundle-dir <dir>] [--json]",
		].join("\n"),
	},
	explain: { usage: "Usage: amber explain [<code>] [--markdown <path>] [--json]" },
	hooks: {
		usage:
			"Usage: amber hooks <check|install|uninstall|status> --target <repo> | amber hooks breadcrumb <print|install|uninstall|status> --target <repo> [--format json|text] [--platform claude] [--json]",
	},
	loop: {
		usage:
			"Usage: amber loop <inspect|recommend|run|approve|verify-ledger|record|status|validate-loop> [--target <repo>] [--file <pack>] [--contract <id>] [--dry-run|--execute] [--reviewer <name>] [--json]",
	},
	ledger: {
		usage:
			"Usage: amber ledger <export|seal|verify-anchoring> --target <repo> [--format json|csv|otlp-json] [--home loops|routes|sessions|all] [--out <path>] [--reviewer <name>] [--json]",
	},
	governance: {
		usage: [
			"Usage: amber governance <docs|evidence|policy|audit|readiness|report|standards|rules> [--target <repo>] [--json]",
			"       amber governance report --target <repo> [--output <file> --confirm] [--json]",
			"       amber governance rules <init|inspect|check> --target <repo> [--command <cmd>]",
		].join("\n"),
	},
	route: {
		usage:
			"Usage: amber route <list|inspect|validate|test|approve|verify-ledger> <route-id> [--target <repo>] [--execute] [--stage <name>] [--reviewer <name>] [--json]",
	},
	session: {
		usage:
			"Usage: amber session <start|status|list|abort|continue|complete-check|verify|approve|verify-ledger> [--target <repo>] [--session <id>] [--goal <goal>] [--json]",
	},
	status: { usage: "Usage: amber status --target <repo> [--json]" },
	drift: {
		usage:
			"Usage: amber drift --target <repo> [--scope artifact|wiki|scaffold|all] [--format text|json|gh-annotations] [--no-fail] [--json]",
	},
	sync: {
		usage:
			"Usage: amber sync --target <repo> [--execute] [--json] | amber sync envelope <pack|unpack|compat|validate> ... | amber sync session <run|push|pull|list|replay|conflicts> --target <repo> [--json]",
	},
	workflow: {
		usage: [
			"Usage: amber workflow <assess|findings|plan|compare> --target <repo>",
			"       amber workflow assess --target <repo> [--format json|markdown] [--output-dir <path>] [--no-sessions]",
			"       amber workflow findings --target <repo> --report <path>",
			"       amber workflow plan --target <repo> --report <path> --finding <id>",
			"       amber workflow compare --target <repo> --baseline <path> --current <path>",
		].join("\n"),
	},
	next: {
		usage:
			"Usage: amber next --target <repo> [--feature <id>] [--session <id>] [--objective <text>] [--json]",
	},
	memory: {
		usage:
			"Usage: amber memory <request|ingest|approve|book|abandon|status> [--target <repo>] [--json]",
	},
	artifact: {
		usage: [
			"Usage: amber artifact admit --target <repo> --id <identity> --body <markdown> [--type <intent|spec|plan>] [--expected-head <n>] [--supersedes-revision <n>] [--idempotency-key <key>] [--transition <name>] [--trace <type>:<identity>[@<revision>]] [--scope <tag>] [--json]",
			"       amber artifact show --target <repo> --id <identity> [--type <type>] [--revision <n>] [--json]",
			"       amber artifact list --target <repo> [--json]",
		].join("\n"),
	},
};

const DEFAULT_OUTPUT = Object.freeze({ dryRun: false, summary: false, usage: null });
const COMMANDS = Object.freeze([
	"init",
	"audit",
	"wiki",
	"doctor",
	"handoff",
	"plan",
	"gate",
	"review",
	"accept",
	"learnings",
	"break-loop",
	"pack",
	"profile",
	"task",
	"result",
	"agent",
	"team",
	"maintenance",
	"adoption",
	"loop",
	"ledger",
	"route",
	"session",
	"status",
	"drift",
	"sync",
	"migrate",
	"governance",
	"execution",
	"security",
	"feature",
	"clean",
	"next",
	"explain",
	"hooks",
	"workflow",
	"context",
	"memory",
	"projection",
	"knowledge",
	"phase",
	"artifact",
]);
const TIER_BY_COMMAND = {
	init: "core",
	audit: "core",
	wiki: "core",
	doctor: "core",
	handoff: "core",
	plan: "core",
	gate: "core",
	review: "core",
	accept: "core",
	learnings: "core",
	"break-loop": "core",
	loop: "core",
	ledger: "core",
	route: "core",
	session: "core",
	governance: "core",
	feature: "core",
	context: "core",
	memory: "core",
	projection: "core",
	knowledge: "core",
	phase: "core",
	artifact: "core",
	next: "journey",
	profile: "deprecated",
	task: "deprecated",
	result: "deprecated",
	agent: "deprecated",
	team: "deprecated",
	adoption: "deprecated",
	pack: "expert",
	maintenance: "expert",
	status: "expert",
	drift: "expert",
	sync: "expert",
	migrate: "expert",
	execution: "expert",
	security: "expert",
	clean: "expert",
	explain: "expert",
	hooks: "expert",
	workflow: "expert",
};
const COMMAND_TIERS = Object.freeze(
	Object.fromEntries(COMMANDS.map((name) => [name, TIER_BY_COMMAND[name]])),
);
const VALID_TIERS = new Set(["core", "journey", "deprecated", "expert"]);
const commandNames = new Set(COMMANDS);
const missingHelp = COMMANDS.filter((name) => !Object.hasOwn(COMMAND_HELP, name));
const orphanedHelp = Object.keys(COMMAND_HELP).filter((name) => !commandNames.has(name));
const orphanedOutput = Object.keys(COMMAND_OUTPUT).filter((name) => !commandNames.has(name));
const missingTiers = COMMANDS.filter((name) => !VALID_TIERS.has(COMMAND_TIERS[name]));
const orphanedTiers = Object.keys(COMMAND_TIERS).filter((name) => !commandNames.has(name));
if (
	missingHelp.length > 0 ||
	orphanedHelp.length > 0 ||
	orphanedOutput.length > 0 ||
	missingTiers.length > 0 ||
	orphanedTiers.length > 0
) {
	throw new Error(
		`Invalid Command definitions: missing help [${missingHelp.join(", ")}], orphaned help [${orphanedHelp.join(", ")}], orphaned output [${orphanedOutput.join(", ")}], missing tier [${missingTiers.join(", ")}], orphaned tier [${orphanedTiers.join(", ")}].`,
	);
}
const COMMAND_DEFINITIONS = Object.freeze(
	Object.fromEntries(
		COMMANDS.map((name) => [
			name,
			Object.freeze({
				name,
				tier: COMMAND_TIERS[name],
				typed: TYPED_COMMAND_NAMES.has(name),
				help: COMMAND_HELP[name],
				output: Object.freeze({ ...DEFAULT_OUTPUT, ...(COMMAND_OUTPUT[name] || {}) }),
			}),
		]),
	),
);
const DEFAULT_COMMANDS = Object.freeze(
	COMMANDS.filter((name) => ["journey", "core"].includes(COMMAND_DEFINITIONS[name].tier)),
);

function commandSummary(command) {
	const help = COMMAND_DEFINITIONS[command]?.help;
	if (help === undefined) {
		return DEFAULT_SUMMARY;
	}
	return Array.isArray(help) ? help.join("\n") : help;
}

function commandUsageLine(command) {
	const definition = COMMAND_DEFINITIONS[command];
	if (!definition) return null;
	if (definition.output.usage) return definition.output.usage;
	const options = ["[--json]"];
	if (definition.output.dryRun) options.push("[--dry-run]");
	if (definition.output.summary) options.push("[--summary]");
	return `Usage: amber ${command} --target <repo> ${options.join(" ")}`;
}

function bindCommandHandlers(handlers) {
	validateCommandRegistry();
	const handlerNames = Object.keys(handlers);
	const missing = COMMANDS.filter((name) => typeof handlers[name] !== "function");
	const orphaned = handlerNames.filter((name) => !COMMAND_DEFINITIONS[name]);
	if (missing.length > 0 || orphaned.length > 0) {
		throw new Error(
			`Invalid Command registration: missing handlers [${missing.join(", ")}], orphaned handlers [${orphaned.join(", ")}].`,
		);
	}
	return Object.freeze(
		Object.fromEntries(
			COMMANDS.map((name) => [
				name,
				Object.freeze({ definition: COMMAND_DEFINITIONS[name], handler: handlers[name] }),
			]),
		),
	);
}

function validateCommandRegistry({
	definitions = COMMAND_DEFINITIONS,
	capabilities = COMMAND_CAPABILITIES,
} = {}) {
	const undefinedCommands = [
		...new Set(
			Object.keys(capabilities)
				.map((key) => key.split("/")[0])
				.filter((command) => !definitions[command]),
		),
	].sort();
	if (undefinedCommands.length > 0) {
		throw new Error(
			`Invalid Command registry: capabilities reference undefined commands [${undefinedCommands.join(", ")}].`,
		);
	}
	const capabilityCommands = new Set(Object.keys(capabilities).map((key) => key.split("/")[0]));
	const typedDefinitions = new Set(
		Object.values(definitions)
			.filter((definition) => definition.typed === true)
			.map((definition) => definition.name),
	);
	const missingCapabilities = [...typedDefinitions]
		.filter((command) => !capabilityCommands.has(command))
		.sort();
	const untypedCapabilities = [...capabilityCommands]
		.filter((command) => !typedDefinitions.has(command))
		.sort();
	if (missingCapabilities.length > 0 || untypedCapabilities.length > 0) {
		throw new Error(
			`Invalid Command registry: typed parity mismatch; missing capabilities [${missingCapabilities.join(", ")}], untyped capabilities [${untypedCapabilities.join(", ")}].`,
		);
	}
	return true;
}

validateCommandRegistry();

const TYPED_COMMANDS = Object.freeze(
	new Set(
		Object.values(COMMAND_DEFINITIONS)
			.filter((definition) => definition.typed === true)
			.map((definition) => definition.name),
	),
);
const KNOWN_UNTYPED_SUBCOMMANDS = Object.freeze(
	new Set([
		"session/list",
		"session/abort",
		"session/continue",
		"session/complete-check",
		"session/complete",
		"session/verify-ledger",
		"route/inspect",
		"route/validate",
		"route/approve",
		"route/verify-ledger",
		"governance/audit",
		"governance/docs",
		"governance/evidence",
		"governance/policy",
		"governance/rules",
		"governance/standards",
		"governance/readiness",
		"loop/inspect",
		"loop/run",
		"loop/approve",
		"loop/verify-ledger",
		"loop/record",
		"loop/status",
		"loop/validate-loop",
		"ledger/verify-anchoring",
		"ledger/verify",
		"memory/request",
		"memory/ingest",
		"memory/book",
		"context/load",
	]),
);

function capabilityFor(command, subcommand) {
	return COMMAND_CAPABILITIES[capabilityKey(command, subcommand)] || null;
}

function isGovernedCommand(command) {
	return TYPED_COMMANDS.has(command);
}

function knownSubcommands(command) {
	const prefix = `${command}/`;
	const registered = [
		...new Set([...Object.keys(COMMAND_CAPABILITIES), ...KNOWN_UNTYPED_SUBCOMMANDS]),
	]
		.filter((key) => key.startsWith(prefix))
		.map((key) => key.slice(prefix.length));
	return [...new Set([...registered, ...documentedSubcommands(command)])].sort();
}

module.exports = {
	COMMANDS,
	DEFAULT_COMMANDS,
	COMMAND_TIERS,
	COMMAND_DEFINITIONS,
	TYPED_COMMANDS,
	KNOWN_UNTYPED_SUBCOMMANDS,
	commandSummary,
	commandUsageLine,
	commandInvocationContract,
	capabilityFor,
	isGovernedCommand,
	knownSubcommands,
	validateCommandRegistry,
	bindCommandHandlers,
};
