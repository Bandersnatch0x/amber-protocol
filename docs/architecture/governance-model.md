# Governance Model Architecture

## Overview

The governance model provides policy definition, evidence export, audit trails, and boundary enforcement for agent-assisted workflows. It implements a control-first approach where projects explicitly define what autonomous agents MAY and MAY NOT do.

**Design Principle:** Governance surfaces are read-only or write-to-governance-dir-only. They never execute agent work, modify session state, or auto-approve gates.

## Core Concepts

### Governance as Control Layer

The governance model sits above execution:

```
User Intent
    ↓
Policy Definition (what agents may do)
    ↓
Boundary Enforcement (what agents must not do)
    ↓
Session Execution (with governance constraints)
    ↓
Evidence Export (audit trail)
    ↓
Compliance Verification
```

### Governance Directory Structure

```
.amber/governance/
├── POLICY.md               # Agent permission defaults
├── BOUNDARIES.md           # Explicit restrictions
├── AUDIT_LOG.md           # Inspection and retention guide
└── evidence/              # Exported evidence reports
    └── 2026-06-21/
        ├── session-abc-123.md
        ├── task-xyz-789.md
        └── audit-report.md
```

## Architecture Components

### 1. Policy Definition

#### Autonomous Policy (`autonomous-policy.json`)

**Purpose:** Machine-readable policy configuration for autonomous execution.

**Schema:**
```json
{
  "gates": {
    "auto": "approve",
    "user-approval": "approve|skip|reject",
    "step-confirm": "approve|skip|reject"
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [1000, 5000, 15000],
    "retryableStages": ["implement", "verify"]
  },
  "budget": {
    "onExceed": "pause|abort"
  },
  "notifications": {
    "email": {
      "enabled": false,
      "to": "",
      "triggers": ["session_failed"]
    },
    "slack": {
      "enabled": false,
      "webhook": "",
      "triggers": ["session_completed", "session_failed"]
    }
  }
}
```

**Key Constraints:**
- `auto-approve-all` is a CLI flag, NOT a policy file setting (security boundary)
- `user-approval: "approve"` triggers a warning (unsafe for production)
- Policy files are config, not executable code

#### Human-Readable Policy (`POLICY.md`)

**Purpose:** Human-readable policy documentation for project teams.

**Sections:**
- Agent permissions (what agents may do autonomously)
- Gate approval rules (which gates auto-approve)
- Retry budgets (how many retries per stage)
- Budget limits (token/time thresholds)
- Notification channels (email/Slack webhooks)

**Format:** Markdown with examples and rationale

#### Boundary Definition (`BOUNDARIES.md`)

**Purpose:** Explicit non-goals and restrictions.

**Sections:**
- **Blocked Commands:** Shell commands that must never run
- **File Access Restrictions:** Directories/files that must not be modified
- **External Service Allowlist:** APIs/URLs that may be called
- **Non-Goals:** Work types that are out of scope
- **Escalation Policy:** When to pause and ask user

**Example:**
```markdown
## Blocked Commands
- `rm -rf /`
- `dd if=/dev/zero`
- `curl ... | bash`
- Any command containing `--force` or `--no-verify`

## File Access Restrictions
- Never modify: .git/, package-lock.json, node_modules/
- Never read: .env, secrets/, credentials/

## External Service Allowlist
- Allowed: api.openai.com, api.anthropic.com
- Blocked: All other external APIs
```

### 2. Evidence Export

#### Session Evidence Export (`G2`)

**Command:**
```bash
amber governance evidence --session <id> --output <file>
amber governance evidence --all --output-dir <dir>
```

**Purpose:** Export session timelines into reviewable Markdown.

**Exported Data:**
- Session metadata (ID, goal, start time, end time)
- Command sequence (all shell commands executed)
- Tool calls (all API calls made)
- Approval decisions (gates approved/rejected with timestamps)
- Errors and failures (with stack traces)
- Budget usage (tokens, time, API calls)

