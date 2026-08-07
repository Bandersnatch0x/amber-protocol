# CLI Reference

Complete command reference for Amber Protocol CLI.

## Global Options

```bash
--target <path>   # Project root directory
--json            # Output JSON format
--dry-run         # Preview without making changes where supported (init, wiki, plan, team install/update, loop run)
--help            # Show command help
```

## Feature & Plan Commands

The governed delivery flow starts here: register a feature, plan a slice, gate the plan, review it, then accept it after the session completes. `amber next` walks this lifecycle step by step.

### feature

Add, list, remove features in `feature_list.json` and record verification evidence:

```bash
node scripts/amber.js feature add --id F001 --title "User login" --priority 1 --area auth --behavior "User logs in with email and receives a session token." --verify "npm test" --paths src/auth --target .
node scripts/amber.js feature list --target .
node scripts/amber.js feature remove --id F001 --target .
node scripts/amber.js feature verify --feature F001 --command "npm test" --result "42 passed" --target .
node scripts/amber.js feature evidence --feature F001 --target .
```

### plan

Create a feature-linked vertical-slice plan from a registered feature:

```bash
node scripts/amber.js plan --target . --feature F001 --title "Small slice" [--dry-run]
```

**Options:**
- `--feature`: Feature id (e.g. F001) — must already exist in `feature_list.json` (required)
- `--title`: Short human-readable title for the plan (required)
- `--dry-run`: Preview without writing files

### gate

Validate that a plan is tied to feature state and has user confirmation, or confirm it:

```bash
node scripts/amber.js gate --target . --plan docs/plans/F001-small-slice.md            # gate-check
node scripts/amber.js gate --target . --plan docs/plans/F001-small-slice.md --confirm  # set User Confirmation
```

Plan-level and session-level approvals are two layers: `gate --confirm` edits the plan's User Confirmation field, while `session approve` records `gate_passed` in the session timeline. Both layers must be satisfied for `complete-check --strict` to pass.

### review

Review a plan against static Amber standards and release-readiness checks:

```bash
node scripts/amber.js review --target . --plan docs/plans/F001-small-slice.md
```

### accept

Accept a reviewed plan and append an Amber evolution record:

```bash
node scripts/amber.js accept --target . --plan docs/plans/F001-small-slice.md
node scripts/amber.js accept --target . --plan docs/plans/F001-small-slice.md --session <session-id>
```

**Options:**
- `--plan`: Relative path to the plan to accept
- `--session`: Optional session id; prints completion-check status as a warning
- `--strict`: With `--session`, turn missing completion-check evidence into errors

With `--session`, the plan's `Feature:` header must match the session's feature — a definite mismatch blocks the accept.

## Session Commands

### session start

Start a new session:

```bash
node scripts/amber.js session start \
  --target . \
  --goal "implement user authentication" \
  --route feature-standard \
  [--budget 100000] \
  [--worktree] \
```

**Options:**
- `--goal`: Session objective (required)
- `--route`: Route ID (default: feature-standard)
- `--budget`: Token limit (default: from route)
- `--worktree`: Use git worktree isolation
- `--mode autonomous`: refused in V1 by ADR-0001/0005; use the default governed session flow.

### session status

Show session status:

```bash
node scripts/amber.js session status [<session-id>]
```

Shows current session if ID omitted.

### session list

List all sessions:

```bash
node scripts/amber.js session list --target .
```

Output:
```
abc123def [completed] feature-standard — implement auth
```

### session abort

Abort running session:

```bash
node scripts/amber.js session abort <session-id> --target .
```

### session continue

Continue paused session:

```bash
node scripts/amber.js session continue [<session-id>] --target .
```

Resumes from last checkpoint.

### session verify / approve / verify-ledger

Record human-run verification evidence and gate approvals, and verify the session's tamper-evident
ledger. `verify` and `approve` also mirror the event into a hash-chain ledger
(`.amber/sessions/<id>/ledger.jsonl`) so a later edit to a recorded result is detectable.

