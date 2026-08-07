# Amber Agent Operating Manual

Last Reviewed: 2026-07-08

Operating rules for agents working on Amber Protocol (this repo). Command syntax lives in
`docs/CLI_REFERENCE.md`; this manual covers boundaries, gates, evidence, and routing.

## 1. Identity And Boundary

Amber Protocol is a repository-local, governance-first protocol layer. It is NOT a general agent
framework, live orchestration runtime, CI replacement, or automatic execution platform.

Never implement or imply support for:

- Dynamic workflow execution or live subagent dispatch.
- Automatic execution of target-project commands.
- Automatic rewrite of existing target-project docs or user-authored files.
- Scheduled/daemonized loop execution, cron, auto-PRs, or external-system writes.
- External marketplace publishing.

Hard consequences already enforced:

- `session start/continue --mode autonomous` is refused (exit 1) citing ADR-0001/0005.
- Experimental executors were deleted, not archived (ADR-0005). Do not reintroduce or "repair"
  them; recover reference code only via `git show v1.2.0:<path>`.
- Loop contracts carry `execution: { executesAnything: false }`; `loop run` is dry-run unless
  `--execute` plus an approval exists.

## 2. Control Priorities

When choices conflict, higher wins: 1 Governance, 2 Verification, 3 Observability, 4 Lifecycle,
5 Context, 6 Tooling, 7 Execution. Faster execution never beats clearer governance.

## 3. Vocabulary And Domain Docs

- `CONTEXT.md` at repo root is the canonical glossary; `UBIQUITOUS_LANGUAGE.md` is deprecated.
  Use glossary terms in issues, plans, and code; avoid the listed banned aliases
  (e.g. say "Amber Protocol", never the deprecated name "Coding Harness"; "Route", never "workflow/pipeline").
- Before working in an area, read `CONTEXT.md` (in multi-context repos, `CONTEXT-MAP.md` at the
  root routes to per-context `CONTEXT.md` files) and the relevant `docs/adr/` entries. If these
  files are absent, proceed silently — `/domain-modeling` creates them lazily; do not flag their
  absence or pre-create them.
- If your output contradicts an ADR, surface the conflict explicitly; never silently override.

## 4. Standard Lifecycle

```text
audit -> init -> governance report -> next -> plan -> gate -> verify -> approve -> handoff bundle -> handoff validate
```

- Inspect before mutating; prefer read-only/dry-run commands first.
- `init` and `wiki` are idempotent and never overwrite existing files.
- Treat gates as real checkpoints; record evidence before claiming pass/done.
- Leave handoff state before ending a session.
- Use `node scripts/amber.js governance report --target .` as the primary product-loop report: it
  scores readiness, names risks, and emits structured next actions.
- Use `node scripts/amber.js handoff bundle --target .` for the portable continuation artifact, then
  `node scripts/amber.js handoff validate --target .` before handing work to another agent or human.

## 5. Task Routes (routes/*.route.json)

- Feature (`feature-standard`): capture -> [approve plan] -> plan -> [approve implement] ->
  implement -> verify (`npm test`).
- Bugfix (`bugfix-quick`): reproduce -> [approve fix] -> fix -> verify. Reproduce BEFORE fixing.
- Refactor (`refactor-safe`): characterize behavior -> [approve refactor] -> refactor ->
  [approve merge] -> verify. No restructuring without a green characterization net.

## 6. Evidence And Feature State

- `feature_list.json` invariants (validator-enforced, doctor-checked): at most ONE feature
  `in_progress`; `passing` requires non-empty `evidence`; statuses are
  `not_started | in_progress | blocked | passing`.
- Any completion/pass/safe claim must name the command or inspection, its result/exit code, the
  artifact path or session id, and remaining risk. Without evidence it is only a claim.
- `amber session verify` without `--execute` records a claim tagged `executed: false`;
  `complete-check --strict` requires executed evidence. `verify --execute` runs in the working
  copy behind two gates: policy (`.amber/governance/rules.json`, deny-wins, default-deny) and
  tamper-evident ledger. Extend `rules.json` rather than bypassing a denied command.

