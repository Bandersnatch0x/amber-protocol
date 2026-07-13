# Notification Policy Configuration

Amber V1 records notification preferences in `.amber/autonomous-policy.json`, but it does not send email or Slack messages by itself. External writes and notifications require explicit approval under the Amber operating manual, so this file is a governance/configuration surface for human-triggered or downstream integrations.

## Notification Preferences

### Email Preferences

1. **Add to policy** (`.amber/autonomous-policy.json`):

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

2. **Validate the policy can be inspected**:

```bash
node scripts/amber.js governance policy --target .
node scripts/amber.js governance report --target .
```

Amber V1 will not send a test email from these commands. Use an approved downstream notifier to read this policy and send messages.

### Slack Preferences

1. **Store the webhook outside the policy file**:

```bash
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX
```

2. **Reference the approved secret in policy**:

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhook": "${SLACK_WEBHOOK_URL}",
      "channel": "#amber-notifications",
      "username": "Amber Bot",
      "triggers": ["session_completed", "session_failed", "gate_blocked"]
    }
  }
}
```

Amber V1 will not post to Slack from these commands. External notifications require explicit approval or an approved downstream integration.

## Trigger Names

| Trigger | When Triggered | Severity |
|---------|----------------|----------|
| `session_created` | Session manifest is created | Info |
| `session_completed` | Session is marked completed | Success |
| `session_failed` | Session is marked failed | Error |
| `gate_blocked` | Gate needs human or policy approval | Warning |
| `budget_exceeded` | Budget threshold is exceeded | Warning |

## Downstream Notification Content

### Email Example

```
Subject: [Amber] Session Completed: implement-user-auth

Session ID: abc123def
Goal: implement user authentication
Status: completed
Readiness: governance report passed
```

### Slack Example

```
Session completed
Goal: implement user authentication
Session: abc123def
Next: validate handoff bundle
```

## Troubleshooting

### Policy Not Reflected In Reports

```bash
node scripts/amber.js governance policy --target .
node scripts/amber.js doctor --target .
```

Confirm the policy lives at `.amber/autonomous-policy.json` and uses `triggers`, not the legacy `events` field.

### Downstream Notifier Does Not Send

Check the approved notifier, secret store, and delivery logs outside Amber. The Amber CLI only records and inspects notification preferences in V1.

## Security

### Protect Credentials

**Never commit**:
```bash
# Add to .gitignore
.env
.amber/autonomous-policy.json  # If it contains secrets
```

**Use environment variables**:
```bash
# .env (gitignored)
EMAIL_USER=your-email@example.com
EMAIL_PASS=secret-password
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

Load with:
```bash
. ./.env
node scripts/amber.js governance policy --target .
node scripts/amber.js governance report --target .
```

### Rotate Credentials

**Email:** Regenerate app password monthly  
**Slack:** Regenerate webhook URL quarterly

## CI/CD Integration

CI should run read-only checks and reports. It must not start autonomous sessions or send external notifications without an explicit approved integration.

### GitHub Actions

```yaml
name: Amber Governance Checks
on: push

jobs:
  amber:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Amber checks
        run: |
          node scripts/amber.js doctor --target .
          node scripts/amber.js governance report --target .
```

### GitLab CI

```yaml
amber:
  script:
    - node scripts/amber.js doctor --target .
    - node scripts/amber.js governance report --target .
  only:
    - main
```

## Next Steps

- Return to [Autonomous Mode Boundary](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
