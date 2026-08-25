# Architecture Survey — Deepening Opportunities (2026-08-24)

Read-only survey in the /improve-codebase-architecture spirit. Method: module inventory
(`wc -l` over scripts/lib and scripts/lib/core), require-frequency counts, then targeted
greps for repeated call patterns (result envelopes, Ajv construction, ledger reads, git
spawns, error-code literals). All findings name files, lines, suffering callers, and a
concrete deep shape. No code was changed.

Context honored: the dispatcher→domain-module extraction, renderer registry,
memory-policy split, seam-guard lexer, shared test fixtures, and the F035 sync
pipeline are treated as landed; findings below are the *next* layer, not re-proposals.

---

## Finding 1 — The command envelope + routing ritual: `shapeResult` and `createSubcommandDispatcher` exist but almost nobody uses them

**Files + lines**
- `scripts/lib/command-helpers.js:27-38` — `shapeResult(args, body, {exitCode, bypassPrint})`, the intended deep seam. Used only inside `scripts/lib/command-dispatcher.js` (7 call sites).
- `scripts/lib/subcommand-dispatcher.js:23-39` — `createSubcommandDispatcher` (declarative action table + envelope shaper). Used by exactly one adapter: `scripts/lib/maintenance/adapters/command.js`.
- Hand-rolled envelope sites (count of `bypassPrint` constructions per file): `scripts/lib/context/adapters/command.js` 27, `scripts/lib/command-dispatcher.js` 21, `scripts/lib/sync-commands.js` 15, `scripts/lib/projection-commands.js` 12, `scripts/lib/memory-commands.js` 8, `scripts/lib/knowledge-commands.js` 7, `scripts/lib/phase-commands.js` 6, `scripts/lib/org-audit-commands.js` 6, `scripts/lib/knowledge-plan/adapters/command.js` 5, `scripts/lib/hooks-commands.js` 2 — **~113 sites across 11 files**.
- Hand-rolled action routing (`if (sub === ...)` / `if (action === ...)` chains): feature-commands 12, sync-commands 12, projection-commands 7, phase-commands 6, knowledge-plan command 6, knowledge-commands 5, hooks-commands 5, org-audit-commands 4, workflow-assessment command 4, governance-commands 3 — **~64 sites**.

**Evidence (the shallow interface as it exists)**
Every domain command module re-types the same literal object, e.g. `scripts/lib/projection-commands.js:30-49`, `:55-64`, `:81-91`, `:113-137`, `:185-204`:
```js
return {
    result: { target: args.target, text: ..., errors: ..., warnings: [] },
    exitCode: ...,
    bypassPrint: !args.json,
};
```
The ritual has already drifted into **four competing conventions**:
1. `shapeResult` (command-helpers.js:27) — dispatcher only.
2. Inline literals with `bypassPrint: !args.json` (projection/sync/knowledge/org-audit/phase commands).
3. A private `ok()`/`fail()` pair in `scripts/lib/memory-commands.js:99-115` whose comment says it all: "Envelope helpers (mirror command-dispatcher handler shape)".
4. A private `errResult()`/`unknownAction()` pair in `scripts/lib/context/adapters/command.js:30-47` that uses `bypassPrint: false, exitCode: 1` — while `command-helpers.js:14-24` `unknownAction` returns *no* exitCode/bypassPrint at all and relies on the `exitCode ?? (errors.length ? 1 : 0)` default in `scripts/amber.js:121,125`.

Exit-code derivation also varies per module: `result.ok ? 0 : 1` (15 sites), `errors.length > 0 ? 1 : 0` (`sync-commands.js:67,88`), and hardcoded literals. The dispatcher's session bridge (`scripts/lib/command-dispatcher.js:280-290`) even duplicates the payload text into `errors: [sessionResult.text]`.

**Suffering callers**: ~113 envelope sites + ~64 routing branches in 11 command modules; every new subcommand author must re-learn which of four conventions their file uses; tests pin exact envelopes so conventions can never be reconciled piecemeal.

**Proposed deep shape**
Promote `createSubcommandDispatcher` + `shapeResult` into one composition, e.g.
`defineCommand({ actions, aliases, handlers, unknown })` where each handler returns only a *body* (`{text|data, errors, warnings, code?}`) and the dispatcher owns routing, aliasing, the envelope, and exit-code derivation (body.ok / errors-present rules in one place). The 11 modules shrink to handler tables; `memory-commands.js:99-115` and `context/adapters/command.js:30-47` are deleted, not mirrored. Note the constraint called out in `sync-commands.js:17-19` ("envelope byte-identical") — the shaper must reproduce the current envelope exactly, which `shapeResult` already does.

