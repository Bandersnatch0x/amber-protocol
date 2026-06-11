# Phase 2: Governance Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Phase 1 (Amber Protocol rename) — merged to master 2026-06-11

**Goal:** Add 4 governance CLI commands (G1–G4) that surface policy, evidence, and audit trails without executing agent work, completing the control-layer emphasis from SPEC positioning.

---

## G1: `amber governance docs` — install governance starter docs

**Purpose:** Scaffold `.amber/governance/` with POLICY.md, BOUNDARIES.md, AUDIT_LOG.md starters so projects can define what autonomous agents MAY and MAY NOT do.

### Steps

- [ ] G1.1: Create `templates/governance/POLICY.md` — agent permission defaults, approval gates, retry budget, notification channels (mirrors `autonomous-policy.json` schema but human-readable)
- [ ] G1.2: Create `templates/governance/BOUNDARIES.md` — explicit non-goals, blocked commands, file access restrictions, external service allow/blocklist
- [ ] G1.3: Create `templates/governance/AUDIT_LOG.md` — timeline inspection guide, evidence export commands, retention policy template
- [ ] G1.4: Add `governanceDocs()` in `scripts/lib/core/governance.js` — scaffold + idempotent logic (skip existing)
- [ ] G1.5: Wire `amber governance docs --target <repo>` in `scripts/amber.js`
- [ ] G1.6: Test: init empty repo → governance docs → files exist, re-run safe, doctor accepts missing governance/ (it's optional)

---

## G2: `amber governance evidence` — export session/execution evidence

**Purpose:** Export `.amber/sessions/*/timeline.jsonl` + `.amber/executions/*/evidence.json` into reviewable Markdown without modifying source state.

### Steps

- [ ] G2.1: Add `exportSessionEvidence(sessionId, outputPath)` in `scripts/lib/core/governance.js`
  - Read `timeline.jsonl` via `timeline-reader.js`
  - Extract: session start/end, goal, commands run, tool calls, errors, approval gates hit, budget spent
  - Write Markdown with timestamp, command sequence, approval decisions, error context
- [ ] G2.2: Add `exportExecutionEvidence(taskId, outputPath)` — same shape for task executions (ledger + evidence pack)
- [ ] G2.3: Wire `amber governance evidence --session <id> --output <file>` and `--task <id>` variants
- [ ] G2.4: Test: run session → export evidence → Markdown contains goal + commands + approvals; run task → export → Markdown contains plan + worktree + commands
- [ ] G2.5: Add `--all` flag: export all sessions/executions into `governance/evidence/<timestamp>/` batch report

---

## G3: `amber governance policy` — check policy vs defaults + W1 fix

**Purpose:** Inspect `.amber/autonomous-policy.json`, compare to default, report drift; **also fixes W1 by rejecting `auto-approve-all` in policy files** (it's a CLI flag only).

### Steps

- [ ] G3.1: Add `inspectPolicy(projectRoot)` in `scripts/lib/core/governance.js`
  - Load policy via `autonomous-policy.js:loadPolicy()`
  - Compare to `getDefaultPolicy()` — report overridden gates, retry config, budget
  - Detect `auto-approve-all` in file → error "auto-approve-all is a CLI flag, not a policy setting; remove from file"
  - Detect unsafe `gates: { "user-approval": "approve" }` → warning
- [ ] G3.2: Wire `amber governance policy --target <repo> [--json]`
- [ ] G3.3: Test: no policy file → shows defaults; custom policy → shows diff; policy with `auto-approve-all` key → errors; unsafe gate override → warns
- [ ] G3.4: **W1 fix verification:** `scripts/lib/autonomous-session.js` must NOT read `auto-approve-all` from policy file (only CLI flag)

---

## G4: `amber governance audit` — export audit.md with policy + evidence + timeline summary

**Purpose:** One-command governance report: policy snapshot + all session/execution summaries + retention compliance check.

### Steps

- [ ] G4.1: Add `generateAuditReport(projectRoot, outputPath)` in `scripts/lib/core/governance.js`
  - Section 1: Policy snapshot (from G3)
  - Section 2: Session summary table (id, goal, start, end, commands count, approvals count, status)
  - Section 3: Execution summary table (taskId, plan, status, commands count)
  - Section 4: Retention compliance (list sessions/executions older than policy retention days if set)
- [ ] G4.2: Wire `amber governance audit --target <repo> --output <file>`
- [ ] G4.3: Test: project with 2 sessions + 1 execution → audit.md contains policy + 2 session rows + 1 execution row + retention section
- [ ] G4.4: Add `--since <date>` filter for scoped audit windows

---

## Verification Checklist (Phase 2 完成后)

- [ ] `npm test` — all existing tests green + new governance command tests
- [ ] `amber governance docs --target /tmp/new-repo` → 3 files scaffolded
- [ ] `amber governance evidence --session <id> --output /tmp/e.md` → Markdown with timeline
- [ ] `amber governance policy --target .` → shows defaults vs overrides
- [ ] Policy file with `auto-approve-all` key → explicit error (W1 fix)
- [ ] `amber governance audit --target . --output /tmp/audit.md` → full report
- [ ] `npm run manifests` — green

---

## Notes

- **No execution:** All G1–G4 commands are read-only or write-to-governance-dir-only — they never run sessions, modify state, or auto-approve gates.
- **Policy files are config, not code:** `.amber/autonomous-policy.json` must NOT accept `auto-approve-all` (W1) — it's a runtime CLI flag with explicit user intent.
- **Evidence privacy:** Timeline exports may contain sensitive data (file paths, command args); add `--redact` flag (future) for sanitized reports.
- **Retention:** Phase 2 only reports age; actual cleanup is Phase 3 (maintenance automation).
