# F065: Harness H0 Foundation — Contract, Run, Event

**spec_id:** F065
**Status:** accepted
**Updated:** 2026-09-22
**Provenance:** Harness v2 proposal (2026-09-14, user-approved 2026-09-22); ADR-0100/0101/0102; wayfinder map `issues/0066`; blast-radius research `issues/0067`; six-audit decisions 2026-09-22; user confirmation 2026-09-22 (`issues/0069`, verdict `.scratch/orchestration/f065-harness-h0-dual-axis-review.md`)
**Feature:** F065

## Problem Statement

When a governed agent execution happens, no single repository artifact answers "who ran, under
what contract and policy, in which boundary, and what exactly happened" for that one run.
Intent lives in plans, continuity in sessions, gates in the ADR-0003 execution path — but a
successor (or a reviewer) cannot inspect one bounded execution as a unit: its frozen contract,
its lifecycle state, its event facts. Without these objects, the "Trusted Continuation"
evidence trail cannot later carry replay or per-run assurance, and the Harness v2 direction
(user decision 2026-09-22) has no foundation.

## Solution

Introduce three schema-governed objects and one expert-tier command surface, exactly as
decided in ADR-0100/0101/0102:

- **Harness Contract** — the versioned, immutable total contract of one run; admitted once,
  frozen as a Snapshot Hash (canonical-JSON SHA-256), stored under the harness state area.
- **Run** — one auditable bounded execution bound to a contract snapshot, with a closed
  nine-state machine and immutable terminal records.
- **Harness Event Ledger** — the tamper-evident, fail-closed, run-scoped ledger composed
  through `defineLedgerFamily` (the governed-ledger factory; no second hash chain).
- **`amber harness inspect|admit|status`** — an expert-tier, untyped CLI command (default
  seven-verb surface unchanged) that admits a contract and shows the
  Agent→Contract→Run→Events chain for inspection.

H0 grants no new execution authority: admission witnesses existing governed gates
(ADR-0003 loop execution remains the authoritative gate set); the ledger and state machine
are records, not runtime.

## User Stories

1. As a repository maintainer, I want one `amber harness inspect` view that shows the
   contract, its snapshot hash, the runs bound to it, and their event streams, so that I can
   answer "what is this execution allowed to do and what did it do" without reading code.
2. As a repository maintainer, I want a run's contract to be immutable after admission, so
   that a later policy or registry change cannot silently reshape an already-started run.
3. As a reviewer, I want every run to record its contract snapshot hash, so that I can verify
   which exact contract version an execution ran under.
4. As a reviewer, I want terminal run states (completed, failed, blocked, cancelled) to be
   preserved records, so that a failure is never rewritten into a success narrative.
5. As a maintainer, I want the **F066 vertical slice's** admission receipt to refuse when any
   check (identity, contract, policy, context, execution, approval pointer) is missing, so
   that fail-closed semantics hold once runs bind to real governed executions.
6. As a maintainer, I want the **F066 vertical slice's** admission to record pointers to the
   existing governed gates of the ADR-0003 execution path, so that Harness never becomes a
   second authority.
7. As an agent operator, I want every harness event to be append-only, run-scoped, and typed,
   so that I can attribute each action and decision to one run.
8. As an agent operator, I want the event ledger to reject reads on a corrupted or
   out-of-order chain, so that tampering is detectable rather than silent.
9. As a maintainer, I want the event type list to be a closed enum that grows only through
   additive schema changes, so that the ledger stays falsifiable.
10. As a maintainer, I want the run state machine to reject illegal transitions, so that
    lifecycle state is trustworthy evidence.
11. As a maintainer, I want `harness` to stay off the default seven-verb help surface, so
    that the newcomer path (audit→init→doctor→next→handoff) is unchanged.
12. As a package consumer, I want the new schemas shipped in the npm package, so that
    external tools can validate harness artifacts without cloning the repo.
