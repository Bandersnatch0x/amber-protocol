# Phase B/C Beta — Correctness Review (Round 2)

**Reviewer role**: Correctness & Regressions Reviewer  
**Scope**: New/changed files in commit `af37c24` — autonomous mode, migration, security, publish/release, web viewer  
**Date**: 2026-06-11  
**Test count**: 224 unit/migration/security tests — **all pass**

---

## BLOCKER — Must fix before proceeding

### B1. `Logger.log()` — Spread `...data` overrides core fields `timestamp`, `level`, `message`

**Location**: `scripts/lib/logger.js`, line 19

```js
log(level, message, data = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...data,   // <── overrides the three fields above
    };
```

**Evidence**:
```js
logger.info('hello', { level: 'OVERRIDE', timestamp: 'FAKE' });
// Results in { level: 'OVERRIDE', timestamp: 'FAKE', message: 'hello' }
```

Any caller passing `data` containing keys `timestamp`, `level`, or `message` silently corrupts the log entry's core fields. The spread `...data` must come **before** the explicit fields, or the log entry should nest `data` under its own key:

```js
const entry = {
    ...data,
    timestamp: new Date().toISOString(),
    level,
    message,
};
```

**Risk**: High — log integrity is affected. A misbehaving caller could destroy timestamp chronology (`level: 'error'` overwritten with `level: 'info'`), making forensic analysis unreliable.

---

### B2. `secret-scan.js` — Inline eslint/biome comment exclusion does not work

**Location**: `src/security/secret-scan.js`, line 39 (regex), and lines 72–74 (isComment check)

The Password Assignment regex includes a negative lookahead intended to skip lines like:
```js
const password = "hunter2"; // eslint-disable-line
```

The lookahead `(?!\s*\/\/(?:\s*eslint| biome))` is positioned **immediately after the closing quote**, but real code has `; ` (semicolon + space) between the quote and `//`. So the lookahead always succeeds trivially because it's checking at a position that doesn't start with `\s*\/\/`.

**Separately**, the line-level `isComment` check (`/^\s*\/\/|^\s*#|^\s*\*/.test(line)`) only matches **pure comment lines** (starting with `//`), not inline comments. So `const password = "hunter2"; // eslint-disable-line` is always flagged.

**Impact**: Low — flagging `password = "hunter2"; // eslint-disable-line` is arguably correct behavior (the secret is still hardcoded). But the regex lookahead is dead code, and the test `"does not flag false positives in comments about secrets"` only passes because its test content doesn't contain any `=`-followed-by-quoted-string patterns. If the test targeted inline eslint comments it would find the bug.

---

## CRITICAL — Wrong behavior, recoverable with effort

### C1. `autonomous-executor.js` — No try/catch on `executeSession`, mixed error-handling patterns

**Location**: `scripts/lib/autonomous-executor.js`, lines 55–63

```js
const sessionResult = await executeSession(sessionDir, manifest, route, {
    autoApprove: (gate) => shouldAutoApproveGate(gate.type, policy),
    dryRun: options.dryRun,
});
```

**Evidence**: `executeSession` (in `execution-engine.js` line 21) throws an `Error` when lock acquisition fails:
```js
const lockResult = acquireLock(projectRoot, sessionId);
if (!lockResult.success) {
    await writer.close();
    throw new Error(lockResult.error);  // <── throws
}
```

But `executeAutonomous` only handles `sessionResult` as a returned object — it does not wrap `executeSession` in try/catch. If the lock is held, `executeAutonomous` throws rather than returning `{ success: false, exitCode: 1, error: ... }`. The rest of the function (e.g., budget simulation, retry loop, route-not-found) uses return-objects for error signaling.

**Inconsistency**: Other error branches in `executeAutonomous` return structured error objects:
- `{ success: false, exitCode: 1, error: "Session not found" }`
- `{ success: false, exitCode: 1, error: "Route not found" }`

But a lock-contention error from `executeSession` would propagate as an unhandled exception up to the caller of `executeAutonomous`.

**Fix**: Wrap `executeSession` in try/catch:
```js
let sessionResult;
try {
    sessionResult = await executeSession(sessionDir, manifest, route, { ... });
} catch (err) {
    return { success: false, exitCode: 1, error: err.message, attempts: attempt };
}
```

---

### C2. `session-lock.js` — `JSON.parse` on corrupt lock file throws instead of treating as stale

**Location**: `scripts/lib/session-lock.js`, lines 17 and 54

```js
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
```

