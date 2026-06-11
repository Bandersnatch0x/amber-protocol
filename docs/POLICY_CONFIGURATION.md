# Policy Configuration Reference

Complete reference for `.amber/autonomous-policy.json` configuration.

## Schema

```json
{
  "gates": {
    "<gate-type>": "auto-approve" | "require-approval"
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
| `user-approval` | General human approval gate | `require-approval` |
| `security-review` | Security-sensitive changes | `require-approval` |
| `deployment` | Production deployment | `require-approval` |
| `breaking-change` | API breaking changes | `require-approval` |
| `data-migration` | Database schema changes | `require-approval` |
| `budget-check` | Token budget verification | `auto-approve` |

### Gate Approval Modes

#### `auto-approve`

Gates pass automatically without human intervention.

**Use for:**
- Low-risk changes (linting, formatting)
- Pre-approved workflows
- Trusted automation

**Example:**
```json
{
  "gates": {
    "user-approval": "auto-approve"
  }
}
```

#### `require-approval`

Session pauses, awaiting manual approval.

**Use for:**
- Security-sensitive changes
- Production deployments
- Breaking API changes

**Example:**
```json
{
  "gates": {
    "deployment": "require-approval"
  }
}
```

### Custom Gates

Add route-specific gates:

```json
{
  "gates": {
    "code-review": "auto-approve",
    "license-check": "auto-approve",
    "performance-test": "require-approval"
  }
}
```

Gates not in policy default to `require-approval`.

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

### Email Configuration

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "to": "team@example.com",
      "from": "amber@example.com",
      "events": [
        "session-started",
        "session-completed",
        "session-failed",
        "gate-blocked",
        "budget-exceeded"
      ]
    }
  }
}
```

**Environment variables:**
```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=sender@example.com
EMAIL_PASS=app-password
EMAIL_TLS=true  # Optional, default true
```

### Slack Configuration

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/T00/B00/XXX",
      "channel": "#amber-notifications",  // Optional
      "username": "Amber Bot",            // Optional
      "events": ["session-completed", "session-failed"]
    }
  }
}
```

**Webhook setup:**
1. Go to https://api.slack.com/apps
2. Create app → Incoming Webhooks
3. Add to workspace
4. Copy webhook URL

### Event Types

| Event | Trigger | Recommended |
|-------|---------|-------------|
| `session-started` | Session begins | Optional |
| `session-completed` | Session succeeds | **Yes** |
| `session-failed` | Session fails | **Yes** |
| `gate-blocked` | Gate requires approval | **Yes** |
| `budget-exceeded` | Token limit hit | **Yes** |
| `checkpoint-saved` | Checkpoint created | Optional |

## Worktree Settings

### Configuration

```json
{
  "worktree": {
    "enabled": true,
    "cleanupOnSuccess": true,
    "cleanupOnFailure": false
  }
}
```

### Fields

- **enabled**: Use git worktree isolation
- **cleanupOnSuccess**: Remove worktree after successful completion
- **cleanupOnFailure**: Remove worktree after failure (loses work)

### When to Enable

**Enable for:**
- Parallel sessions
- Experimental changes
- High-risk operations

**Disable for:**
- Single-session workflows
- Direct branch work
- Debugging

## Complete Example

Production-ready configuration:

```json
{
  "gates": {
    "user-approval": "auto-approve",
    "security-review": "require-approval",
    "deployment": "require-approval",
    "breaking-change": "require-approval",
    "data-migration": "require-approval",
    "budget-check": "auto-approve",
    "code-review": "auto-approve",
    "test-validation": "auto-approve"
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [2000, 10000, 30000]
  },
  "budget": {
    "maxTokens": 150000,
    "onExceed": "pause"
  },
  "notifications": {
    "email": {
      "enabled": true,
      "to": "dev-team@example.com",
      "events": ["session-completed", "session-failed", "gate-blocked"]
    },
    "slack": {
      "enabled": true,
      "webhookUrl": "${SLACK_WEBHOOK_URL}",
      "events": ["session-completed", "session-failed"]
    }
  },
  "worktree": {
    "enabled": true,
    "cleanupOnSuccess": true,
    "cleanupOnFailure": false
  }
}
```

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
      "webhookUrl": "${SLACK_WEBHOOK_URL}"
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
3. **Week 3:** Auto-approve `user-approval`
4. **Never:** Auto-approve `deployment`, `security-review`

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Set up [Notifications](NOTIFICATION_SETUP.md)
- Review [Troubleshooting](TROUBLESHOOTING.md)
