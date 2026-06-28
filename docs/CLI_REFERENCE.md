# CLI Reference

Complete command reference for Amber Protocol CLI.

## Global Options

```bash
--target <path>   # Project root directory
--json            # Output JSON format
--dry-run         # Preview without making changes (init, wiki, plan)
--help            # Show command help
```

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
  [--mode autonomous]
```

**Options:**
- `--goal`: Session objective (required)
- `--route`: Route ID (default: feature-standard)
- `--budget`: Token limit (default: from route)
- `--worktree`: Use git worktree isolation
- `--mode`: `interactive` (default) or `autonomous`

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

Test route with sample goal:

```bash
node scripts/amber.js route test \
  --route feature-standard \
  --goal "add login endpoint" \
  --target .
```

## Governance Commands

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

### execution validate-loop

Validate loop contract:

```bash
node scripts/amber.js execution validate-loop \
  --contract loop.json \
  --target .
```

### execution readiness

Check execution readiness:

```bash
node scripts/amber.js execution readiness \
  --plan docs/plans/feature.md \
  --target .
```

## Daemon Commands

### daemon start

Start background daemon:

```bash
node scripts/amber.js daemon start --target .
```

PID stored in `.amber/daemon.pid`.

### daemon status

Check daemon status:

```bash
node scripts/amber.js daemon status --target .
```

### daemon stop

Stop daemon:

```bash
node scripts/amber.js daemon stop --target .
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
node scripts/amber.js next --target . --json          # machine-readable envelope
```

Lifecycle: `init → feature → plan → gate → verify/approve → complete-check → accept`. With no
`--feature`/`--session`, `next` auto-selects (active session → most-recent plan's feature → first
unstarted feature) and reports the chosen focus plus how many other items are pending.

### migrate

Migrate from Harness to Amber:

```bash
# Migrate state directory
node scripts/amber.js migrate state --target .

# Migrate wiki
node scripts/amber.js migrate wiki --target .

# Migrate manifests
node scripts/amber.js migrate manifests --target .
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

Inspect project profile:

```bash
node scripts/amber.js profile inspect \
  --file profiles/default.profile.json
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

Build a ledger preview for a loop contract. Live scheduling is disabled by product boundary,
so `--dry-run` is required.

```bash
node scripts/amber.js loop run \
  --file workflow-packs/safe-amber-bootstrap.pack.json \
  --contract daily-amber-triage \
  --dry-run \
  --json
```

### loop record / status

Record caller-supplied manual loop evidence, then inspect the resulting ledger. These commands
do not execute workflow steps; they only write or read review artifacts supplied by the caller.

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
```

### task prepare

Prepare task execution:

```bash
node scripts/amber.js task prepare \
  --target . \
  --plan docs/plans/feature.md \
  --task task-1
```

### result inspect

Inspect task result:

```bash
node scripts/amber.js result inspect \
  --target . \
  --task task-1
```

## Examples

### Start Simple Session

```bash
node scripts/amber.js session start \
  --target . \
  --goal "fix login timeout bug" \
  --route bugfix-quick
```

### Start Autonomous Session

```bash
node scripts/amber.js session start \
  --target . \
  --goal "add email validation" \
  --route feature-standard \
  --mode autonomous \
  --budget 50000
```

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
  "gates": { "user-approval": "auto-approve" },
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

## Error Codes

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