**Evidence**: If the lock file is truncated (e.g., process killed mid-write, disk error), `JSON.parse` throws an unhandled exception. `acquireLock` is called from `executeSession` in `execution-engine.js` which catches it (line 21), but `isLocked` has no caller-side try/catch. A corrupted lock file renders `isLocked` unusable.

The same pattern in `checkpoint-manager.js` was fixed in Round 1 (FIX 4) — this is the same class of bug.

**Fix**: Wrap in try/catch, treating unparseable lock files as stale (remove and proceed):
```js
try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    // ... use lock
} catch {
    fs.unlinkSync(lockPath); // corrupt lock → treat as stale
}
```

---

## WARNING — Incorrect behavior under edge cases

### W1. `autonomous-policy.js` — Default policy auto-approves `"user-approval"` gates

**Location**: `scripts/lib/autonomous-policy.js`, line 18

```js
getDefaultPolicy() {
    return {
        gates: {
            auto: "approve",
            "user-approval": "approve",   // ← auto-approves user-approval gates
            "step-confirm": "skip",
        },
```

**Evidence**: The default policy auto-approves every gate type, including `"user-approval"`. This means autonomous mode runs without any human-in-the-loop intervention by default. If the project root lacks an `.harness/autonomous-policy.json`, the default kicks in silently.

**Risk**: A user who runs autonomous mode without explicitly configuring the policy gets an "auto-pilot" mode that never asks for confirmation. This is a **design choice** (express, not implicit), but should be documented prominently. Not a code defect, but a safety concern.

---

### W2. `daemon.js` — `parseInt` without radix in 3 locations

**Location**: `scripts/lib/daemon.js`, lines 16, 58, 87

```js
const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
```

**Risk**: In older JS engines, `parseInt("0..." + octal)` could be interpreted as octal (though ES5+ spec says leading zeros are ignored). In Node.js 24, this is harmless, but it's a consistent code quality gap. Add `, 10` radix.

---

### W3. `publish.js` — Module-level `publish()` call without `require.main` guard

**Location**: `scripts/publish.js`, last line

```js
publish();
```

**Evidence**: `require('./scripts/publish')` immediately executes the publish function. The default export is the side-effect, not a function. If anything else in the dependency graph ever `require`s this file (e.g., for testing), it will attempt to publish. The `release.js` file also lacks this guard.

**Fix**: Wrap in `if (require.main === module) { publish(); }`.

---

### W4. `release.js` — `node --test` shell command without `|| true`

**Location**: `scripts/release.js`, line 74

```js
run("node --test 2>&1", { timeout: 120000 });
```

**Evidence**: If tests fail, `execSync` throws, which is caught by the outer try/catch on line 149. The `process.exit(1)` on line 76 handles it. Functionally correct. But the error message from `execSync` is swallowed by the release script, not shown. Consider using `npm test` or surfacing the test output.

---

### W5. `autonomous-executor.js` — No timeout on `executeSession` call

**Location**: `scripts/lib/autonomous-executor.js`, line 55

```js
const sessionResult = await executeSession(sessionDir, manifest, route, {
```

If `executeSession` hangs (e.g., waiting on stdin, stalled process), `executeAutonomous` hangs forever. There's no timeout parameter or `AbortController` in the options passed to `executeSession`.

---

## INFO — Observations and follow-ups

### I1. `apps/web/` — Scaffold-only, no components or pages

**Files present**: `next.config.js`, `package.json`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `vitest.config.ts`, `playwright.config.ts`

No `src/`, `pages/`, `app/`, or component files exist. The scaffold is syntactically valid and loadable by Node.js, but running `next build` would produce an empty build. The `package.json` lists heavy dependencies (trpc, react-markdown, react-window, zustand) that are all unused. Not a bug — this is clearly a scaffold for future work.

### I2. `rollback.js` — `createBackup` writes backup before rollback, which is correct but creates double backups

**Location**: `src/migration/rollback.js`, lines 105–107

On each rollback, the current settings are backed up first (with a `createBackup` call), then the target backup is restored. This means rolling back from backup A → B creates an additional backup of B. A second rollback restores A again. This is correct behavior for safety but accumulates backup files.

### I3. `dependency-scan.js` — `parseAuditOutput` silently catches malformed JSON

**Location**: `src/security/dependency-scan.js`, line 16

```js
} catch (e) {
    return [];
}
```

Swallows parse errors silently. Upstream callers see an empty result but have no way to distinguish "no vulnerabilities" from "audit JSON was malformed". The error should be logged or returned.

