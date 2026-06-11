# Autonomous Mode Guide

**Amber Protocol** autonomous mode enables fully automated session execution without human intervention. Sessions run with policy-driven gate approval, automatic retries, and budget management.

## Quick Start

### 1. Configure Policy

Create `.amber/autonomous-policy.json`:

```json
{
  "gates": {
    "user-approval": "auto-approve",
    "security-review": "auto-approve",
    "deployment": "require-approval"
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

### 2. Start Autonomous Session

```bash
node scripts/amber.js session start \
  --goal "implement user authentication" \
  --route feature-standard \
  --mode autonomous
```

### 3. Monitor Progress

```bash
# Check session status
node scripts/amber.js session status

# View timeline
cat .amber/sessions/<session-id>/timeline.jsonl

# Check logs
cat .amber/logs/harness.log
```

## Policy Configuration

### Gate Approval

Control which gates require human approval:

```json
{
  "gates": {
    "user-approval": "auto-approve",      // Always approve
    "security-review": "require-approval", // Always prompt
    "deployment": "auto-approve"
  }
}
```

**Options:**
- `auto-approve`: Gates pass automatically
- `require-approval`: Pause for human review

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

## Daemon Mode

Run sessions in the background:

```bash
# Start daemon
node scripts/amber.js daemon start

# Check status
node scripts/amber.js daemon status

# Stop daemon
node scripts/amber.js daemon stop
```

Daemon PID stored in `.amber/daemon.pid`.

## Notifications

Enable email/Slack alerts for key events.

### Email Setup

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "to": "team@example.com",
      "events": ["session-completed", "session-failed", "gate-blocked"]
    }
  }
}
```

Requires environment variables:
```bash
export EMAIL_HOST=smtp.gmail.com
export EMAIL_PORT=587
export EMAIL_USER=your@email.com
export EMAIL_PASS=your-password
```

### Slack Setup

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
      "events": ["session-completed", "session-failed"]
    }
  }
}
```

## Best Practices

### Start Small

Begin with low-risk tasks:
- Bug fixes
- Documentation updates
- Test additions

### Gradual Automation

Progressively enable gate auto-approval:

1. Week 1: All gates require approval
2. Week 2: Auto-approve low-risk gates
3. Week 3: Auto-approve most gates
4. Week 4: Full autonomous mode

### Monitor Closely

First autonomous runs:
- Check logs frequently
- Review timeline events
- Validate output quality

### Set Conservative Budgets

Start with lower token limits:
- Simple tasks: 10k-50k tokens
- Medium tasks: 50k-100k tokens
- Complex tasks: 100k-500k tokens

### Use Checkpoints

Enable checkpoint/continue for long-running sessions:

```bash
node scripts/amber.js session start \
  --goal "large refactoring" \
  --checkpoint-interval 5  # Every 5 stages
```

## Troubleshooting

### Session Stuck in "Running"

```bash
# Check if process is alive
ps aux | grep amber

# Abort stuck session
node scripts/amber.js session abort <session-id>

# Continue from checkpoint
node scripts/amber.js session continue <session-id>
```

### Budget Exceeded Immediately

Increase budget or use simpler routes:

```json
{
  "budget": {
    "maxTokens": 200000
  }
}
```

Or switch to lightweight route:
```bash
--route bugfix-quick  # Lower token usage
```

### All Gates Failing

Check policy syntax:

```bash
node scripts/amber.js governance policy
```

Ensure gates match route definitions:
```bash
node scripts/amber.js route inspect feature-standard
```

## Examples

### Automated Bug Fix

```bash
node scripts/amber.js session start \
  --goal "fix login timeout issue #123" \
  --route bugfix-quick \
  --mode autonomous \
  --budget 25000
```

### Scheduled Refactoring

```bash
# Run via cron every Sunday at 2am
0 2 * * 0 cd /project && node scripts/amber.js session start \
  --goal "weekly code cleanup" \
  --route refactor-safe \
  --mode autonomous
```

### CI/CD Integration

```yaml
# .github/workflows/autonomous-fixes.yml
name: Autonomous Fixes
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: node scripts/amber.js session start \
          --goal "fix linting issues" \
          --mode autonomous \
          --budget 10000
```

## Security Considerations

### Dangerous Gate Auto-Approval

**Never auto-approve:**
- `deployment` gates (production changes)
- `security-review` gates (auth/permissions)
- `data-migration` gates (database changes)

### Audit Trail

All autonomous decisions are logged:
```bash
cat .amber/sessions/<session-id>/timeline.jsonl | grep gate-decision
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
- Set up [Notifications](NOTIFICATION_SETUP.md)
- Review [Troubleshooting Guide](TROUBLESHOOTING.md)
- Explore [CLI Reference](CLI_REFERENCE.md)
