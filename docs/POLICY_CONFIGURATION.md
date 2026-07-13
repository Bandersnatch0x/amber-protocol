# Policy Configuration Reference

Complete reference for `.amber/autonomous-policy.json` configuration.

## Schema

```json
{
  "gates": {
    "<gate-type>": "approve" | "block"
  },
  "retry": {
    "maxAttempts": 1-10,
    "backoffMs": [number, ...]
  },
  "budget": {
    "maxTokens": number,
    "onExceed": "pause" | "abort"
  },
  "notifications": {
    "email": { ... },
    "slack": { ... }
  },
  "worktree": {
    "enabled": boolean,
    "cleanupOnSuccess": boolean
  }
}
```

## Gates

### Built-in Gate Types

| Gate Type | Description | Default |
|-----------|-------------|---------|
| `user-approval` | General human approval gate | `block` |
| `security-review` | Security-sensitive changes | `block` |
| `deployment` | Production deployment | `block` |
| `breaking-change` | API breaking changes | `block` |
| `data-migration` | Database schema changes | `block` |
| `budget-check` | Token budget verification | `approve` |

### Gate Approval Modes

#### `approve`

Low-risk automatic gates can pass without human intervention. Do not use this for `user-approval`, deployment, security review, data migration, or breaking-change gates.

**Use for:**
- Low-risk checks such as linting or formatting
- Pre-approved local verification gates
- Trusted read-only automation

**Example:**
```json
{
  "gates": {
    "budget-check": "approve"
  }
}
```

#### `block`

Session pauses until a real human approval or manual follow-up occurs.

**Use for:**
- Security-sensitive changes
- Production deployments
- Breaking API changes

**Example:**
```json
{
  "gates": {
    "deployment": "block"
  }
}
```

### Custom Gates

Add route-specific gates:

```json
{
  "gates": {
    "code-review": "approve",
    "license-check": "approve",
    "performance-test": "block"
  }
}
```

Gates not in policy default to `block`.

## Retry Configuration

### Fields

- **maxAttempts**: Number of retry attempts (1-10)
- **backoffMs**: Array of delays in milliseconds

### Examples

**Aggressive Retry** (fast iteration):
```json
{
  "retry": {
    "maxAttempts": 5,
    "backoffMs": [500, 1000, 2000, 5000, 10000]
  }
}
```

**Conservative Retry** (avoid rate limits):
```json
{
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [5000, 15000, 30000]
  }
}
```

**No Retry** (fail fast):
```json
{
  "retry": {
    "maxAttempts": 1,
    "backoffMs": []
  }
}
```

### Retry Behavior

- **Transient errors** (network, timeout): Retry
- **Permanent errors** (schema, config): Fail immediately
- **Resource errors** (disk, memory): Fail immediately

See [error-recovery.js](../scripts/lib/error-recovery.js) for classification logic.

## Budget Management

### Fields

- **maxTokens**: Maximum token consumption
- **onExceed**: Behavior when budget exceeded

### Token Estimates

| Task Type | Typical Range |
|-----------|---------------|
| Simple bug fix | 10k-25k tokens |
| Feature addition | 50k-100k tokens |
| Large refactoring | 100k-500k tokens |
| Documentation | 20k-50k tokens |

### Overflow Modes

#### `pause`

Save checkpoint and stop execution:

```json
{
  "budget": {
    "maxTokens": 100000,
    "onExceed": "pause"
  }
}
```

**Recovery:**
```bash
# Increase budget
# Edit .amber/autonomous-policy.json

# Continue session
node scripts/amber.js session continue <session-id>
```

#### `abort`

Terminate immediately:

```json
{
  "budget": {
    "maxTokens": 100000,
    "onExceed": "abort"
  }
}
```

Session cannot be resumed.

## Notifications

Amber V1 treats notification settings as policy metadata. The CLI can inspect the policy, but it does not send email or Slack messages by itself; external notifications require explicit approval or an approved downstream integration.

### Email Preferences

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "to": "team@example.com",
      "triggers": [
        "session_created",
        "session_completed",
        "session_failed",
        "gate_blocked",
        "budget_exceeded"
      ]
    }
  }
}
```

Keep SMTP credentials in the approved downstream notifier, not in the Amber policy file.

### Slack Preferences

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhook": "${SLACK_WEBHOOK_URL}",
      "channel": "#amber-notifications",
      "username": "Amber Bot",
      "triggers": ["session_completed", "session_failed"]
    }
  }
}
```

Store real webhook URLs in environment or secret-management systems used by the approved notifier.

### Trigger Names

| Trigger | Meaning | Recommended |
|---------|---------|-------------|
| `session_created` | Session manifest created | Optional |
| `session_completed` | Session marked completed | Yes |
| `session_failed` | Session marked failed | Yes |
| `gate_blocked` | Human or policy gate blocked progress | Yes |
| `budget_exceeded` | Budget threshold exceeded | Yes |

## Validation

Check policy syntax:

```bash
node scripts/amber.js governance policy
```

Expected output:
```
Policy: .amber/autonomous-policy.json
Status: valid
Gates: 8 configured
Budget: 150000 tokens (pause on exceed)
Notifications: email + slack
```

## Migration

### From Harness to Amber

Rename file:
```bash
mv .harness/autonomous-policy.json .amber/autonomous-policy.json
```

Update references:
```bash
# Policy auto-detects .amber/ directory
# No code changes needed
```

### Version Compatibility

Policy schema is forward-compatible. Unknown fields are ignored.

Minimum Amber version: `1.0.0`

## Security

### Sensitive Values

**Never commit:**
- Slack webhook URLs
- Email credentials
- API keys

Use environment variables:
```json
{
  "notifications": {
    "slack": {
      "webhook": "${SLACK_WEBHOOK_URL}"
    }
  }
}
```

### Audit Trail

Policy changes are logged:
```bash
git log .amber/autonomous-policy.json
```

### Least Privilege

Start restrictive, gradually relax:

1. **Week 1:** All gates require approval
2. **Week 2:** Auto-approve `code-review`
3. **Week 3:** Auto-approve only low-risk verification gates
4. **Never:** Auto-approve `user-approval`, `deployment`, `security-review`, or data-migration gates

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Set up [Notifications](NOTIFICATION_SETUP.md)
- Review [Troubleshooting](TROUBLESHOOTING.md)
