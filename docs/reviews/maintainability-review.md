# Phase B Alpha — Simplicity & Maintainability Review

**Reviewer:** Maintainability subagent  
**Date:** 2026-06-10  
**Files inspected:** route-commands.js, session-commands.js, timeline-reader.js, timeline-writer.js, budget-tracker.js, harness.js, route.schema.json, session-manifest.schema.json, timeline-event.schema.json, validate-route.js, schema-version-checker.js, migrate-command.js, session-manifest.js  
**Prior review docs at `docs/superpowers/plans/`:** No prior review feedback found.

---

## 1. Code Duplication — `{ text, exitCode }` Return Pattern

### IMPROVEMENT: Extract a `result(text, exitCode)` helper

**Evidence:** 29 instances across two files:

- `route-commands.js` — 9 occurrences (lines 20, 31, 54, 67, 72, 77, 84, 90, 101)
- `session-commands.js` — 20 occurrences (lines 57, 68, 142, 151, 185, 191, 208, 217, 224, 231, …)

Every function in both modules returns `{ text: string, exitCode: number }`. This is a good contract, but the pattern is repeated verbosely each time. A trivial helper would improve clarity:

```js
// scripts/lib/result.js
function result(text, exitCode = 0) {
  return { text, exitCode };
}
```

This would let `route-commands.js` and `session-commands.js` use `return result("No routes found.")` instead of `return { text: "No routes found.", exitCode: 0 }`.

**Impact:** Low risk, high readability gain. ~50 lines saved across two files.

---

### IMPROVEMENT: `harness.js` route/session adapter is boilerplate-heavy

**Evidence:** `harness.js` lines ~195–280 contain the `route` and `session` command dispatch. Each wraps subcommand results into the `{ target, text, errors, warnings }` envelope with nearly identical code:

```js
result = {
  target: args.target,
  text: routeResult.text,
  errors: routeResult.exitCode === 0 ? [] : [routeResult.text],
  warnings: [],
};
if (!args.json) { console.log(routeResult.text); return routeResult.exitCode; }
printResult(result, { json: true });
return routeResult.exitCode;
```

This block is copy-pasted for `route`, `session`, and `migrate`. A small adapter function would deduplicate this:

```js
function adaptTextResult(args, textResult) {
  const result = {
    target: args.target,
    text: textResult.text,
    errors: textResult.exitCode === 0 ? [] : [textResult.text],
    warnings: [],
  };
  if (!args.json) { console.log(textResult.text); return textResult.exitCode; }
  printResult(result, { json: true });
  return textResult.exitCode;
}
```

**Impact:** Eliminates ~25 lines of near-identical dispatch code.

---

## 2. Module Cohesion

### OPTIONAL: `session-commands.js` is doing too much (435 lines)

**Evidence:** `session-commands.js` handles:
- Directory path computation (`getSessionsDir`, `getSessionDir`)
- Session discovery (`findMostRecentSession`, `findMostRecentNonCompletedSession`)
- Session lifecycle (start, status, list, abort, continue)
- Manifest I/O (reading/writing `manifest.json` — at least 10 calls)
- Timeline writing (4 separate `new TimelineWriter(...)` instantiations)
- Worktree management delegation
- State machine transitions
- Checkpoint loading

The two `findMostRecent*Session` functions are 60+ lines each and nearly identical — one filters for non-completed, the other doesn't. Both do full manifest reads during sort, meaning O(n log n) file reads just to sort sessions.

**Suggested split:**
- Extract `session-finder.js` for `findMostRecentSession` / `findMostRecentNonCompletedSession` (with shared helper)
- Extract manifest I/O helpers (`readManifest`, `writeManifest`, `manifestExists`)
- Keep lifecycle commands in `session-commands.js`

**Impact:** Reduces session-commands.js from ~435 lines to ~250 lines.

---

### OPTIONAL: Merge `timeline-reader.js` and `timeline-writer.js`?

**Evidence:**
- `timeline-reader.js` — 34 lines, exports `{ readTimeline }`
- `timeline-writer.js` — 62 lines, exports `{ TimelineWriter }`

