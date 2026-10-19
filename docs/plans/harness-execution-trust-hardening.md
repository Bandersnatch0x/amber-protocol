# Plan: Harness execution-trust hardening

Spec: `docs/specs/harness-execution-trust-hardening.md` (spec_id `harness-execution-trust-hardening`, status `proposed`, updated 2026-10-19)
Status: proposed
Origin: audit of `AMBER_V4_SPEC_AND_PLAN_REVISED.md` (2026-10-19)
Baseline HEAD: `ce3f8c3fe85731019bd3d4a1d9a78ea29f56108f`
Supersedes: nothing (this plan replaces the V4 spec's migration frame, which is not adopted)

## 1. Origin and scope decision

The V4 spec was audited against the repository. Verdict: **not adopted as-is.**

Two structural reasons:

1. **No migration object.** The spec's M0–M7 frame (freeze V3 → dual-read → cutover → retire V3)
   assumes a running V3 writer alongside a new V4 one. The repository has exactly one
   implementation — the Harness H0–H7 stack (`feature_list.json` F065 accepted, F066–F082
   passing; ADR-0100/0101/0102/0103). There is no legacy harness event stream to wrap, no
   second state root to dual-read, and no HTTP layer to content-negotiate. §4.1, §9, and
   §10's M0/M1/M2/M6/M7 have no object.
2. **Six hard conflicts** with rulings already accepted in this repo (§2 below). Each is
   deferred to its own ADR; none is carried in this plan.

What survives the audit is six increments of genuine net-new hardening. This plan covers
only those.

## 2. Out of scope — deferred to individual ADRs

Each row is a V4 requirement that contradicts an accepted repo decision. Not in this plan.

| V4 requirement | Conflicts with | Disposition |
|---|---|---|
| §3.2 hardened Docker/CI provider as P0 | ADR-0022, `issues/0044` out-of-scope, F068 "Amber does not own the sandbox" | ADR: does Amber ever own a sandbox runtime, or only adapt to one? |
| §2.3 "no PEP receipt ⇒ not `completed`/`pass`" | `issues/0047` ruling A (declared blind spot — host tool calls never traverse Amber) | ADR: restate as recorded coverage, never as enforcement |
| §2.4 standalone `ContextSnapshot` object | `issues/0053` (ContextSnapshot ≡ Loadout; standalone object rejected) | ADR: reopen only if Loadout proves insufficient |
| §4.2 `provenance_tier` field on events | `issues/0054` (doc-only mapping Provenance↔Assurance; no field — DRY) | ADR: only if a consumer needs the field at runtime |
| §5 three-axis lifecycle | ADR-0101 (accepted nine-state Run machine) | ADR: reopen the state model, or keep nine states |
| §2.2 full HarnessContract field set | ADR-0100 (deliberately minimal; embedded policy text rejected) | ADR: which contract fields earn their place |

## 3. Increments

### A. Provider enforcement level

**Gap.** `scripts/lib/harness/execution-adapter.js` compares declared vs effective vs observed
boundaries (`EXECUTION_VERDICTS = ["ok","violation","unevaluated"]`), but never records
*whether the boundary is actually enforceable* by the backing provider. A local worktree and a
hardened container both read as "declared", so a caller cannot tell "network denied" from
"network not enforced, merely unobserved".

**Change.** Add an **`enforcement` level** `unsupported | observed-only | enforced` to the
execution section of the admitted contract and to the effective boundary. **Named `enforcement`,
never "capability"** — `execution-domain-adapter.js`'s `capabilities()` already means F052
`EFFECT_KINDS`, and the trusted-control `Capability` is Scope×Target×Effect×Constraint. The level
is **derived from the declared `workspace.type`** (`git-worktree`/`local` → `observed-only`); there
is no runtime provider probe and none is added (ADR-0022, `issues/0044`). Comparison
(`compareBoundaries`) consumes the effective (weaker) level and yields `unevaluated` — never
`ok` — when the observed side exceeds it; a contract requiring `enforced` against a
`git-worktree`/`local` provider is refused at admission.

**Touch points.** `scripts/lib/harness/execution-adapter.js`,
`schemas/execution-contract.schema.json` (the declared artifact — **not**
`schemas/harness-contract.schema.json`, whose `execution.workspace` is a reference *string*, not
the boundary map), `schemas/run.schema.json` (`$defs/executionBoundary` for the effective
boundary and `$defs/observedEntry` for the optional per-observation claim), `execution-core.js`.
Governed by ADR-0104.

**Acceptance.** A contract requiring `enforced` cannot be admitted against a `git-worktree`/`local`
provider; no code path claims `enforced` without a provider that can deliver it.

### B. ValidationReceipt verdict axes

**Gap.** `scripts/lib/harness/validation-core.js` records six closed checks
(`policy/execution/tools/context/evidence/attempts`) each `pass|fail|not-run`, plus the `eval`
check (`EVAL_OVERALL = ["pass","fail"]`). There is no single receipt-level verdict, no gate
verdict, no completeness, and no per-axis breakdown.

**Change.** Add to the receipt: `verdict` (`pass|fail|incomplete|unknown|not-run`),
`gateVerdict` (`pass|fail|incomplete|unknown|blocked|not-run`), `completeness`
(`complete|partial|not-evaluated`), and `axes` (`functional|performance|security|provenance|context`).
Fail-closed rules: a `not-run` check, a missing axis, a missing Context Firewall receipt, or missing
evaluator provenance can never yield `verdict: pass`; an `observed-only` provider can never yield
`gateVerdict: pass`. `verdict` answers "was the evidence complete and correct", `gateVerdict` answers
"how strong was the governed gate" — the split that keeps R-ET-3.2 ("a mediated-only run can still
reach `pass`") and R-ET-2.4 ("`observed-only` can never yield `pass`") from contradicting.

**Touch points.** `scripts/lib/harness/validation-core.js`, its receipt schema, `listReceipts`.

**Acceptance.** Existing six-check behaviour is unchanged; the new fields are derived, not
independently writable, and a receipt with any fail-closed condition reports `incomplete`/`not-run`.

### C. PEP coverage as a declared blind spot

**Gap.** `issues/0047` ruling A records that host tool calls do not traverse Amber's PEP. That
fact is documented but not surfaced on the receipt, so a reader cannot tell "no side effect
occurred" from "side effects occurred outside Amber's view".

**Change.** Record PEP coverage on the receipt over the **four evidence classes** ADR-0001's 0047
amendment fixes (Amber-recorded facts / executor self-reports / independently observed state /
unobservable host actions), each labelled distinctly, with the 0047 pointer — never as an
enforcement claim. The blind spot **caps assurance, it does not veto the run**: unmediated host
actions stay `unavailable` (not even CLAIMED), and a `pass` may not rest on E2/E4 as if
they were observations, but their presence does not itself fail the run.

**Touch points.** `scripts/lib/harness/validation-core.js`, `docs/specs/trusted-control-context-runtime-contract.md`
§2 (PEP-coverage owner — coverage note only; the run contract is **not** a touch point),
`issues/0047` cross-reference.

**Acceptance.** The receipt labels the four classes distinctly; a mediated-only run can still
`pass`; a `pass` whose evidence would rest on a claim or an unobservable action is refused.

### D. Hidden / held-out tests and leak checks

**Gap.** No such concept exists (`grep` for `held-out`/`held_out` across `scripts/`, `schemas/`,
`docs/specs/` is empty).

**Change.** A held-out evaluation set the agent under test cannot read, plus a leak check that
fails when held-out content appears in the run's accessible context. Binds into the `eval` check.

**Touch points.** new module under `scripts/lib/harness/`, `validation-core.js` eval binding,
`scripts/lib/core/context-*` (leak surface). Governed by ADR-0105.

**Acceptance.** A run that reads held-out content fails the leak check; the held-out set is not
reachable through the run's declared context scope.

### E. Release manifest sha256 binding

**Gap.** No `release_manifest` concept exists.

**Change.** A release manifest binding the exact code/task/evaluator/provider/model versions to
a sha256, referenced by the ValidationReceipt. Without it, a receipt cannot say *what* it
validated.

**Touch points.** new artifact + schema, `validation-core.js` receipt field, provenance report.

**Acceptance.** A receipt whose manifest sha256 does not match the current artifacts cannot be
`pass`.

### F. `settling` as a formal phase

**Gap.** `run-state-machine.js` has nine states with no explicit settling phase; settlement
exists (F081) but is not a named lifecycle step.

**Change.** Add `settling` between `running` and the terminal states so `completed` means
"execution converged", never "passed". This is a Run state-machine change and therefore needs
its own ADR (it touches ADR-0101) — **list it here but do not implement until that ADR lands**.

**Touch points.** `scripts/lib/harness/run-state-machine.js`, `scripts/lib/harness/run-core.js`,
`schemas/run.schema.json`, `scripts/lib/harness/event-ledger.js` (`HARNESS_EVENT_TYPES`).

**Acceptance.** `completed` is reachable only through `settling`; a receipt verdict is
independent of the run's terminal outcome.

## 4. Ticket breakdown (stage 5 preview)

Tracer bullets, each independently deliverable and gate-verified. Filed as local tickets
(`issues/`, gitignored work queue).

| # | Ticket | blocked-by |
|---|---|---|
| 1 | `issues/0171-provider-enforcement-level.md` — A: provider enforcement level | — |
| 2 | `issues/0172-validation-receipt-verdict-axes.md` — B: receipt verdict axes | 0171 |
| 3 | `issues/0173-pep-coverage-declared-blind-spot.md` — C: PEP coverage blind spot | 0172 |
| 4 | `issues/0174-held-out-eval-set-and-leak-check.md` — D: held-out set + leak check | 0172 |
| 5 | `issues/0175-release-manifest-sha256-binding.md` — E: release manifest binding | 0172 |
| 6 | `issues/0176-amend-adr-0101-for-settling-phase.md` — F: amend ADR-0101 for `settling` | — |
| 7 | `issues/0177-settling-phase.md` — F: `settling` phase (after 0176's ADR) | 0176 |

Ticket 0171 is the tracer: it touches the comparison seam every later ticket reads. No F-number
is assigned yet — `feature_list.json` carries only `accepted`/`passing`, so the number is claimed
when implementation is scheduled.

## 5. Gates (stages 6–7)

Per `docs/agents/dev-workflow.md`, each ticket's exit requires all five:

- `npm test`
- `npm run manifests`
- `npm run doctor`
- `npm run gen:agents:check`
- `node scripts/validate-wiki.js --target .`

Then stage 7: two-axis review (Standards + Spec) with all findings adjudicated, a
spec-to-code compliance pass with no `contradicts`, report under `.scratch/`, conclusion in the
ticket Log, and **delivery evidence** — the change merged to the default branch
(`git merge-base --is-ancestor <commit> origin/<default>`).

## 6. Resolved design questions (stage 3)

**Q1 — Where does `enforced` capability live? → Both; effective ⊆ declared; the comparison
consumes the effective (weaker) value.**

Declared capability sits in the contract's execution section (frozen at admission, inside the
snapshot hash — ADR-0100). Effective capability sits on the effective boundary
(`effectiveBoundaryOf` already mirrors the declared shape with defaults so the two stay
field-comparable). Effective can only *downgrade* from declared, exactly as the existing
boundary discipline allows. Consequence: a contract declaring `enforced` whose provider delivers
`observed-only` produces a comparison **finding**, and the verdict can never be `ok`.

**Q2 — Are B's axes always populated? → Always; `not-run` when there is no evidence; no N/A
state; any `not-run` axis caps `completeness` at `partial` and forbids `pass`.**

This mirrors the established check discipline: `evaluateChecks` always adds every one of the six
checks and records `not-run` honestly when there is no evidence ("no policy.evaluated event yet",
"the run never executed", "no attempt records"). The check set uses only `pass|fail|not-run` —
there is no "not applicable". The five axes follow the same rule: all are evaluable in principle
for a coding run, so `not-run` means "no evidence yet", never "irrelevant".

**Q3 — Where does D's held-out set live? → Outside the run's workspace, in Amber-controlled
state, pinned as a committed governed artifact by `{identity, revision}` (the F077 mechanism);
never a plain file in the tracked tree, never per-run ad-hoc input.**

Evidence: the worktree is created at `.amber/worktrees/<sessionId>` and `.amber/` is gitignored,
so it is outside the tracked tree — but a held-out set living in the tracked tree would land
straight in the worktree and leak. F077's `resolveEvalResultBinding` already establishes the
pattern of pinning a committed, revisioned, content-addressed artifact. Its protection is only
as strong as the provider's capability (Q1/A): under `observed-only` a leak is observable, not
prevented — so the leak check is the backstop, not the primary control.

**Q4 — When does E's manifest bind? → Write-time freeze + read-time re-derive (tamper →
fail-closed), exactly like the contract snapshot.**

`inspectHarnessContract` re-derives `canonicalHashOf` on read and refuses a mismatch;
`listHarnessContracts` does the same. The receipt is content-addressed and idempotent per
content. The manifest snapshot + sha256 is frozen into the receipt at write; integrity is the
re-derivation of that *stored snapshot*, not a comparison against current artifacts. Checking the
manifest against *current* artifacts is a separate staleness check (reuse the existing
staleness discipline) — re-verifying artifact bytes at read would misreport every historical
receipt once the repo moves on.

**ADRs written:** Q1 → `docs/adr/0104-provider-enforcement-level.md`; Q3 →
`docs/adr/0105-held-out-evaluation-set-boundary.md` (both Proposed, 2026-10-19). Q2 and Q4 are
direct applications of existing discipline and need no new ADR.

## 7. Sequence

1. ADR for ticket 6 (Run state model) can proceed in parallel with A/B.
2. A → B → {C, D, E} is the critical path.
3. F lands last, behind its ADR.