13. As a successor agent or person, I want a run to reference its evidence bundle, so that I
    can continue from repository facts without the old chat (trusted continuation).
14. As a maintainer, I want legacy `loop`/`session`/`execution` records untouched in H0, so
    that existing governance state keeps its byte-compatibility guarantees.

## Implementation Decisions

- **Schemas**: three new files (`harness-contract`, `run`, `event`), `apiVersion`
  `amber.dev/v1`, validated exclusively through the existing schema-contract seam
  (`compileSchema`); no direct Ajv construction anywhere in harness modules (guard test).
- **Contract required fields**: `metadata.id`, `metadata.version`, `agent` (id, role),
  `governance.policy` reference; all other sections optional — absence means "governed by the
  referenced policy", never unbounded (ADR-0100).
- **Snapshot identity**: canonical-JSON SHA-256; admitted bytes stored under the harness state
  area; runs record the hash, never a mutable reference. `inspect --all` is a **list view**:
  a stored record that fails its re-hash is shown as a flagged tombstone (`corrupt: true`,
  no snapshot presented), while single-contract `inspect --contract` refuses closed — the
  list never presents unproven bytes as admitted, and never hides them.
- **Admission**: H0 delivers **contract admission** — schema validation, immutability, and
  fail-closed reads. The full six-check AdmissionReceipt (identity, contract, policy,
  context, execution, approval) is a **F066 vertical-slice** deliverable per ADR-0100
  decision 3: it witnesses the consumer's existing gate outcomes by pointer; a missing check
  refuses.
- **Run state machine**: closed nine-state set with exported `STATES`/`TRANSITIONS`/
  `isLegalTransition`/`legalTargets`/`isFinal`, in its own module under the harness core area;
  the session state machine is untouched; the only sanctioned bridge is the later vertical-
  slice mapping adapter.
- **Event ledger**: the `harness` family declared through `defineLedgerFamily` — chain hash,
  exclusive append lock, ceiling bounds, fail-closed reads inherited from the governed-ledger
  core; state paths resolve via the state-dir seam only.
- **CLI**: `harness` registered as an expert-tier, **untyped** command with subcommands
  `inspect`, `admit`, `status` (declared in the untyped-subcommand allowlist); registered in
  the command registry with help/usage; never in the default help projection.
- **Legacy**: no modification to loop/session/execution records or their validators in H0.
- **Naming discipline**: modules and docs avoid the legacy `harness-core` / quoted
  `.harness` / `coding-harness` identifiers (legacy-reference guard tests).

## Testing Decisions

- Test at the highest existing seams: the CLI JSON output seam (command dispatch → stdout
  JSON, following the existing CLI unit-test convention), the ledger-family behavior seam
  (append, lock, chain tamper rejection, ceiling, fail-closed read — mirroring the existing
  family suites), the state-machine seam (legal/illegal transition tables), and schema
  fixtures (valid/invalid/boundary per schema).
- A good test asserts externally observable behavior: JSON shapes, exit codes, refusal
  wordings, chain-verification outcomes — never internal helper calls.
- Registry/parity pins update in the same batch (schema count 22→25; command order array).
- No test writes state into the repository-root `.amber/sessions` (suite leak guard).

## Out of Scope

- Any execution authority, runner, scheduler, daemon, cron, or live dispatch (H7 boundary).
- Policy evaluation, capability registry, context firewall, replay engine, validation
  receipts (H1–H5 phases; fog on the wayfinder map).
- Repositioning the homepage story or amending the charter.
- Modifying session/route/loop/execution records or the MCP typed seam.
- The vertical slice (F066, separate spec).

## Further Notes

- The Harness v2 proposal's `src/` target layout stays aspirational; H0 modules live beside
  the governed core they compose (blast-radius research, `issues/0067`).
- User confirmation was given 2026-09-22 (`issues/0069`, "按推荐"); the two adjudicated wording
  fixes (stories 5–6 → F066; `inspect --all` tombstone semantics) are applied in this revision.
