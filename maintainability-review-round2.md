# Phase B/C — Simplicity & Maintainability Review (Round 2)

**Reviewer:** Maintainability subagent  
**Date:** 2026-06-11  
**Files inspected:** autonomous-executor.js, autonomous-policy.js, daemon.js, session-lock.js, logger.js, notifier.js, metrics-collector.js, execution-engine.js, session-commands.js, route-loader.js, stage-executor.js, gate-handler.js, budget-tracker.js, harness-core.js, publish.js, release.js, dry-run.js, rollback.js, schema-validator.js, v5-to-phase-b.js, secret-scan.js, dependency-scan.js, permission-review.js, audit-report.js  
**Previous review consulted:** maintainability-review.md (Round 1)

---

## 1. CODE DUPLICATION

### IMPROVEMENT: `autonomous-executor.js` duplicates the session-finding and validation pattern from `session-commands.js`

**Evidence:**
- `autonomous-executor.js` (lines 11–17): Reads `manifest.json`, checks existence, parses it.
- `session-commands.js` `continueSession()` (lines 236–243): Reads the same `manifest.json`, checks existence, parses it.
- `session-commands.js` `statusSession()` (lines 137–144): Same pattern again.
- `session-commands.js` `abortSession()` (lines 187–192): Same pattern again.

The manifest path computation `path.join(projectRoot, ".harness", "sessions", sessionId, "manifest.json")` is also repeated verbatim in at least 5 places across `session-commands.js` and `autonomous-executor.js`.

**Recommendation:** Extract a `readManifest(projectRoot, sessionId)` helper that returns the parsed manifest or throws. Export it from `session-manifest.js` (which already exists) or `session-commands.js`.

**Impact:** Eliminates ~30 lines of duplicate I/O boilerplate. Reduces risk of path inconsistency.

---

### IMPROVEMENT: Route-pattern copy-paste between `autonomous-executor.js` and `session-commands.js`

**Evidence:**
- `autonomous-executor.js` (lines 19–28): Loads routes from `routesDir`, finds route by ID matching manifest's `route.id`, errors if not found.
- `session-commands.js` `startSession()` (lines 59–72): Loads routes from `ROUTES_DIR`, finds route by ID, errors if not found, extracts version.

The route-loading-and-matching logic is duplicated. `startSession` has the richer version-extraction logic, while `autonomous-executor` has only the lookup. When `route-loader.js` already exports `loadRoutes`, this duplication is unnecessary.

**Recommendation:** Add a `findRoute(routesDir, routeId)` exported function to `route-loader.js` that returns the matched route or null. Use it from both files.

**Impact:** Small — ~8 lines each in both callers replaced by a single call. Prevents divergence.

---

### IMPROVEMENT: `createBackup` in `rollback.js` reimplements the timestamp formatting already done elsewhere

**Evidence:**
- `rollback.js` (lines 37–56): `createBackup` builds a timestamp string manually by concatenating `now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + ...` — 15 lines.
- Node.js has `toISOString()` which produces nearly the same format.

The same manual formatting pattern could appear elsewhere. There's no shared date-formatting utility in the codebase.

**Recommendation:** Either use `toISOString().replace(/[:.]/g, "-")` (as `harness-core.js` line ~1900 already does in `timestampForFileName()`), or extract a shared `formatTimestamp(date)` function. The `timestampForFileName` in `harness-core.js` already does exactly this — but `rollback.js` can't import it without creating a dependency on the massive `harness-core.js` module. This argues for a tiny shared `date-utils.js`.

**Impact:** Minor deduplication. The current code works correctly.

---

### IMPROVEMENT: `release.js` and `publish.js` share a near-identical `run()` helper

**Evidence:**
- `publish.js` (lines 16–24): `function run(cmd, opts)` — execSync wrapper with logging.
- `release.js` (lines 19–27): `function run(cmd, opts)` — *identical* execSync wrapper with logging.

Both scripts are in `scripts/` and use the same pattern. The `run` function is copy-pasted verbatim.

**Recommendation:** Extract to `scripts/lib/script-utils.js` or add to the existing `index.js`.

