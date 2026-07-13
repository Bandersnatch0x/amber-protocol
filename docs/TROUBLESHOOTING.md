# Troubleshooting Guide

Common issues and solutions for Amber Protocol.

## Session Issues

### Session Stuck in "Running"

**Symptoms:** `session status` shows "running" but no progress.

**Diagnosis:**
```bash
# Check if process exists
ps aux | grep amber

# Check last timeline event
tail -1 .amber/sessions/<session-id>/timeline.jsonl

# Check system health
node scripts/amber.js maintenance inspect --target .
```

**Solutions:**

1. **Abort and restart**:
```bash
node scripts/amber.js session abort <session-id>
node scripts/amber.js session start --goal "..." --route <route>
```

2. **Continue from checkpoint**:
```bash
node scripts/amber.js session continue <session-id>
```

### Session Fails Immediately

**Symptoms:** Session exits with error on start.

**Common causes:**

1. **Invalid route**:
```bash
# List available routes
node scripts/amber.js route list

# Validate route
node scripts/amber.js route validate <route-file>
```

2. **Missing policy**:
```bash
# Check policy exists
ls .amber/autonomous-policy.json

# Inspect policy
node scripts/amber.js governance policy
```

3. **Low disk space**:
```bash
# Check system health
node scripts/amber.js maintenance inspect --target .

# View disk usage
df -h .
```

### Budget Exceeded Immediately

**Symptoms:** Session pauses/aborts with "Budget exceeded" after first stage.

**Solutions:**

1. **Increase budget**:
```json
{
  "budget": {
    "maxTokens": 200000  // Was 50000
  }
}
```

2. **Use lightweight route**:
```bash
node scripts/amber.js session start \
  --goal "..." \
  --route bugfix-quick  # Instead of feature-standard
```

3. **Break into smaller goals**:
```bash
# Instead of: "implement complete auth system"
# Use: "implement login endpoint only"
```

## Gate Issues

### All Gates Failing

**Symptoms:** Every gate requires approval despite policy.

**Diagnosis:**
```bash
# Check policy syntax
node scripts/amber.js governance policy

# Inspect route gates
node scripts/amber.js route inspect <route-id>
```

**Solutions:**

1. **Fix policy syntax**:
```json
{
  "gates": {
    "user-approval": "block",  // Not "user_approval"
    "security-review": "block"
  }
}
```

2. **Ensure gate types match**:
```bash
# Route defines: "user-approval"
# Policy must use: "user-approval" (not "user_approval")
```

### Gate Approval Not Working

**Symptoms:** Manual approval doesn't resume session.

**Solutions:**

1. **Use correct approval command**:
```bash
# Wrong
node scripts/amber.js session approve <session-id>

# Right
node scripts/amber.js session continue <session-id>
```

2. **Check session state**:
```bash
node scripts/amber.js session status <session-id>
# Should show "paused" not "aborted"
```

## Notification Issues

### Email Not Sending

**Diagnosis:**
```bash
# Check environment variables
echo $EMAIL_HOST $EMAIL_USER

# Check logs
cat .amber/logs/harness.log | grep -i email
```

**Solutions:**

1. **Set all required variables**:
```bash
export EMAIL_HOST=smtp.gmail.com
export EMAIL_PORT=587
export EMAIL_USER=your@email.com
export EMAIL_PASS=your-app-password
```

2. **Test SMTP connection**:
```bash
telnet smtp.gmail.com 587
# Should connect successfully
```

3. **Use app password** (Gmail):
   - Enable 2FA: https://myaccount.google.com/security
   - Generate app password: https://myaccount.google.com/apppasswords

### Slack Not Receiving

**Diagnosis:**
```bash
# Test webhook directly
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test"}' \
  $SLACK_WEBHOOK_URL
```

**Solutions:**

1. **Verify webhook URL**:
   - Should start with `https://hooks.slack.com/services/`
   - Check for typos in policy

2. **Regenerate webhook**:
   - Go to https://api.slack.com/apps
   - Your App → Incoming Webhooks
   - Generate new webhook URL

## Worktree Issues

### Worktree Creation Fails

**Symptoms:** `Error creating worktree` on session start.

**Diagnosis:**
```bash
# Check git status
git status

# List existing worktrees
git worktree list

# Check disk space
df -h .
```

