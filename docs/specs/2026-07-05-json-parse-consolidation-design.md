# JSON.parse Consolidation — Design

**Date:** 2026-07-05
**Target:** Amber Protocol, `scripts/lib/` (shipped CLI logic)
**HEAD at authoring:** `82ecdc1`
**Scope:** Route unguarded file-read `JSON.parse` call sites onto the existing `readJson` / `readJsonSafe` helpers in `scripts/lib/core/fs-utils.js`.

## Problem

`scripts/lib/core/fs-utils.js` already exposes two purpose-built JSON readers:

- `readJson(p)` — reads + parses; throws a clear, actionable error on `ENOENT` or `SyntaxError`.
- `readJsonSafe(p)` — returns `{ value, error }`; degrades gracefully (file-not-found is not an error).

Despite this, **23 call sites** in `scripts/` bypass them with the inline `JSON.parse(fs.readFileSync(p, "utf8"))` pattern — 19 in shipped CLI logic, 4 in dev/build tooling (`publish.js`, `release.js`, `sync-version.js`). A missing or corrupted state / schema / policy / manifest / lock file therefore surfaces as a raw `ENOENT` or `SyntaxError` stack trace instead of the helper's actionable message.

The inline pattern is the precise scope boundary: split read-then-parse sites (e.g. `route-loader.js`, which reads to `raw` then `JSON.parse(raw)` inside its own try/catch with file-specific messages) already degrade gracefully and are out of scope.

## Verified evidence (HEAD `82ecdc1`)

`grep -rn "JSON\.parse(fs\.readFileSync" scripts/` → 23 matches.

Hotspots: `core/execution-validator.js` (4), `core/standards.js` (2), `core/loop-policy.js` (2), `session-lock.js` (2), plus module-load schema reads (`validate-route.js`, `validate-loop-contract.js`, `session-manifest.js`), session/manifest readers (`session-commands.js`, `completion-check.js`, `migrate-command.js`), policy/rules readers (`autonomous-policy.js`, `core/governance-readiness.js`), and `state-migration.js`.

**Test impact: none expected.** `tests/` parses CLI JSON *output* (`JSON.parse(result.stdout)`); no test asserts on internal parse-error message text from these sites.

## Approach (chosen: A)

**A — Like-for-like consolidation.** Route every shipped-CLI file-read site onto the existing helpers. No new helpers. No CI guard.

Rejected:

- **B (+ `readJsonl` helper):** the ~5 JSONL line-readers (`timeline-reader`, `loop-ledger`, `state-migration:61`, `standards:52`, `checkpoint-manager:63`) have varying error-handling shapes and are not currently painful. YAGNI.
- **C (+ CI guard):** cheap drift-prevention, but deferred to keep this cycle minimal; add later only if regression reappears.

## Design

### Helper-choice rule (per site)

The destination helper is determined by the caller's **current** failure behavior — *preserve or improve it, never change semantics*:

- Caller wraps the read in `try { … } catch { degrade }` and continues on missing/corrupt → **`readJsonSafe(p)`**, consume `{ value, error }`.
  - Candidates: `session-lock.js`, `core/loop-policy.js`, `core/governance-readiness.js`, `autonomous-policy.js`, `state-migration.js`, `core/standards.js:34`.
- Missing/corrupt file should fail fast with a clear message → **`readJson(p)`**.
  - Candidates: `session-commands.js`, `completion-check.js`, `migrate-command.js`, `core/standards.js:20`, and module-load schema reads in `validate-route.js` / `validate-loop-contract.js` / `session-manifest.js`.

When a site's shape is ambiguous, prefer `readJson` (fail-fast) unless the caller already degrades.

### Explicitly excluded (not helper-bypasses — leave unchanged)

- Deep-clone `JSON.parse(JSON.stringify(...))` — `checkpoint-manager.js`.
- Regex-extracted string parses — `core/adoption-metrics.js`, `core/agent-commands.js`.
- Non-file parses — `core/ledger-seal.js`.
- The helpers themselves — `core/fs-utils.js:60,84`.
- JSONL line-readers (out of scope under A).
- Dev/build tooling — `publish.js`, `release.js`, `sync-version.js`. Not shipped CLI logic; consolidate only if a given edit is free.

### Done criterion

- `grep -rn "JSON\.parse(fs\.readFileSync" scripts/` returns **0** shipped-CLI matches (dev tooling optionally remaining).
- `npm test` green — no new failures beyond the known pre-existing ones (completion-check wording drift ×3, flaky `legacy-references`).
- Each cluster committed separately with tests green before the next cluster begins.

### Commit shape (loop-friendly)

Cluster edits so one loop fire can land 1–2 clusters:

1. **`execution-validator`** (4 sites).
2. **`session-*`** — `session-commands`, `session-lock`, `session-manifest`, `completion-check`, `migrate-command`.
3. **`policy & rules`** — `loop-policy`, `governance-readiness`, `autonomous-policy`, `standards`.
4. **`schema loaders` + `state-migration`** — `validate-route`, `validate-loop-contract`, `state-migration`.

## Risk

**Low.** Replacement preserves failure semantics per the rule. Main watch: module-load schema reads run at `require()` time — `readJson` keeps their throw-on-load behavior identical, so no load-time behavior change.