**Effort**: M — mechanical across 11 files, but wide; envelope byte-compatibility must be preserved for the tests that pin it.

---

## Finding 2 — The `.amber` state-dir seam is bypassed by 61 hardcoded path joins (with a live behavioral contradiction)

**Files + lines**
- The seam: `scripts/lib/state-dir-resolver.js:11-49` — `resolveStateDirForRead` (legacy `.harness` fallback + warn-once) and `resolveStateDirForCreate`. Deep and correct. 28 files use it.
- The bypass: **61 `path.join(..., ".amber", ...)` sites across 38 files**, including `scripts/lib/core/audit.js:502`, `scripts/lib/core/lifecycle.js:127`, `scripts/lib/core/context-request.js:119`, `scripts/lib/core/identity.js:91`, `scripts/lib/core/knowledge-base.js:53,57`, `scripts/lib/core/organization-audit.js:28,32`, `scripts/lib/core/memory-store.js:39-76`, `scripts/lib/core/context-store.js:20-46`, `scripts/lib/core/loop-execution.js:16`, `scripts/lib/core/doctor.js:514,555,578`, `scripts/lib/core/adoption-reports.js:476`, `scripts/lib/core/context-loadout.js:79`, `scripts/lib/core/phase-gates.js:95,101`, `scripts/lib/core/governance-report.js:250`.

**Evidence (the shallow interface)**
Each module decides state-dir policy for itself with a raw join. The contradiction is crisp because it involves the *same artifact*: `scripts/lib/session-commands.js:32-35` resolves the sessions dir through `resolveStateDirForRead` (legacy `.harness` repos work), while `scripts/lib/core/audit.js:502` reads `path.join(targetRoot, ".amber", "sessions")` — on a legacy repo, `amber session list` finds the sessions and `amber audit` counts zero. Same split for sessions in `lifecycle.js:127` and `context-request.js:119`.

Honest caveat: several bypassing features (knowledge, context, memory, org-audit ledgers) never existed under `.harness`, so for them the bypass is presently harmless. The cost is (a) the *sessions* surfaces, which do predate the rename, and (b) any future state-dir policy change (rename, env override, per-feature subdirs) now touches 38 files instead of one.

**Suffering callers**: 61 join sites in 38 files; plus users of `amber audit`/`amber doctor` on legacy `.harness` repositories who get silently wrong session counts today.

**Proposed deep shape**
Give `state-dir-resolver` (or `fs-utils`) path-building verbs so callers never concatenate the state dir again:
`statePath(targetRoot, ...segments)` (read policy) and `statePathForCreate(targetRoot, ...segments)`. Each of the 61 sites becomes a one-line replacement; the legacy fallback and the warn-once behavior become universal instead of per-module luck.

**Effort**: M — 61 mechanical edits, but each site needs a read-vs-create policy decision, and the sessions-surface behavior change (audit.js) should be covered by a legacy-fixture test.

---

## Finding 3 — Thirteen private Ajv adapters: the sync-envelope-contract exemplar was not generalized

> **Shipped (F042, 2026-08-25):** `scripts/lib/core/schema-contract.js` now owns every compile — one shared Ajv (`allErrors: true`), formats registered once plus the strict RFC 3339 `date-time`, a compile-once cache, and the generalized `formatErrors`. All 12 files migrated (session-manifest and validate-route keep eager throw-on-load; mcp-registry-loader uses `compileInline` for dynamic schemas), and `tests/unit/schema-contract-guard.test.js` fails on any new Ajv site outside the seam.

**Files + lines** (all `new Ajv` sites)
`scripts/lib/core/context-benchmark.js:20`, `context-ingest.js:27`, `context-loadout.js:55`, `context-request.js:27`, `context-source-adapter.js:13`, `sync-envelope-contract.js:23`, `scripts/lib/knowledge-plan/internal/validate.js:22`, `scripts/lib/mcp-invocation-coordinator.js:19`, `scripts/lib/mcp-registry-loader.js:28,100`, `scripts/lib/memory-commands.js:67`, `scripts/lib/session-manifest.js:21`, `scripts/lib/validate-route.js:18` — **13 constructions in 12 files**, each paired with its own schema-path `path.join(__dirname, ...)` and lazy-compile dance (e.g. `context-ingest.js:30-35`, `context-loadout.js:57-76`, `memory-commands.js:72-96`).

