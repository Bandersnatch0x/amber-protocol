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

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