**Output Format (Markdown):**
```markdown
# Session Evidence Report

**Session ID:** abc-123
**Goal:** Fix login bug
**Started:** 2026-06-21T10:00:00Z
**Completed:** 2026-06-21T10:30:00Z
**Status:** success

## Command Sequence

1. `git status` (10:00:01) → exit 0
2. `npm test` (10:01:05) → exit 1 (3 failures)
3. `git add src/login.ts` (10:15:30) → exit 0
4. `git commit -m "fix: login validation"` (10:15:32) → exit 0

## Tool Calls

- `Read(src/login.ts)` (10:02:10)
- `Edit(src/login.ts, ...)` (10:14:22)
- `Bash(npm test, ...)` (10:15:40)

## Approval Decisions

- `user-approval-fix` (10:05:00) → APPROVED (user)
- `user-approval-merge` (10:20:00) → APPROVED (auto-policy)

## Errors

- Stage `verify` failed (10:08:30): AssertionError: Expected 3 passing tests

## Budget Usage

- Tokens: 15,420
- Duration: 1800 seconds
- API Calls: 42
```

#### Execution Evidence Export

**Purpose:** Export task execution evidence (for worktree-based executions).

**Exported Data:**
- Task ID, plan summary
- Worktree path
- Execution ledger (commands + results)
- Evidence pack (verification results)
- Exit code and status

### 3. Policy Inspection (`G3`)

**Command:**
```bash
amber governance policy --target <repo> [--json]
```

**Purpose:** Compare project policy against defaults and detect unsafe configurations.

**Inspection Results:**

1. **Policy Drift Report:**
   - Default gates vs overridden gates
   - Default retry config vs custom retry config
   - Default budget vs custom budget

2. **Security Warnings:**
   - `auto-approve-all` in policy file → ERROR (must be CLI flag only)
   - `user-approval: "approve"` → WARNING (unsafe for production)
   - `budget.onExceed: "abort"` without human review → WARNING

3. **Recommendations:**
   - Suggested safer policy configurations
   - Best practices based on project type

**Output Format:**
```
Policy Inspection: /path/to/project

Defaults:
  gates.auto: approve
  gates.user-approval: skip
  gates.step-confirm: skip
  retry.maxAttempts: 3
  budget.onExceed: pause

Overrides:
  gates.user-approval: approve [⚠️  WARNING: Auto-approves user gates]
  retry.maxAttempts: 5 [OK]

Errors:
  [❌] Policy file contains 'auto-approve-all' key
       This is a CLI flag only, not a policy setting.
       Remove from .amber/autonomous-policy.json

Recommendations:
  - Consider gates.user-approval: "skip" for production safety
  - Add notification channels for critical failures
```

### 4. Audit Report Generation (`G4`)

**Command:**
```bash
amber governance audit --target <repo> --output <file> [--since <date>]
```

**Purpose:** One-command governance report combining policy, evidence, and compliance.

**Report Sections:**

1. **Policy Snapshot**
   - Current policy configuration
   - Overrides from defaults
   - Security warnings

2. **Session Summary Table**
   ```
   | Session ID | Goal | Started | Completed | Commands | Approvals | Status |
   |------------|------|---------|-----------|----------|-----------|--------|
   | abc-123 | Fix login | 10:00 | 10:30 | 15 | 2 | success |
   | def-456 | Add feature | 11:00 | 12:45 | 42 | 5 | success |
   ```

3. **Execution Summary Table**
   ```
   | Task ID | Plan | Status | Commands | Duration |
   |---------|------|--------|----------|----------|
   | xyz-789 | Refactor auth | success | 28 | 45m |
   ```

4. **Retention Compliance**
   - Sessions older than retention policy (if set)
   - Executions older than retention policy
   - Recommended cleanup actions

**Output Format:** Markdown report with tables and warnings

### 5. Governance Starter Docs (`G1`)

**Command:**
```bash
amber governance docs --target <repo>
```

**Purpose:** Scaffold governance documentation templates.

**Created Files:**

1. **POLICY.md** - Human-readable policy guide
2. **BOUNDARIES.md** - Explicit restrictions
3. **AUDIT_LOG.md** - Inspection and retention guide