**Evidence (the shallow interface)**
F035 built the right thing in `sync-envelope-contract.js:21-31` (compile-once cache, format registered) and `:38-74` (`formatErrors`), but scoped it to one schema. Everywhere else re-implements the adapter with drift:
- **Diagnostics inconsistency**: `session-manifest.js:21` and `validate-route.js:18` use `new Ajv()` *without* `allErrors: true` — those surfaces report only the first schema error while the 11 others report all.
- **Format registration inconsistency**: `ajv-formats` is added in memory-commands/context-loadout/session-manifest/validate-route but not in the context-* validators; `sync-envelope-contract.js:24-26` hand-registers `date-time` instead.
- **Error-shaping duplication (~14 sites)**: the same `` `${e.instancePath || "/"} ${e.message}` `` mapper is re-typed with local variants at `context-ingest.js:359`, `context-loadout.js:74`, `context-source-adapter.js:37`, `context-benchmark.js:190`, `mcp-registry-loader.js:46`, `mcp-invocation-coordinator.js:31`, plus prefix/slice variants at `context-request.js:47`, `memory-commands.js:83,94`, `knowledge-plan/internal/validate.js:35-36`, `session-manifest.js:61`, `validate-route.js:27`.

**Suffering callers**: 12 files own schema plumbing instead of behavior; users see different error detail depending on which subsystem validated their payload.

**Proposed deep shape**
One `scripts/lib/core/schema-contract.js`: `validate(schemaName, data) -> {valid, errors[]}` — compiled-validator cache, `ajv-formats` + `date-time` registered once, and sync-envelope-contract's `formatErrors` generalized. `sync-envelope-contract.js` collapses to a one-line specialization; the other 12 files delete their Ajv/lazy-compile/format plumbing. This is the same move jsonl.js made for ledgers (architecture review #4), applied to schemas.

**Effort**: S-M — one new module plus 12 mechanical deletions; the only design work is normalizing the error-string prefixes tests may pin.

---

## Finding 4 — Git adapter drift: `git-exec` is canonical for four modules and bypassed by three, one of them brand-new F035 code

**Files + lines**
- The adapter: `scripts/lib/core/git-exec.js:9-34` — `gitOutput` (null on failure) and `gitRun` (`{ok, stdout, stderr}`). Users: `git-state.js:54-63`, `git-workflow-detector.js:24,30,95,189`, `completion-check.js:69-71`, `artifact-drift.js:38`.
- Bypasses: `scripts/lib/core/sync-session.js:73-88` defines a private `git()` returning a *third* shape `{exitCode, stdout, stderr}` (`exitCode: -1` for spawn failure); `scripts/lib/core/identity.js:56-66` has its own `gitConfig` returning `""` on failure; `scripts/lib/worktree-manager.js:11,26,57,77` calls `spawnSync("git", ...)` directly at four sites.

**Evidence (the shallow interface)**
The repo now has three incompatible "git failed / git absent" policies in flight: `null` (gitOutput), `""` (identity's gitConfig), and `{exitCode: -1}` (sync-session's git). That F035 — the freshest code — introduced the third shape is the tell that the seam is not discoverable enough. Worktree-manager additionally re-implements output trimming and status checking around each raw spawn.

**Suffering callers**: 3 modules (~10 call sites) maintain private wrappers; any future change to git invocation policy (e.g. timeouts, `--no-optional-locks`, env sanitization, git-absent handling) must be discovered and re-applied in four places.