```bash
node scripts/amber.js session verify   --session <id> --command "npm test" --result pass  --target .
node scripts/amber.js session approve  --session <id> [--gate <gate-id>]                  --target .
node scripts/amber.js session verify-ledger --session <id>                                --target .
```

`verify-ledger` recomputes the session ledger's hash chain and reports `AMBER_E_LEDGER_TAMPERED` on
any broken link.

## Route Commands

### route list

List available routes:

```bash
node scripts/amber.js route list --target .
```

### route inspect

Show route details:

```bash
node scripts/amber.js route inspect <route-id> --target .
```

### route validate

Validate route file:

```bash
node scripts/amber.js route validate <route-file> --target .
```

### route test

Print a route's dry-run stage sequence, OR — since [ADR-0003](adr/0003-governance-gated-execution.md)
Phase 3 — execute one `command`-type stage under the four governance gates.

```bash
# dry-run stage sequence (default; no execution)
node scripts/amber.js route test feature-standard --target .

# governed execution of one command stage (needs a prior `route approve`; runs in an isolated worktree)
node scripts/amber.js route test feature-standard --execute --stage verify --target .
```

`--execute --stage <name>` runs only `command`-type stages' `target`, after the policy gate, an
unconsumed approval, git-worktree isolation, and a tamper-evident ledger entry. Non-`command` stages
refuse `--execute`.

### route approve / verify-ledger

Record a human approval authorizing ONE governed execution of a route stage, then verify the
route-scoped hash-chain ledger.

```bash
node scripts/amber.js route approve feature-standard --stage verify --reviewer your-name --target .
node scripts/amber.js route verify-ledger feature-standard --target .
```

## Governance Commands

### governance report

Score the repository's product delivery loop and emit structured next actions.

```bash
node scripts/amber.js governance report --target .
node scripts/amber.js governance report --target . --output docs/quality/amber-governance-report.md
```

The report covers the product loop `Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle`, with scores for governance, evidence, continuity, safety, and maintenance.

### governance docs

Generate governance documents:

```bash
node scripts/amber.js governance docs --target .
```

Creates:
- `.amber/governance/POLICY.md`
- `.amber/governance/BOUNDARIES.md`
- `.amber/governance/AUDIT_LOG.md`

### governance evidence

Export session evidence:

```bash
# Single session
node scripts/amber.js governance evidence \
  --session <id> \
  --output evidence.md \
  --target .

# Single execution
node scripts/amber.js governance evidence \
  --task <id> \
  --output execution-evidence.md \
  --target .
```

### governance policy

Inspect governance policy:

```bash
node scripts/amber.js governance policy --target .
```

Shows policy violations and recommendations.

### governance audit

Generate audit report:

```bash
node scripts/amber.js governance audit \
  --target . \
  [--since 2024-01-01] \
  --output audit-report.md
```

### governance standards

Honest, read-only coverage report of Amber's governance controls against the OWASP Top 10 for
Agentic Applications 2026 (ASI01–ASI10). Amber is a static layer, so most ASI risks are reported as
`out-of-scope` (runtime-only) rather than overclaimed as covered. Each risk's `present` flag reflects
whether its *specific* control is actually deployed in the target repo (a deny rule for ASI02, an
allow rule for ASI04, a non-empty hash-chain ledger for ASI06, an approval record for ASI09) — not
just a label.

The `init` subcommand scaffolds the declarative security-governance standard
(`standards/security-governance.json`) the report maps against — idempotent, it skips when the file
already exists. The starter ships via `templates/`, so it is written from the Amber install, not
read from the target's own `standards/`.

```bash
# scaffold the security-governance standard (idempotent; skips if present)
node scripts/amber.js governance standards init --target .

# read-only coverage report
node scripts/amber.js governance standards --target . --framework owasp-agentic
node scripts/amber.js governance standards --target . --json
```

### governance rules

Scaffold and inspect the declarative command policy (`.amber/governance/rules.json`) that the
governed-execution policy gate uses. All subcommands are read-only or idempotent scaffolding.

