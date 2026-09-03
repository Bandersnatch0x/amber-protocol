# Phase B Alpha — Correctness Review

**Reviewer role**: Correctness Reviewer  
**Scope**: `scripts/harness.js`, `scripts/lib/session-commands.js`, `scripts/lib/stage-executor.js`, `scripts/lib/execution-engine.js`, `scripts/lib/session-state-machine.js`, `scripts/lib/checkpoint-manager.js`, plus dependencies (`migrate-command.js`, `budget-tracker.js`, `gate-handler.js`, `timeline-writer.js`, `session-manifest.js`, `schema-version-checker.js`, `route-selector.js`, `route-loader.js`, `worktree-manager.js`)  
**Date**: 2026-06-10

---

## BLOCKER — Must fix before proceeding

### B1. `harness.js` — No `.catch()` on `run()`, unhandled promise rejections crash the process

**Location**: `scripts/harness.js`, lines 361–365

```js
if (require.main === module) {
    run().then((code) => {
        process.exitCode = code;
    });
}
```

**Evidence**: `run()` is `async`. Any thrown exception from a synchronous command or a rejected promise from an async session command (`startSession`, `abortSession`, `continueSession`) becomes an unhandled promise rejection. In Node.js ≥15, this terminates the process with exit code 1 but bypasses all user-friendly error formatting (e.g., `printResult`). The user sees a raw stack trace instead of a structured error. Every command in the dispatch chain is affected — not just session commands. For example, `scaffoldHarness(args.target)` throws if `args.target` is an invalid path and `fs.mkdirSync` fails inside it.

**Fix**: Add `.catch()`:
```js
if (require.main === module) {
    run().then((code) => {
        process.exitCode = code;
    }).catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}
```

---

### B2. `migrate-command.js` — Migration log always prints "missing" regardless of original schemaVersion

**Location**: `scripts/lib/migrate-command.js`, lines 57–62

```js
manifest.schemaVersion = CURRENT_SCHEMA_VERSION;   // ← sets to "1.0.0"
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
logs.push(
    `Migrated ${sessionDirName}: ${manifest.schemaVersion === CURRENT_SCHEMA_VERSION ? "missing" : manifest.schemaVersion} → ${CURRENT_SCHEMA_VERSION}`,
);
```

**Evidence**: After line 57 assigns `CURRENT_SCHEMA_VERSION` to `manifest.schemaVersion`, the ternary on line 60 *always* evaluates to `true` (`"1.0.0" === "1.0.0"`), so the log always says `"missing → 1.0.0"`. A manifest with `schemaVersion: "0.9.0"` would be correctly migrated to `"1.0.0"`, but the log would misleadingly say `"missing → 1.0.0"` instead of `"0.9.0 → 1.0.0"`. The dry-run path (line 64) correctly reads the original value because it runs before mutation.

**Fix**: Capture the original version before mutation:
```js
if (!dryRun) {
    const backupPath = manifestPath + ".backup";
    fs.copyFileSync(manifestPath, backupPath);
    const originalVersion = manifest.schemaVersion || "missing";
    manifest.schemaVersion = CURRENT_SCHEMA_VERSION;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    logs.push(
        `Migrated ${sessionDirName}: ${originalVersion} → ${CURRENT_SCHEMA_VERSION}`,
    );
}
```

**Test gap**: `tests/integration/migrate-command.test.js` does not assert on the content of `result.logs`. The test verifies `result.migrated === 1` and the file contents, but never checks the log messages. Adding a log-content assertion would catch this regression.

---

## CRITICAL — Wrong behavior, recoverable with effort

### C1. `execution-engine.js` — Budget consumption not persisted during `executeSession`

**Location**: `scripts/lib/execution-engine.js`, lines 12–20

```js
const tracker = new BudgetTracker(
    manifest.budget?.total || Infinity,
    manifest.budget?.used || 0,
);
```

**Evidence**: The `BudgetTracker` is in-memory only. `manifest.budget.used` is never updated during execution. If a session fails mid-run and is later resumed via `continueSession`, the budget tracker restarts from the original `manifest.budget.used` (typically `0`), so all previously consumed budget is effectively forgotten. A user can resume sessions indefinitely without the budget ever being enforced across sessions.

