# Harness Execution-Trust Hardening

**Spec ID:** `harness-execution-trust-hardening`
**Status:** proposed
**Updated:** 2026-10-19
**Provenance:** audit of `AMBER_V4_SPEC_AND_PLAN_REVISED.md` (2026-10-19, user-requested, version numbers deliberately ignored); `docs/plans/harness-execution-trust-hardening.md`; ADR-0104 and ADR-0105 (2026-10-19); `issues/0044` (boundary map), `issues/0047` (runtime-interception ruling A), `issues/0053` (ContextSnapshot ≡ Loadout), `issues/0054` (provenance/assurance mapping), `issues/0059` (generic runtime adapter).
**Depends on:** F065–F082 (Harness H0–H7, implemented), ADR-0100 (contract), ADR-0101 (Run unit), ADR-0102 (event ledger), ADR-0103 (bounded runtime), ADR-0022 (no runner spawning), F068 (execution boundary), F069/F071 (context firewall), F073/F077 (validation receipt, eval-result binding), F081 (settlement and cancellation).
**Implementation plan:** `docs/plans/harness-execution-trust-hardening.md`.
**Tickets:** `issues/0171`–`0177` (local work queue).

> Normative contract for six execution-trust increments on the existing Harness stack:
> provider enforcement level, receipt verdict axes, PEP coverage over the four evidence
> classes, held-out evaluation with a leak check, release-manifest integrity, and a
> `settling` lifecycle phase. This spec adds no migration frame and no second state root:
> the repository has exactly one Harness implementation, so every requirement is an
> extension of shipped behavior, not a V3→V4 bridge.

## 1. Problem

The Harness H0–H7 stack records what happened and compares declared against observed
boundaries. It does not record three things a reader needs to judge execution trust:

1. **How strong the boundary is.** A local git worktree and a hardened container both read
   as "declared". "Network denied" and "network not enforced, merely unobserved" are
   indistinguishable.
2. **How complete the validation is.** `scripts/lib/harness/validation-core.js` records six
   closed checks (`policy`, `execution`, `tools`, `context`, `evidence`, `attempts`) each
   `pass|fail|not-run`, plus an optional `eval` leg. There is no receipt-level verdict, no
   gate verdict, no completeness, and no per-axis breakdown. An all-pass check set and a
   check set where nothing was looked at can read alike.
3. **What is outside Amber's view.** `issues/0047` ruling A records that unmediated host
   tool calls never traverse Amber's PEP. That fact is documented but not surfaced on the
   receipt, so "no side effect occurred" and "side effects occurred outside Amber's view"
   cannot be told apart.

Separately, evaluation has no held-out set (a set the agent under test cannot read), so
overfitting is undetectable; a receipt names no release manifest, so it cannot say *what*
it validated; and `completed` currently conflates "execution converged" with lifecycle
end.

## 2. Scope and non-goals

**In scope.** The six requirements in §3, all as extensions of shipped Harness behavior.

**Out of scope — each contradicts a decision already accepted in this repository, and each
requires its own reopening before it could be specified:**

| Excluded | Standing decision |
|---|---|
| Amber building or owning a sandbox runtime / hardened provider | ADR-0022; `issues/0044` out-of-scope; F068 |
| "No PEP receipt ⇒ not `completed`/`pass`" | `issues/0047` ruling A — the blind spot is declared, not closable |
| A standalone `ContextSnapshot` object | `issues/0053` — ContextSnapshot ≡ Loadout |
| A `provenance_tier` field on events | `issues/0054` — document mapping only; no duplicate field |
| A three-axis canonical lifecycle replacing the nine-state Run machine | ADR-0101 (accepted) |
| The full V4 HarnessContract field set | ADR-0100 — minimal contract, deliberately |
| V3→V4 dual-read / cutover / V3 writer retirement | No V3 writer exists; the shipped Harness is the only implementation |
| HTTP content negotiation (`Accept: amber.v4`) | No HTTP API layer exists (CLI + stdio MCP only) |