```bash
# write safe defaults (deny-wins / default-deny); skips if rules.json already exists
node scripts/amber.js governance rules init --target .

# show the active policy surface (rules.json, or built-in defaults if absent)
node scripts/amber.js governance rules inspect --target .

# try a command against the policy without executing it (read-only verdict)
node scripts/amber.js governance rules check --target . --command "rm -rf /tmp/x"
```

`rules check` uses the **same policy surface as `governed-runner`** (`evaluateGovernedPolicy`):
un-removable built-in denies for destructive commands and shell composition (`&&`, `|`, `;`,
file redirects, etc.) run **before** user `rules.json` allows. A prefix allow cannot smuggle a
composite tail past the dry-run check — the verdict matches what `--execute` would enforce.
Pure FD-to-FD redirects (`2>&1`, `1>&2`) are allowed; they rebind streams of the same process
and are not a second command.

**Per-context rules:** a loop contract's `governed` block and a route `command` stage may each
declare an extra `rules` array (same `{ id, action, match, pattern }` shape). These compose with
the global `rules.json` for that one command only — a context `allow` can supplement the global
policy, but **deny-wins is absolute**: no context `allow` can override a global or context `deny`
(or a built-in deny).

## Handoff Commands

### handoff

Regenerate `session-handoff.md` from live repository state.

```bash
node scripts/amber.js handoff --target .
```

### handoff bundle / validate

Produce and validate the portable continuation artifact set.

```bash
node scripts/amber.js handoff bundle --target .
node scripts/amber.js handoff bundle --target . --output-dir .amber/handoff/latest
node scripts/amber.js handoff validate --target .
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

The bundle contains `README.md`, `session-summary.md`, `verification-evidence.md`, `next-actions.md`, `risks.md`, `recovery-commands.md`, and `manifest.json`.

## Maintenance Commands

### maintenance inspect

Detect maintenance needs:

```bash
node scripts/amber.js maintenance inspect --target .
```

Reports:
- Stale documentation
- Wiki lint issues
- Rule pack drift
- Upgrade opportunities

### maintenance propose

Generate maintenance proposal:

```bash
node scripts/amber.js maintenance propose \
  --target . \
  --output maintenance-plan.md
```

## Execution Commands

### execution validate-integration

Validate integration contract:

```bash
node scripts/amber.js execution validate-integration \
  --contract integration.json \
  --target .
```

### execution readiness

Check execution readiness:

```bash
node scripts/amber.js execution readiness \
  --plan docs/plans/feature.md \
  --target .
```

## Daemon Boundary

Amber V1 has no daemon command surface. Do not use Amber as a background autonomous worker. Use explicit, human-triggered commands such as:

```bash
node scripts/amber.js doctor --target .
node scripts/amber.js governance report --target .
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

## Utility Commands

### init

Initialize Amber structure:

```bash
node scripts/amber.js init --target . [--dry-run]
```

Creates `.amber/` directory with starter files.

### audit

Audit project structure:

```bash
node scripts/amber.js audit --target . [--summary] [--json]
```

### doctor

Run diagnostic checks:

```bash
node scripts/amber.js doctor --target .
```

Reports:
- Missing files
- Configuration issues
- Compatibility warnings

Failing checks carry an actionable `→ fix:` remedy (e.g. missing harness files → `amber init`).

### next

Infer the repo's position in the Amber lifecycle and print the single next command to run
(read-only — never executes anything):

```bash
node scripts/amber.js next --target .                 # auto-select a focus
node scripts/amber.js next --target . --feature F001  # focus a feature
node scripts/amber.js next --target . --session <id>  # focus a session
node scripts/amber.js next --target . --objective "fix login timeout" # match a target-local Route
node scripts/amber.js next --target . --json          # machine-readable envelope
```