**Behavior:**
- Idempotent (skips existing files)
- Optional (doctor doesn't require governance/ directory)
- Customizable templates

## CLI Commands

### G1: Governance Docs

```bash
amber governance docs --target <repo>
```

**Purpose:** Install governance starter documentation.

**Output:**
- `.amber/governance/POLICY.md`
- `.amber/governance/BOUNDARIES.md`
- `.amber/governance/AUDIT_LOG.md`

**Options:** None (idempotent by default)

### G2: Evidence Export

```bash
# Export single session
amber governance evidence --session <id> --output <file>

# Export single task execution
amber governance evidence --task <id> --output <file>

# Export all sessions/executions
amber governance evidence --all --output-dir <dir>
```

**Purpose:** Export session/execution evidence to Markdown.

**Output:** Markdown files with timeline, commands, approvals, errors

**Options:**
- `--session <id>` - Session to export
- `--task <id>` - Task execution to export
- `--all` - Export all sessions and executions
- `--output <file>` - Output file path
- `--output-dir <dir>` - Output directory (for --all)

**Future:**
- `--redact` - Sanitize sensitive data (file paths, command args)

### G3: Policy Inspection

```bash
amber governance policy --target <repo> [--json]
```

**Purpose:** Inspect and validate policy configuration.

**Output:** Policy diff, security warnings, recommendations

**Options:**
- `--json` - JSON output for programmatic use

**Validation:**
- Rejects `auto-approve-all` in policy file
- Warns on unsafe gate configurations
- Reports policy drift from defaults

### G4: Audit Report

```bash
amber governance audit --target <repo> --output <file> [--since <date>]
```

**Purpose:** Generate comprehensive governance audit report.

**Output:** Markdown report with policy + evidence + compliance

**Options:**
- `--since <date>` - Filter sessions/executions after date
- `--output <file>` - Output file path

## Integration with Other Systems

### Policy Enforcement

Policy is loaded by autonomous executor:
```javascript
const { loadPolicy } = require('./autonomous-policy');
const { executeAutonomous } = require('./autonomous-executor');

const policy = loadPolicy(projectRoot);
await executeAutonomous(sessionId, { policy });
```

Gate handler checks policy for auto-approval:
```javascript
const { shouldAutoApproveGate } = require('./autonomous-policy');

if (shouldAutoApproveGate(gate.type, policy)) {
  approveGate(sessionId, gate.id);
} else {
  pauseForUserApproval(sessionId, gate.id);
}
```

### Evidence Collection

Timeline writer automatically records all events:
```javascript
const { appendEvent } = require('./timeline-writer');

appendEvent(sessionId, {
  type: 'command_executed',
  command: 'npm test',
  exitCode: 0,
  timestamp: new Date().toISOString()
});
```

Evidence export reads timeline and formats:
```javascript
const { getTimeline } = require('./timeline-reader');
const { exportSessionEvidence } = require('./governance');

const timeline = getTimeline(sessionId);
await exportSessionEvidence(sessionId, outputPath);
```

## Security Boundaries

1. **CLI Flag vs Policy File:**
   - `auto-approve-all` is CLI flag only (explicit user intent)
   - Policy files cannot enable blanket auto-approval
   - G3 validation rejects `auto-approve-all` in policy files

2. **Read-Only by Default:**
   - Governance commands never modify session state
   - Evidence export is read-only
   - Audit reports are write-once

3. **Boundary Enforcement:**
   - BOUNDARIES.md documents restrictions
   - Enforcement happens at execution layer (not governance layer)
   - Violations logged to timeline

## Design Principles

1. **Control-First:** Governance defines constraints before execution
2. **Evidence-Based:** All decisions recorded in audit trail
3. **Human-Readable:** Markdown reports for team review
4. **Machine-Readable:** JSON for tooling integration
5. **Fail-Safe:** Unsafe configurations produce errors, not silent failures

## Future Enhancements

- Evidence redaction for sensitive data
- Automated retention policy enforcement
- Policy version control and migration
- Compliance report templates (SOC2, ISO27001)
- Real-time policy violation alerts
- Policy simulation (dry-run with policy)