## 3. Requirements

### R-ET-1 — Provider enforcement level

**R-ET-1.1** The execution section of the Harness Contract carries an **`enforcement`**
level: `unsupported | observed-only | enforced`. The name is `enforcement`, never
"capability" — `scripts/lib/core/execution-domain-adapter.js` already exposes
`capabilities()` meaning the F052 `EFFECT_KINDS`, and the trusted-control `Capability` is
Scope×Target×Effect×Constraint.

**R-ET-1.2** The level is a **static function of the declared `workspace.type`**:
`git-worktree` and `local` → `observed-only`. No runtime provider probe exists and none is
introduced; a provider interface would make Amber own the sandbox (ADR-0022, `issues/0044`).
A future hardened provider enters only through the `execution-domain-adapter` seam
(`issues/0059`).

> **Deliberate gap (implementation choice, not a spec gap).** The spec fixes the *shape* of the
> mapping, not its table: the level must be a pure function of the declared `workspace.type`,
> monotone in provider strength (a stronger provider never resolves weaker), and the shipped
> `git-worktree`/`local` providers must resolve to `observed-only`. Which further `workspace.type`
> values exist, and what each resolves to, is settled in 0171 when a provider is actually added —
> pinning a table now would specify providers that do not exist. This is why the spec names only
> the two shipped values.

**R-ET-1.3** The declared level is frozen at admission inside the contract snapshot hash
(ADR-0100 decision 2). The effective level is derived by the same defaulting rule
`effectiveBoundaryOf` already applies to filesystem/network/mutation, and
**effective ⊆ declared** (downgrade-only). With no probe today effective equals declared;
the rule binds once a provider can deliver less than asked.

**R-ET-1.4** A contract requiring a level above the declared provider's ceiling (for
example `enforced` against `git-worktree`) is **refused at admission**. An observation that
exceeds an `observed-only` level yields `unevaluated`, never `ok`.

### R-ET-2 — Receipt verdict, gate verdict, completeness, and axes

**R-ET-2.1** A ValidationReceipt carries `verdict`
(`pass|fail|incomplete|unknown|not-run`), `gateVerdict`
(`pass|fail|incomplete|unknown|blocked|not-run`), `completeness`
(`complete|partial|not-evaluated`), and `axes` over
`functional|performance|security|provenance|context`.

**R-ET-2.2** **Every axis is always present.** This mirrors `evaluateChecks`, which always
adds all six checks and records `not-run` honestly when no evidence exists ("no
policy.evaluated event yet", "the run never executed", "no attempt records"). There is no
"not applicable" state — the existing check set has none.

**R-ET-2.3** The new fields are **derived** from existing evidence, never independently
writable.

**R-ET-2.4** Fail-closed. The receipt `verdict` is `pass` only when every check is `pass`:
a `not-run` check, a missing axis, a missing Context Firewall receipt, or missing evaluator
provenance yields `incomplete`/`not-run` and never `pass`. An **`observed-only` provider
(R-ET-1) does not veto the receipt `verdict`** — it caps the **`gateVerdict`**, which is
`pass` only when the provider can actually enforce. The two fields answer different
questions: `verdict` is "was the evidence complete and correct", `gateVerdict` is "how
strong was the governed gate". This keeps R-ET-3.2 true (a mediated-only run can still
reach `pass`) while still refusing to claim enforcement the provider cannot deliver.
`unknown` is a declared value the current derivation never emits — reserved for a
condition that is neither a check status nor an evidence gap.

### R-ET-3 — PEP coverage over the four evidence classes

**R-ET-3.1** The receipt records PEP coverage over the four evidence classes fixed by
ADR-0001's binding amendment `## Amendment (0047, 2026-09-16)`, each labelled distinctly and
never blended (E1–E4 as the owner spec labels them):