**Solutions:**

1. **Clean up stale worktrees**:
```bash
git worktree prune
```

2. **Remove specific worktree**:
```bash
git worktree remove .amber/worktrees/<session-id>
```

3. **Disable worktree isolation**:
```json
{
  "worktree": {
    "enabled": false
  }
}
```

### Worktree Not Cleaned Up

**Symptoms:** `.amber/worktrees/` directory fills up.

**Solutions:**

1. **Enable auto-cleanup**:
```json
{
  "worktree": {
    "cleanupOnSuccess": true,
    "cleanupOnFailure": false
  }
}
```

2. **Manual cleanup**:
```bash
# List worktrees
git worktree list

# Remove old worktrees
git worktree remove .amber/worktrees/<session-id>
git worktree prune
```

## Performance Issues

### Sessions Running Slowly

**Diagnosis:**
```bash
# Check system resources
node scripts/amber.js maintenance inspect --target .

# View session metrics
cat .amber/sessions/<session-id>/manifest.json | grep duration
```

**Solutions:**

1. **Check system health**:
```bash
# Memory
free -h

# CPU
top

# Disk I/O
iostat
```

2. **Reduce parallel sessions**:
```bash
# Run one session at a time
node scripts/amber.js session list
# Abort unnecessary sessions
```

3. **Optimize budget**:
```json
{
  "budget": {
    "maxTokens": 75000  // Reduce from 200000
  }
}
```

### Timeline File Growing Too Large

**Symptoms:** `.amber/sessions/<id>/timeline.jsonl` > 100MB.

**Solutions:**

1. **Archive old sessions**:
```bash
# Move to archive
mkdir -p .amber/archive/2024-06
mv .amber/sessions/<old-session-id> .amber/archive/2024-06/
```

2. **Compress timelines**:
```bash
gzip .amber/sessions/<session-id>/timeline.jsonl
```

## Test Failures

### Tests Pass Locally, Fail in CI

**Common causes:**

1. **Missing environment variables**:
```yaml
# Add to CI config
env:
  EMAIL_HOST: ${{ secrets.EMAIL_HOST }}
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

2. **Filesystem differences**:
```bash
# Use platform-agnostic paths
path.join(__dirname, 'file')  # Not __dirname + '/file'
```

3. **Timing issues**:
```bash
# Increase timeouts in CI
npm test -- --timeout=60000
```

### Specific Test Failing

**Diagnosis:**
```bash
# Run single test file
npm test -- tests/unit/<test-name>.test.js

# Run with verbose output
npm test -- --reporter=tap tests/unit/<test-name>.test.js
```

**Solutions:**

1. **Check test isolation**:
```javascript
// Clean up after each test
test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

2. **Fix race conditions**:
```javascript
// Wait for async operations
await new Promise(resolve => setTimeout(resolve, 100));
```

## Background Execution Issues

Amber V1 does not provide daemon commands. If a workflow expects `amber daemon start`, replace it with explicit read-only or governed commands.

### CI Job Starts Unsupported Background Work

**Diagnosis:**

```bash
node scripts/amber.js doctor --target .
node scripts/amber.js governance report --target .
```

**Solutions:**

1. Remove `amber daemon ...` and `session start --mode autonomous` from CI jobs.
2. Use `doctor`, `governance report`, `handoff bundle`, and `handoff validate` for automated checks.
3. Let a human start and approve governed sessions when work needs mutation or external writes.

### Session Needs Manual Stop

```bash
node scripts/amber.js session status --target . <session-id>
node scripts/amber.js session abort --target . <session-id>
```

## Getting Help

### Collect Diagnostic Info

```bash
# System info
node --version
npm --version
git --version
uname -a

# Amber info
node scripts/amber.js --version
node scripts/amber.js doctor --target .

# Session info
node scripts/amber.js session status
node scripts/amber.js governance policy

# Governance report
node scripts/amber.js governance report --target .
```

### Report Issues

Include:
1. Diagnostic info (above)
2. Steps to reproduce
3. Expected vs actual behavior
4. Relevant logs/timeline

## Next Steps

- Return to [Autonomous Mode Guide](AUTONOMOUS_MODE_GUIDE.md)
- Review [Policy Configuration](POLICY_CONFIGURATION.md)
- Check [CLI Reference](CLI_REFERENCE.md)