### I4. `permission-review.js` — Overly broad `SENSITIVE_PATHS` matching via `includes()` is fragile

**Location**: `src/security/permission-review.js`, lines 47–49

```js
if (paths.some(pp => pp === sensitive || pp.includes(sensitive.replace(/\*+/g, "")))) {
```

Using `.includes()` on the path string means a path like `not-sensitive.env.backup` would match `.env` (true positive), but also `credentials-backup.txt` would match `credentials/`. However, the patterns are safe enough for a heuristic warning. Minor.

### I5. `rollback.js` — Backup timestamp format with hyphens is valid but visually ambiguous

The timestamp format `2026-06-11-001139-425` uses hyphens as separators for date, time-of-day components, AND milliseconds. The `BACKUP_PATTERN` regex handles this correctly, but visually it's hard to distinguish `2026-06-11` (date) from `001139-425` (time). Consider using `T` or `.` as the date/time separator: `2026-06-11T001139.425`.

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| **B1** | **BLOCKER** | `logger.js:19` | Spread `...data` overrides `timestamp`/`level`/`message` |
| **B2** | **BLOCKER** | `secret-scan.js:39` | Inline eslint/biome comment exclusion regex doesn't work (dead code) |
| **C1** | **CRITICAL** | `autonomous-executor.js:55` | No try/catch on `executeSession`; lock failure throws instead of returning error |
| **C2** | **CRITICAL** | `session-lock.js:17,54` | Corrupt lock file causes unhandled `JSON.parse` throw |
| W1 | WARNING | `autonomous-policy.js:18` | Default policy auto-approves user-approval gates (no human-in-loop) |
| W2 | WARNING | `daemon.js:16,58,87` | `parseInt` without radix (3 places) |
| W3 | WARNING | `publish.js` / `release.js` | Module-level side effect call without `require.main` guard |
| W4 | WARNING | `release.js:74` | Test failure output suppressed by silent `execSync` catch |
| W5 | WARNING | `autonomous-executor.js:55` | No timeout on `executeSession`; could hang forever |
| I1 | INFO | `apps/web/` | Scaffold-only, no pages/components yet |
| I2 | INFO | `rollback.js:105` | Rolling back creates double backups (safe but accumulates) |
| I3 | INFO | `dependency-scan.js:16` | Malformed audit JSON silently returns empty array |
| I4 | INFO | `permission-review.js:44` | Sensitive-path matching via `includes()` is heuristic |
| I5 | INFO | `rollback.js:35` | Backup timestamp format uses hyphens everywhere (ambiguous visually) |

---

## Correctness Signals (What's Already Good)

- **All 224 tests pass** — unit, migration, and security suites. No regressions from Round 1 fixes.
- **All 13 modules load cleanly** — `require()` succeeds for every new/modified file.
- **Session lock lifecycle is correct**: `acquireLock` → double-acquire fails → `releaseLock` → re-acquire succeeds. Stale locks (>5 min) are cleaned up. *(session-lock.js)*
- **Daemon lifecycle is correct**: `startDaemon` → `getDaemonStatus` → `stopDaemon`. PID file cleanup on stale PID. Test mode separates unit tests from actual process management. *(daemon.js)*
- **Migration chain works**: `v5-to-phase-b.migrateSettings` → `dryRun.dryRun` → `schema-validator.detectVersion/validateUpgrade` produce consistent results. Dry-run does not mutate. *(src/migration/*)*
- **Security scanners produce valid output**: `scanForSecrets`, `dependencyScan`, `reviewPermissions`, `generateAuditReport` all accept inputs, return structured results, and integrate into a coherent markdown report. *(src/security/*)*
- **Retry/backoff logic is correct**: `backoffMs[attempt - 1]` indexing aligns with 0-based array. Budget-exceeded in `pause` mode exits without retry. Budget-exceeded in other modes falls through to retry. *(autonomous-executor.js)*
- **Rollback is safe**: Creates pre-rollback backup before restoring. Validates backup is valid JSON with object structure. *(rollback.js)*
- **Permission reviewer deduplicates findings** with a Set-based dedup key. *(permission-review.js)*
- **`correctness-review.md` Round 1 fixes are present**: `harness.js` has `.catch()`, `migrate-command.js` captures original version, budget validation rejects NaN, checkpoint manager wraps JSON.parse in try/catch, budget is persisted via `persistBudget()` in `execution-engine.js`.