Note: `executeStagesWithCheckpoints` in `stage-executor.js` does persist manifest updates to checkpoints, but `executeSession` in `execution-engine.js` does not use checkpoints. These are two separate execution paths with different persistence behavior.

**Fix**: After each stage succeeds, update `manifest.budget.used` with the tracker's current value. If checkpoints are the persistence mechanism, call `saveCheckpoint` after each stage within `executeSession`. Alternatively, after `executeSession` returns, have the caller write the updated `manifest.budget.used` back to `manifest.json`.

---

### C2. `NaN` budget from non-numeric `--budget` input silently disables budget limits

**Location**: `scripts/harness.js`, line 91 (session dispatch)

```js
budget: args.budget ? parseInt(args.budget, 10) : undefined,
```

**Evidence**: `parseInt("not-a-number", 10)` returns `NaN`. This flows into `createManifest` which sets `budget: { total: NaN, used: 0 }`. In `BudgetTracker`:
- `getPercentage()` returns `Math.floor((used / NaN) * 100)` → `NaN`
- `addConsumption()`: `NaN >= 100` is `false`, so `exceeded` is never `true`
- Budget enforcement is silently disabled for the entire session

**Fix**: Validate after `parseInt`:
```js
const parsedBudget = args.budget ? parseInt(args.budget, 10) : undefined;
if (args.budget && (isNaN(parsedBudget) || parsedBudget <= 0)) {
    // return error
}
```

---

### C3. `checkpoint-manager.js` — Corrupt checkpoint file crashes all checkpoint reading functions

**Location**: `scripts/lib/checkpoint-manager.js`, `loadLatestCheckpoint` (lines 30–37), `listCheckpoints` (lines 40–53)

```js
const checkpoints = files.map((f) => {
    const content = fs.readFileSync(path.join(checkpointsDir, f), "utf8");
    return JSON.parse(content);  // throws on corrupt/invalid JSON
});
```

**Evidence**: A single corrupt checkpoint file (e.g., truncated write, disk error, manual edit) causes `JSON.parse` to throw, crashing `loadLatestCheckpoint`, `listCheckpoints`, and `loadCheckpointByStage`. This makes `continueSession` unusable for that session — the user cannot resume, and there's no way to recover except manually deleting the corrupt file. No unit test covers corrupt file scenarios.

**Fix**: Wrap individual file reads in try/catch, skip or log corrupt files:
```js
const checkpoints = [];
for (const f of files) {
    try {
        const content = fs.readFileSync(path.join(checkpointsDir, f), "utf8");
        checkpoints.push(JSON.parse(content));
    } catch (err) {
        // skip corrupt checkpoint, optionally log warning
    }
}
```

---

## INFO — Observations, risks, and follow-ups

### I1. `session-state-machine.js` — `EVENT_TYPES` maps `executing → "session_resumed"` for first-time execution

**Location**: `scripts/lib/session-state-machine.js`, line 19

```js
[STATES.EXECUTING]: "session_resumed",
```

**Observation**: When a session transitions from `routed → executing` for the first time, the event type is `"session_resumed"`. This is semantically incorrect — it's a start, not a resume. The `continueSession` function in `session-commands.js` separately appends a `"session_resumed"` event (line 238), which is correct for actual resumes. The state machine event is redundant/conflicting in the resume case and misleading in the start case.

---

### I2. `session-commands.js` — `continueSession` directly mutates `sm.currentState`

**Location**: `scripts/lib/session-commands.js`, line 205

```js
sm.currentState = STATES.ROUTED;
```

**Observation**: After calling `sm.transition(STATES.ROUTED)` (which already sets `this.currentState = toState` internally), this line is redundant. It also bypasses the state machine's encapsulation. Not a current bug, but fragile if the `SessionStateMachine` internals change.

---

### I3. `stage-executor.js` — No null guard on `shouldContinue` callback

**Location**: `scripts/lib/stage-executor.js`, lines 42, 67

```js
if (!shouldContinue()) break;
```

**Observation**: If a caller passes `null` or `undefined` for `shouldContinue`, this throws `TypeError: shouldContinue is not a function`. Current callers always pass a function, but there's no defensive check. Adding `typeof shouldContinue === 'function' && !shouldContinue()` would be safer.

---

