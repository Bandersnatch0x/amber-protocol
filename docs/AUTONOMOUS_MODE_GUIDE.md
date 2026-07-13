# Autonomous Mode Boundary

**Amber Protocol does not run fully autonomous sessions in V1.** The policy file is retained for governance inspection and safe defaults, but `session start/continue --mode autonomous` is intentionally refused by ADR-0001/0005. Use governed, human-triggered routes instead.

## Quick Start

### 1. Configure Policy

Create `.amber/autonomous-policy.json`:

```json
{
  "gates": {
    "auto": "approve",
    "user-approval": "block",
    "step-confirm": "block",
    "security-review": "block",
    "deployment": "block"
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [1000, 5000, 15000]
  },
  "budget": {
    "maxTokens": 100000,
    "onExceed": "pause"
  }
}
```

### 2. Start A Governed Session

```bash
node scripts/amber.js session start \
  --goal "implement user authentication" \
  --route feature-standard
```

Do not pass `--mode autonomous`; Amber refuses that mode so human approval gates remain real.


### 3. Monitor Progress

```bash
# Check the latest session status
node scripts/amber.js session status --target .

# Check a specific session
node scripts/amber.js session status --target . <session-id>

# Recompute readiness and next actions
node scripts/amber.js governance report --target .
```

## Policy Configuration

### Gate Approval

Control which gates require human approval:

```json
{
  "gates": {
    "auto": "approve",              // Low-risk automatic gates
    "user-approval": "block",       // Human approval remains required
    "security-review": "block",     // Manual review required
    "deployment": "block"
  }
}
```

**Options:**
- `approve`: Low-risk automatic gates pass
- `block`: Pause for human review or manual follow-up

### Retry Strategy

Configure retry behavior for transient failures:

```json
{
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [1000, 5000, 15000]
  }
}
```

First retry after 1s, second after 5s, third after 15s.

### Budget Management

Set token limits and overflow behavior:

```json
{
  "budget": {
    "maxTokens": 100000,
    "onExceed": "pause"  // or "abort"
  }
}
```

**Options:**
- `pause`: Stop and save checkpoint
- `abort`: Terminate session immediately

## Background Execution Boundary

Amber V1 has no daemon mode. Do not run Amber as a background autonomous worker or scheduled session starter. For CI or recurring maintenance, run read-only checks and reports:

```bash
node scripts/amber.js doctor --target .
node scripts/amber.js governance report --target .
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

## Notification Preferences

Notification settings are policy metadata only. Amber V1 does not send email or Slack messages by itself because external notifications are external writes and require explicit approval.

### Email Preferences

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "to": "team@example.com",
      "triggers": ["session_completed", "session_failed", "gate_blocked"]
    }
  }
}
```

### Slack Preferences

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhook": "${SLACK_WEBHOOK_URL}",
      "triggers": ["session_completed", "session_failed"]
    }
  }
}
```

## Best Practices

### Start Small

Begin with low-risk governed tasks:
- Bug fixes
- Documentation updates
- Test additions

### Keep Human Gates Real

Do not progress toward full autonomous mode in V1. Keep these gates blocked unless a future ADR explicitly changes the boundary:
- `user-approval`
- `step-confirm`
- `deployment`
- `security-review`
- `data-migration`

### Monitor With CLI Surfaces

During early governed sessions:
- Check `session status` frequently
- Re-run `governance report` after meaningful changes
- Validate handoff bundles before ending work

### Set Conservative Budgets

Start with lower token limits:
- Simple tasks: 10k-50k tokens
- Medium tasks: 50k-100k tokens
- Complex tasks: 100k-500k tokens

## Troubleshooting

### Session Appears Stuck

```bash
# Check current state
node scripts/amber.js session status --target . <session-id>

# Check lifecycle readiness
node scripts/amber.js session complete-check --target . --session <session-id> --strict

# Abort if the governed session should stop
node scripts/amber.js session abort --target . <session-id>
```

### Budget Exceeded Immediately

Increase the budget only if the task is still worth continuing, or split the goal into a smaller governed session:

```json
{
  "budget": {
    "maxTokens": 200000
  }
}
```

### All Gates Failing

Check policy syntax and route definitions:

```bash
node scripts/amber.js governance policy --target .
node scripts/amber.js route inspect feature-standard
```

## Examples

### Governed Bug Fix

```bash
node scripts/amber.js session start \
  --goal "fix login timeout issue #123" \
  --route bugfix-quick \
  --budget 25000

node scripts/amber.js session status --target .
node scripts/amber.js session approve --target . --session <session-id> --gate user-approval-fix --yes
node scripts/amber.js session verify --target . --session <session-id> --execute --command "npm test"
```

### Scheduled Or CI Work

Do not schedule Amber sessions or CI jobs that start autonomous work. For recurring maintenance, generate a report or recommendation, then let a human trigger the governed route and approvals.

```bash
node scripts/amber.js loop recommend --target .
node scripts/amber.js governance report --target .
```

## Security Considerations

### Dangerous Gate Auto-Approval

**Never configure `approve` for:**
- `user-approval` gates (human identity boundary)
- `deployment` gates (production changes)
- `security-review` gates (auth/permissions)
- `data-migration` gates (database changes)

### Audit Trail

Use CLI evidence surfaces instead of treating chat history as durable proof:
```bash
node scripts/amber.js session status --target . <session-id>
node scripts/amber.js handoff bundle --target . --output-dir .amber/handoff/latest
node scripts/amber.js handoff validate --target . --bundle-dir .amber/handoff/latest
```

### Token Budget as Safety Net

Set conservative budgets to limit blast radius:
```json
{
  "budget": {
    "maxTokens": 50000  // Prevents runaway sessions
  }
}
```

## Next Steps

- Read [Policy Configuration Guide](POLICY_CONFIGURATION.md)
- Review [Notification Policy Configuration](NOTIFICATION_SETUP.md)
- Review [Troubleshooting Guide](TROUBLESHOOTING.md)
- Explore [CLI Reference](CLI_REFERENCE.md)