Lifecycle: `[audit on existing repos] → init → feature → plan → gate → verify → approve → handoff → complete-check → session complete → accept` (handoff may refresh after accept). With no
`--feature`/`--session`, `next` auto-selects (active session → most-recent plan's feature → first
unstarted feature) and reports the chosen focus plus how many other items are pending. Session
completion evaluation matches `complete-check --strict` (executed verification + live handoff, not
the init scaffold). Approve remedies include the concrete `--gate <id>` from the session route.
Existing non-empty targets get a read-only `amber audit` first; audit writes no target file, so
`next` advances straight to `init` (audit is a non-blocking advisory).

With `--objective`, `next` resolves Route manifests and Workflow Packs from the target repository,
not Amber's installation directory. A matching Route selects the governed path for that objective;
when no Route matches, the recommendation remains behind the plan gate instead of guessing an
execution path.

### migrate

Migrate from Harness to Amber:

```bash
# Merge legacy state into .amber without overwriting existing files
node scripts/amber.js migrate state --target .

# After a clean merge, rename .harness to a timestamped backup to remove coexistence
node scripts/amber.js migrate state --target . --archive-legacy

# Migrate wiki
node scripts/amber.js migrate wiki --target .

# Migrate session manifest schemas and backfill ADR-0012 version fields
node scripts/amber.js migrate manifests --target .

# Preview both manifest migration and version-field backfill without writing
node scripts/amber.js migrate manifests --target . --dry-run
```

`migrate` with no subcommand is equivalent to `migrate manifests`. It updates Session manifest
schemas and backfills missing ADR-0012 version fields in recognized JSON artifacts under `.amber/`,
`routes/`, and `workflow-packs/`; existing version fields are never overwritten. Unknown JSON is
left untouched, and Workflow Pack containers migrate only their recognized `loopContracts[]`.
Before the first write to each changed JSON file, Amber keeps a sibling `.backup` copy and preserves
that original backup on later runs.

### wiki

Create missing Wiki starter files, skip existing files, then validate links (idempotent):

```bash
node scripts/amber.js wiki --target . [--dry-run]
```

Knowledge Plan subcommands (declarative plan + structured knowledge base):

```bash
node scripts/amber.js wiki knowledge plan --target .      # pre-flight inspection + propose or update the plan
node scripts/amber.js wiki knowledge scaffold --target .  # scaffold docs/wiki/knowledge-plan.json (or --yaml)
node scripts/amber.js wiki knowledge inspect --target .   # dump the loaded plan
node scripts/amber.js wiki knowledge report --target .    # coverage report against declared documents
node scripts/amber.js wiki knowledge validate --target .  # schema validation of the plan
node scripts/amber.js wiki knowledge build --target .     # materialize pages under docs/wiki/knowledge/
```

### status

Show a curated one-line overview of repo state: git branch, Amber init status, install freshness, and scaffold/artifact/wiki drift counts. Read-only thin front-door — does not duplicate `doctor` or `maintenance inspect`:

```bash
node scripts/amber.js status --target . [--json]
```

### sync

Detect scaffold and artifact drift between installed files and shipped templates. Dry-run by default (no changes made); with `--execute`, refreshes stale Amber-owned scaffold files and caches customized/ambiguous proposals:

```bash
node scripts/amber.js sync --target .
node scripts/amber.js sync --target . --execute
```

### clean

Remove amber-generated files from the target repository (reverse of `init`):

```bash
node scripts/amber.js clean --target . [--dry-run]
```

### security audit

Run security governance checks in report-only mode (never mutates target code):

```bash
node scripts/amber.js security audit --target .
node scripts/amber.js security audit --target . --output docs/security-audit.md
```

## Advanced Commands

### pack inspect

Inspect workflow pack:

```bash
node scripts/amber.js pack inspect \
  --file workflow-packs/safe-amber-bootstrap.pack.json
```

### pack readiness

Check pack readiness:

```bash
node scripts/amber.js pack readiness \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --json
```

### profile inspect
> ⚠️ **DEPRECATED** — will be removed in v2. Use `amber governance policy` instead.

Inspect project profile:

```bash
node scripts/amber.js profile inspect \
  --file profiles/default.profile.json
```

### loop validate-loop

Validate a loop contract file (read-only):