### I4. `stage-executor.js` — Stale worktree state in post-execution checkpoint

**Location**: `scripts/lib/stage-executor.js`, `executeStagesWithCheckpoints`, lines 69–93

```js
const worktreeState = getWorktreeState(projectRoot, sessionId);  // captured BEFORE stage
const result = await executeStage(stage, options);                // stage runs, may change worktree
saveCheckpoint(..., stage.name, updatedManifest, worktreeState);  // saves stale worktree state
```

**Observation**: The "after" checkpoint uses worktree state captured before the stage executed. If the stage modifies the working tree (which command stages likely do), the checkpoint's `worktreeState` doesn't reflect the post-stage reality. This could mislead recovery if the checkpoint is used to assess worktree cleanliness.

---

### I5. `checkpoint-manager.js` — Filename collision on same-millisecond saves

**Location**: `scripts/lib/checkpoint-manager.js`, line 28

```js
const filename = `${stage}-${Date.now()}.json`;
```

**Observation**: Two checkpoints for the same stage name within the same millisecond overwrite each other. Unlikely in practice but possible in automated speed scenarios. Using a UUID or monotonic counter would eliminate this risk.

---

### I6. `harness.js` — `else` fallthrough to `doctor` for new commands

**Location**: `scripts/harness.js`, lines 285–287

```js
} else {
    result = doctor(args.target);
}
```

**Observation**: Any command added to `COMMANDS` but not added to the dispatch `if/else` chain would silently run `doctor` instead of erroring. Currently all 21 commands are handled, so this is a latent maintenance risk rather than a current bug. A `switch` statement or explicit final check would be more robust.

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| B1 | **BLOCKER** | harness.js | No `.catch()` on `run()` — unhandled promise rejection |
| B2 | **BLOCKER** | migrate-command.js | Migration log always says "missing" (mutation before read) |
| C1 | **CRITICAL** | execution-engine.js | Budget not persisted; resume resets budget |
| C2 | **CRITICAL** | harness.js | `NaN` budget from bad `--budget` input disables limits |
| C3 | **CRITICAL** | checkpoint-manager.js | Corrupt checkpoint file crashes all checkpoint reads |
| I1 | INFO | session-state-machine.js | "session_resumed" event for first-time execution |
| I2 | INFO | session-commands.js | Direct `sm.currentState` mutation |
| I3 | INFO | stage-executor.js | No null guard on `shouldContinue` callback |
| I4 | INFO | stage-executor.js | Stale worktree state in post-execution checkpoint |
| I5 | INFO | checkpoint-manager.js | Filename collision risk on same-ms saves |
| I6 | INFO | harness.js | `else` fallthrough to `doctor` if new command added |

---

## Correctness Signals (What's Already Good)

- **State machine transitions are airtight**: Final states (`completed`, `failed`, `aborted`) have zero outgoing transitions. `created → executing` is correctly rejected. Tests cover all transition paths. *(session-state-machine.js)*
- **Stage failure halts execution correctly**: Both `executeStages` and `executeSession` break on non-optional stage failure. Optional stages are handled. *(stage-executor.js, execution-engine.js)*
- **Gate rejection stops execution**: `executeSession` correctly checks gates after stages and returns `success: false, reason: "Gate rejected"`. Timeline events are written. *(execution-engine.js)*
- **Session commands handle missing inputs**: `startSession` rejects missing `goal`, `abortSession` rejects missing `sessionId`, `statusSession`/`listSessions` handle empty directories. *(session-commands.js)*
- **Timeline events are comprehensive**: Session lifecycle events (`stage_started`, `stage_completed`, `stage_failed`, `gate_triggered`, `gate_passed`, `gate_failed`, `budget_warning`, `budget_exceeded`) are all written correctly. *(execution-engine.js)*
- **Writer is always closed**: Both the happy path and error path in `executeSession` call `writer.close()`. *(execution-engine.js)*
- **Route auto-selection works**: `startSession` correctly falls back to `selectRoute` when no route ID is specified. *(session-commands.js)*
- **Deep copies in checkpoint manager**: `saveCheckpoint` deep-copies manifest and worktree state to prevent mutation. *(checkpoint-manager.js)*
- **Worktree cleanup on abort**: `abortSession` removes the worktree if one was created. *(session-commands.js)*