Both operate on JSONL timeline files. However, the reader uses `fs.readFileSync` (synchronous) while the writer uses `fs.createWriteStream` (async). They have different usage patterns.

**Verdict:** Keep separate for now. The asymmetry (sync reader vs async writer) means a merged `timeline.js` would be harder to reason about. The reader could later be made async for consistency, but that's a separate concern. Current split is fine.

---

## 3. Magic Values

### IMPROVEMENT: `"1.0.0"` hardcoded in 5+ locations

**Evidence:**

| File | Line | Usage |
|------|------|-------|
| `schemas/route.schema.json` | 7 | `"const": "1.0.0"` |
| `schemas/session-manifest.schema.json` | 7 | `"const": "1.0.0"` |
| `session-manifest.js` | 21 | `schemaVersion: "1.0.0"` |
| `session-commands.js` | 61, 73, 83 | `routeVersion = "1.0.0"` (3 times) |
| `schema-version-checker.js` | 3 | `SUPPORTED_VERSIONS = ["1.0.0"]` |
| `migrate-command.js` | 6 | `CURRENT_SCHEMA_VERSION = "1.0.0"` |
| `harness-core.js` | 1175 | `schemaVersion: "1.0.0"` |

The schemas must use `const` (that's fine). But the JS code should use a single source of truth. `schema-version-checker.js` already exports `SUPPORTED_VERSIONS`, and `migrate-command.js` exports `CURRENT_SCHEMA_VERSION`. Both are the same value but defined independently.

**Suggestion:** Define `SCHEMA_VERSION = "1.0.0"` once in a shared constants module (or in `schema-version-checker.js` which already exists) and import it everywhere.

---

### NOTE: Stage estimates are not magic in the bad sense

**Evidence:** `budget-tracker.js` lines 3–14 define `STAGE_ESTIMATES` as a named constant map with descriptive keys. The default fallback `|| 1000` on line 16 is also reasonable. This is properly structured — no action needed.

---

## 4. `harness.js` Dispatch

### OPTIONAL: The 20+ command chain is long but manageable

**Evidence:** `harness.js` `run()` function spans lines ~130–300. The dispatch is a flat `if/else if` chain with 21 commands. Each command block is 3–15 lines. The longest blocks are `adoption` (12 subcommands) and `team` (5 subcommands).

**Issues:**
1. **Sub-command parsing is inconsistent.** Some commands use `args._[0]` for sub-commands (pack, profile, task, result, agent, loop, team, maintenance, adoption, route, session), while others are top-level (init, audit, wiki, etc.). This is fine for now but would break if the command count grows.
2. **`else { result = doctor(args.target); }`** on the final fallthrough (line ~298) means any new command added to `COMMANDS` but forgotten in the dispatch would silently run `doctor`. This is a latent bug risk.

**Suggestion:** Replace the final `else` with an explicit error:
```js
} else {
  console.error(`No handler for command: ${command}`);
  return 1;
}
```

**Impact:** Prevents silent misrouting if a command is added to the `COMMANDS` array but not wired.

---

## 5. Duplicated Utility Functions

### IMPROVEMENT: `getSessionsDir()` duplicated

**Evidence:**
- `session-commands.js` line 19: `function getSessionsDir(projectRoot) { return path.join(projectRoot, ".harness", "sessions"); }`
- `migrate-command.js` line 8: `function getSessionsDir(projectRoot) { return path.join(projectRoot, ".harness", "sessions"); }`

Identical function, duplicated verbatim. Extract to a shared module (e.g., `paths.js` or add to `session-commands.js` and export).

---

### IMPROVEMENT: `findMostRecentSession` and `findMostRecentNonCompletedSession` are 80% identical

**Evidence:** Both functions in `session-commands.js`:
1. Get sessions dir, check existence
2. Read all manifests via `fs.readdirSync` + filter
3. Sort by `createdAt`
4. Return the first (or null)

The only difference: `findMostRecentNonCompletedSession` adds a `.filter(m => m.status !== "completed" && m.status !== "aborted" && m.status !== "failed")`.

**Suggestion:** Merge into one parameterized function:
```js
function findSession(projectRoot, { excludeCompleted = false } = {}) {
  // shared logic with optional filter
}
```

**Impact:** Eliminates ~40 lines of near-duplicate code and prevents them from diverging.

---

## 6. Naming Consistency

### NOTE: Naming is mostly consistent

**Observations:**
- `route-commands.js` exports: `listRoutes`, `inspectRoute`, `validateRouteFile`, `testRoute` — verbs are consistent.
- `session-commands.js` exports: `startSession`, `statusSession`, `listSessions`, `abortSession`, `continueSession` — "status" as a verb is slightly unusual (vs `getSessionStatus`), but acceptable for CLI consistency.
- `timeline-reader.js` exports `readTimeline` (function), while `timeline-writer.js` exports `TimelineWriter` (class). The noun-style for the writer is fine since it's stateful. The reader is stateless so a plain function is appropriate.
- `validate-route.js` exports `validateRoute` (function) while `validate-route.js` is a different name from `route-commands.js`'s `validateRouteFile`. The difference is: `validateRoute` validates a JS object, `validateRouteFile` loads and validates from a file path. This distinction is clear.

---

## 7. `harness.js` Fallthrough to `doctor`

### IMPROVEMENT: Silent fallthrough is a latent bug

**Evidence:** `harness.js` line ~298:
```js
} else {
  result = doctor(args.target);
}
```

The `COMMANDS` array is checked on lines ~138–142, so unknown commands are caught before reaching the dispatch. However, if a developer adds a new command to `COMMANDS` but forgets to add a dispatch branch, the command would silently execute `doctor()` with no warning.

**Fix:** Replace the `else` with an explicit "no handler" error.

---

## 8. Minor Code Quality

### NOTE: `findMostRecentSession` sort is O(n²) in I/O

**Evidence:** `session-commands.js` lines 38–48. The sort comparator reads and parses `manifest.json` for each comparison. For `n` sessions, this means O(n log n) file reads in the worst case, with repeated reads of the same file. For typical usage (few sessions) this is fine, but it's a pattern that would bite at scale.

**Suggestion:** Read all manifests once into an array, then sort the array. This is already done in `findMostRecentNonCompletedSession` (lines 380–396) but not in `findMostRecentSession`.

---

### NOTE: `session-commands.js` writes manifest 2–3 times in `startSession`

**Evidence:** Lines 96, 116, 125 all call `fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))`. The manifest is written after creation, then again if worktree succeeds, then again if mode is set. This is fine for correctness but could be consolidated into a single write at the end of the function.

---

### NOTE: `session-commands.js` continues session creates TimelineWriter 3 times

**Evidence:** `continueSession()` creates `TimelineWriter` at lines 335 and 354 (plus one at line 247 in `abortSession`). The continue function creates one writer for the route transition event, closes it, then creates another for the resume event. This is correct but could use a single writer instance.

---

## Summary Table

| # | Finding | Category | Effort |
|---|---------|----------|--------|
| 1 | Extract `result(text, exitCode)` helper | **IMPROVEMENT** | Small |
| 2 | Deduplicate `harness.js` route/session/migrate adapter | **IMPROVEMENT** | Small |
| 3 | Single source of truth for `SCHEMA_VERSION` | **IMPROVEMENT** | Small |
| 4 | Deduplicate `getSessionsDir()` | **IMPROVEMENT** | Trivial |
| 5 | Merge `findMostRecentSession` / `findMostRecentNonCompletedSession` | **IMPROVEMENT** | Small |
| 6 | Replace `harness.js` fallthrough `else` with explicit error | **IMPROVEMENT** | Trivial |
| 7 | Fix `findMostRecentSession` O(n²) sort I/O | **NOTE** | Trivial |
| 8 | Session-commands is large — consider splitting | **OPTIONAL** | Medium |
| 9 | Keep timeline-reader/writer separate | **NOTE** (no action) | N/A |
| 10 | Stage estimates are well-structured | **NOTE** (no action) | N/A |
| 11 | Naming is consistent | **NOTE** (no action) | N/A |
| 12 | Multiple manifest writes in startSession/continueSession | **NOTE** | Low |
| 13 | No prior review feedback found at `docs/superpowers/plans/` | **NOTE** | N/A |