**Impact:** ~12 lines of duplication eliminated.

---

### NOTE: The 4 migration files are NOT copy-paste despite similar structure

**Evidence:**
- `v5-to-phase-b.js` — migration engine (migrateSettings, migrateAgents, migrateRoutes)
- `dry-run.js` — calls migrateSettings, computes diff, generates summary
- `rollback.js` — backup management, file restoration (no dependency on other migration files)
- `schema-validator.js` — standalone detection and validation (no dependency on other migration files)

Each has a distinct concern. `dry-run.js` depends on `v5-to-phase-b.js` (calls `migrateSettings`), which is a clean dependency — the caller/callee separation is appropriate. `rollback.js` and `schema-validator.js` are completely independent. No copy-paste detected.

---

### NOTE: The 4 security files are NOT copy-paste

**Evidence:**
- `secret-scan.js` — regex-based pattern matching on file content. Pure function.
- `dependency-scan.js` — wraps npm audit JSON output. Standalone.
- `permission-review.js` — validates permissions against usage log. Standalone.
- `audit-report.js` — markdown report generator calling the other 3.

`audit-report.js` depends on the other three by accepting their *output* (not importing them). This is a clean consumer pattern. The scanners do not share a common interface class (they export bare functions), but they don't need one — they are orchestrated by `audit-report.js` which normalizes their return shapes. This is acceptable for the current scale.

---

## 2. MODULE COHESION

### IMPROVEMENT: `daemon.js` does exactly one thing — and that's fine

**Verdict:** `daemon.js` exports 3 functions (`startDaemon`, `stopDaemon`, `getDaemonStatus`) plus one private helper (`isProcessRunning`). All three revolve around a single PID file at `.harness/daemon.pid`. This is **well-scoped** — it does PID management and nothing else. No action needed.

However, one concern:

**NOTE:** `isProcessRunning` uses `process.kill(pid, 0)` which works on Linux/macOS but has undefined behavior on Windows (it *does* work in Node.js on Windows, but the `SIGTERM` sent on stop may not terminate the process reliably). The daemon is currently Linux/Unix-focused, which is fine. Documenting this assumption would help.

---

### IMPROVEMENT: `autonomous-executor.js` vs `autonomous-policy.js` — good separation

**Evidence:**
- `autonomous-policy.js` — pure data access: `loadPolicy`, `shouldAutoApproveGate`, `getRetryConfig`, `getBudgetPolicy`, `getNotificationConfig`. No I/O except loading the JSON file.
- `autonomous-executor.js` — orchestration: loads policy, loads routes, calls `executeSession`, handles retries and budget pause.

These are well-separated. The executor imports from the policy module but not vice versa. **No circular dependency risk.** The separation is clean.

---

### IMPROVEMENT: `session-commands.js` is still too large (as noted in Round 1)

**Round 1 noted this.** The file is ~430 lines and does:
- Path computation (getSessionsDir, getSessionDir)
- Session discovery (findMostRecentSession, findMostRecentNonCompletedSession)
- Lifecycle (start, status, list, abort, continue)
- Manifest I/O
- Timeline I/O
- State machine transitions
- Worktree management
- Autonomous delegation

The `startSession` function (lines 45–132) alone mixes route loading, route selecting, manifest creation, directory creation, timeline writing, worktree creation, and manifest writing. That's ~90 lines handling 7 distinct concerns.

**Recommendation (reiterating Round 1):**
- Extract `session-finder.js` for `findMostRecentSession` / `findMostRecentNonCompletedSession`
- Extract manifest read/write helpers from the inline I/O

---

### IMPROVEMENT: `execution-engine.js` is well-cohesive but `executeSession` is one long function

**Evidence:** `executeSession()` (lines 13–108) is ~96 lines doing:
1. Timeline writer creation
2. Lock acquisition
3. Budget tracker creation
4. Gate map prep
5. Stage iteration (with budget checks, stage execution, gate checks, timeline writes)
6. Persist budget

The stage loop body (lines 41–96) could be extracted into a `processStage(stage, context)` function, but the function is linear and clear. The lock/budget/persist orchestration is legitimate to keep together.