```bash
node scripts/amber.js loop validate-loop \
  --contract loop.json \
  --target .
```

### loop recommend

Select the safest local loop contract for a maintenance goal. This command is read-only and
returns a `nextCommand`; it never schedules work or executes workflow steps.

```bash
node scripts/amber.js loop recommend \
  --target . \
  --goal "continuous improvement" \
  --json
```

For the default project packs, continuous improvement recommends `daily-amber-triage` and a
dry-run command like:

```bash
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --dry-run \
  --json
```

### loop inspect

Inspect one loop contract and its readiness without writing a ledger:

```bash
node scripts/amber.js loop inspect \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --json
```

### loop run

Build a ledger preview for a loop contract (default, requires `--dry-run`), OR — since
[ADR-0003](adr/0003-governance-gated-execution.md) — execute the contract's `governed.command`
under governance gates with `--execute`. Live scheduling is disabled by product boundary; `--execute`
is a human-triggered one-shot (with approval), not scheduled or unattended work.

```bash
# dry-run preview (default; nothing executes)
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --dry-run --json

# governed execution (needs a prior `loop approve`; runs in an isolated worktree)
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract amber-doctor-check \
  --execute
```

`--execute` runs only if all gates pass: the contract declares a `governed.command`, that command
passes the policy gate (`.amber/governance/rules.json`, deny-wins / default-deny), an unconsumed
approval exists, the target is a git repo (worktree isolation), and the attempt is appended to the
tamper-evident ledger.

### loop approve

Record an explicit human approval authorizing ONE governed execution. One approval is consumed by one
`loop run --execute`; re-running requires re-approval.

```bash
node scripts/amber.js loop approve \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract amber-doctor-check \
  --reviewer your-name
```

### loop verify-ledger

Recompute the hash chain of a contract's execution ledger and report any tampering.

```bash
node scripts/amber.js loop verify-ledger --contract amber-doctor-check --json
```

### loop record / status

Record caller-supplied manual loop evidence, then inspect the resulting ledger. These commands
do not execute workflow steps; they only write or read review artifacts supplied by the caller.
`loop status --ledger` accepts either one ledger JSON file or a directory containing ledger
JSON records. Directory status considers at most the newest 100 files by modification time,
retains valid records when individual files are corrupt, orders loaded records chronologically,
and reports `insufficient-history`, `progressing`, or `stalled` with explicit no-progress signals
and remedies. Status never executes commands, schedules jobs, calls external systems, or rewrites
the supplied ledger history.

```bash
node scripts/amber.js loop record \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --trigger-source manual \
  --stop-reason reviewer-gate-required \
  --output .amber/loops/daily-amber-triage/manual-ledger.json \
  --json

node scripts/amber.js loop status \
  --ledger .amber/loops/daily-amber-triage/manual-ledger.json \
  --json

# assess bounded no-progress signals from recorded history
node scripts/amber.js loop status \
  --ledger .amber/loops/daily-amber-triage/history \
  --json
```

### task prepare
> ⚠️ **DEPRECATED** — will be removed in v2.

Prepare task execution:

```bash
node scripts/amber.js task prepare \
  --target . \
  --plan docs/plans/feature.md \
  --task task-1 \
  --session <id>
```

The execution ledger and evidence always bind to a target-local, non-terminal Session. Amber validates
an explicit `--session`; when it is omitted, Amber uses the most recent incomplete Session. The command
fails before creating execution or worktree directories when no valid Session can be resolved.

### result inspect
> ⚠️ **DEPRECATED** — will be removed in v2.

Inspect task result:

```bash
node scripts/amber.js result inspect \
  --target . \
  --task task-1
```

### agent
> ⚠️ **DEPRECATED** — will be removed in v2.

Create and control auditable worker/reviewer dispatch records without executing agent work:

```bash
node scripts/amber.js agent dispatch --target . --task task-1 --worker worker-a --reviewer reviewer-b
node scripts/amber.js agent stop --target . --task task-1
node scripts/amber.js agent resume --target . --task task-1
node scripts/amber.js agent review --target . --task task-1
```

