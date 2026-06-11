# Notification Setup

Configure email and Slack notifications for Amber Protocol autonomous sessions.

## Email Notifications

### Quick Setup

1. **Add to policy** (`.amber/autonomous-policy.json`):
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

2. **Set environment variables**:
```bash
export EMAIL_HOST=smtp.gmail.com
export EMAIL_PORT=587
export EMAIL_USER=your-email@gmail.com
export EMAIL_PASS=your-app-password
```

3. **Test**:
```bash
node scripts/amber.js session start --goal "test notification" --mode autonomous
```

### Gmail Setup

1. Enable 2FA: https://myaccount.google.com/security
2. Create App Password: https://myaccount.google.com/apppasswords
3. Use app password as `EMAIL_PASS`

### Other Providers

**Outlook:**
```bash
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
```

**SendGrid:**
```bash
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=<sendgrid-api-key>
```

## Slack Notifications

### Quick Setup

1. **Create Incoming Webhook**:
   - Go to https://api.slack.com/apps
   - Create New App → From Scratch
   - Enable "Incoming Webhooks"
   - Add New Webhook to Workspace
   - Copy webhook URL

2. **Add to policy**:
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

3. **Test**:
```bash
node scripts/amber.js session start --goal "test slack" --mode autonomous
```

### Advanced Configuration

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhookUrl": "${SLACK_WEBHOOK_URL}",
      "channel": "#amber-notifications",
      "username": "Amber Bot",
      "iconEmoji": ":robot_face:",
      "events": ["session-completed", "session-failed", "gate-blocked", "budget-exceeded"]
    }
  }
}
```

Use environment variable:
```bash
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX
```

## Event Types

| Event | When Triggered | Severity |
|-------|----------------|----------|
| `session-started` | Session begins | Info |
| `session-completed` | Session succeeds | Success |
| `session-failed` | Session fails | Error |
| `gate-blocked` | Gate needs approval | Warning |
| `budget-exceeded` | Token limit hit | Warning |

## Notification Content

### Email Format

```
Subject: [Amber] Session Completed: implement-user-auth

Session ID: abc123def
Goal: implement user authentication
Status: completed
Duration: 15m 23s
Tokens Used: 45,230 / 100,000

Timeline: .amber/sessions/abc123def/timeline.jsonl
```

### Slack Format

```
✅ Session Completed
Goal: implement user authentication
Duration: 15m 23s
Tokens: 45,230 / 100,000
Session: abc123def
```

## Troubleshooting

### Email Not Sending

**Check credentials**:
```bash
echo $EMAIL_HOST $EMAIL_USER
```

**Test SMTP connection**:
```bash
telnet smtp.gmail.com 587
```

**Check logs**:
```bash
cat .amber/logs/harness.log | grep email
```

### Slack Not Receiving

**Verify webhook URL**:
```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test from Amber"}' \
  $SLACK_WEBHOOK_URL
```

**Check policy syntax**:
```bash
node scripts/amber.js governance policy
```

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
source .env
node scripts/amber.js session start --mode autonomous
```

### Rotate Credentials

**Email:** Regenerate app password monthly  
**Slack:** Regenerate webhook URL quarterly

## CI/CD Integration

### GitHub Actions

```yaml
name: Autonomous Session
on: push

jobs:
  amber:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Amber
        env:
          EMAIL_HOST: ${{ secrets.EMAIL_HOST }}
          EMAIL_USER: ${{ secrets.EMAIL_USER }}
          EMAIL_PASS: ${{ secrets.EMAIL_PASS }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          node scripts/amber.js session start \
            --goal "automated fix" \
            --mode autonomous
```

### GitLab CI

```yaml
amber:
  script:
    - export EMAIL_HOST=$EMAIL_HOST
    - export EMAIL_USER=$EMAIL_USER
    - export EMAIL_PASS=$EMAIL_PASS
    - node scripts/amber.js session start --mode autonomous
  variables:
    EMAIL_HOST: smtp.gmail.com
  only:
    - main
```

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