## 7. Approval And Governed Execution

Explicit approval is required for: file mutation where policy demands it, governed command
execution, external writes/notifications, issue/branch/commit/PR creation, dependency/secret/
migration/release changes, and destructive git or filesystem operations.

`amber loop run --execute` needs all four gates; if any is missing, fall back to dry-run or
report-only:

1. Policy gate — command allowed by `.amber/governance/rules.json` (deny wins).
2. Approval gate — an unconsumed `amber loop approve`; one approval = one run.
3. Isolation gate — mutating work runs in an isolated git worktree, never the main checkout.
4. Evidence gate — the attempt lands in the tamper-evident hash-chain ledger
   (`amber loop verify-ledger`).

Worker output never approves itself: worker, reviewer, approval, and acceptance are separate records.

## 8. Handoff

A session is handoff-ready only when someone can continue without the chat transcript:
goal, work done, feature/session status, verification evidence, blockers, next action, recovery
instructions. Regenerate the live handoff with `node scripts/amber.js handoff --target .`, produce the
portable bundle with `node scripts/amber.js handoff bundle --target .`, and validate it with
`node scripts/amber.js handoff validate --target .`.

## 9. State Vs Docs

Stable knowledge -> `docs/wiki/`. Current state -> `feature_list.json`, `PROGRESS.md`,
`session-handoff.md`, session manifests, ledgers. Never put temporary status in wiki pages;
never invent architecture, commands, or business rules — mark unknowns as "needs confirmation".

## 10. Engineering Gates In This Repo

- `skills/<name>/SKILL.md` is the single source of truth. After editing, run
  `npm run gen:agents`; never edit generated platform surfaces (`.claude/commands/`,
  `.agents/skills/`, `.gemini/commands/amber/`). CI fails on drift via `gen:agents:check`.
- Before claiming done, all of these must pass (CI runs them on every push/PR):
  `npm test`, `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`.
  Wiki changes: `node scripts/validate-wiki.js --target .`.
- New CLI command -> one definition in `scripts/lib/command-help.js` plus its handler binding in
  `scripts/lib/command-dispatcher.js`; startup rejects missing or orphaned handlers. Schema change ->
  sync `schemas/*.schema.json` with `scripts/validate-*.js`. New template -> `templates/` +
  `scripts/lib/core/scaffolding.js`. New route -> `routes/*.route.json` per `schemas/route.schema.json`.
- Commits use conventional format: `feat|fix|refactor|docs|test|chore|perf|ci: <description>`.
- Release: pushing a `v*.*.*` tag auto-publishes ONLY when all CI jobs pass and the tag has no
  `-rc`/`-beta` suffix; pre-release tags skip publish.

## 11. Web Viewer (apps/web)

- Data-first, developer-native (DESIGN.md): semantic colors (emerald/amber/crimson) communicate
  state only; no hero metrics, gradients, decorative shadows, or layout-property animation.
- The viewer reads `.amber/` ONLY (ADR-0006). Do not add a `.harness` fallback; legacy repos must
  run `amber migrate` first. Reviews should not re-suggest viewer legacy support.
- Install with `npm install --legacy-peer-deps`. CLI code is CommonJS; web code is ES modules.

## 12. Issue Tracker And Triage

Issues live on GitHub `Bandersnatch0x/amber-protocol`; use the `gh` CLI for create/read/label/
close. Canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`.

## 13. Failure Patterns

Stop and re-check when any of these appear:

- Implementation starts before the plan or gate is clear.
- A dry-run result is described as if real execution happened.
- A completion claim has no evidence, or a verify claim is recorded without `--execute` and
  treated as executed.
- Chat history is treated as durable handoff.
- User-authored files are overwritten or normalized without approval.
- A worker reviews or approves its own output.
- A route or workflow pack is treated as a live execution engine.
- Policy, approval, isolation, or ledger requirements are bypassed for speed.
- A future or out-of-boundary capability is documented as already supported.

## 14. Core Maxim

Execution is cheap. Trusted execution requires artifacts, gates, evidence, and handoff.