### team
> ⚠️ **DEPRECATED** — will be removed in v2.

Inspect, install, pin, update, and roll back local team distribution metadata. Use `install --dry-run` to preview `.amber/team` metadata writes before creating local state:

```bash
node scripts/amber.js team inspect --target .
node scripts/amber.js team install --target . --version 1.0.0 --preset safe-bootstrap --dry-run --json
```

### adoption
> ⚠️ **DEPRECATED** — will be removed in v2. Use `amber governance audit` instead.

Generate, list, or index safe adoption report artifacts without modifying target repositories:

```bash
node scripts/amber.js adoption report --target . --output-dir docs/examples/adoptions
node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions
```

## Examples

### Start Simple Session

```bash
node scripts/amber.js session start \
  --target . \
  --goal "fix login timeout bug" \
  --route bugfix-quick
```

### Autonomous Mode Boundary

`--mode autonomous` is intentionally refused in V1. Use governed sessions, explicit approvals, and handoff validation instead.

### Continue After Budget Exceeded

```bash
# Edit .amber/autonomous-policy.json to increase budget
# Then:
node scripts/amber.js session continue --target .
```

### Check Session Status

```bash
node scripts/amber.js session status --target .
```

### List All Sessions

```bash
node scripts/amber.js session list --target .
```

### Generate Governance Audit

```bash
node scripts/amber.js governance audit \
  --target . \
  --since 2024-01-01 \
  --output audit-2024.md
```

### Check System Health

```bash
node scripts/amber.js maintenance inspect --target .
```

## Exit Codes

- `0`: Success
- `1`: Failure
- `2`: Paused (autonomous mode, budget exceeded)

## Environment Variables

```bash
# Email notifications
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@email.com
EMAIL_PASS=app-password

# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Debugging
DEBUG=amber:*
```

## JSON Output Format

All commands support `--json` for machine-readable output:

```bash
node scripts/amber.js session status --target . --json
```

Output:
```json
{
  "sessionId": "abc123def",
  "status": "completed",
  "goal": "implement auth",
  "route": "feature-standard",
  "tokensUsed": 45230,
  "duration": "15m 23s"
}
```

## Configuration Files

### .amber/autonomous-policy.json

Session execution policy:
```json
{
  "gates": { "auto": "approve", "user-approval": "block", "step-confirm": "block" },
  "retry": { "maxAttempts": 3 },
  "budget": { "maxTokens": 100000 }
}
```

### routes/*.route.json

Route definitions with stages and gates.

### schemas/*.schema.json

JSON schemas for validation.

## Directory Structure

```
project/
├── .amber/
│   ├── sessions/           # Session data
│   ├── governance/         # Governance docs
│   ├── logs/               # System logs
│   ├── autonomous-policy.json
│   └── daemon.pid
├── routes/                 # Route definitions
│   ├── feature-standard.route.json
│   ├── bugfix-quick.route.json
│   └── refactor-safe.route.json
└── schemas/                # JSON schemas
    ├── route.schema.json
    └── session-manifest.schema.json
```

## Tips

### Faster Commands

Use shorter route names:
```bash
--route bugfix-quick  # Instead of feature-standard
```

### Debug Mode

Enable verbose logging:
```bash
DEBUG=amber:* node scripts/amber.js session start ...
```

### Batch Operations

Process multiple sessions:
```bash
for session in $(node scripts/amber.js session list --json | jq -r '.[] | select(.status=="paused") | .sessionId'); do
  node scripts/amber.js session continue $session --target .
done
```

### Monitor Long Sessions

Watch timeline in real-time:
```bash
tail -f .amber/sessions/<session-id>/timeline.jsonl
```

## Enforcement Commands (opt-in)

The `hooks` command manages an opt-in git `pre-commit` guard. It reads governance **metadata only**
and never runs target-project build/test commands. It is never installed automatically.

### hooks install

