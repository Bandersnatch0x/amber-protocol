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
	"eval",
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
		"        Rebuild from canonical artifacts: context pages (.amber/context/pages/),",
		"        plus committed Canonical Artifact revisions for the Governance Graph.",
		"  status --type <type>  Report projection state: missing, current, or drifted.",
		"  strict-query --scope <node> --checkpoint <sha256> --projection-version 1",
		"        --limit <n> --sort id --depth <0|1> [--cursor <cursor>]",
		"        Strict Governance Graph read: exact scope/checkpoint/version,",
		"        expiring cursor, and stale dependency refusal.",
		"  invalidate --subject <scope> --dependency <type:identity[@revision]> --reason <text>",
		"        Append a scoped staleness receipt; history is never rewritten.",
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
		"  graph                 Emit the deterministic knowledge graph (F059):",
		"        three layers (decision: adr/artifact; knowledge: wiki/memory/",
		"        architecture; implementation: feature), four verbs (supersedes,",
		"        builds-on, references, describes), dead-anchor drift findings.",
		"        Read-only, schema-validated (knowledge-graph.schema.json),",
		"        byte-identical on recompute over an unchanged tree.",
		"  context-manifest      Render and validate the F059 43-row context-page manifest.",
		"  context-sync [--refresh]",
		"        Idempotently drive context request/ingest/verify for the manifest and rebuild",
		"        the knowledge-base projection. Existing unmanaged pages are never overwritten.",
		"  context-review-sample [--limit <n>] [--output <file>]",
		"        Emit a bounded ADR/wiki/architecture sample with source hashes, page ids,",
		"        verification verdicts, and excerpts for the mandatory HITL checkpoint.",
		"",
		"Examples:",
		"  amber knowledge admit --page p1 --auth human-approve --target . --json",
		"  amber knowledge status --id <record-id> --target . --json",
		"  amber knowledge graph --target . --json",
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
		"Registered Artifact Types (closed registry): intent, spec, plan,",
		"decision, gate, policy, eval, eval-result. intent, spec, and plan",
		"each have a closed lifecycle of",
		"named transitions — intent: draft -> accepted via --transition",
		"accept; spec/plan: draft -> approved via --transition approve. A",
		"transition is admitted as a new revision (superseding the head); it",
		"never mutates a committed revision. A decision records an",
		"authority act by a Principal (F050): its lifecycle is a single",
		"recorded state (no transitions — an amended Decision is a new",
		"revision of the same identity, admitted fresh), and every Decision",
		"revision binds the acting Principal, verified against the",
		"Principal registry at admission time (amber principal). A gate is a",
		"Gate Contract (F050 #228): draft -> active via --transition",
		"activate, active -> retired via --transition retire; its",
		"machine-actionable content rides the extensions carrier under the",
		"gate namespace (--extension gate.require=...), and `amber gate",
		"evaluate` is that content's deterministic consumer. A policy is a",
		"Policy Contract (F050 #230): draft -> active via --transition",
		"activate, active -> retired via --transition retire; its",
		"deny-wins content rides under extensions.policy and `amber policy",
		"evaluate` is that content's strict-consumption consumer. Eval",
		"definitions use the same draft -> active -> retired lifecycle under",
		"the eval type; eval-result artifacts are recorded immutable suite",
		"outcomes produced by `amber eval admit` and then referenced by normal",
		"replayable Evidence receipts.",
		"",
		"Typed Trace lineage (versioned registry: refines, realizes,",
		"supersedes, decides): a Spec must refine exactly one accepted Intent",
		"revision and a Plan must realize exactly one approved Spec revision",
		"(required planning lineage; a Plan cannot realize an Intent",
		"directly — the omitted-Spec policy). A generic or unregistered",
		"relation cannot satisfy required lineage, and Traces crossing",
		"scope boundaries are rejected. A Decision must decide exactly one",
		"committed revision of a registered type: the decides Trace",
		"qualifies for any registered target type, so it DECLARES the type",
		"itself — --trace decides:<targetType>:<identity>[@<revision>].",
		"",
		"Every read is a verification read: show and list replay the settlement",
		"journal, sweep both halves of every committed pair, cross-check the",
		"committed record's content hash, and walk the trace graph for cycles.",
		"Tampered state fails closed with stable corruption codes instead of",
		"being served; one corrupt artifact fails the whole listing. A crashed",
		"admission (dangling prepared record) is settled deterministically as",
		"aborted — journal-only recovery that never rewrites a Body or Envelope",
		"and stays invisible to reads.",
		"",
		"Subcommands:",
		"  admit --id <identity> --body <markdown>",
		"        Admit a new revision; returns the admission receipt.",
		"        --type <intent|spec|plan|decision|gate> selects the Artifact Type",
		"        (default intent). --expected-head <n> (or --supersedes-revision <n>)",
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
		"        current committed head. A Trace whose contract cannot derive",
		"        the target type (decides) declares it instead:",
		"        --trace decides:<targetType>:<identity>[@<revision>].",
		"        --scope <tag> is an optional confinement tag — Traces are",
		"        confined to one scope.",
		"        --extension <ns>.<key>=<value> carries opaque extension data",
		"        in the Envelope's reserved extensions carrier (repeatable);",
		"        the value is JSON when it parses and a verbatim string",
		"        otherwise, the namespace/key split is on the first dot, and",
		"        a namespace or key shadowing a core Envelope field fails",
		"        closed as an extension collision.",
		"        --decision-kind <acceptance|approval|review> and --principal",
		"        <id> bind a Decision admission (required for --type decision,",
		"        rejected for every other type): the Principal is verified",
		"        against the registry — registered, unrevoked, inside its",
		"        validity window — and snapshotted into the Envelope. An",
		"        acceptance or approval Decision is a human-only authority",
		"        slot: binding a service Principal fails closed, and only a",
		"        review Decision may be carried by a service identity.",
		"  show --id <identity> [--type <type>] [--revision <n>]",
		"        Show a committed revision (verification read: fails closed on",
		"        corrupt settlement, an orphaned pair half, or a cyclic trace).",
		"  list                  List committed artifacts (current revision",
		"        each; a verification read of the whole store — one corrupt",
		"        artifact fails the listing).",
		"",
		"Examples:",
		'  amber artifact admit --id intent/login-bug --body "# Intent: login bug" --target . --json',
		'  amber artifact admit --id intent/login-bug --body "..." --expected-head 1 --transition accept --target .',
		'  amber artifact admit --type spec --id spec/login-spec --body "..." --trace refines:intent/login-bug --target . --json',
		'  amber artifact admit --type plan --id plan/login-plan --body "..." --trace realizes:spec/login-spec --target . --json',
		'  amber artifact admit --id intent/login-bug --body "..." --extension acme.ticket=INT-42 --target . --json',
		'  amber artifact admit --type decision --id decision/login-accepted --body "..." --decision-kind acceptance --principal alice@example.com --trace decides:spec:spec/login-spec --target . --json',
		'  amber artifact admit --type gate --id gate/login-gate --body "# Gate: login readiness" --extension gate.require=\'[{"evidenceType":"spec/login@2","assurance":"observed","threshold":{"value":80,"comparator":"ge"}}]\' --extension gate.owners=\'["alice@example.com"]\' --target . --json',
		"  amber artifact show --id intent/login-bug --revision 1 --target . --json",
		"  amber artifact list --target . --json",
	],
	principal: [
		"Register, inspect, and revoke Principals — the humans and service",
		"identities that can act with authority in this repository (F050).",
		"Every Decision artifact (amber artifact admit --type decision) binds",
		"its acting Principal, verified against this registry at admission",
		"time: registered, unrevoked, and inside its validity window.",
		"",
		"The registry is governed state, not incidental metadata: an",
		"append-only event ledger under .amber/principals/ (registered and",
		"revoked events; no in-place mutation path) protected by a",
		"tamper-evident hash chain (each event binds the previous event's",
		"hash; a fold over an edited ledger fails closed as corruption),",
		"serialized by a short-lived registry write lock (a second writer",
		"in flight fails closed as AMBER_E_PRINCIPAL_REGISTRY_LOCK; a",
		"lock older than 30 s is reclaimed as stale), fail-closed on",
		"corruption and on schema versions this reader does not support,",
		"with a size ceiling (AMBER_PRINCIPAL_MAX_REGISTRY_BYTES; default",
		"1 MiB; an append that would exceed it is refused before any",
		"durable state is touched). A principal id is registered at most",
		"once and revocation is terminal — a revoked id cannot be",
		"re-registered (revocation would otherwise be laundersable).",
		"",
		"Subcommands:",
		"  register --id <id> --kind <human|service>",
		"        Register a Principal. --role, --membership, --capability,",
		"        --scope, --issuer, and the validity window",
		"        --valid-from/--valid-to (ISO-8601 with an explicit zone;",
		"        half-open [from, to)) are optional qualifications; the",
		"        window is evaluated against the admission-time clock when",
		"        a Decision binds the Principal.",
		"  show --id <id>        Show one Principal's record and current",
		"        status: active | revoked | expired | not-yet-valid.",
		"  list                  List every registered Principal with its",
		"        status, in first-registration order.",
		"  revoke --id <id> [--reason <text>]",
		"        Revoke a Principal terminally. A revoked Principal can no",
		"        longer bind new Decisions; already-committed Decisions",
		"        keep their recorded Principal snapshots.",
		"",
		"Examples:",
		"  amber principal register --target . --id alice@example.com --kind human --role tech-lead --scope team-a --json",
		"  amber principal register --target . --id ci-bot --kind service --capability deploy --valid-to 2027-01-01T00:00:00Z --json",
		"  amber principal show --target . --id alice@example.com --json",
		"  amber principal list --target . --json",
		'  amber principal revoke --target . --id ci-bot --reason "rotated credentials" --json',
	],
	eval: [
		"Run deterministic instruction-surface Evals (F050 Evidence; F058).",
		"Version 2 contains four Evals: MCP tool descriptions, QA contract-surface",
		"model independence, the Context quote boundary, and breadcrumb authenticity.",
		"`eval run` is report-only; `eval admit` is the explicit F050 admission path",
		"that writes canonical Eval definition/result artifacts and a replayable",
		"Evidence receipt. Eval is not Approval and cannot widen execution authority.",
		"",
		"Subcommands:",
		"  run [--suite instruction-surface]  Replay the suite against --target.",
		"        Exit 0 when every Eval passes; exit 1 when any Eval has findings.",
		"  admit --producer <principal>  Admit the suite definition/result artifacts",
		"        and record replayable Evidence through the normal receipt ledger.",
		"        Optional: --definition-id, --outcome-id, --evidence-id, --subject.",
		"  list                  List registered Eval identities in the suite.",
		"  show --id <evalId>    Show one Eval definition.",
		"",
		"Examples:",
		"  amber eval run --target . --json",
		"  amber eval admit --target . --producer ci-runner --evidence-id evidence/eval-run --yes --json",
		"  amber eval list --target .",
		"  amber eval show --id eval.instruction-surface.mcp-tool-description --target .",
	],
	evidence: [
		"Record and independently verify Evidence receipts, each binding the",
		"four-level Assurance contract (F050): unavailable | observed |",
		"replayable | verified. A receipt records what actually ran — identity,",
		"producer (a registry-verified Principal snapshot), scope, subject,",
		"inputs, tools, environment, time, status, and outputs — so a reviewer",
		"can assess the claim, not just consume it.",
		"",
		"The ledger is governed state, not incidental output: an append-only",
		"event ledger under .amber/evidence/ (recorded and verified events; no",
		"in-place mutation path) protected by a tamper-evident hash chain (a",
		"fold over an edited ledger fails closed as corruption), serialized by",
		"a short-lived write lock (a second writer in flight fails closed as",
		"AMBER_E_EVIDENCE_REGISTRY_LOCK; a lock older than 30 s is reclaimed",
		"as stale), with a size ceiling (AMBER_EVIDENCE_MAX_REGISTRY_BYTES;",
		"default 1 MiB; an append that would exceed it is refused before any",
		"durable state is touched).",
		"",
		'A claim can never impersonate verification: "verified" is not',
		"recordable (AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN), only an",
		"independent registered Principal — one whose id differs from the",
		"producer's — can append a verification event, and a producer naming",
		"itself as verifier fails closed (AMBER_E_EVIDENCE_SELF_VERIFICATION).",
		"A replayable receipt must name what it replayed via --replay-of",
		"(deterministic replay provenance; AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT",
		"otherwise). Effective assurance and the verifier list are derived at",
		"read time — a later verification changes what a read returns without",
		"rewriting any event. An evidence id is recorded exactly once; a re-run",
		"is a new receipt.",
		"",
		"Subcommands:",
		"  record --id <id> --producer <principal> --assurance <level> --subject <what>",
		"        Record one receipt. --scope, --input, --tool, --env <key=value>,",
		"        --outputs, --status <pass|fail> (required — the receipt states",
		"        its run outcome explicitly), and --replay-of (required for",
		"        replayable, forbidden otherwise) qualify it.",
		"  verify --id <id> --verifier <principal>",
		"        Append one independent verification event; promotes the",
		"        effective assurance to verified. A verification is recorded",
		"        exactly once per verifier (AMBER_E_EVIDENCE_ALREADY_VERIFIED).",
		"  show --id <id>        Show one derived record (effective assurance,",
		"        verifiers).",
		"  list                  List every derived record in first-recorded",
		"        order.",
		"",
		"Examples:",
		"  amber evidence record --target . --id evidence/run-42 --producer ci-runner --assurance replayable --replay-of eval.instruction-surface --subject eval.instruction-surface --status pass --tool node --env os=linux --outputs 'all evals pass' --json",
		"  amber evidence verify --target . --id evidence/run-42 --verifier reviewer-alice --json",
		"  amber evidence show --target . --id evidence/run-42 --json",
		"  amber evidence list --target . --json",
	],
	approval: [
		"Grant, revoke, consume, and inspect Approvals — the human",
		"authorizations a Decision settles under (F050): scoped, expiring,",
		"revocable, and single-use. One authorization can never be replayed.",
		"",
		"The registry is governed state, not incidental metadata: an",
		"append-only event ledger under .amber/approvals/ (granted, revoked,",
		"and consumed events; no in-place mutation path) protected by a",
		"tamper-evident hash chain (a fold over an edited ledger fails closed",
		"as corruption), serialized by a short-lived write lock (a second",
		"writer in flight fails closed as AMBER_E_APPROVAL_REGISTRY_LOCK; a",
		"lock older than 30 s is reclaimed as stale), fail-closed on",
		"corruption and on schema versions this reader does not support, with",
		"a size ceiling (AMBER_APPROVAL_MAX_REGISTRY_BYTES; default 1 MiB; an",
		"append that would exceed it is refused before any durable state is",
		"touched).",
		"",
		"An Approval is a human-only authorization slot: the approver (and the",
		"revoker) are verified against the Principal registry — registered,",
		"unrevoked, inside their validity window — and must be human; the",
		"verified snapshot is frozen into the event. The validity window is",
		"half-open [validAt, validUntil) under a recorded clock source and the",
		"no-tolerance skew policy: at exactly validUntil the authorization is",
		"already expired. validAt (when the window opens) and recordedAt (when",
		"the record was written) are stored as distinct fields.",
		"",
		"Consumption is atomic with the authorized Decision's settlement: the",
		"consume writer admits one Decision artifact (decisionKind approval,",
		"principal = the approval's frozen approver) and appends the consumed",
		"event binding that Decision's identity and revision — if the",
		"admission fails, no consumed event is written and the authorization",
		"stays unconsumed. A second consumer (racing or serial) fails closed",
		"as AMBER_E_APPROVAL_ALREADY_CONSUMED; consumption is terminal, so a",
		"consumed approval can no longer be revoked. When the approval carries",
		"a scope, the Decision is admitted with that same scope. Derived status",
		"(granted | revoked | consumed | expired) is computed at read time,",
		"never stored.",
		"",
		"Subcommands:",
		"  grant --id <id> --approver <human-principal> --subject <what>",
		"        Grant one authorization. --valid-until <iso> is the required",
		"        expiry instant (ISO-8601; a date-time must carry an explicit",
		"        zone); --scope <tag> is an optional confinement tag.",
		"  revoke --id <id> --revoker <human-principal>",
		"        Revoke terminally (revocation is a human act; history is",
		"        never rewritten).",
		"  consume --id <id> --decision-identity <identity> --body <markdown>",
		"        Settle the authorization as one approval Decision.",
		"        --trace decides:<type>:<identity> names the artifact revision",
		"        the Decision decides (the Decision admission's required",
		"        lineage); --scope must match the approval's scope when it",
		"        carries one.",
		"  show --id <id>        Show one derived record (status, decision",
		"        binding when consumed).",
		"  list                  List every derived record in grant order.",
		"",
		"Examples:",
		"  amber approval grant --target . --id approval/login-42 --approver alice@example.com --subject spec/login@2 --valid-until 2027-01-31 --scope team-a --json",
		"  amber approval consume --target . --id approval/login-42 --decision-identity decision/login-approved --body 'Approved after review.' --trace decides:spec:spec/login --json",
		"  amber approval revoke --target . --id approval/login-42 --revoker alice@example.com --json",
		"  amber approval show --target . --id approval/login-42 --json",
		"  amber approval list --target . --json",
	],
	gate: [
		"Evaluate Gates and inspect their immutable outcomes (F050): the",
		"reviewable contracts admission is decided against — never hidden",
		"weights or model confidence.",
		"",
		"The legacy plan gate is still here: `amber gate --plan <path>",
		"[--confirm]` validates that a plan is tied to feature state and has",
		"user confirmation, or confirms it — a bare `amber gate` with no",
		"evaluate/show/list action routes there unchanged.",
		"",
		"A Gate Contract is a canonical artifact of the registered `gate` type,",
		"admitted through the existing artifact surface: `amber artifact admit",
		"--type gate ... --extension gate.require='[...]'`. Its machine-actionable",
		"content rides the Envelope's extensions carrier under the `gate`",
		"namespace: gate.require (required — a non-empty array of requirement",
		"objects { evidenceType, subject?, assurance?, threshold?, maxAgeMs? }),",
		"gate.anyOf (bounded explicit alternatives: at most 8 sets of at most 8",
		"entries), gate.owners, gate.expires, gate.dependsOn,",
		'gate.maxEvidenceAgeMs, and gate.failBehavior (v1 is deny-only: "deny").',
		"The gate lifecycle is draft -> active via --transition activate,",
		"active -> retired via --transition retire. The evaluator is the",
		"contract's first shape consumer: a malformed contract fails closed",
		"with AMBER_E_GATE_CONTRACT_INVALID (or",
		"AMBER_E_GATE_UNSUPPORTED_COMPARATOR /",
		"AMBER_E_GATE_FAIL_BEHAVIOR_UNSUPPORTED for those specific verdicts).",
		"",
		"Evaluation is deterministic: allOf over gate.require plus bounded",
		"explicit anyOf (>=1 alternative set fully satisfied when anyOf is",
		"declared). A requirement is satisfied only by an Evidence receipt",
		"that joins on the receipt's subject (the requirement's evidenceType,",
		"scoped to the evaluation subject or the requirement's own subject",
		"override), passed (status pass), at or above the required Assurance",
		"level (unavailable < observed < replayable < verified), fresh at the",
		"evaluation clock (age <= maxAgeMs — the requirement's maxAgeMs, else",
		"the gate's maxEvidenceAgeMs; no bound means always fresh), and — when",
		"a threshold is declared — whose LAST output parses and compares true",
		"under the registered comparator (numeric: eq/ne/lt/le/gt/ge over a",
		"strict base-10 decimal string; string: eq/ne/contains exact;",
		'version ordering: lt/le/gt/ge dot-numeric, where "1.2" < "1.10";',
		'eq/ne on string values are exact, so "1.2" != "1.2.0"). An',
		"expired gate (gate.expires at or before the clock, no-tolerance)",
		"refuses to run: AMBER_E_GATE_EXPIRED, no outcome appended.",
		"",
		"Every completed evaluation appends one immutable `evaluated` event to",
		"the hash-chained outcome ledger under .amber/gates/outcomes.jsonl —",
		"a pass is never silently revised, and a fail is recorded (verdict",
		'"fail") rather than dropped: the record IS the audit trail. An',
		"in-place edit breaks the chain and fails every read closed as",
		"AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT. The ledger is serialized by a",
		"short-lived write lock (AMBER_E_GATE_OUTCOME_REGISTRY_LOCK; a lock",
		"older than 30 s is reclaimed as stale) with a size ceiling",
		"(AMBER_GATE_MAX_OUTCOME_BYTES, default 1 MiB). Every outcome records",
		'its clock source ("injected" with --now, "system" otherwise) and',
		"the fixed skew policy no-tolerance.",
		"",
		"Subcommands:",
		"  evaluate --gate <identity> --subject <subject>",
		"        Evaluate one gate against the recorded Evidence and append",
		"        the outcome. --revision <n> selects the committed gate",
		"        revision (default: the current committed head); --now <iso>",
		"        injects the evaluation clock. A FAIL verdict is a completed",
		"        evaluation, not a command error: the outcome is appended and",
		"        returned with exit code 0.",
		"  show --index <n> | --gate <identity> [--subject <subject>]",
		"        Show one outcome record: by 0-based ledger line (--index),",
		"        or the latest matching --gate (narrowed by --subject).",
		"  list [--gate <identity>] [--subject <subject>] [--verdict <pass|fail>]",
		"        List outcome records in append order, optionally filtered.",
		"",
		"Examples:",
		"  amber gate evaluate --target . --gate gate/login-gate --subject spec/login@2 --json",
		"  amber gate evaluate --target . --gate gate/login-gate --subject spec/login@2 --revision 2 --now 2027-01-31T09:00:00Z --json",
		"  amber gate show --target . --index 0 --json",
		"  amber gate list --target . --gate gate/login-gate --verdict fail --json",
	],
	policy: [
		"Evaluate deny-wins Policy Contracts and inspect immutable Policy Outcomes (F050).",
		"Policy Contracts are canonical artifacts of type `policy`; their machine-actionable",
		"content rides the Envelope extensions carrier under the `policy` namespace.",
		"Strict consumption requires org and tenant policies, with optional repo/play/gate",
		"layers. Lower layers can only tighten the stack: deny rules accumulate,",
		"separation of duties cannot be relaxed, unsupported allow/relax keys fail",
		"closed, and delegations may only be declared by org/tenant policy within",
		"the delegator Principal's own capability and scope.",
		"",
		"Subcommands:",
		"  evaluate --org-policy <id> --tenant-policy <id> --subject <subject>",
		"        --submitter <principal> --capability <capability> --approval <id>",
		"        --gate-outcome-index <n> [--repo-policy <id>] [--play-policy <id>]",
		"        [--gate-policy <id>] [--delegator <principal>] [--now <iso>]",
		"        Resolve the policy stack, consumed Approval, passing Gate Outcome,",
		"        Evidence actors, and optional direct delegation, then append a",
		"        pass/deny Policy Outcome.",
		"  show --index <n>",
		"        Show one Policy Outcome by its 0-based ledger line.",
		"  list [--subject <subject>] [--submitter <principal>]",
		"        [--capability <capability>] [--verdict <pass|deny>]",
		"        List Policy Outcomes in append order, optionally filtered.",
		"",
		"Examples:",
		"  amber policy evaluate --target . --org-policy policy/org --tenant-policy policy/tenant --repo-policy policy/repo --gate-policy policy/login --subject spec/login@2 --submitter dev@example.com --capability release --approval approval/login-42 --gate-outcome-index 0 --json",
		"  amber policy show --target . --index 0 --json",
		"  amber policy list --target . --verdict deny --json",
	],
	adapter: [
		"Register read-only Adapters, record immutable read receipts, and prepare migration candidates (F051).",
		"Adapters declare source owner, supported record types/versions, exact scope,",
		"identity mapping, freshness, and read-only permissions. Pre-Cutover reads",
		"never mutate Canonical Artifacts; migration candidates become normal Artifact admission payloads",
		"and receipts record fresh/stale/unavailable/conflict/unmapped with exact source bytes/digest.",
		"Shadow comparison writes bounded coverage receipts with source and target hashes.",
		"Cutover is a separate human Decision scoped by artifact type, scope, and generation,",
		"bound to resolved comparison evidence, a registered human owner's independent",
		"confirmation, and rollback evidence naming a recorded Evidence receipt;",
		"post-cutover source divergence appends a Finding and degrades reads and",
		"migration candidates.",
		"",
		"Subcommands:",
		"  register --id <id> --adapter-owner <owner> --record-type <type>",
		"        --record-version <v> --scope <scope> --identity-map <strategy>",
		"        --freshness-ms <n> [--allow-path <prefix>] [--adapter-version <v>]",
		"  read --id <id> --source <path> --record-id <id> [--record-type <type>] [--record-version <v>] [--expected-source-hash <hash>] [--scope <scope>]",
		"  candidate --id <id> --source <path> --record-id <id> [--record-type <type>] [--record-version <v>] [--expected-source-hash <hash>] [--scope <scope>]",
		"  compare --id <id> --fixture <json> [--scope <scope>]",
		"  comparisons [--id <adapter-id>] [--scope <scope>]",
		"  cutover --id <id> --cutover-id <id> --artifact-type <type> --generation <gen>",
		"        --comparison-index <n> --decision-identity <identity> --revision <n>",
		"        --confirmed-by <owner> --rollback-evidence <ref> [--scope <scope>]",
		"  rollback --cutover-id <id> --decision-identity <identity> --revision <n>",
		"        --confirmed-by <owner> --evidence <ref>",
		"  cutovers [--id <adapter-id>] [--scope <scope>]",
		"  show --id <id>",
		"  list",
		"  receipts [--id <adapter-id>]",
		"",
		"Examples:",
		"  amber adapter register --target . --id adapter/legacy --adapter-owner legacy-team --record-type legacy-ticket --record-version v1 --scope F051 --identity-map path --freshness-ms 86400000 --allow-path legacy --json",
		"  amber adapter read --target . --id adapter/legacy --source legacy/item.json --record-id legacy-1 --record-version v1 --json",
		"  amber adapter candidate --target . --id adapter/legacy --source legacy/item.json --record-id legacy-1 --record-version v1 --json",
		"  amber adapter compare --target . --id adapter/legacy --fixture fixtures/adapter-shadow.json --json",
		"  amber adapter cutover --target . --id adapter/legacy --cutover-id cutover/legacy-gen-1 --artifact-type intent --generation gen-1 --comparison-index 0 --decision-identity decision/cutover-legacy --revision 1 --confirmed-by legacy-team --rollback-evidence evidence/rollback-plan --json",
	],
	runner: [
		"Register controlled Runners, their closed operation capabilities, and governed",
		"execution requests (F052). A Runner is an EXTERNAL executor identity: id, version,",
		"integrity digest, owner, and closed capabilities (declared effects, path scope",
		"shape, timeout bound, credential requirement, rollback declaration) — never",
		"command text, and Amber never spawns anything (ADR-0022). Registration is a",
		"human-approved governance mutation binding a single-use committed human Decision;",
		"unknown runner, version drift, and integrity mismatch fail closed. A request is",
		"the closed declaration of one intended execution: risk derives from capability",
		"facts through a versioned pinned policy (callers carry no risk field), semantic",
		"refusals are recorded as immutable denied events, and authorization consumes a",
		"single-use F050 Approval whose subject binds exactly one requestHash and",
		"environment (runner-request:<environment>:<requestHash>). Versioned environment",
		"profiles gate admission: development requires an isolated scope, staging admits",
		"allowlisted deploy/rollback only with rollback rehearsal Evidence, production",
		"grants preparation/diagnosis/runbook.* only; credentials are opaque short-lived",
		"handles (never secret values), and the rehearsing party cannot approve its own",
		"rehearsal. Execution settles durably: prepare binds one registered executor to",
		"one authorized request, the external Runner submits one result receipt, and",
		"Amber derives the outcome (attempted|timed-out|failed|committed|rolled-back) —",
		"non-zero exit, signal, timeout, and scope escape fail explicitly, and sandbox",
		"assurance, credential assurance, and result integrity stay separate fields.",
		"",
		"Subcommands:",
		"  register --id <id> --runner-version <v> --integrity <sha256:...>",
		"        --runner-owner <owner> --decision-identity <identity> --revision <n>",
		"  capability --id <runner-id> --runner-version <v> --capability <name>",
		"        --capability-version <v>",
		"        --effect <effect> [--effect <effect> ...] [--path-prefix <prefix> ...]",
		"        --timeout-ms <n> --credential <none|scoped> --rollback <declaration>",
		"        --decision-identity <identity> --revision <n>",
		"  request --id <runner-id> --runner-version <v> --capability <name>",
		"        --capability-version <v> --repository <repo> --path <path> [--path <path> ...]",
		"        --environment <development|staging|production> [--scope <scope>]",
		"        [--input-hash <sha256:...> ...] --timeout-ms <n> --effect <effect> [...]",
		"        --credential <none|scoped> [--credential-handle <id> --credential-purpose <p>",
		"        --credential-scope <s> --credential-expires <iso>] [--rehearsal <evidence-id>]",
		"        --rollback <declaration>",
		"  authorize --request-hash <sha256:...> --approval <id>",
		"        --decision-identity <identity> --body <markdown> [--trace decides:<type>:<identity>]",
		"        [--scope <scope>]",
		"  requests [--environment <env>] [--status <requested|authorized|denied>]",
		"  prepare --request-hash <sha256:...> --id <runner-id> --runner-version <v>",
		"        --integrity <sha256:...>",
		"  settle --request-hash <sha256:...> --receipt <json-file>",
		"  abort --request-hash <sha256:...> --reason <text>",
		"  rolled-back --request-hash <sha256:...> --evidence <evidence-id> --reason <text>",
		"  executions [--status <attempted|timed-out|failed|committed|rolled-back>]",
		"  show --id <id>",
		"  list",
		"",
		"Examples:",
		"  amber runner register --target . --id runner/ci --runner-version 1.0.0 --integrity sha256:<64-hex> --runner-owner platform-team --decision-identity decision/runner-ci --revision 1 --json",
		"  amber runner capability --target . --id runner/ci --runner-version 1.0.0 --capability deploy.staging-web --capability-version 1 --effect deploy --path-prefix deploy/staging --timeout-ms 600000 --credential scoped --rollback runbook/staging-rollback --decision-identity decision/cap-deploy --revision 1 --json",
		"  amber runner request --target . --id runner/ci --runner-version 1.0.0 --capability deploy.staging-web --capability-version 1 --repository repo/main --path deploy/staging/web --environment staging --timeout-ms 300000 --effect deploy --credential scoped --rollback runbook/staging-rollback --json",
		'  amber runner authorize --target . --request-hash sha256:<64-hex> --approval approval/deploy-42 --decision-identity decision/deploy-42 --body "# Authorize" --trace decides:intent:intent/deploy --json',
		"  amber runner show --target . --id runner/ci --json",
	],
	release: [
		"Prepare governed release candidates (F053 T1).",
		"A candidate immutably binds one exact Change (commit + committed Artifact",
		"revisions), recorded Evidence, per-axis Review findings (logic, security,",
		"spec compliance — Evidence references, never approvals), the target",
		"environment, a versioned release Policy artifact, one registered F052",
		"Runner capability pin, the credentials class, and a rollback plan into a",
		"canonical releaseHash. Preparation is a governance write: it never deploys",
		"and touches no git state; any drift invalidates downstream authorization.",
		"",
		"Subcommands:",
		"  prepare --id <release-id> --commit <40-hex> --change-artifact <type>:<identity>@<rev>",
		"        [--change-artifact ...] --evidence-item <evidence-id> [--evidence-item ...]",
		"        --review-logic <evidence-id> --review-security <evidence-id>",
		"        --review-spec <evidence-id> --environment <development|staging|production>",
		"        --release-policy <identity>@<rev> --runner <runner-id> --runner-version <v>",
		"        --capability <name> --capability-version <v> --credential <none|scoped>",
		"        --rollback <evidence-id>",
		"  show --id <release-id>",
		"  list [--environment <env>]",
		"",
		"Examples:",
		"  amber release prepare --target . --id release/web-42 --commit <40-hex> --change-artifact spec:spec/login@2 --evidence-item evidence/test-run --review-logic evidence/review-logic --review-security evidence/review-security --review-spec evidence/review-spec --environment staging --release-policy policy/release@1 --runner runner/ci --runner-version 1.0.0 --capability deploy.staging-web --capability-version 1 --credential scoped --rollback evidence/rollback-plan --json",
		"  amber release show --target . --id release/web-42 --json",
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
		usage: [
			"Usage: amber gate <evaluate|show|list> --target <repo> [--json]  (F050 Gate Contracts)",
			"       amber gate evaluate --target <repo> --gate <identity> --subject <subject> [--revision <n>] [--now <iso>] [--json]",
			"       amber gate show --target <repo> (--index <n> | --gate <identity> [--subject <subject>]) [--json]",
			"       amber gate list --target <repo> [--gate <identity>] [--subject <subject>] [--verdict <pass|fail>] [--json]",
			"       amber gate --target <repo> --plan <relative-plan-path> [--confirm] [--json]  (legacy plan gate)",
		].join("\n"),
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
			"Usage: amber artifact admit --target <repo> --id <identity> --body <markdown> [--type <intent|spec|plan|decision|gate|policy>] [--expected-head <n>] [--supersedes-revision <n>] [--idempotency-key <key>] [--transition <name>] [--trace <type>:<identity>[@<revision>]] [--scope <tag>] [--extension <ns>.<key>=<value>] [--decision-kind <acceptance|approval|review>] [--principal <id>] [--json]",
			"       amber artifact show --target <repo> --id <identity> [--type <type>] [--revision <n>] [--json]",
			"       amber artifact list --target <repo> [--json]",
		].join("\n"),
	},
	principal: {
		usage: [
			"Usage: amber principal register --target <repo> --id <id> --kind <human|service> [--role <role>] [--membership <org>] [--capability <capability>] [--scope <scope>] [--valid-from <iso>] [--valid-to <iso>] [--issuer <name>] [--json]",
			"       amber principal show --target <repo> --id <id> [--json]",
			"       amber principal list --target <repo> [--json]",
			"       amber principal revoke --target <repo> --id <id> [--reason <text>] [--json]",
		].join("\n"),
	},
	eval: {
		usage: [
			"Usage: amber eval <run|list|show|admit> --target <repo> [--json]",
			"       amber eval run --target <repo> [--suite instruction-surface] [--json]",
			"       amber eval admit --target <repo> --producer <principal> [--suite instruction-surface] [--definition-id <identity>] [--outcome-id <identity>] [--evidence-id <id>] [--subject <subject>] --yes [--json]",
			"       amber eval list --target <repo> [--json]",
			"       amber eval show --id <evalId> --target <repo> [--json]",
		].join("\n"),
	},
	evidence: {
		usage: [
			"Usage: amber evidence <record|verify|show|list> --target <repo> [--json]",
			"       amber evidence record --target <repo> --id <id> --producer <principal> --assurance <unavailable|observed|replayable> --subject <what> [--scope <scope>] [--input <text>] [--tool <text>] [--env <key=value>] [--outputs <text>] --status <pass|fail> [--replay-of <definition>] [--json]",
			"       amber evidence verify --target <repo> --id <id> --verifier <principal> [--json]",
			"       amber evidence show --target <repo> --id <id> [--json]",
			"       amber evidence list --target <repo> [--json]",
		].join("\n"),
	},
	approval: {
		usage: [
			"Usage: amber approval <grant|revoke|consume|show|list> --target <repo> [--json]",
			"       amber approval grant --target <repo> --id <id> --approver <human-principal> --subject <what> --valid-until <iso> [--scope <scope>] [--json]",
			"       amber approval revoke --target <repo> --id <id> --revoker <human-principal> [--json]",
			"       amber approval consume --target <repo> --id <id> --decision-identity <identity> --body <markdown> [--trace decides:<type>:<identity>[@<revision>]] [--scope <scope>] [--json]",
			"       amber approval show --target <repo> --id <id> [--json]",
			"       amber approval list --target <repo> [--json]",
		].join("\n"),
	},
	policy: {
		usage: [
			"Usage: amber policy <evaluate|show|list> --target <repo> [--json]",
			"       amber policy evaluate --target <repo> --org-policy <id> --tenant-policy <id> --subject <subject> --submitter <principal> --capability <capability> --approval <id> --gate-outcome-index <n> [--repo-policy <id>] [--play-policy <id>] [--gate-policy <id>] [--delegator <principal>] [--now <iso>] [--json]",
			"       amber policy show --target <repo> --index <n> [--json]",
			"       amber policy list --target <repo> [--subject <subject>] [--submitter <principal>] [--capability <capability>] [--verdict pass|deny] [--json]",
		].join("\n"),
	},
	adapter: {
		usage: [
			"Usage: amber adapter <register|read|candidate|compare|comparisons|cutover|rollback|cutovers|show|list|receipts> --target <repo> [--json]",
			"       amber adapter register --target <repo> --id <id> --adapter-owner <owner> --record-type <type> --record-version <version> --scope <scope> --identity-map <strategy> --freshness-ms <ms> [--allow-path <prefix>] [--adapter-version <version>] [--json]",
			"       amber adapter read --target <repo> --id <id> --source <path> --record-id <id> [--record-type <type>] [--record-version <version>] [--expected-source-hash <sha256:...>] [--scope <scope>] [--json]",
			"       amber adapter candidate --target <repo> --id <id> --source <path> --record-id <id> [--record-type <type>] [--record-version <version>] [--expected-source-hash <sha256:...>] [--scope <scope>] [--json]",
			"       amber adapter compare --target <repo> --id <id> --fixture <json> [--scope <scope>] [--json]",
			"       amber adapter comparisons --target <repo> [--id <adapter-id>] [--scope <scope>] [--json]",
			"       amber adapter cutover --target <repo> --id <id> --cutover-id <id> --artifact-type <type> --generation <gen> --comparison-index <n> --decision-identity <identity> --revision <n> --confirmed-by <owner> --rollback-evidence <ref> [--scope <scope>] [--json]",
			"       amber adapter rollback --target <repo> --cutover-id <id> --decision-identity <identity> --revision <n> --confirmed-by <owner> --evidence <ref> [--json]",
			"       amber adapter cutovers --target <repo> [--id <adapter-id>] [--scope <scope>] [--json]",
			"       amber adapter show --target <repo> --id <id> [--json]",
			"       amber adapter list --target <repo> [--json]",
			"       amber adapter receipts --target <repo> [--id <adapter-id>] [--json]",
		].join("\n"),
	},
	release: {
		usage: [
			"Usage: amber release <prepare|show|list> --target <repo> [--json]",
			"       amber release prepare --target <repo> --id <release-id> --commit <40-hex> --change-artifact <type>:<identity>@<rev> --evidence-item <evidence-id> --review-logic <evidence-id> --review-security <evidence-id> --review-spec <evidence-id> --environment development|staging|production --release-policy <identity>@<rev> --runner <runner-id> --runner-version <version> --capability <name> --capability-version <version> --credential none|scoped --rollback <evidence-id> [--json]",
			"       amber release show --target <repo> --id <release-id> [--json]",
			"       amber release list --target <repo> [--environment <env>] [--json]",
		].join("\n"),
	},
	runner: {
		usage: [
			"Usage: amber runner <register|capability|request|authorize|requests|prepare|settle|abort|rolled-back|executions|show|list> --target <repo> [--json]",
			"       amber runner register --target <repo> --id <id> --runner-version <version> --integrity <sha256:...> --runner-owner <owner> --decision-identity <identity> --revision <n> [--json]",
			"       amber runner capability --target <repo> --id <runner-id> --runner-version <version> --capability <name> --capability-version <version> --effect <effect> [--effect <effect>] [--path-prefix <prefix>] --timeout-ms <n> --credential none|scoped --rollback <declaration> --decision-identity <identity> --revision <n> [--json]",
			"       amber runner request --target <repo> --id <runner-id> --runner-version <version> --capability <name> --capability-version <version> --repository <repo-id> --path <path> --environment development|staging|production --timeout-ms <n> --effect <effect> --credential none|scoped --rollback <declaration> [--scope <scope>] [--input-hash <sha256:...>] [--credential-handle <id>] [--credential-purpose <purpose>] [--credential-scope <scope>] [--credential-expires <iso>] [--rehearsal <evidence-id>] [--json]",
			"       amber runner authorize --target <repo> --request-hash <sha256:...> --approval <id> --decision-identity <identity> --body <markdown> [--trace <decides:...>] [--scope <scope>] [--json]",
			"       amber runner requests --target <repo> [--environment <env>] [--status requested|authorized|denied] [--json]",
			"       amber runner prepare --target <repo> --request-hash <sha256:...> --id <runner-id> --runner-version <version> --integrity <sha256:...> [--json]",
			"       amber runner settle --target <repo> --request-hash <sha256:...> --receipt <json-file> [--json]",
			"       amber runner abort --target <repo> --request-hash <sha256:...> --reason <text> [--json]",
			"       amber runner rolled-back --target <repo> --request-hash <sha256:...> --evidence <evidence-id> --reason <text> [--json]",
			"       amber runner executions --target <repo> [--status attempted|timed-out|failed|committed|rolled-back] [--json]",
			"       amber runner show --target <repo> --id <id> [--json]",
			"       amber runner list --target <repo> [--json]",
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
	"policy",
	"adapter",
	"runner",
	"release",
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
	"principal",
	"eval",
	"evidence",
	"approval",
]);
const TIER_BY_COMMAND = {
	init: "core",
	audit: "core",
	wiki: "core",
	doctor: "core",
	handoff: "core",
	plan: "core",
	gate: "core",
	policy: "core",
	adapter: "core",
	runner: "core",
	release: "core",
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
	principal: "core",
	eval: "core",
	evidence: "core",
	approval: "core",
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
		"eval/list",
		"eval/show",
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