**Verdict:** Not a blocker, but extracting the stage-processing loop would help testability.

---

### NOTE: `session-lock.js` is a model of cohesion

**Evidence:** 4 exports (`acquireLock`, `releaseLock`, `isLocked`, `getLockPath`), all on the same concern. One private path helper. No external imports beyond `fs` and `path`. Lock timeout is a named constant (300000 ms = 5 min). This is **exemplary**. No action needed.

---

### OPTIONAL: `notifier.js` mixes formatting and transport — could split

**Evidence:**
- `formatNotification(eventType, data)` — template-based text formatting
- `sendNotification(eventType, data, config, options)` — dispatch logic
- `sendEmail(...)` — email transport (requires optional `nodemailer`)
- `sendSlack(...)` — Slack webhook transport

The `sendEmail`/`sendSlack` functions silently swallow missing nodemailer and fetch failures. This is pragmatic but hides errors. Consider extracting a `transports/` directory if more transports are added.

**Verdict:** Keep as-is for now. The 4 functions in one file are manageable.

---

## 3. ARCHITECTURE

### NOTE: Directory layout is clear

**Current structure:**
- `scripts/lib/` — CLI command implementations and library modules (27 files)
- `src/migration/` — V5.5 → Phase B migration (4 files)
- `src/security/` — Security scanning tools (4 files)
- `scripts/publish.js` — npm publish wrapper
- `scripts/release.js` — full release automation

The separation is logical. `scripts/lib/` is the core, `src/` contains domain-specific subdirectories. No files in `apps/web/` were reviewed (out of scope), but `src/migration/` and `src/security/` are clearly separated.

---

### IMPROVEMENT: No circular dependencies detected — but one fragile import chain exists

**Evidence:** Let me trace the dependency graph:

```
session-commands.js
  → execution-engine.js (via require in continueSession, lazy)
  → autonomous-executor.js (via require in continueSession, lazy)
  → session-manifest.js
  → timeline-writer.js
  → session-state-machine.js
  → checkpoint-manager.js
  → schema-version-checker.js
  → worktree-manager.js
  → route-selector.js
  → route-loader.js
  → result.js

autonomous-executor.js
  → execution-engine.js
  → autonomous-policy.js
  → route-loader.js
  → timeline-writer.js

execution-engine.js
  → stage-executor.js
  → gate-handler.js
  → budget-tracker.js
  → timeline-writer.js
  → session-lock.js
```

No cycles. However, the **lazy require** in `session-commands.js` `continueSession()`:

```js
const { executeAutonomous } = require("./autonomous-executor");
```