**Proposed deep shape**
Extend `git-exec.js` with `gitExec(targetRoot, args) -> {ok, status, stdout, stderr}` (a superset that sync-session's `git()` maps onto exactly) and thin read-only conveniences (`isRepository`, `configGet`). Migrate sync-session, identity, worktree-manager onto it; delete the private wrappers. The "never throws, degrade gracefully" policy then lives in exactly one module.

**Effort**: S.

---

## Finding 5 — The fail-closed ledger ritual exists as four verbatim copies

**Files + lines**
- `scripts/lib/core/knowledge-base.js:73-87` (`corruptLedgerError`) and `scripts/lib/core/organization-audit.js:35-49` — byte-identical doc comment and body, differing only in the code constant.
- `scripts/lib/knowledge-commands.js:15-27` (`readFailure`) and `scripts/lib/org-audit-commands.js:15-27` (`readFailure`) — identical, differing only in the fallback code string.
- Consumers: `knowledge-commands.js:61,79` and `org-audit-commands.js:43,~70` wrap every ledger read in the same `try { read } catch (err) { return readFailure(args, err); }`.

**Evidence (the shallow interface)**
jsonl.js already absorbed the read/append/corruption-policy mechanics (architecture review #4), but the *typed fail-closed wrapper* — throw an Error carrying `.amberCode`, catch it in the command adapter, emit `{text: "", errors, code, exitCode: 1}` — is still copy-pasted per ledger family. The next ledger family (the pattern is established: every append-only artifact gets one) will copy it a fifth time.

**Suffering callers**: 4 duplicated definitions + 2 command adapters' catch blocks; the F035-S5 "decision D4" semantics live in comments rather than in a function name.

**Proposed deep shape**
Two small moves: (a) `jsonl.js` gains `readLedgerFailClosed(filePath, code)` that performs the read with `onCorrupt: "throw"` and rethrows with `.amberCode` attached; (b) `command-helpers.js` gains the `readFailure(args, err, fallbackCode)` envelope (subsumed by Finding 1's shaper if that lands first). knowledge-base and organization-audit each lose ~20 lines and the comments stop being the spec.

**Effort**: S.

---

## Finding 6 — 37 unguarded `AMBER_E_*` string literals: the catalog is a doc, not a type

**Files + lines**
- 37 bare `code: "AMBER_E_*"` literals across 9 files: `context-loadout.js` (13), `projection-registry.js` (6), `memory-commands.js` (5), `context-request.js` (5), `organization-audit.js` (4), `knowledge-base.js`, `governance-graph.js`, `context-retention.js`, `context-ingest.js` (1 each). Plus `.amberCode` assignments at `knowledge-base.js:86`, `organization-audit.js:48`.
- `codedError` is used by only 5 modules (`governed-runner`, `loop-ledger`, `planning`, `hooks-command`, `memory-commands`).
- `scripts/lib/core/error-catalog.js:457-459` — `codedError` silently degrades to a bare message for unknown codes, and `tests/unit/error-catalog.test.js:46` pins that degradation as intended.

**Evidence (the shallow interface)**
Nothing validates that the 37 literal codes exist in `CATALOG`. A typo'd code (`AMBER_E_CONTEXT_LOADOUT_REQURED`) compiles, passes its own unit test if the test matches the typo, and renders without the `[CODE] → fix:` remedy — the catalog's whole value. The format test (`error-catalog.test.js:17`) checks only the catalog's own keys.

**Suffering callers**: every consumer of `result.code` downstream (cli-output rendering, MCP `isError` surfaces, `explain`) trusts a string nobody checks; 9 authoring files can drift from the catalog silently.

**Proposed deep shape**
Either (a) export frozen constants from error-catalog (`CODES.AMBER_E_KB_CORRUPT`) so typos are require-time failures, or (b) minimal: one unit test that scans `scripts/lib` for `AMBER_E_[A-Z_]+` literals and asserts each resolves via `getEntry`. Option (a) also gives Finding 5's `readLedgerFailClosed` a typed input.

**Effort**: S.

---

## Ranked summary

| # | Finding | Leverage | Effort |
|---|---------|----------|--------|
| 1 | Command envelope + routing ritual (~113 envelope sites, ~64 routing branches, 4 conventions; both deep helpers already exist unused) | High | M |
| 2 | `.amber` state-dir seam bypass (61 joins / 38 files; live audit-vs-session-list contradiction on legacy `.harness` repos) | High | M |
| 3 | Schema-contract adapter not generalized (13 `new Ajv` sites / 12 files; inconsistent `allErrors`/formats; ~14 error-format variants) | Medium-High | S-M |
| 4 | Git adapter drift (3 bypassing modules, 3 failure shapes; F035 added the newest bypass) | Medium | S |
| 5 | Fail-closed ledger ritual copy-pasted 4x | Medium-Low | S |
| 6 | Unguarded `AMBER_E_*` literals (37 sites; silent remedy-loss on typo) | Low-Medium | S |

## Verified non-findings (checked and deliberately not proposed)

- **`core/fs-utils.js` (76 requires)** — already deep: small surface (`resolvePathWithin`, `readJsonSafe`, `pathExists`, ...), lots of symlink/escape behavior behind it.
- **`core/jsonl.js`** — the exemplar deep module from review #4; Findings 3 and 5 extend its pattern, they don't replace it.
- **`command-registry.js` (1236 lines)** — large but declarative: help text data plus a validated, frozen handler binding (`bindCommandHandlers:1103-1120`). Splitting it would reduce locality, not increase depth.
- **`session-commands.js` (873 lines)** — big, but cohesive session-lifecycle verbs behind `result()`; its real problem (envelope bridging) is Finding 1, not another extraction.
- **`core/cli-output.js` renderer registry, memory-policy split, seam-guard lexer, test fixture builders** — recently landed per the brief; not re-examined for re-proposals.
- **`state-dir-resolver.js` itself** — deep and right; Finding 2 is about adoption, not design.
