# Governance Model Architecture

## Overview

The governance model provides policy definition, evidence export, audit trails, and boundary enforcement for agent-assisted workflows. It implements a control-first approach where projects explicitly define what autonomous agents MAY and MAY NOT do.

**Design Principle:** Governance surfaces are read-only or write-to-governance-dir-only. They never modify session state or auto-approve gates. Since [ADR-0003](../adr/0003-governance-gated-execution.md), Amber may execute a loop contract's declared `governed.command` (or a route command-stage's `target`) under four explicit gates — policy, approval, worktree isolation, and a tamper-evident ledger. This is governance-gated, human-triggered execution, NOT autonomous or scheduled work.

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
├── rules.json             # Declarative command policy (GLX gate 1, deny-wins/default-deny)
└── evidence/              # Exported evidence reports
    └── 2026-06-21/

.amber/loops/<contractId>/
└── ledger.jsonl           # Hash-chain governed-execution ledger (GLX gate 4)

.amber/routes/<routeId>/
└── ledger.jsonl           # Route-stage governed-execution ledger

.amber/sessions/<id>/
├── timeline.jsonl         # Session event timeline (state-machine source of truth)
├── manifest.json          # Session manifest
└── ledger.jsonl           # Tamper-evident mirror of verify/approve events
```

## Architecture Components

### 1. Policy Definition

#### Governed command policy (`rules.json` / `verify-rules.json`) — primary

**Purpose:** Declarative allow/deny rules for the two live execution surfaces:

| File | Surface | Evaluator |
|------|---------|-----------|
| `.amber/governance/rules.json` | `governed-runner` (loop / route command stages) | `evaluateGovernedPolicy` |
| `.amber/governance/verify-rules.json` | `evidence-runner` (`session verify --execute`) | `evaluateVerifyPolicy` |

Both surfaces apply **un-removable built-in denies** first (destructive patterns + shell composition), then the file's rules, then `defaultAction` (safe default: `deny`). Scaffold with `amber governance rules init`. Dry-run a command with `amber governance rules check --command "…"` — same verdict as governed execution.

#### Leftover autonomous policy (`autonomous-policy.json`) — compat only

**Purpose:** Optional on-disk remnant from pre-ADR-0005 autonomous execution. **There is no auto-approve executor.** `loadPolicy` still reads `.amber/autonomous-policy.json` so `governance policy` can warn on unsafe leftovers; missing file degrades to fail-safe defaults (`user-approval: block`).

**Schema (historical / leftover):**
```json
{
  "gates": {
    "auto": "approve",
    "user-approval": "block",
    "step-confirm": "block"
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
- `auto-approve-all` is a CLI flag, NOT a policy file setting (security boundary); `inspectPolicy` errors if the key appears in the file
- `user-approval: "approve"` on a leftover file triggers a warning (cannot auto-approve; executor removed)
- Policy files are config, not executable code
- Do not require `autonomous-policy.json` for execution readiness — that check keys off `rules.json` (see `checkExecutionReadiness`)

#### Human-Readable Policy (`POLICY.md`)

**Purpose:** Human-readable policy documentation for project teams.

**Sections:**
- Agent permissions (what agents may do autonomously)
- Gate approval rules (which low-risk gates may approve automatically)
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

**Exported Data (from live `timeline.jsonl`):**
- Session metadata (goal, start, end) from `session_created` / terminal session events
- Commands / verification from `stage_completed` and `verification_failed` that carry `data.command` (what `session verify --execute` actually writes). Legacy `command_executed` / `tool_call` lines are still recognized if present in old timelines
- Approval gates: `gate_triggered` / `gate_passed` / `gate_failed` (gate id from `data.gate` or `data.gateId`)
- Errors: `error`, `stage_failed`, `verification_failed`
- Budget: `budget_warning` / `budget_exceeded` when present

**Output Format (Markdown, simplified):**
```markdown
# Session Evidence

**Session ID:** abc-123
**Goal:** Fix login bug
**Started:** 2026-06-21T10:00:00Z
**Ended:** 2026-06-21T10:30:00Z
**Status:** session_completed

## Commands / Verification

- `npm test` (executed, exit 0) (2026-06-21T10:01:05Z)

## Approval Gates

- gate_passed: user-approval-plan (2026-06-21T10:05:00Z)
- gate_passed: user-approval-implement (2026-06-21T10:20:00Z)
```

Amber does **not** currently write agent tool-call traces (`Read`/`Edit`/`Bash`) into the session timeline — only governed stage/gate/session events from the CLI surface.

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
  gates.user-approval: block
  gates.step-confirm: block
  retry.maxAttempts: 3
  budget.onExceed: pause

Overrides:
  gates.user-approval: block [OK]
  retry.maxAttempts: 5 [OK]

Errors:
  [❌] Policy file contains 'auto-approve-all' key
       This is a CLI flag only, not a policy setting.
       Remove from .amber/autonomous-policy.json

Recommendations:
  - Keep gates.user-approval: "block" unless a live approval process exists
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

### 6. Governed Loop Execution — GLX ([ADR-0003](../adr/0003-governance-gated-execution.md))

The GLX subsystem adds governance-gated, human-triggered command execution for loop contracts and route command-stages. It extends the governance model from pure inspection into governed, gated action without becoming an agent runtime.

**Four gates** — every governed execution must pass all four:

1. **Policy gate (`.amber/governance/rules.json`)** — declarative allow/deny rules with deny-wins and `defaultAction: deny`. A command matching any deny rule is rejected; a command with no allow match under default-deny is also rejected. Loop contracts and route stages may declare per-context rules that compose with the global policy.

2. **Approval gate (`amber loop approve` / `amber route approve`)** — an explicit human sign-off recorded in the hash-chain ledger. One approval authorises exactly one execution (replay protection via `approvalKey`/`consumedApprovalKey` pairing).

3. **Isolation gate (git worktree)** — the command runs in a dedicated worktree under `.amber/worktrees/`. The user's main checkout is never the cwd. The worktree is cleaned up after execution.

4. **Evidence gate (hash-chain ledger)** — every attempt (allowed, denied, executed) appends a record to a per-context ledger (`.amber/loops/<id>/ledger.jsonl`, `.amber/routes/<id>/ledger.jsonl`). Each record carries the previous record's SHA-256 hash, so any edit breaks the chain (`amber loop verify-ledger` detects it). Session verify/approve events are also mirrored to `.amber/sessions/<id>/ledger.jsonl` for tamper-evidence.

**Honest standards mapping** — `amber governance standards` reports each OWASP ASI risk as `governance` / `partial` / `out-of-scope` based on which controls are actually deployed in the target repo. Runtime-only risks are never falsely claimed as covered.

**Readiness integration** — `amber governance readiness` inspects GLX state: missing or unsafe `rules.json` triggers a warning / block; tampered hash-chain ledgers trigger a hard block.

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

### Policy Enforcement (live)

Autonomous execution was **removed** (ADR-0001 / ADR-0005). There is no
`executeAutonomous` / `shouldAutoApproveGate` path. Live enforcement is:

```javascript
// Governed loop / route command stage (four gates: policy, approval, worktree, ledger)
const { evaluateGovernedPolicy, loadPolicyRules } = require('./loop-policy');
const verdict = evaluateGovernedPolicy(command, loadPolicyRules(projectRoot));

// Session verify --execute
const { evaluateVerifyPolicy, loadVerifyPolicyRules } = require('./loop-policy');
const verifyVerdict = evaluateVerifyPolicy(command, loadVerifyPolicyRules(projectRoot));
```

`amber session approve --gate <id> --yes` records human approval; workers cannot
self-approve. Optional leftover `.amber/autonomous-policy.json` is inspected only:

```javascript
const { loadPolicy } = require('./autonomous-policy');
const policy = loadPolicy(projectRoot); // fail-safe defaults if missing/corrupt
// inspectPolicy warns if gates['user-approval'] === 'approve' — no executor consumes it
```

### Evidence Collection (live)

Timeline events are appended via the deep module `session-timeline.js`
(`appendSessionEvent` / `readSessionEvents`). `timeline-writer.js` /
`timeline-reader.js` were deleted. Verification evidence looks like:

```javascript
const { appendSessionEvent } = require('./session-timeline');

// session verify --execute success
appendSessionEvent(sessionDir, {
  type: 'stage_completed',
  data: {
    stage: 'verify',
    command: 'npm test',
    result: 'passed',
    executed: true,
    exitCode: 0,
    durationMs: 83527,
  },
});
```

Evidence export:

```javascript
const { exportSessionEvidence } = require('./governance');
exportSessionEvidence(sessionId, projectRoot, outputPath);
// Counts stage_completed / verification_failed with data.command (and legacy types)
```

Audit summaries use the same `isCommandLikeEvent` predicate so live dogfood
sessions no longer report `commands: 0`.

## Security Boundaries

1. **CLI Flag vs Policy File:**
   - `auto-approve-all` must not appear in policy files (`inspectPolicy` errors)
   - Built-in deny-destructive + shell-composition cannot be dropped by custom rules
   - Human gate approval is explicit (`session approve`); no policy auto-approve executor

2. **Read-Only by Default:**
   - Governance inspect/audit/evidence never mutate session state
   - Evidence export is read-only
   - Audit reports are write-once artifacts

3. **Boundary Enforcement:**
   - Product boundaries live in Operating Manual / ADR-0003 (policy, approval, worktree, ledger)
   - Enforcement is at the governed/evidence runners, not only in docs
   - Policy denials and verification failures are ledgered / timeline-recorded

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