```bash
node scripts/amber.js hooks install --target .
node scripts/amber.js hooks install --target . --warn-only   # surface findings, never block
node scripts/amber.js hooks install --target . --force       # overwrite a foreign pre-commit hook
```

Writes `.git/hooks/pre-commit` (a portable `#!/bin/sh` shim, marked `# amber-managed-hook`). An
existing non-Amber hook is backed up to `pre-commit.amber-backup` unless `--force` is given.

### hooks check

```bash
node scripts/amber.js hooks check --target .
```

Runs the governance checks now (this is what the hook invokes). Exits non-zero on a violation.
Default check: a feature with status `passing`/`accepted`/`done` must not have an empty `evidence`
array (`AMBER_E_FEATURE_NO_EVIDENCE`). Bypass once with `AMBER_SKIP_HOOKS=1 git commit ...`.

### hooks status / uninstall

```bash
node scripts/amber.js hooks status --target .      # installed (blocking|warn-only) / not installed
node scripts/amber.js hooks uninstall --target .   # removes the Amber guard; restores any backup
```

## Drift Commands

`amber drift` is a CI-native drift gate. It aggregates the artifact, wiki, and scaffold drift
detectors into one exit code: `0` if no actionable drift, `1` if any. Read-only; no execution.

```bash
node scripts/amber.js drift --target .                           # human text, exit 0/1
node scripts/amber.js drift --target . --json                    # machine envelope (exitCode field)
node scripts/amber.js drift --target . --format gh-annotations   # GitHub Actions ::warning lines
node scripts/amber.js drift --target . --scope artifact          # one scope only
node scripts/amber.js drift --target . --no-fail                 # always exit 0 (informational CI step)
```

GitHub Actions snippet (add as a step in any workflow that runs on PRs):

```yaml
- name: Amber drift gate
  run: |
    npm install -g amber-protocol
    amber drift --target . --format gh-annotations --no-fail
```

## Workflow Commands

`amber workflow` is the ADR-0008 workflow-effectiveness assessment surface. Read-only by default:
`assess` builds a report from repository evidence plus session observations (amber-native sessions
and cwd-bound Claude host transcripts, capped to the newest 20 transcript files) unless
`--no-sessions`; `findings` / `plan` / `compare` operate on prior report files. `assess` writes a
report file only when `--output-dir` is given. Diagnostics go to **stderr**; stdout stays
parser-safe JSON (or Markdown for assess).

```bash
# Build a report (stdout JSON by default)
node scripts/amber.js workflow assess --target .
node scripts/amber.js workflow assess --target . --format markdown
node scripts/amber.js workflow assess --target . --output-dir .amber/workflow-reports
node scripts/amber.js workflow assess --target . --no-sessions   # repository-only baseline

# Extract findings from a prior report
node scripts/amber.js workflow findings --target . --report path/to/report.json

# Dry-run plan draft for one finding (never mutates the target)
node scripts/amber.js workflow plan --target . --report path/to/report.json --finding ca-1-feature-observable

# Longitudinal compare of two reports
node scripts/amber.js workflow compare --target . --baseline path/to/old.json --current path/to/new.json
```

Subcommands:

| Action | Purpose | Key flags |
|--------|---------|-----------|
| `assess` | Score dimensions + findings from live repo evidence | `--format json\|markdown`, `--output-dir`, `--no-sessions` |
| `findings` | List findings from a saved report | `--report` (required) |
| `plan` | Dry-run plan draft for one finding | `--report`, `--finding` (required) |
| `compare` | Diff baseline vs current report | `--baseline`, `--current` (required) |

Only `assess` accepts `--output-dir`. `findings` / `plan` / `compare` reject it with exit code 1
and an empty stdout. No action schedules work or executes target-project commands.

## Ledger Commands

`amber ledger` exports, seals, or verifies the anchoring of Amber's tamper-evident ledgers.