This is a defensive pattern to avoid circular imports (the file doesn't actually have a cycle, so the lazy require is unnecessary). It hides the dependency from static analysis tools. Either:
1. Remove the lazy require and make it a top-level import (preferred, since no cycle exists)
2. Or leave it if the intent is to delay-load the autonomous feature

---

### NOTE: `harness-core.js` is 1900+ lines and deserves scrutiny

`harness-core.js` at 6383+ lines (truncated at 1926) is a monolithic module. It handles scaffolding, plan management, team distribution, adoption reports, wiki linting, and orchestration. This file exceeds any reasonable single-module size. However, it was already partially reviewed in Round 1. Splitting it would be the largest refactor in the codebase.

**For this round:** Noting that `harness-core.js` remains the primary architectural concern. If it grows further, it should be split by domain (scaffold, team, adoption, orchestration).

---

## 4. NAMING

### NOTE: `executeAutonomous` vs `executeSession` vs `executeStages` — clear enough

**Evidence:**
- `executeAutonomous(projectRoot, sessionId, options)` — top-level autonomous session run (in `autonomous-executor.js`)
- `executeSession(sessionDir, manifest, route, options)` — session execution loop (in `execution-engine.js`)
- `executeStage(stage, options)` — single stage execution (in `stage-executor.js`)
- `executeStages(stages, options, shouldContinue)` — batch stage execution (in `stage-executor.js`)
- `executeStagesWithCheckpoints(stages, projectRoot, sessionId, ...)` — stages with checkpoints (in `stage-executor.js`)

The `execute*` prefix is consistent. The parameter signatures are distinct enough. `executeAutonomous` is at the highest level (project + session), `executeSession` is at the session level, and the `stage-executor.js` functions are at the stage level. **Good naming hierarchy.**

---

### NOTE: Migration function names are consistent but `dryRun` could be more descriptive

**Evidence:**
- `v5-to-phase-b.js`: `migrateSettings(settings)` — clear
- `dry-run.js`: `dryRun(settings)` — returns `{ before, after, diff, summary }`
- `rollback.js`: `rollback(settingsPath, backupPath)` — clear; `findBackups(dir)`, `createBackup(settingsPath)` — consistent
- `schema-validator.js`: `detectVersion(settings)`, `validateUpgrade(settings, targetVersion)` — clear

`dryRun(settings)` is the only anomaly — it's a noun used as a function name. `previewMigration` or `simulateMigration` would better convey that it performs work. However, `dryRun` is a well-known DevOps term, so it's acceptable.

---

### NOTE: Security scanner naming is slightly inconsistent

**Evidence:**
- `secret-scan.js`: exports `scanForSecrets(files)` — good verb
- `dependency-scan.js`: exports `dependencyScan(vulnerabilities)` and `parseAuditOutput(auditJson)` — `dependencyScan` is a noun, not a verb
- `permission-review.js`: exports `reviewPermissions(settings, usageLog)` — good verb
- `audit-report.js`: exports `generateAuditReport(depResult, secretResult, permResult)` — good verb

**Recommendation:** Rename `dependencyScan` → `analyzeDependencies` or `scanDependencies` for verb consistency with the other scanners. This is low priority.

---

## 5. COMPLEXITY

### OPTIONAL: `daemon.js` `startDaemon` is well-scoped and not too complex

**Evidence:** `startDaemon` (lines 8–48) is ~41 lines doing:
1. Build PID path, ensure directory exists
2. Check for existing daemon process
3. Handle test mode
4. Spawn child process with specific args
5. Unref child, write PID

Each block is 2–8 lines. The `spawn` call (lines 27–38) is the densest block, with a multi-line argument array. This is clear enough. **No action needed.**

---

### NOTE: `executeSession` in `execution-engine.js` is the longest critical-path function at ~96 lines

**Lines 13–108** in `execution-engine.js`. The function is linear (no deep nesting), which keeps it readable. However, the stage-processing loop (lines 43–95) contains:
- Timeline append (2 calls)
- Budget tracking and check
- Stage execution
- Success/failure handling
- Gate checking

Each concern within the loop is 2–10 lines, but there are 5 concerns in ~53 lines. Extracting a `processSingleStage(stageIndex, stage, context)` function would make the loop body ~20 lines and improve testability.

---

### IMPROVEMENT: `continueSession` in `session-commands.js` is too complex (145 lines)

**Evidence:** Lines 222–367 (~145 lines):
1. Session ID resolution (either explicit or by finding most recent)
2. Manifest reading and validation
3. 4× status checks (completed, aborted, paused/executing/created/routed, catch-all)
4. Autonomous mode delegation
5. Checkpoint loading (either by stage or latest)
6. State machine transition for created→routed
7. State machine transition for routed→executing
8. Manifest persistence (written *twice* — lines 296 and 316)
9. Timeline writing (two separate TimelineWriter instances — lines 301 and 320)
10. Result formatting

The function handles 4 branching paths (explicit session vs found, autonomous vs manual, with checkpoint vs without, created vs already routed). Each path is itself conditional.

**Recommendation:**
1. Extract status-guard checks into a `validateSessionForContinuation(manifest)` function
2. Consolidate the two manifest writes and two timeline writes into one
3. Extract the "auto-route created session" block (lines 281–307) into a `routeSession(projectRoot, sessionId, manifest)` function

This would bring `continueSession` from ~145 lines to ~80 lines.

---

### NOTE: `startSession` in `session-commands.js` is 90 lines with 7 concerns — exceeds the 80-line guideline

**Lines 45–132.** Recommendations from Round 1 (consolidate manifest writes, extract route selection) apply. The function is not unreadable, but it's doing too much.

---

### IMPROVEMENT: `release.js` does everything synchronously with `execSync` — fragile if tests take long

**Evidence:** Lines 53–55:
```js
run("node --test 2>&1", { timeout: 120000 });
```
This blocks for up to 2 minutes (120 seconds). If tests complete in 5 seconds, that's fine. But if they hang, the entire release process blocks. The script uses `execSync` for everything (git operations, tests, npm publish verification).

**Recommendation:** At minimum, add a warning about long-running tests. For a future improvement, consider a two-phase release: `node scripts/release.js prepare` (bump, tag, git push) and `node scripts/publish.js` (npm publish). The current design is fine for interactive use.

---

### NOTE: `permission-review.js` has the most complex conditional logic

**Evidence:** `reviewPermissions` (lines 42–118, ~77 lines) with 3 nested loops and 4 branching paths. The deduplication step (lines 107–114) uses a `Set` on a manually constructed key. The function is well-structured but does 3 different analyses:
1. Overly broad permissions check
2. Sensitive path access check
3. Unused permissions check
4. Missing permissions check

Each analysis could be a separate private function:
```js
function checkBroadPermissions(permissions) { ... }
function checkSensitivePaths(permissions) { ... }
function checkUnusedPermissions(permissions, usageLog) { ... }
function checkMissingPermissions(permissions, usageLog) { ... }
```

Extracting these would make `reviewPermissions` a 20-line orchestrator calling 4 focused helpers.

---

### NOTE: `harness-core.js` `dispatchAgentTask` is dense but not overly complex for its domain

At ~100 lines, `dispatchAgentTask` validates 8 different conditions, builds a dispatch object, and writes it. The validation chain is long but linear (early returns on errors). The function is readable despite its length.

---

## Summary Table

| # | Finding | Category | Effort |
|---|---------|----------|--------|
| 1 | Extract `readManifest(projectRoot, sessionId)` helper from 5+ duplicated patterns | **IMPROVEMENT** | Small |
| 2 | Add `findRoute(routesDir, routeId)` to `route-loader.js` to deduplicate route lookup | **IMPROVEMENT** | Small |
| 3 | Extract shared `run()` helper from `publish.js` / `release.js` | **IMPROVEMENT** | Trivial |
| 4 | Extract shared timestamp formatter from `harness-core.js` for `rollback.js` to use | **IMPROVEMENT** | Small |
| 5 | `session-commands.js` `continueSession()` is 145 lines — split into 3 functions | **IMPROVEMENT** | Medium |
| 6 | `permission-review.js` `reviewPermissions` — extract 4 analysis helpers | **IMPROVEMENT** | Small |
| 7 | `execution-engine.js` `executeSession` — extract stage loop body | **OPTIONAL** | Small |
| 8 | `session-commands.js` `startSession` — consolidate 3 manifest writes into 1 | **OPTIONAL** | Trivial |
| 9 | Rename `dependencyScan` → `analyzeDependencies` for verb consistency | **OPTIONAL** | Trivial |
| 10 | Remove unnecessary lazy `require` in `session-commands.js` `continueSession` | **OPTIONAL** | Trivial |
| 11 | `daemon.js` is well-scoped (3 functions, 1 concern) | **NOTE** (no action) | N/A |
| 12 | `session-lock.js` is exemplary cohesion | **NOTE** (no action) | N/A |
| 13 | Migration files are cleanly separated, no copy-paste | **NOTE** (no action) | N/A |
| 14 | Security scanners don't share a formal interface but orchestration is clean | **NOTE** (no action) | N/A |
| 15 | `executeAutonomous`/`executeSession`/`executeStage` naming hierarchy is clear | **NOTE** (no action) | N/A |
| 16 | No circular dependencies detected | **NOTE** (no action) | N/A |
| 17 | `harness-core.js` at 1900+ lines is the largest remaining architectural concern | **NOTE** | Large |