1. **E1** — Amber-recorded facts (requests, authorizations, ledger events) — observed facts about
   the mediation itself; they claim nothing about external behavior.
2. **E2** — Executor self-reports (runner receipts, adapter declarations) — **claims**; a
   fail-closed claim check, never an independent observation.
3. **E3** — Independently observed state (a worktree read performed by an Amber-mediated command,
   classified by `classifyDirtyPaths`) — repository-internal only; it can never establish
   the absence of network or out-of-repository effects.
4. **E4** — Unobservable host actions — **no record point in Amber, not even a claimed one**;
   assurance stays `unavailable`.

**R-ET-3.2** The blind spot **caps assurance; it does not veto the run.** A mediated-only
run can still reach `pass`. A `pass` may not rest on E2 or E4 as if they were
observations.

**R-ET-3.3** No code path promotes the blind-spot record into an enforcement claim.

**R-ET-3.4** The **normative owner** of the PEP-coverage contract is
`docs/specs/trusted-control-context-runtime-contract.md` §2 ("PEP coverage as an explicit
contract over evidence classes (0047)"), whose §2.2 matrix already fixes the E1–E4 classes and
their assurance ceilings. This spec adds only the **receipt surface** for those classes; it does
not restate the definitions (DRY), and `docs/specs/trusted-control-run-contract.md` does not own
them — the run contract records the run lifecycle, not PEP coverage.

### R-ET-4 — Held-out evaluation set and leak check

**R-ET-4.1** A held-out set is a **committed governed artifact**, revisioned and
content-addressed, pinned by `{identity, revision}` exactly as F077's
`resolveEvalResultBinding` pins an eval-result. It is never a tracked-tree file (the
worktree checkouts it) and never per-run ad-hoc input (unauditable, unreproducible).

**R-ET-4.2** It lives **outside the run workspace** — Amber-controlled state, never inside
the prepared worktree at `.amber/worktrees/<sessionId>`.

**R-ET-4.3** Reachability is governed by the declared context scope and filesystem deny
list, whose strength equals the provider enforcement level (R-ET-1). Under `enforced` a
read is denied; under `observed-only` a read is observable but not prevented.

**R-ET-4.4** The **leak check is the backstop**: it fails the eval when held-out content
appears in the run's accessible context or events — the control that holds under
`observed-only`. It shares the context-firewall seam rather than inventing a second surface.

**R-ET-4.5** No held-out binding ⇒ the eval axis is `not-run`, never `pass`. In a ValidationReceipt this reads as `heldOut.leak.status === "not-run"` (R-ET-4.5); a bound set records `pass` or `fail` and never `not-run`.

### R-ET-5 — Release manifest integrity

**R-ET-5.1** A release manifest binds the exact code/task/evaluator/provider/model versions
to a sha256, referenced by the ValidationReceipt.

**R-ET-5.2** **Write-time freeze + read-time re-derive**, exactly like the contract
snapshot: `inspectHarnessContract` re-derives `canonicalHashOf` on read and refuses a
mismatch.

**R-ET-5.3** Integrity is the re-derivation of the **stored snapshot**. Comparing the
manifest against *current* artifacts is a **separate staleness check**, not receipt
integrity; re-verifying artifact bytes at read would misreport every historical receipt once
the repository moves on.

**R-ET-5.4** A receipt whose stored manifest snapshot no longer hashes to its recorded
sha256 fails closed on read.

### R-ET-6 — `settling` as a formal phase

**R-ET-6.1** `settling` sits between `running` and the terminal states.

**R-ET-6.2** `completed` is reachable only through `settling`, so it means "execution
converged", never "passed".

**R-ET-6.3** A receipt verdict (R-ET-2) is independent of the run's terminal outcome.

**R-ET-6.4** This extends the ADR-0101 state model and is recorded as an **in-place
amendment** to ADR-0101 (`## Amendment (0176, <date>)`), the repository's convention for
extending an ADR (ADR-0001 ← ADR-0019/0047). A new ADR with an `Amends:` header is reserved
for reversing a standing prohibition (ADR-0103) and is not used here.

## 4. Compatibility

Every requirement is additive. Existing records that predate a requirement read as
"absent", never as a fabricated value:

- A run without an `enforcement` level reads as the default for its `workspace.type`
  (`observed-only` for `git-worktree`/`local`).
- A receipt without the new verdict fields (pre-R-ET-2) remains readable; the derived fields
  appear only when a receipt is produced by the new code path.
- A run without a held-out binding yields `not-run` on the eval axis (R-ET-4.5), never
  `pass`.
- A run without a release manifest is a known-absent binding (R-ET-5.1), not a silent pass.

No state root changes, no dual-write, no migration id. The append-only ledger remains the
single authority (ADR-0102).

## 5. Verification

Each requirement is verified by targeted unit tests plus the repository gates. The mapping
(test files located against baseline HEAD, 2026-10-19 — `contract-core.js` and
`execution-core.js` have no dedicated suite; they are exercised through the admission and
execution suites):

| Requirement | Test focus | Existing test file |
|---|---|---|
| R-ET-1 | admission refusal for an unmet level; `unevaluated` beyond `observed-only` | `tests/unit/harness-execution.test.js`, `tests/unit/surface-boundary.test.js` |
| R-ET-2 | derived verdict/axes; fail-closed conditions never `pass`; six-check behavior unchanged | `tests/unit/harness-control-plane.test.js`, `tests/unit/harness-replay.test.js` |
| R-ET-3 | four classes labelled distinctly; mediated-only run can `pass`; class-2/4 evidence cannot ground `pass` | `tests/unit/harness-control-plane.test.js` |
| R-ET-4 | leak check fails on access; set unreachable through declared scope; no binding ⇒ `not-run` | `tests/unit/canonical-artifact-contracts.test.js`, `tests/unit/canonical-artifacts.test.js` (F077 pinning), `tests/unit/harness-context.test.js` (leak seam) |
| R-ET-5 | tampered stored snapshot fails closed on read; stale manifest is a staleness finding, not an integrity failure | `tests/unit/harness-replay.test.js` (the receipt suite; 0175) |
| R-ET-6 | `completed` unreachable without `settling`; verdict independent of terminal outcome | `tests/unit/harness-run.test.js` |

Every change also runs the five repository gates defined in `docs/agents/dev-workflow.md`
stage 6 (`npm test`, `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`,
`node scripts/validate-wiki.js --target .`).

## 6. Rejected alternatives

- **A V3→V4 migration frame (the audited spec's M0–M7).** It assumes a legacy writer that
  does not exist. Freezing, dual-reading, and retiring a phantom implementation would
  produce process with no object.
- **Naming the level "capability".** Three meanings under one word: F052 `EFFECT_KINDS`,
  the trusted-control `Capability`, and enforcement strength.
- **A runtime provider probe.** Makes Amber own the sandbox (ADR-0022, `issues/0044`).
- **Treating a missing PEP receipt as a run failure.** Contradicts `issues/0047` ruling A;
  the blind spot caps assurance, it does not veto the run.
- **Held-out tests in the tracked tree.** Checked out into the worktree — readable by
  construction.
- **Re-verifying artifact bytes at receipt read.** Would misreport every historical receipt
  once the repository moves on; staleness is a separate check (R-ET-5.3).
- **A canonical-artifact-registry entry for the release manifest.** The registry holds
  *authored, revisioned* governance objects with lineage and traces; a release manifest is
  *derived* from the run it describes, so registering it would mint a revision lineage for
  something nobody authors. It is a schema-validated document frozen into the receipt
  (R-ET-5.2), which is what binds it.
- **A new ADR to add `settling`.** Overhead without content; in-place amendment is the
  established convention for extending an ADR.