```bash
# SIEM/compliance export (JSON default; csv and otlp-json — the latter is valid OTLP JSON)
node scripts/amber.js ledger export --target . --format json                  # pipe to your collector
node scripts/amber.js ledger export --target . --format csv --out audits/ledger.csv
node scripts/amber.js ledger export --target . --format otlp-json
node scripts/amber.js ledger export --target . --home sessions                # one ledger home

# Git-anchor ledger tail hashes (closes the ADR-0003 full-rewrite gap)
node scripts/amber.js ledger seal --target . --reviewer <name>
node scripts/amber.js ledger verify-anchoring --target .     # exit 1 if any ledger changed since the last seal
```

`export` emits a broken chain as `intact:false` (data, not refusal) and counts it in `brokenCount`.
`seal` writes an annotated git tag `amber-ledger-seal-<head-sha>` carrying each ledger's tail hash,
so forging a ledger then requires rewriting git tag history. No Ed25519 signing yet — deferred per
the Phase 1 spec until key management (HSM / OS keystore) is a real capability rather than a key in
the repo.

## Context Commands

`amber context` is the ADR-0009 contract-driven distillation surface. **Amber never calls a model**:
`request` writes a hash-bearing distillation contract; a host agent executes it; `ingest` judges the
result (schema, citation completeness, payload-to-request binding, source freshness) and persists
provenance-backed pages under `.amber/context/pages/`, indexed by `docs/wiki/context-index.md`.
Run `amber context --help` for the full subcommand reference; `skills/amber-context/SKILL.md` is the
agent-facing loop.

```bash
# Contract + gate
node scripts/amber.js context request --target . --page governed-execution --title "Governed execution" --source docs/adr/0003-....md
node scripts/amber.js context ingest  --target . --request kd-2026-08-07-a3f1 --payload out.json
node scripts/amber.js context ingest  --target . --request <id> --payload no-change.json   # {"outcome":"no-change"} rebases hashes

# Health and maintenance
node scripts/amber.js context verify --target . --json
node scripts/amber.js context list   --target .
node scripts/amber.js context show   --target . --page <id>
node scripts/amber.js context refresh --target .          # absorbs cosmetic changes; requests real ones
node scripts/amber.js context delete --target . --page <id>

# Task-scoped Loadout
node scripts/amber.js context load --target . --route feature-standard
node scripts/amber.js context load --target . --route feature-standard --feature F016 --budget 4000 --page governed-execution
node scripts/amber.js context verify --target . --loadout .amber/context/loadouts/feature-standard-F016.json

# Observability
node scripts/amber.js context stats --target .            # lifetime
node scripts/amber.js context stats --target . --window 50   # last 50 events
```

Sources are mutable by default (raw+normalized hash; cosmetic changes absorbed silently) and
immutable under `.amber/` and `docs/adr/` (excerpt-snapshotted; tamper detected). A payload must
reproduce the request's bundled source hashes verbatim — re-bundling is rejected as stale.
Failures carry the `AMBER_E_CONTEXT_*` codes (see `amber explain`).

Loadouts use `schemaVersion: 1.0.0`. `artifacts.required[]` always records and budgets the
target-local Operating Manual (`docs/wiki/agent/amber.md`), selected Route manifest, and Loadout
Definition (`docs/wiki/agent/context-loadout.md`); Context Page accounting remains in `references`.
Missing, escaped, or hash-changed Required Artifacts fail closed. `verify --loadout` rechecks them
and any required-tier Pages immediately before the host agent loads the artifact.

## Error Codes

### explain

Look up Amber error codes, or regenerate the troubleshooting reference:

```bash
node scripts/amber.js explain                                  # list every code with its layer
node scripts/amber.js explain AMBER_E_FEATURE_NO_EVIDENCE      # cause + fix for one code
node scripts/amber.js explain feature_no_evidence             # bare suffix also works
node scripts/amber.js explain --markdown docs/ERROR_CODES.md  # write a standalone reference table
```

Blocking errors render with their stable code inline (`<message> [CODE] → fix: <remedy>`). The
catalog is the single source of truth. `--markdown` writes a standalone reference file (don't point
it at a doc with hand-written front-matter — it writes only the generated table).

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
