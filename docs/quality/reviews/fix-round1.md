# Review Round 1 — Fix Worker Report

## Summary
5 targeted fixes applied. All 269 tests pass. No regressions.

## Changed Files

| File | Lines | Fix |
|------|-------|-----|
| `scripts/harness.js` | +28/-9 | FIX 1: `.catch()` on `run()`; FIX 3: budget validation |
| `scripts/lib/migrate-command.js` | +3/-1 | FIX 2: capture original schemaVersion before mutation |
| `scripts/lib/checkpoint-manager.js` | +20/-12 | FIX 4: try/catch JSON.parse for corrupt checkpoint files |
| `scripts/lib/execution-engine.js` | +23 | FIX 5: `persistBudget()` helper + calls at 4 return points |

## Validation

```
node --test → 269 tests, 0 failures, duration ~19s
```

### FIX 1 — harness.js unhandled promise rejection
- **Before**: `run().then(...)` — if `run()` throws/rejects, the process crashes silently
- **After**: `.catch((err) => { console.error(err.message); process.exitCode = 1; })`

### FIX 2 — migrate-command.js log always "missing"
- **Before**: `manifest.schemaVersion === CURRENT_SCHEMA_VERSION ? "missing" : manifest.schemaVersion` — but `manifest.schemaVersion` was just set to `CURRENT_SCHEMA_VERSION`, so the check was always true
- **After**: Captures `originalVersion` before mutation; log now shows correct "0.9.0 → 1.0.0"

### FIX 3 — NaN budget silently disables limits
- **Before**: `args.budget ? parseInt(args.budget, 10) : undefined` — `parseInt("abc")` returns `NaN`, `NaN ? ...` is falsy → budget `undefined` (unlimited)
- **After**: Explicit `isNaN` / `<= 0` check; returns error "Error: --budget must be a positive integer" with exitCode 1
- Validated: `--budget -5` → error, `--budget abc` → error, `--budget 1000` → success

### FIX 4 — corrupt checkpoint crashes all reads
- **Before**: `files.map(f => JSON.parse(fs.readFileSync(...)))` — any corrupt file crashes the entire map
- **After**: for-loop with try/catch, skips corrupt files, logs warning to stderr

### FIX 5 — budget not persisted to manifest
- **Before**: `BudgetTracker` updated in memory only; on process restart/crash, budget reset to 0
- **After**: `persistBudget()` helper writes `budget.used/total` to `manifest.json` at all 4 return points: budget exceeded, stage failed, gate rejected, and success. Errors are logged as warnings without breaking the flow.

## Surprises
None. All fixes were straightforward. The `git checkout --` had restored some unintended files (harness-core.js, session-commands.js, timeline-*) but those were reverted before the final validation. Only the 4 targeted files remain modified.
